const crypto = require('node:crypto');

const COOKIE_NAME = 'nhanes_session';
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('password must contain 12 to 256 characters');
  const derived = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${Buffer.from(salt).toString('base64url')}$${derived.toString('base64url')}`;
}

function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  try {
    const salt = Buffer.from(parts[4], 'base64url'), expected = Buffer.from(parts[5], 'base64url');
    const actual = crypto.scryptSync(String(password || ''), salt, expected.length, { N, r, p, maxmem: SCRYPT.maxmem });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

function cookieValue(header, name) {
  for (const item of String(header || '').split(';')) {
    const index = item.indexOf('=');
    if (index > 0 && item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return null;
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAuth(config = process.env) {
  const passwordHash = config.AUTH_PASSWORD_HASH || '';
  const sessionSecret = config.AUTH_SESSION_SECRET || '';
  const required = config.AUTH_REQUIRED === 'true';
  const enabled = Boolean(passwordHash || sessionSecret || required);
  if (enabled && (!verifyPassword('invalid-password-probe', passwordHash) && !/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(passwordHash))) throw new Error('AUTH_PASSWORD_HASH is invalid; run node scripts/generate-auth.js');
  if (enabled && sessionSecret.length < 32) throw new Error('AUTH_SESSION_SECRET must contain at least 32 characters');
  const username = String(config.AUTH_USERNAME || 'admin').slice(0, 100);
  const ttlSeconds = Math.min(Math.max(Number(config.AUTH_SESSION_TTL_SECONDS) || 43200, 900), 604800);
  const secure = config.AUTH_COOKIE_SECURE !== 'false';
  const sign = value => crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  const issue = (now = Date.now()) => {
    const payload = Buffer.from(JSON.stringify({ sub: username, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + ttlSeconds, csrf: crypto.randomBytes(24).toString('base64url') })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  };
  const verify = (token, now = Date.now()) => {
    if (!enabled || typeof token !== 'string') return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || !safeEqualText(signature, sign(payload))) return null;
    try { const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return value.sub === username && Number.isInteger(value.exp) && value.exp > Math.floor(now / 1000) && typeof value.csrf === 'string' ? value : null; } catch { return null; }
  };
  const authenticate = req => verify(cookieValue(req.headers.cookie, COOKIE_NAME));
  const cookie = token => `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}${secure ? '; Secure' : ''}`;
  const expiredCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  return {
    enabled, username, verifyPassword: password => enabled && verifyPassword(password, passwordHash), issue, verify, authenticate, cookie, expiredCookie,
    session(req) { if (!enabled) return { enabled: false, authenticated: true, user: { id: 'local' }, csrfToken: null }; const value = authenticate(req); return value ? { enabled: true, authenticated: true, user: { id: value.sub }, csrfToken: value.csrf } : { enabled: true, authenticated: false, user: null, csrfToken: null }; },
    validCsrf(req, value) { return Boolean(value && safeEqualText(req.headers['x-csrf-token'], value.csrf)); }
  };
}

module.exports = { COOKIE_NAME, hashPassword, verifyPassword, createAuth };
