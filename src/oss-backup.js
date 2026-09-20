const fs = require('fs');
const path = require('path');
const OSS = require('ali-oss');

function truthy(value) { return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase()); }
function cleanError(error) { return String(error?.message || error || 'OSS upload failed').replace(/[\r\n]+/g, ' ').slice(0, 300); }

function normalizePrefix(value = 'nhanes-research-agent/backups') {
  const prefix = String(value).replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.length > 200 || prefix.split('/').some(part => part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) throw new Error('OSS_BACKUP_PREFIX contains unsafe characters');
  return prefix;
}

function readConfiguration(environment = process.env) {
  const isEnabled = truthy(environment.OSS_BACKUP_ENABLED);
  if (!isEnabled) return { enabled: false, configured: false };
  const region = String(environment.OSS_REGION || ''), bucket = String(environment.OSS_BUCKET || ''), accessKeyId = String(environment.OSS_ACCESS_KEY_ID || ''), accessKeySecret = String(environment.OSS_ACCESS_KEY_SECRET || '');
  const missing = [['OSS_REGION', region], ['OSS_BUCKET', bucket], ['OSS_ACCESS_KEY_ID', accessKeyId], ['OSS_ACCESS_KEY_SECRET', accessKeySecret]].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) return { enabled: true, configured: false, error: `missing ${missing.join(', ')}` };
  if (!/^oss-[a-z0-9-]+$/.test(region)) return { enabled: true, configured: false, error: 'invalid OSS_REGION' };
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return { enabled: true, configured: false, error: 'invalid OSS_BUCKET' };
  try {
    return { enabled: true, configured: true, region, bucket, accessKeyId, accessKeySecret, stsToken: environment.OSS_STS_TOKEN || undefined, prefix: normalizePrefix(environment.OSS_BACKUP_PREFIX), internal: environment.OSS_INTERNAL === undefined ? true : truthy(environment.OSS_INTERNAL) };
  } catch (error) { return { enabled: true, configured: false, error: cleanError(error) }; }
}

function objectKeys(prefix, filename, createdAt) {
  if (!/^nhanes-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/.test(filename)) throw new Error('invalid backup filename');
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid backup timestamp');
  const year = String(date.getUTCFullYear()), month = String(date.getUTCMonth() + 1).padStart(2, '0'), base = `${prefix}/${year}/${month}/${filename}`;
  return { database: base, checksum: `${base}.sha256`, manifest: `${base}.json` };
}

class OssBackupManager {
  constructor(options = {}) {
    this.configuration = options.configuration || readConfiguration(options.environment);
    this.client = options.client || null;
    this.active = null;
    this.lastSuccessAt = null;
    this.lastFailureAt = null;
    this.lastError = this.configuration.error || null;
    this.lastRequestId = null;
    this.lastObject = null;
    if (this.configuration.configured && !this.client) this.client = new OSS({ region: this.configuration.region, bucket: this.configuration.bucket, accessKeyId: this.configuration.accessKeyId, accessKeySecret: this.configuration.accessKeySecret, stsToken: this.configuration.stsToken, internal: this.configuration.internal, secure: true, timeout: 120000, retryMax: 2 });
  }

  status() {
    const failed = this.lastFailureAt && (!this.lastSuccessAt || Date.parse(this.lastFailureAt) > Date.parse(this.lastSuccessAt));
    return { enabled: this.configuration.enabled, configured: this.configuration.configured, ok: !this.configuration.enabled || (this.configuration.configured && !failed), state: !this.configuration.enabled ? 'disabled' : !this.configuration.configured ? 'misconfigured' : this.active ? 'uploading' : failed ? 'failed' : this.lastSuccessAt ? 'synced' : 'pending', region: this.configuration.configured ? this.configuration.region : null, internalEndpoint: this.configuration.configured ? this.configuration.internal : null, lastSuccessAt: this.lastSuccessAt, lastFailureAt: this.lastFailureAt, lastError: this.lastError, lastRequestId: this.lastRequestId };
  }

  async perform(snapshot) {
    if (!this.configuration.configured) throw new Error(this.configuration.error || 'OSS backup is not configured');
    if (!snapshot || !fs.existsSync(snapshot.destination) || !/^[a-f0-9]{64}$/.test(snapshot.checksum || '')) throw new Error('local backup snapshot is invalid');
    const filename = path.basename(snapshot.destination), keys = objectKeys(this.configuration.prefix, filename, snapshot.createdAt), checksumFile = `${snapshot.destination}.sha256`;
    if (!fs.existsSync(checksumFile)) throw new Error('local backup checksum file is missing');
    const metadata = { sha256: snapshot.checksum, createdat: snapshot.createdAt, service: 'nhanes-research-agent' };
    const database = await this.client.put(keys.database, snapshot.destination, { timeout: 120000, mime: 'application/vnd.sqlite3', meta: metadata });
    await this.client.put(keys.checksum, checksumFile, { timeout: 30000, mime: 'text/plain' });
    const manifest = Buffer.from(JSON.stringify({ schemaVersion: 'nhanes-oss-backup/v1', createdAt: snapshot.createdAt, object: keys.database, checksumObject: keys.checksum, sha256: snapshot.checksum, bytes: snapshot.bytes }));
    const completed = await this.client.put(keys.manifest, manifest, { timeout: 30000, mime: 'application/json' });
    this.lastSuccessAt = new Date().toISOString(); this.lastFailureAt = null; this.lastError = null; this.lastObject = keys.database;
    this.lastRequestId = completed?.res?.headers?.['x-oss-request-id'] || database?.res?.headers?.['x-oss-request-id'] || null;
    console.log(JSON.stringify({ event: 'backup.offsite_completed', at: this.lastSuccessAt, region: this.configuration.region, object: keys.database, requestId: this.lastRequestId }));
    return this.status();
  }

  upload(snapshot) {
    if (!this.configuration.enabled) return Promise.resolve(this.status());
    if (this.active) return this.active;
    this.active = this.perform(snapshot).catch(error => { this.lastFailureAt = new Date().toISOString(); this.lastError = cleanError(error); console.error(JSON.stringify({ event: 'backup.offsite_failed', at: this.lastFailureAt, error: this.lastError })); }).finally(() => { this.active = null; }).then(() => this.status());
    return this.active;
  }
}

module.exports = { OssBackupManager, truthy, cleanError, normalizePrefix, readConfiguration, objectKeys };
