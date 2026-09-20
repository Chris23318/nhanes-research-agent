const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { ProjectStore } = require('../src/store');
const { BackupManager, BACKUP_PATTERN } = require('../src/backup-manager');

test('automatic backup creates an integrity-checked SQLite copy and checksum', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-auto-backup-')), database = path.join(root, 'nhanes.sqlite'), backupDir = path.join(root, 'backups'), store = new ProjectStore(database);
  try {
    store.save({ id: 'prj_backup00000001', question: 'A valid automatic backup research project', createdAt: new Date().toISOString() }, 'project.created');
    const manager = new BackupManager(store, { enabled: true, databasePath: database, backupDir, retentionDays: 7, maxFiles: 3 });
    const status = await manager.runNow();
    assert.equal(status.state, 'protected');
    assert.equal(status.fileCount, 1);
    assert.match(status.lastChecksum, /^[a-f0-9]{64}$/);
    const file = fs.readdirSync(backupDir).find(name => BACKUP_PATTERN.test(name));
    assert.ok(file);
    assert.ok(fs.existsSync(path.join(backupDir, `${file}.sha256`)));
    const copy = new DatabaseSync(path.join(backupDir, file), { readOnly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1);
    assert.equal(copy.prepare('PRAGMA quick_check(1)').get().quick_check, 'ok');
    copy.close();
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backup rotation only removes recognized expired backup files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-auto-backup-')), database = path.join(root, 'nhanes.sqlite'), backupDir = path.join(root, 'backups'), store = new ProjectStore(database);
  try {
    const manager = new BackupManager(store, { enabled: true, databasePath: database, backupDir, retentionDays: 1, maxFiles: 2 });
    await manager.runNow();
    const current = manager.backupFiles()[0].filename, old = path.join(backupDir, 'nhanes-2020-01-01T00-00-00-000Z.sqlite'), unrelated = path.join(backupDir, 'keep-me.txt');
    fs.copyFileSync(current, old); fs.writeFileSync(`${old}.sha256`, 'old'); fs.writeFileSync(unrelated, 'safe');
    fs.utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
    manager.rotate();
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(`${old}.sha256`), false);
    assert.equal(fs.existsSync(unrelated), true);
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
