const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, createAuth } = require('../src/auth');

test('password hashes use bounded scrypt parameters and constant-time verification', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
});

test('signed sessions expire and bind a CSRF token', () => {
  const auth = createAuth({ AUTH_USERNAME: 'researcher', AUTH_PASSWORD_HASH: hashPassword('a sufficiently strong password'), AUTH_SESSION_SECRET: 'x'.repeat(48), AUTH_COOKIE_SECURE: 'false', AUTH_SESSION_TTL_SECONDS: '900' });
  const issuedAt = Date.parse('2026-01-01T00:00:00Z'), token = auth.issue(issuedAt), session = auth.verify(token, issuedAt + 1000);
  assert.equal(session.sub, 'researcher');
  assert.match(session.csrf, /^[A-Za-z0-9_-]+$/);
  assert.equal(auth.verify(token, issuedAt + 901000), null);
  assert.match(auth.cookie(token), /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(auth.cookie(token), /Secure/);
});

test('authentication refuses partial or weak server configuration', () => {
  assert.throws(() => createAuth({ AUTH_PASSWORD_HASH: hashPassword('a sufficiently strong password') }), /SESSION_SECRET/);
  assert.throws(() => createAuth({ AUTH_PASSWORD_HASH: 'invalid', AUTH_SESSION_SECRET: 'x'.repeat(48) }), /PASSWORD_HASH/);
});
