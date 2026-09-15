const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const { createAnalysisArchive } = require('./archive');
const { markdownReport, htmlReport, flowSvg, forestSvg } = require('./report');
const { evaluateResult } = require('./quality');
const { generateRProject } = require('./analysis-package');
const jobs = new Map(), queue = [];
let workerActive = false;
function dataRoot() { return path.resolve(process.env.DATA_ROOT || (process.env.DATABASE_PATH && process.env.DATABASE_PATH !== ':memory:' ? path.dirname(process.env.DATABASE_PATH) : require('os').tmpdir())); }
function xptCacheRoot() { return process.env.DATA_CACHE_PATH ? path.resolve(process.env.DATA_CACHE_PATH) : path.join(dataRoot(),'xpt-cache'); }
function safeId(value) { if (!/^prj_[a-f0-9]{16}$/.test(value)) { const error = new Error('invalid project id'); error.status = 400; throw error; } return value; }
function executionGate(project) {
  const names = new Set((project.variables || []).map(item => item.variable)), errors = [], cycles = project.intent?.cycles || [];
  if (project.status !== 'approved') errors.push('research protocol is not approved');
  if (!cycles.length) errors.push('no approved NHANES cycles');
  if (project.modelSpec) {
    if (!require('./model-spec').verifyModelSpec(project.modelSpec)) errors.push('model specification digest is invalid');
    if (!project.cleaningApproval || project.modelSpec.cleaningDigest !== project.cleaningApproval.digest) errors.push('model specification does not match cleaning approval');
    if (project.status === 'approved' && project.protocol?.modelSpecDigest !== project.modelSpec.digest) errors.push('approved protocol does not bind the current model specification');
    if (project.modelSpec.status !== 'approved_for_code_generation_not_execution') errors.push('model specification is not approved');
    if (!['continuous','binary'].includes(project.modelSpec.outcomeFamily)) errors.push('unsupported generic outcome family');
    for (const key of ['weightVariable','strataVariable','psuVariable']) if (!names.has(project.modelSpec[key])) errors.push(`model ${key} is missing`);
    return { ready: errors.length === 0, errors, mode: 'generic_survey_v1' };
  }
  if (project.feasibility && project.feasibility.status !== 'executable') errors.push(`research feasibility is ${project.feasibility.status}`);
  if (!names.has('LBXVIDMS')) errors.push('supported exposure LBXVIDMS is missing');
  if (![...names].some(name => String(name).startsWith('DPQ010'))) errors.push('supported PHQ-9 outcome mapping is missing');
  return { ready: errors.length === 0, errors, mode: 'vitamin_d_phq9_v1' };
}
function view(job) { let result = null, quality = null; if (job.status === 'completed') { try { result = JSON.parse(fs.readFileSync(path.join(job.outputDir, 'result.json'), 'utf8')); quality = evaluateResult(result); } catch {} } return { id: job.id, projectId: job.projectId, status: job.status, gate: job.gate, startedAt: job.startedAt, completedAt: job.completedAt, error: job.error, result, quality }; }
function executeR(args, cwd, timeoutMs) { return new Promise((resolve, reject) => { const child = spawn('Rscript', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: '/tmp', LANG: 'C.UTF-8' } }); let logs = '', settled = false; const collect = chunk => { logs = (logs + chunk.toString('utf8')).slice(-16000); }; child.stdout.on('data', collect); child.stderr.on('data', collect); const finish = (error, code) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(Object.assign(error,{logs})) : code === 0 ? resolve(logs) : reject(Object.assign(new Error(`R exited with code ${code}`),{logs})); }; const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('R analysis exceeded the 10 minute limit')); }, Math.max(1, timeoutMs)); child.on('error', error => finish(error)); child.on('exit', code => finish(null, code)); }); }
async function run(job) {
  job.status = 'running'; fs.mkdirSync(job.outputDir, { recursive: true });
  fs.rmSync(path.join(job.outputDir, 'result.json'), { force: true });
  let logs = ''; const deadline = Date.now() + 10 * 60 * 1000;
  try {
    if (job.mode === 'generic_survey_v1') {
      const artifact = generateRProject(job.project);
      if (!artifact.readiness.ready) throw new Error(artifact.readiness.errors.join('; '));
      const scriptDir = path.join(job.outputDir, 'generated-scripts'); fs.mkdirSync(scriptDir, { recursive: true });
      for (const name of ['cleaning-draft.R','prepare-data.R','model.R','analysis-spec.json','data-manifest.json']) fs.writeFileSync(path.join(scriptDir,name),artifact.files[name],{mode:0o600});
      logs += await executeR([path.join(scriptDir,'prepare-data.R'),job.cacheDir,job.outputDir],scriptDir,deadline-Date.now());
      logs += await executeR([path.join(scriptDir,'model.R'),path.join(job.outputDir,'merged.rds'),job.outputDir],scriptDir,deadline-Date.now());
    } else logs += await executeR(['/app/runner/analysis.R',job.cacheDir,job.outputDir,String(job.cycles),String(job.ageMin)],process.cwd(),deadline-Date.now());
    if (!fs.existsSync(path.join(job.outputDir,'result.json'))) throw new Error('R completed without result.json');
    job.status = 'completed';
  } catch (error) { logs = `${logs}\n${error.logs || ''}`.slice(-16000); job.status = 'failed'; job.error = error.message; }
  job.completedAt = new Date().toISOString(); fs.writeFileSync(path.join(job.outputDir,'execution.log'),logs.slice(-16000),{mode:0o600});
}
async function drain() { if (workerActive) return; const job = queue.shift(); if (!job) return; workerActive = true; try { await run(job); } finally { workerActive = false; setImmediate(drain); } }
function startAnalysis(project) { safeId(project.id); const gate = executionGate(project); if (!gate.ready) { const error = new Error(gate.errors.join('; ')); error.status = 409; error.code = 'ANALYSIS_NOT_READY'; throw error; } if(gate.mode==='generic_survey_v1'){const readiness=generateRProject(project).readiness;if(!readiness.ready){const error=new Error(readiness.errors.join('; '));error.status=409;error.code='ANALYSIS_NOT_READY';throw error}} const existing = jobs.get(project.id); if (existing && ['queued', 'running'].includes(existing.status)) return view(existing); const root = dataRoot(), job = { id: `run_${crypto.randomBytes(8).toString('hex')}`, projectId: project.id, project: structuredClone(project), mode:gate.mode, status: 'queued', gate, cacheDir: path.join(xptCacheRoot(), project.id), outputDir: path.join(root, 'results', project.id), cycles: project.intent.cycles.length, ageMin: project.intent.population?.ageMin || 18, startedAt: new Date().toISOString(), completedAt: null, error: null }; if (!fs.existsSync(job.cacheDir)) { const error = new Error('approved XPT data cache is missing'); error.status = 409; error.code = 'DATA_CACHE_MISSING'; throw error; } jobs.set(project.id, job); queue.push(job); setImmediate(drain); return view(job); }
function getAnalysis(projectId) { safeId(projectId); const job = jobs.get(projectId); if (job) return view(job); const outputDir = path.join(dataRoot(), 'results', projectId), resultFile = path.join(outputDir, 'result.json'); if (fs.existsSync(resultFile)) { const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')); return { projectId, status: 'completed', result, quality: evaluateResult(result) }; } return { projectId, status: 'not_started', result: null, quality: null }; }
function reportFiles(project) { safeId(project.id); const outputDir = path.join(dataRoot(), 'results', project.id), resultFile = path.join(outputDir, 'result.json'); if (!fs.existsSync(resultFile)) { const error = new Error('completed analysis result is missing'); error.status = 404; throw error; } const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')), quality = evaluateResult(result); if (quality.status !== 'passed') { const error = new Error('analysis result did not pass the publication quality gate'); error.status = 422; error.code = 'QUALITY_GATE_FAILED'; error.quality = quality; throw error; } const files = {}; for (const name of ['result.json', 'model-coefficients.csv', 'sensitivity-coefficients.csv', 'model-sample-flow.csv', 'sample-flow.csv', 'session-info.txt', 'REPORT.md', 'execution.log']) { const file = path.join(outputDir, name); if (fs.existsSync(file)) files[name] = fs.readFileSync(file, 'utf8'); } if(result.analysisMode==='generic_survey_v1'){const scriptDir=path.join(outputDir,'generated-scripts');for(const name of ['cleaning-draft.R','prepare-data.R','model.R','analysis-spec.json','data-manifest.json']){const file=path.join(scriptDir,name);if(fs.existsSync(file))files[`generated-${name}`]=fs.readFileSync(file,'utf8')}const modelFile=path.join(outputDir,'model.rds');if(fs.existsSync(modelFile))files['model.rds']=fs.readFileSync(modelFile)} files['quality-report.json'] = JSON.stringify(quality, null, 2); files['quality-checks.csv'] = ['id,severity,status,message', ...quality.checks.map(item => [item.id,item.severity,item.status,item.message].map(value=>`"${String(value).replaceAll('"','""')}"`).join(','))].join('\n'); files['REPORT.zh-CN.md'] = markdownReport(project, result); files['report.html'] = htmlReport(project, result); files['flow-diagram.svg'] = flowSvg(result); files['forest-plot.svg'] = forestSvg(result); return { result, quality, files }; }
function getAnalysisArchive(project) { const { files } = reportFiles(project); files['result-manifest.json'] = JSON.stringify({ schemaVersion: '1.1', projectId: project.id, files: Object.entries(files).map(([name, value]) => ({ name, bytes: Buffer.byteLength(value), sha256: crypto.createHash('sha256').update(value).digest('hex') })) }, null, 2); return createAnalysisArchive({ files }); }
function getAnalysisReport(project) { return reportFiles(project).files['report.html']; }
function getAnalysisQuality(projectId) { const analysis = getAnalysis(projectId); if (analysis.status !== 'completed') { const error = new Error('completed analysis result is missing'); error.status = 404; throw error; } return analysis.quality; }
module.exports = { executionGate, startAnalysis, getAnalysis, getAnalysisArchive, getAnalysisReport, getAnalysisQuality };
