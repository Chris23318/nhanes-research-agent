const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { buildDataManifest, CDC_HOST } = require('./data-manifest');

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_JOB_BYTES = 250 * 1024 * 1024;
const jobs = new Map();
const queue = [];
let workerActive = false;

function cacheRoot() {
  if (process.env.DATA_CACHE_PATH) return path.resolve(process.env.DATA_CACHE_PATH);
  const database = process.env.DATABASE_PATH;
  return database && database !== ':memory:' ? path.join(path.dirname(database), 'xpt-cache') : path.join(os.tmpdir(), 'nhanes-xpt-cache');
}
function safeProjectId(value) { if (!/^prj_[a-f0-9]{16}$/.test(value)) { const error = new Error('invalid project id'); error.status = 400; throw error; } return value; }
function assertOfficialFile(file) { const url = new URL(file.url); if (url.protocol !== 'https:' || url.hostname !== CDC_HOST || url.username || url.password || url.port || !/^\/Nchs\/Data\/Nhanes\/Public\/(?:19|20)\d{2}\/DataFiles\/[A-Z][A-Z0-9_]{1,40}_[A-Z]\.XPT$/i.test(url.pathname) || url.search || url.hash) { const error = new Error('data URL is not an approved CDC XPT file'); error.status = 400; throw error; } }
function publicJob(job) { return { id: job.id, projectId: job.projectId, status: job.status, totalFiles: job.totalFiles, completedFiles: job.completedFiles, cachedFiles: job.cachedFiles, bytesDownloaded: job.bytesDownloaded, currentFile: job.currentFile, error: job.error, startedAt: job.startedAt, completedAt: job.completedAt, files: job.files }; }
function cancellationError() { const error = new Error('data cache cancelled by user'); error.code = 'TASK_CANCELLED'; error.cancelled = true; return error; }

async function downloadFile(file, directory, fetchImpl, signal) {
  assertOfficialFile(file); fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${file.code}.XPT`), temporary = `${target}.part`;
  if (fs.existsSync(target)) { const stat = fs.statSync(target), header = Buffer.alloc(80), descriptor = fs.openSync(target, 'r'); try { fs.readSync(descriptor, header, 0, 80, 0); } finally { fs.closeSync(descriptor); } if (stat.size > 80 && stat.size <= MAX_FILE_BYTES && header.toString('ascii').startsWith('HEADER RECORD')) return { code: file.code, path: target, bytes: stat.size, cached: true }; fs.rmSync(target, { force: true }); }
  if (signal?.aborted) throw cancellationError();
  const timeoutSignal = AbortSignal.timeout(60000), requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetchImpl(file.url, { headers: { 'User-Agent': 'nhanes-research-agent/1.1' }, signal: requestSignal });
  if (!response.ok || !response.body) throw new Error(`CDC download failed for ${file.code}: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0); if (declared > MAX_FILE_BYTES) throw new Error(`${file.code} exceeds the file size limit`);
  let bytes = 0; const hash = crypto.createHash('sha256');
  const meter = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; if (bytes > MAX_FILE_BYTES) return callback(new Error(`${file.code} exceeds the file size limit`)); hash.update(chunk); callback(null, chunk); } });
  try { await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 })); const header = Buffer.alloc(80); const descriptor = fs.openSync(temporary, 'r'); try { fs.readSync(descriptor, header, 0, 80, 0); } finally { fs.closeSync(descriptor); } if (!header.toString('ascii').startsWith('HEADER RECORD')) throw new Error(`${file.code} has an invalid XPT signature`); fs.renameSync(temporary, target); return { code: file.code, path: target, bytes, sha256: hash.digest('hex'), cached: false }; }
  catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
}

async function runJob(job, manifest, options) {
  job.status = 'running'; const directory = path.join(cacheRoot(), job.projectId); let total = 0;
  try { for (const file of manifest.files) { if (job.cancelRequested) throw cancellationError(); job.currentFile = file.code; const result = await downloadFile(file, directory, options.fetchImpl || fetch, job.abortController.signal); total += result.bytes; if (total > MAX_JOB_BYTES) throw new Error('download job exceeds the total size limit'); job.completedFiles += 1; job.cachedFiles += result.cached ? 1 : 0; job.bytesDownloaded += result.cached ? 0 : result.bytes; job.files.push({ code: result.code, bytes: result.bytes, sha256: result.sha256 || null, cached: result.cached }); } job.status = 'completed'; job.completedAt = new Date().toISOString(); }
  catch (error) { job.status = job.cancelRequested || error.cancelled ? 'cancelled' : 'failed'; job.error = job.status === 'failed' ? error.message : null; job.completedAt = new Date().toISOString(); }
  finally { job.currentFile = null; }
}
function startDataCache(project, options = {}) {
  safeProjectId(project.id); const existing = jobs.get(project.id); if (existing && ['queued', 'running'].includes(existing.status)) return publicJob(existing);
  const manifest = buildDataManifest(project); if (!manifest.files.length) { const error = new Error('project has no supported CDC XPT files'); error.status = 409; throw error; }
  const job = { id: `job_${crypto.randomBytes(8).toString('hex')}`, projectId: project.id, status: 'queued', totalFiles: manifest.files.length, completedFiles: 0, cachedFiles: 0, bytesDownloaded: 0, currentFile: null, error: null, startedAt: new Date().toISOString(), completedAt: null, files: [], cancelRequested: false, abortController: new AbortController() };
  jobs.set(project.id, job); queue.push({ job, manifest, options }); setImmediate(drainQueue); return publicJob(job);
}
async function drainQueue() { if (workerActive) return; const next = queue.shift(); if (!next) return; workerActive = true; try { await runJob(next.job, next.manifest, next.options); } finally { workerActive = false; setImmediate(drainQueue); } }
function getDataCache(projectId) { safeProjectId(projectId); const job = jobs.get(projectId); return job ? publicJob(job) : { projectId, status: 'not_started', totalFiles: 0, completedFiles: 0, cachedFiles: 0, bytesDownloaded: 0, files: [] }; }
function cancelDataCache(projectId) { safeProjectId(projectId); const job = jobs.get(projectId); if (!job || !['queued','running'].includes(job.status)) return getDataCache(projectId); job.cancelRequested = true; if (job.status === 'queued') { const index = queue.findIndex(item => item.job === job); if (index >= 0) queue.splice(index, 1); job.status = 'cancelled'; job.completedAt = new Date().toISOString(); } else job.abortController.abort(cancellationError()); return publicJob(job); }

module.exports = { MAX_FILE_BYTES, MAX_JOB_BYTES, assertOfficialFile, downloadFile, startDataCache, getDataCache, cancelDataCache };
