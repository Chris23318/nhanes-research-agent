const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { executionGate, getAnalysisArchive } = require('../src/analysis-runner');
const { createModelSpec } = require('../src/model-spec');

function project(overrides = {}) {
  return { id: 'prj_1234567890abcdef', status: 'approved', intent: { cycles: ['2017-2018'], population: { ageMin: 20 } }, variables: [{ variable: 'LBXVIDMS' }, { variable: 'DPQ010–DPQ090' }], ...overrides };
}

test('R execution gate requires approval and the supported exposure/outcome', () => {
  assert.equal(executionGate(project()).ready, true);
  assert.match(executionGate(project({ status: 'awaiting_approval' })).errors.join(' '), /not approved/);
  assert.match(executionGate(project({ variables: [{ variable: 'RIDAGEYR' }] })).errors.join(' '), /LBXVIDMS/);
});

test('R execution gate accepts a frozen generic survey model without using the fixed template',()=>{
  const cycles=['2017-2018'],generic=project({status:'awaiting_approval',feasibility:{status:'design_only'},cleaningApproval:{digest:'clean'},variables:[{role:'exposure',variable:'LBXBPB',sourceFile:'PBCD_J',cycles,confirmationStatus:'codebook_and_cleaning_approved'},{role:'outcome',variable:'BPXSY1',sourceFile:'BPX_J',cycles,confirmationStatus:'codebook_and_cleaning_approved'},{role:'design',variable:'WTMEC2YR',cycles},{role:'design',variable:'SDMVSTRA',cycles},{role:'design',variable:'SDMVPSU',cycles}]});
  generic.modelSpec=createModelSpec(generic,{outcomeFamily:'continuous',exposureTransform:'raw',outcomeTransform:'raw',populationAgeMin:20,weightVariable:'WTMEC2YR',covariates:[],acknowledgeAssociationOnly:true,acknowledgeWeightChoice:true});generic.status='approved';generic.protocol={modelSpecDigest:generic.modelSpec.digest};
  const gate=executionGate(generic);assert.equal(gate.ready,true);assert.equal(gate.mode,'generic_survey_v6');
  generic.modelSpec.cleaningDigest='stale';assert.match(executionGate(generic).errors.join(' '),/does not match/);
});

test('completed R results download as an audited archive', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nhanes-results-test-')), projectId = 'prj_abcdef1234567890', directory = path.join(root, 'results', projectId);
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ status: 'completed', weightRule: 'WTMEC2YR / 1', flow: { merged: 10, adults: 9, complete_phq9: 8, analytic_complete_case: 7, depression_cases: 1 }, coefficients: [{ model: 'primary', term: 'I(LBXVIDMS/10)', effect: 0.9, ci_low: 0.8, ci_high: 1.01, p_value: 0.07 }], sensitivityCoefficients: [], warnings: ['test'], runtime: { rVersion: 'R test', surveyVersion: '4', havenVersion: '2', completedAt: 'now' } })); fs.writeFileSync(path.join(directory, 'REPORT.md'), '# Report'); fs.writeFileSync(path.join(directory, 'descriptive-statistics.csv'), 'variable,estimate\nanalysis_exposure,1.2\n'); fs.writeFileSync(path.join(directory, 'imputation-diagnostics.csv'), 'metric,value\nimputations,20\n');
  const previous = process.env.DATA_ROOT; process.env.DATA_ROOT = root;
  try { const archive = await getAnalysisArchive({ id: projectId, title: 'Test', question: 'Test?', intent: { cycles: ['2017-2018'], population: { ageMin: 20 } } }); assert.equal(archive[0], 0x1f); const tar = zlib.gunzipSync(archive).toString('utf8'); assert.match(tar, /result\.json/); assert.match(tar, /result-manifest\.json/); assert.match(tar, /audit-trail\.json/); assert.match(tar, /quality-report\.json/); assert.match(tar, /quality-checks\.csv/); assert.match(tar, /descriptive-statistics\.csv/); assert.match(tar, /imputation-diagnostics\.csv/); assert.match(tar, /result-tables\.csv/); assert.match(tar, /manuscript-draft\.zh-CN\.md/); assert.match(tar, /report\.pdf/); assert.match(tar, /report\.docx/); assert.match(tar, /REPORT\.zh-CN\.md/); assert.match(tar, /forest-plot\.svg/); }
  finally { if (previous === undefined) delete process.env.DATA_ROOT; else process.env.DATA_ROOT = previous; fs.rmSync(root, { recursive: true, force: true }); }
});
