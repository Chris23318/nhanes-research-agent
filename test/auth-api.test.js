const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword } = require('../src/auth');

process.env.PUBMED_AUTO_SEARCH = 'false';
process.env.AUTH_USERNAME = 'admin';
process.env.AUTH_PASSWORD_HASH = hashPassword('test administrator password');
process.env.AUTH_SESSION_SECRET = 'test-session-secret-that-is-longer-than-thirty-two-characters';
process.env.AUTH_COOKIE_SECURE = 'false';
const { server } = require('../server');

let base;
test.before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('API authentication protects projects and requires CSRF for mutations', async () => {
  let response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authEnabled, true);
  response = await fetch(`${base}/api/projects`);
  assert.equal(response.status, 401);
  response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong password' }) });
  assert.equal(response.status, 401);
  response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test administrator password' }) });
  assert.equal(response.status, 200);
  const session = await response.json(), cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal(session.authenticated, true);
  assert.match(cookie, /^nhanes_session=/);
  response = await fetch(`${base}/api/projects`, { headers: { cookie } });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/projects`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Study vitamin D and depression in NHANES adults' }) });
  assert.equal(response.status, 403);
  response = await fetch(`${base}/api/projects`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ question: 'Study vitamin D and depression in NHANES adults' }) });
  assert.equal(response.status, 201);
  response = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie, 'x-csrf-token': session.csrfToken } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
