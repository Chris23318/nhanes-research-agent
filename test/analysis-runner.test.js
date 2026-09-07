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
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ status: 'completed', weightRule: 'WTMEC2YR / 1', flow: { merged: 10, adults: 9, complete_phq9: 8, analytic_complete_case: 7, depression_cases: 1 }, coefficients: [{ model: 'primary', term: 'I(LBXVIDMS/10)', effect: 0.9, ci_low: 0.8, ci_high: 1.01, p_value: 0.07 }], sensitivityCoefficients: [], warnings: ['test'], runtime: { rVersion: 'R test', surveyVersion: '4', havenVersion: '2', completedAt: 'now' } })); fs.writeFileSync(path.join(directory, 'REPORT.md'), '# Report');
  const previous = process.env.DATA_ROOT; process.env.DATA_ROOT = root;
  try { const archive = getAnalysisArchive({ id: projectId, title: 'Test', question: 'Test?', intent: { cycles: ['2017-2018'], population: { ageMin: 20 } } }); assert.equal(archive[0], 0x1f); const tar = zlib.gunzipSync(archive).toString('utf8'); assert.match(tar, /result\.json/); assert.match(tar, /result-manifest\.json/); assert.match(tar, /quality-report\.json/); assert.match(tar, /quality-checks\.csv/); assert.match(tar, /REPORT\.zh-CN\.md/); assert.match(tar, /forest-plot\.svg/); }
  finally { if (previous === undefined) delete process.env.DATA_ROOT; else process.env.DATA_ROOT = previous; fs.rmSync(root, { recursive: true, force: true }); }
});
