const crypto = require('node:crypto');
const { hashPassword } = require('../src/auth');

const password = crypto.randomBytes(18).toString('base64url');
console.log(`AUTH_USERNAME=admin\nAUTH_PASSWORD_HASH=${hashPassword(password)}\nAUTH_SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}\nAUTH_COOKIE_SECURE=true\n\nADMIN_PASSWORD=${password}`);
