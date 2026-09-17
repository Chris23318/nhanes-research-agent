const crypto = require('crypto');
const { validateDataManifest, buildDataManifest } = require('./data-manifest');
const { startDataCache, getDataCache, cancelDataCache } = require('./data-cache');
const { startAnalysis, getAnalysis, cancelAnalysis } = require('./analysis-runner');

const jobs = new Map();
const queue = [];
let workerActive = false;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function phase(id, label) {
  return { id, label, status: 'pending', startedAt: null, completedAt: null, summary: null };
}

function publicJob(job) {
  return {
    id: job.id,
    projectId: job.projectId,
    status: job.status,
    currentPhase: job.currentPhase,
    phases: job.phases,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    analysis: job.analysis || null
  };
}
function cancellationError() { const error = new Error('full execution cancelled by user'); error.code = 'TASK_CANCELLED'; error.cancelled = true; return error; }
function assertActive(job) { if (job.cancelRequested) throw cancellationError(); }

function begin(job, id) {
  const item = job.phases.find(value => value.id === id);
  job.currentPhase = id;
  item.status = 'running';
  item.startedAt = new Date().toISOString();
  return item;
}

function complete(item, summary) {
  item.status = 'completed';
  item.completedAt = new Date().toISOString();
  item.summary = summary;
}

async function waitFor(getter, terminal, maxWaitMs, pollMs, job, cancel) {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (job?.cancelRequested) { cancel?.(); throw cancellationError(); }
    const value = getter();
    if (terminal.includes(value.status)) return value;
    if (Date.now() >= deadline) throw new Error(`execution timed out while ${value.status}`);
    await delay(pollMs);
  }
}

async function executeOnce(project, job, options = {}) {
  if (project.status !== 'approved') {
    const error = new Error('research protocol is not approved');
    error.status = 409;
    error.code = 'ANALYSIS_NOT_READY';
    throw error;
  }
  const deps = {
    validate: options.validate || (manifest => validateDataManifest(manifest)),
    startCache: options.startCache || (value => startDataCache(value)),
    getCache: options.getCache || (id => getDataCache(id)),
    startAnalysis: options.startAnalysis || (value => startAnalysis(value)),
    getAnalysis: options.getAnalysis || (id => getAnalysis(id)),
    cancelCache: options.cancelCache || (id => cancelDataCache(id)),
    cancelAnalysis: options.cancelAnalysis || (id => cancelAnalysis(id))
  };
  const pollMs = options.pollMs || 1000;
  const maxWaitMs = options.maxWaitMs || 20 * 60 * 1000;

  assertActive(job);
  const validationPhase = begin(job, 'validate_data');
  const validation = await deps.validate(buildDataManifest(project));
  assertActive(job);
  if (!validation.summary || validation.summary.invalid > 0 || validation.summary.valid !== validation.summary.total) {
    throw new Error('one or more CDC XPT files failed validation');
  }
  complete(validationPhase, { valid: validation.summary.valid, total: validation.summary.total, totalBytes: validation.summary.totalBytes });

  const cachePhase = begin(job, 'cache_data');
  deps.startCache(project);
  const cache = await waitFor(() => deps.getCache(project.id), ['completed', 'failed', 'cancelled'], maxWaitMs, pollMs, job, () => deps.cancelCache(project.id));
  if (cache.status !== 'completed') throw new Error(cache.error || 'data cache failed');
  complete(cachePhase, { files: cache.completedFiles, cachedFiles: cache.cachedFiles, bytesDownloaded: cache.bytesDownloaded });

  const analysisPhase = begin(job, 'run_analysis');
  deps.startAnalysis(project);
  const analysis = await waitFor(() => deps.getAnalysis(project.id), ['completed', 'failed', 'cancelled'], maxWaitMs, pollMs, job, () => deps.cancelAnalysis(project.id));
  if (analysis.status !== 'completed') throw new Error(analysis.error || 'R analysis failed');
  complete(analysisPhase, { runId: analysis.id || null, analyticN: analysis.result?.flow?.analytic_complete_case || null });

  const qualityPhase = begin(job, 'quality_report');
  if (analysis.quality?.status !== 'passed') throw new Error('analysis did not pass the publication quality gate');
  complete(qualityPhase, { status: analysis.quality.status, passed: analysis.quality.summary?.passed || 0, failed: analysis.quality.summary?.failed || 0 });
  job.analysis = { status: analysis.status, quality: analysis.quality?.status, result: analysis.result };
}

async function run(job, project, options) {
  job.status = 'running';
  try {
    await executeOnce(project, job, options);
    job.status = 'completed';
    job.currentPhase = null;
  } catch (error) {
    const current = job.phases.find(value => value.id === job.currentPhase);
    const cancelled = job.cancelRequested || error.cancelled;
    if (current) {
      current.status = cancelled ? 'cancelled' : 'failed';
      current.completedAt = new Date().toISOString();
      current.summary = cancelled ? { cancelled: true } : { error: String(error.message || error).slice(0, 500) };
    }
    job.status = cancelled ? 'cancelled' : 'failed';
    job.error = cancelled ? null : String(error.message || error).slice(0, 500);
  }
  job.completedAt = new Date().toISOString();
}

async function drain() {
  if (workerActive) return;
  const next = queue.shift();
  if (!next) return;
  workerActive = true;
  try { await run(next.job, next.project, next.options); }
  finally { workerActive = false; setImmediate(drain); }
}

function newJob(project) {
  return {
    id: `exec_${crypto.randomBytes(8).toString('hex')}`,
    projectId: project.id,
    status: 'queued',
    currentPhase: null,
    phases: [phase('validate_data', '验证 CDC 数据'), phase('cache_data', '缓存 XPT 文件'), phase('run_analysis', '执行 R survey 分析'), phase('quality_report', '质量检查与报告')],
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    analysis: null,
    cancelRequested: false
  };
}

function startFullExecution(project, options = {}) {
  if (project.status !== 'approved') {
    const error = new Error('research protocol is not approved');
    error.status = 409;
    error.code = 'ANALYSIS_NOT_READY';
    throw error;
  }
  const existing = jobs.get(project.id);
  if (existing && ['queued', 'running'].includes(existing.status)) return publicJob(existing);
  const job = newJob(project);
  jobs.set(project.id, job);
  queue.push({ job, project: structuredClone(project), options });
  setImmediate(drain);
  return publicJob(job);
}

function getFullExecution(projectId) {
  const job = jobs.get(projectId);
  return job ? publicJob(job) : { projectId, status: 'not_started', currentPhase: null, phases: [], startedAt: null, completedAt: null, error: null, analysis: null };
}
function cancelFullExecution(projectId) { const job = jobs.get(projectId); if (!job || !['queued','running'].includes(job.status)) return getFullExecution(projectId); job.cancelRequested = true; if (job.status === 'queued') { const index = queue.findIndex(item => item.job === job); if (index >= 0) queue.splice(index, 1); job.status = 'cancelled'; job.completedAt = new Date().toISOString(); } else { cancelDataCache(projectId); cancelAnalysis(projectId); } return publicJob(job); }

module.exports = { executeOnce, startFullExecution, getFullExecution, cancelFullExecution, newJob };
