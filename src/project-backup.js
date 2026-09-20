const crypto = require('crypto');
const { id } = require('./domain');

const SCHEMA_VERSION = 'nhanes-project-backup/v1';
const JOB_SCOPES = ['data-cache', 'analysis-run', 'full-execution'];

function fail(message, code = 'INVALID_BACKUP') {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  throw error;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function verifyAudit(events = []) {
  let previous = '';
  for (const event of events) {
    if (!event || typeof event !== 'object') return false;
    if (!event.eventHash) continue;
    const payloadJson = JSON.stringify(event.payload || {});
    const expected = require('./store').ProjectStore.auditHash(event.projectId, event.eventType, payloadJson, event.createdAt, event.previousHash || '');
    if (event.previousHash !== (previous || null) || event.eventHash !== expected) return false;
    previous = event.eventHash;
  }
  return true;
}

function exportProjectBackup(projectId, store, serviceVersion = '2.20.0') {
  const project = store.get(projectId);
  if (!project) { const error = new Error('project not found'); error.status = 404; error.code = 'NOT_FOUND'; throw error; }
  const events = store.auditTrail(projectId, 5000);
  if (events.some(event => event.verified === false)) fail('审计链验证失败，已阻止导出', 'AUDIT_CHAIN_INVALID');
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: { service: 'nhanes-research-agent', version: serviceVersion, projectId },
    project,
    jobs: JOB_SCOPES.flatMap(scope => { const data = store.getJob(scope, projectId); return data ? [{ scope, data }] : []; }),
    audit: { chainVerified: events.every(event => event.verified !== false), events }
  };
  return { ...payload, digest: digest(payload) };
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) fail('备份文件格式无效');
  if (backup.schemaVersion !== SCHEMA_VERSION) fail('不支持的备份版本');
  if (!backup.project || typeof backup.project !== 'object') fail('备份缺少研究项目');
  if (!/^prj_[a-f0-9]{16}$/i.test(String(backup.project.id || ''))) fail('备份中的项目 ID 无效');
  if (backup.source?.projectId !== backup.project.id) fail('备份来源与项目 ID 不一致');
  if (typeof backup.project.question !== 'string' || backup.project.question.length < 10 || backup.project.question.length > 4000) fail('备份中的研究问题无效');
  if (!Array.isArray(backup.audit?.events) || backup.audit.events.length > 5000) fail('备份中的审计记录无效');
  if (backup.audit.events.some(event => event?.projectId !== backup.project.id)) fail('备份包含其他项目的审计记录');
  if (!Array.isArray(backup.jobs) || backup.jobs.length > JOB_SCOPES.length || backup.jobs.some(job => !JOB_SCOPES.includes(job?.scope) || !job.data || typeof job.data !== 'object')) fail('备份中的任务记录无效');
  if (backup.jobs.some(job => job.data.projectId && job.data.projectId !== backup.project.id)) fail('备份包含其他项目的任务记录');
  const { digest: supplied, ...payload } = backup;
  if (!/^[a-f0-9]{64}$/i.test(String(supplied || '')) || digest(payload) !== supplied) fail('备份摘要不匹配，文件可能已被修改', 'BACKUP_DIGEST_MISMATCH');
  if (!verifyAudit(backup.audit.events)) fail('备份审计链验证失败', 'AUDIT_CHAIN_INVALID');
  return backup;
}

function safeRestoredJob(job, projectId) {
  const copy = structuredClone(job.data);
  copy.projectId = projectId;
  copy.restoredFromBackup = true;
  if (['queued', 'running', 'cancelling'].includes(copy.status)) {
    copy.status = 'cancelled';
    copy.error = '导入时安全停止了未完成任务，请在项目中重新执行。';
    copy.finishedAt = new Date().toISOString();
  }
  if (job.scope === 'data-cache') {
    copy.restoredStatus = copy.status;
    copy.status = 'not_started';
    copy.files = [];
    copy.completedFiles = 0;
    copy.error = null;
  }
  return copy;
}

function importProjectBackup(input, store) {
  const backup = validateBackup(input), now = new Date().toISOString(), sourceProjectId = backup.project.id;
  const project = structuredClone(backup.project);
  project.id = id('prj');
  project.title = `${String(project.title || '未命名研究').slice(0, 180)}（备份恢复）`;
  project.createdAt = now;
  if (project.status === 'running') project.status = project.protocol ? 'awaiting_approval' : 'draft';
  project.backupProvenance = {
    sourceProjectId,
    sourceCreatedAt: backup.project.createdAt || null,
    exportedAt: backup.exportedAt,
    importedAt: now,
    digest: backup.digest,
    sourceVersion: backup.source?.version || null,
    sourceAuditChainVerified: true,
    sourceAuditEvents: backup.audit.events,
    sourceJobs: backup.jobs
  };
  store.save(project, 'project.backup_imported', { sourceProjectId, backupDigest: backup.digest, sourceAuditEvents: backup.audit.events.length, sourceJobs: backup.jobs.length });
  for (const job of backup.jobs) store.saveJob(job.scope, project.id, safeRestoredJob(job, project.id));
  return project;
}

module.exports = { SCHEMA_VERSION, JOB_SCOPES, canonical, digest, verifyAudit, exportProjectBackup, validateBackup, importProjectBackup };
