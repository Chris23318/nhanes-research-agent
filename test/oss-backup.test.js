const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OssBackupManager, normalizePrefix, readConfiguration, objectKeys } = require('../src/oss-backup');

test('OSS configuration is opt-in, complete and prefix constrained', () => {
  assert.equal(readConfiguration({}).enabled, false);
  const missing = readConfiguration({ OSS_BACKUP_ENABLED: 'true', OSS_REGION: 'oss-cn-hangzhou' });
  assert.equal(missing.configured, false);
  assert.match(missing.error, /OSS_BUCKET/);
  const configured = readConfiguration({ OSS_BACKUP_ENABLED: 'true', OSS_REGION: 'oss-cn-hangzhou', OSS_BUCKET: 'private-nhanes-backups', OSS_ACCESS_KEY_ID: 'id', OSS_ACCESS_KEY_SECRET: 'secret' });
  assert.equal(configured.configured, true);
  assert.equal(configured.internal, true);
  assert.throws(() => normalizePrefix('../unsafe'));
  assert.throws(() => objectKeys('safe', '../../database.sqlite', new Date().toISOString()));
});

test('OSS uploader writes database, checksum and completion manifest without exposing credentials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-oss-backup-')), filename = 'nhanes-2026-09-20T00-00-00-000Z.sqlite', database = path.join(root, filename), checksum = 'a'.repeat(64), calls = [];
  fs.writeFileSync(database, 'sqlite backup'); fs.writeFileSync(`${database}.sha256`, `${checksum}  ${filename}\n`);
  const client = { put: async (key, value, options) => { calls.push({ key, value, options }); return { res: { status: 200, headers: { 'x-oss-request-id': `request-${calls.length}` } } }; } };
  const configuration = { enabled: true, configured: true, region: 'oss-cn-hangzhou', bucket: 'private-nhanes-backups', accessKeyId: 'secret-id', accessKeySecret: 'secret-value', prefix: 'nhanes-research-agent/backups', internal: true };
  try {
    const manager = new OssBackupManager({ configuration, client }), status = await manager.upload({ destination: database, checksum, bytes: fs.statSync(database).size, createdAt: '2026-09-20T00:00:00.000Z' });
    assert.equal(status.state, 'synced');
    assert.equal(status.ok, true);
    assert.equal(calls.length, 3);
    assert.match(calls[0].key, /^nhanes-research-agent\/backups\/2026\/09\/nhanes-/);
    assert.match(calls[1].key, /\.sha256$/);
    assert.match(calls[2].key, /\.json$/);
    assert.equal(calls[0].options.meta.sha256, checksum);
    const manifest = JSON.parse(calls[2].value.toString('utf8'));
    assert.equal(manifest.sha256, checksum);
    assert.doesNotMatch(JSON.stringify(status), /secret-id|secret-value|private-nhanes-backups/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('OSS upload failures degrade only the off-site status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-oss-backup-')), filename = 'nhanes-2026-09-20T00-00-00-000Z.sqlite', database = path.join(root, filename), checksum = 'b'.repeat(64);
  fs.writeFileSync(database, 'sqlite backup'); fs.writeFileSync(`${database}.sha256`, 'checksum');
  const configuration = { enabled: true, configured: true, region: 'oss-cn-hangzhou', bucket: 'private-nhanes-backups', accessKeyId: 'id', accessKeySecret: 'secret', prefix: 'safe', internal: true };
  try {
    const manager = new OssBackupManager({ configuration, client: { put: async () => { throw new Error('temporary network failure'); } } }), status = await manager.upload({ destination: database, checksum, bytes: 10, createdAt: '2026-09-20T00:00:00.000Z' });
    assert.equal(status.state, 'failed');
    assert.equal(status.ok, false);
    assert.match(status.lastError, /temporary network failure/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
