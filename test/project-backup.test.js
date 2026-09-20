const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectStore } = require('../src/store');
const { exportProjectBackup, importProjectBackup, validateBackup, digest } = require('../src/project-backup');

test('project backup preserves provenance and restores safe task state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-backup-')), file = path.join(dir, 'test.sqlite'), store = new ProjectStore(file);
  try {
    const source = { id: 'prj_1234567890abcdef', title: 'Vitamin D study', question: 'Study vitamin D and depression in adults', status: 'approved', createdAt: '2026-01-01T00:00:00.000Z', events: [], approvals: [{ id: 'approval_1' }] };
    store.save(source, 'project.created', { question: source.question });
    store.save(source, 'project.approved', { actor: 'tester' });
    store.saveJob('analysis-run', source.id, { projectId: source.id, status: 'running', startedAt: '2026-01-01T01:00:00.000Z' });
    store.saveJob('data-cache', source.id, { projectId: source.id, status: 'completed', files: [{ path: '/data/source.xpt' }], completedFiles: 1 });
    const backup = exportProjectBackup(source.id, store);
    assert.equal(backup.audit.chainVerified, true);
    assert.equal(backup.jobs.length, 2);
    const restored = importProjectBackup(backup, store);
    assert.notEqual(restored.id, source.id);
    assert.equal(restored.backupProvenance.sourceProjectId, source.id);
    assert.equal(restored.backupProvenance.sourceAuditEvents.length, 2);
    assert.equal(store.getJob('analysis-run', restored.id).status, 'cancelled');
    assert.equal(store.getJob('data-cache', restored.id).status, 'not_started');
    assert.ok(store.auditTrail(restored.id).every(event => event.verified === true));
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('project backup rejects changed content and tampered source audits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-backup-')), file = path.join(dir, 'test.sqlite'), store = new ProjectStore(file);
  try {
    const source = { id: 'prj_fedcba0987654321', title: 'Test', question: 'A sufficiently detailed research question', status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', events: [], approvals: [] };
    store.save(source, 'project.created', { question: source.question });
    const backup = exportProjectBackup(source.id, store), changed = structuredClone(backup);
    changed.project.title = 'Changed';
    assert.throws(() => validateBackup(changed), /摘要不匹配/);
    const auditChanged = structuredClone(backup);
    auditChanged.audit.events[0].payload.question = 'tampered';
    const { digest: ignored, ...payload } = auditChanged;
    auditChanged.digest = digest(payload);
    assert.throws(() => validateBackup(auditChanged), /审计链验证失败/);
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
