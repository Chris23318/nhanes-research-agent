const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { executionGate, getAnalysisArchive } = require('../src/analysis-runner');

function project(overrides = {}) {
  return { id: 'prj_1234567890abcdef', status: 'approved', intent: { cycles: ['2017-2018'], population: { ageMin: 20 } }, variables: [{ variable: 'LBXVIDMS' }, { variable: 'DPQ010–DPQ090' }], ...overrides };
}

test('R execution gate requires approval and the supported exposure/outcome', () => {
  assert.equal(executionGate(project()).ready, true);
  assert.match(executionGate(project({ status: 'awaiting_approval' })).errors.join(' '), /not approved/);
  assert.match(executionGate(project({ variables: [{ variable: 'RIDAGEYR' }] })).errors.join(' '), /LBXVIDMS/);
});

test('completed R results download as an audited archive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-results-test-')), projectId = 'prj_abcdef1234567890', directory = path.join(root, 'results', projectId);
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'result.json'), '{"status":"completed"}'); fs.writeFileSync(path.join(directory, 'REPORT.md'), '# Report');
  const previous = process.env.DATA_ROOT; process.env.DATA_ROOT = root;
  try { const archive = getAnalysisArchive(projectId); assert.equal(archive[0], 0x1f); const tar = zlib.gunzipSync(archive).toString('utf8'); assert.match(tar, /result\.json/); assert.match(tar, /result-manifest\.json/); }
  finally { if (previous === undefined) delete process.env.DATA_ROOT; else process.env.DATA_ROOT = previous; fs.rmSync(root, { recursive: true, force: true }); }
});
