const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { backup, DatabaseSync } = require('node:sqlite');

const BACKUP_PATTERN = /^nhanes-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sqlite$/;

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function automaticEnabled(options, environment = process.env) {
  if (options.enabled !== undefined) return Boolean(options.enabled);
  if (environment.AUTO_BACKUP_ENABLED !== undefined) return enabled(environment.AUTO_BACKUP_ENABLED);
  return environment.NODE_ENV === 'production';
}

function isoFilename(date) {
  return `nhanes-${date.toISOString().replaceAll(':', '-').replaceAll('.', '-')}.sqlite`;
}

async function fileDigest(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

class BackupManager {
  constructor(store, options = {}) {
    this.store = store;
    this.databasePath = options.databasePath ?? store.filename ?? process.env.DATABASE_PATH ?? ':memory:';
    this.enabled = automaticEnabled(options);
    this.intervalMs = boundedNumber(options.intervalHours ?? process.env.BACKUP_INTERVAL_HOURS, 24, 1 / 60, 168) * 60 * 60 * 1000;
    this.retentionDays = boundedNumber(options.retentionDays ?? process.env.BACKUP_RETENTION_DAYS, 14, 1, 365);
    this.maxFiles = Math.floor(boundedNumber(options.maxFiles ?? process.env.BACKUP_MAX_FILES, 30, 1, 365));
    this.backupDir = path.resolve(options.backupDir ?? process.env.BACKUP_PATH ?? (this.databasePath === ':memory:' ? path.join(require('os').tmpdir(), 'nhanes-backups') : path.join(path.dirname(this.databasePath), 'backups')));
    this.supported = this.databasePath !== ':memory:' && path.parse(this.backupDir).root !== this.backupDir;
    this.timer = null;
    this.active = null;
    this.nextRunAt = null;
    this.lastSuccessAt = null;
    this.lastFailureAt = null;
    this.lastError = null;
    this.lastChecksum = null;
    this.lastBackupBytes = 0;
    this.refreshFromDisk();
  }

  backupFiles() {
    if (!this.supported || !fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir, { withFileTypes: true }).filter(entry => entry.isFile() && BACKUP_PATTERN.test(entry.name)).map(entry => {
      const filename = path.join(this.backupDir, entry.name), stat = fs.statSync(filename);
      return { name: entry.name, filename, mtimeMs: stat.mtimeMs, bytes: stat.size };
    }).sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  refreshFromDisk() {
    let latest;
    try { latest = this.backupFiles()[0]; } catch (error) { this.lastFailureAt = new Date().toISOString(); this.lastError = String(error.message || error).slice(0, 300); return; }
    if (latest && !this.lastSuccessAt) {
      this.lastSuccessAt = new Date(latest.mtimeMs).toISOString();
      this.lastBackupBytes = latest.bytes;
    }
  }

  status() {
    let files = [];
    try { files = this.backupFiles(); } catch (error) { this.lastFailureAt ||= new Date().toISOString(); this.lastError ||= String(error.message || error).slice(0, 300); }
    const lastMs = this.lastSuccessAt ? Date.parse(this.lastSuccessAt) : NaN;
    const overdue = this.enabled && this.supported && Number.isFinite(lastMs) && Date.now() - lastMs > this.intervalMs * 2;
    const failed = this.lastFailureAt && (!this.lastSuccessAt || Date.parse(this.lastFailureAt) > Date.parse(this.lastSuccessAt));
    return {
      enabled: Boolean(this.enabled), supported: this.supported, ok: !this.enabled || (this.supported && !failed && !overdue),
      state: !this.enabled ? 'disabled' : !this.supported ? 'unsupported' : this.active ? 'running' : failed ? 'failed' : overdue ? 'overdue' : this.lastSuccessAt ? 'protected' : 'pending',
      lastSuccessAt: this.lastSuccessAt, lastFailureAt: this.lastFailureAt, lastError: this.lastError,
      nextRunAt: this.nextRunAt, intervalHours: this.intervalMs / 3600000, retentionDays: this.retentionDays,
      fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), lastBackupBytes: this.lastBackupBytes,
      lastChecksum: this.lastChecksum
    };
  }

  rotate(now = Date.now()) {
    const files = this.backupFiles(), cutoff = now - this.retentionDays * 86400000;
    for (const [index, file] of files.entries()) {
      if (index < this.maxFiles && file.mtimeMs >= cutoff) continue;
      const resolved = path.resolve(file.filename);
      if (!resolved.startsWith(`${this.backupDir}${path.sep}`)) throw new Error('unsafe backup path');
      fs.rmSync(resolved, { force: true });
      fs.rmSync(`${resolved}.sha256`, { force: true });
    }
  }

  async perform() {
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    const now = new Date(), name = isoFilename(now), destination = path.join(this.backupDir, name), partial = path.join(this.backupDir, `.${name}.${process.pid}.partial`);
    try {
      await backup(this.store.db, partial, { rate: 100 });
      const copy = new DatabaseSync(partial, { readOnly: true });
      const integrity = copy.prepare('PRAGMA quick_check(1)').get();
      copy.close();
      if (integrity?.quick_check !== 'ok') throw new Error('backup integrity check failed');
      const checksum = await fileDigest(partial);
      fs.renameSync(partial, destination);
      fs.writeFileSync(`${destination}.sha256`, `${checksum}  ${name}\n`, { mode: 0o600 });
      const stat = fs.statSync(destination);
      this.lastSuccessAt = now.toISOString();
      this.lastFailureAt = null;
      this.lastError = null;
      this.lastChecksum = checksum;
      this.lastBackupBytes = stat.size;
      try { this.rotate(now.getTime()); } catch (error) { console.error(JSON.stringify({ event: 'backup.rotation_failed', at: new Date().toISOString(), error: String(error.message || error).slice(0, 300) })); }
      console.log(JSON.stringify({ event: 'backup.completed', at: this.lastSuccessAt, bytes: stat.size, checksum }));
      return this.status();
    } catch (error) {
      fs.rmSync(partial, { force: true });
      fs.rmSync(destination, { force: true });
      fs.rmSync(`${destination}.sha256`, { force: true });
      this.lastFailureAt = new Date().toISOString();
      this.lastError = String(error.message || error).slice(0, 300);
      console.error(JSON.stringify({ event: 'backup.failed', at: this.lastFailureAt, error: this.lastError }));
      throw error;
    }
  }

  runNow({ force = true } = {}) {
    if (!this.enabled || !this.supported) return Promise.resolve(this.status());
    if (this.active) return this.active;
    const lastMs = this.lastSuccessAt ? Date.parse(this.lastSuccessAt) : NaN;
    if (!force && Number.isFinite(lastMs) && Date.now() - lastMs < this.intervalMs) return Promise.resolve(this.status());
    this.active = this.perform().finally(() => { this.active = null; }).then(() => this.status());
    return this.active;
  }

  schedule() {
    if (!this.enabled || !this.supported) return;
    clearTimeout(this.timer);
    const lastMs = this.lastSuccessAt ? Date.parse(this.lastSuccessAt) : NaN, delay = Number.isFinite(lastMs) ? Math.max(60000, this.intervalMs - (Date.now() - lastMs)) : 5000;
    this.nextRunAt = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(async () => { try { await this.runNow({ force: false }); } catch {} finally { this.schedule(); } }, delay);
    this.timer.unref();
  }

  start() { this.schedule(); return this.status(); }
  stop() { clearTimeout(this.timer); this.timer = null; this.nextRunAt = null; }
}

module.exports = { BACKUP_PATTERN, BackupManager, boundedNumber, enabled, automaticEnabled, isoFilename, fileDigest };
