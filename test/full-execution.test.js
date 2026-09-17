const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveVariables } = require('../src/catalog');
const { executeOnce, newJob, startFullExecution, cancelFullExecution } = require('../src/full-execution');

function approvedProject() {
  const intent = {
    cycles: ['2017-2018'],
    population: { ageMin: 20 },
    exposure: { term: 'serum 25-hydroxyvitamin D' },
    outcome: { term: 'depressive symptoms' }
  };
  return { id: 'prj_1234567890abcdef', status: 'approved', intent, variables: resolveVariables(intent), feasibility: { status: 'executable' } };
}

test('one-click execution completes validation, cache, R analysis and quality phases', async () => {
  const project = approvedProject();
  const job = newJob(project);
  await executeOnce(project, job, {
    validate: async manifest => ({ summary: { valid: manifest.files.length, total: manifest.files.length, invalid: 0, totalBytes: 1234 } }),
    startCache: () => ({ status: 'queued' }),
    getCache: () => ({ status: 'completed', completedFiles: 4, cachedFiles: 1, bytesDownloaded: 1234 }),
    startAnalysis: () => ({ status: 'queued' }),
    getAnalysis: () => ({ id: 'run_123', status: 'completed', result: { flow: { analytic_complete_case: 4009 } }, quality: { status: 'passed', summary: { passed: 8, failed: 0 } } }),
    pollMs: 1,
    maxWaitMs: 50
  });

  assert.deepEqual(job.phases.map(item => item.status), ['completed', 'completed', 'completed', 'completed']);
  assert.equal(job.analysis.quality, 'passed');
  assert.equal(job.analysis.result.flow.analytic_complete_case, 4009);
});

test('one-click execution refuses an unapproved protocol', () => {
  const project = approvedProject();
  project.status = 'awaiting_approval';
  assert.throws(() => startFullExecution(project), error => error.code === 'ANALYSIS_NOT_READY' && error.status === 409);
});

test('one-click execution records a failed data cache phase', async () => {
  const project = approvedProject();
  const job = newJob(project);
  await assert.rejects(executeOnce(project, job, {
    validate: async manifest => ({ summary: { valid: manifest.files.length, total: manifest.files.length, invalid: 0, totalBytes: 1 } }),
    startCache: () => ({ status: 'queued' }),
    getCache: () => ({ status: 'failed', error: 'CDC unavailable' }),
    pollMs: 1,
    maxWaitMs: 50
  }), /CDC unavailable/);
});

test('queued one-click execution can be cancelled without starting work', async () => {
  const project = { ...approvedProject(), id: 'prj_9999999999999999' };
  const started = startFullExecution(project);
  const cancelled = cancelFullExecution(project.id);
  assert.equal(cancelled.id, started.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.completedAt !== null, true);
  await new Promise(resolve => setImmediate(resolve));
});
