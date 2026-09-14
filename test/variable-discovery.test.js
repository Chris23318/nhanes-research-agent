const test = require('node:test');
const assert = require('node:assert/strict');
const { rankCatalogItems, discoverVariableMap } = require('../src/variable-discovery');
const { parseQuestion } = require('../src/question-parser');

const rows = [
  { variable: 'SLD012', description: 'Sleep hours - weekdays or workdays', file: 'SLQ_J', fileDescription: 'Sleep Disorders', component: 'Questionnaire' },
  { variable: 'MCQ160C', description: 'Ever told had coronary heart disease', file: 'MCQ_J', fileDescription: 'Medical Conditions', component: 'Questionnaire' }
];

test('measurement descriptions outrank shared file titles and comment codes', () => {
  const context = { file: 'PBCD_J', fileDescription: 'Lead, Cadmium, Total Mercury, Selenium, & Manganese - Blood' };
  const candidates = [
    { ...context, variable: 'LBDBCDSI', description: 'Blood cadmium (nmol/L)' },
    { ...context, variable: 'LBDBPBLC', description: 'Blood lead comment code' },
    { ...context, variable: 'LBXBPB', description: 'Blood lead (ug/dL)' }
  ];
  assert.equal(rankCatalogItems(candidates, 'blood lead')[0].variable, 'LBXBPB');
});

test('official catalog candidates are ranked by the research concept', () => {
  assert.equal(rankCatalogItems(rows, 'sleep duration')[0].variable, 'SLD012');
  assert.equal(rankCatalogItems(rows, 'cardiovascular disease')[0].variable, 'MCQ160C');
});

test('agent discovers candidates without pretending they are confirmed variables', async () => {
  const intent = parseQuestion('研究 2017-2018 年成年人睡眠时长与心血管疾病');
  const result = await discoverVariableMap(intent, { fetchCatalog: async () => ({ items: rows }) });
  assert.equal(result.discovery.mode, 'official_cdc_catalog');
  assert.equal(result.variables.some(x => x.role === 'exposure'), false);
  assert.equal(result.discovery.candidates.length, 2);
  assert.ok(result.discovery.candidates.every(x => x.status === 'researcher_confirmation_required'));
});
