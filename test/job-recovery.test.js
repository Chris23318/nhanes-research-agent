const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ProjectStore } = require('../src/store');

test('active jobs are recovered from SQLite after a process restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-job-recovery-'));
  const database = path.join(root, 'state.sqlite');
  const cacheDir = path.join(root, 'xpt-cache', 'prj_2222222222222222');
  fs.mkdirSync(cacheDir, { recursive: true });
  const project = {
    id: 'prj_2222222222222222',
    status: 'approved',
    intent: { cycles: ['2017-2018'], population: { ageMin: 20 } },
    variables: [{ variable: 'LBXVIDMS', source: 'VID' }, { variable: 'DPQ010–DPQ090', source: 'DPQ' }],
    feasibility: { status: 'executable' }
  };
  const manifest = { projectId: project.id, files: [{ code: 'VID_J', url: 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/VID_J.XPT' }] };
  const common = { projectId: project.id, status: 'running', startedAt: '2026-01-01T00:00:00.000Z', completedAt: null, error: null };
  const store = new ProjectStore(database);
  store.saveJob('data-cache', project.id, { ...common, id: 'job_saved', totalFiles: 1, completedFiles: 0, cachedFiles: 0, bytesDownloaded: 0, currentFile: 'VID_J', files: [], manifest });
  store.saveJob('analysis', project.id, { ...common, id: 'run_saved', project, mode: 'vitamin_d_phq9_v1', gate: { ready: true, errors: [], mode: 'vitamin_d_phq9_v1' }, cacheDir, outputDir: path.join(root, 'results', project.id), cycles: 1, ageMin: 20 });
  store.saveJob('full-execution', project.id, { ...common, id: 'exec_saved', project, currentPhase: 'cache_data', phases: [], analysis: null });
  store.close();

  const script = `
    const cache = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'data-cache.js'))});
    const analysis = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'analysis-runner.js'))});
    const full = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'full-execution.js'))});
    const id = 'prj_2222222222222222';
    const result = [cache.getDataCache(id), analysis.getAnalysis(id), full.getFullExecution(id)];
    cache.cancelDataCache(id); analysis.cancelAnalysis(id); full.cancelFullExecution(id);
    console.log(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, DATABASE_PATH: database, DATA_CACHE_PATH: path.join(root, 'xpt-cache'), DATA_ROOT: root }, timeout: 10000 });
  try {
    assert.equal(child.status, 0, child.stderr);
    const recovered = JSON.parse(child.stdout.trim());
    assert.deepEqual(recovered.map(job => job.status), ['queued', 'queued', 'queued']);
    assert.deepEqual(recovered.map(job => job.recovered), [true, true, true]);
    assert.equal(recovered[0].completedFiles, 0);
    assert.equal(recovered[2].phases.length, 4);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
