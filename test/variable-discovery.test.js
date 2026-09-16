const test = require('node:test');
const assert = require('node:assert/strict');
const { rankCatalogItems, covariateSearchTerm, conceptSearchTerm, discoverVariableMap } = require('../src/variable-discovery');
const { parseQuestion } = require('../src/question-parser');

const rows = [
  { variable: 'SLD012', description: 'Sleep hours - weekdays or workdays', file: 'SLQ_J', fileDescription: 'Sleep Disorders', component: 'Questionnaire', beginYear: '2017', endYear: '2018' },
  { variable: 'MCQ160C', description: 'Ever told had coronary heart disease', file: 'MCQ_J', fileDescription: 'Medical Conditions', component: 'Questionnaire', beginYear: '2017', endYear: '2018' }
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
  assert.ok(result.discovery.candidates.length >= 2);
  assert.ok(result.discovery.candidates.filter(x=>['exposure','outcome'].includes(x.role)).every(x => x.status === 'researcher_confirmation_required'));
  assert.equal(result.discovery.coverage.summary.coreComplete, true);
  assert.equal(result.discovery.coverageDigest, result.discovery.coverage.digest);
});
test('common Chinese covariates map to explicit CDC search terms',()=>{assert.match(covariateSearchTerm('年龄'),/RIDAGEYR/);assert.match(covariateSearchTerm('贫困收入比'),/INDFMPIR/);assert.match(covariateSearchTerm('BMI'),/BMXBMI/)});
test('common research concepts expand to known NHANES variable families',()=>{assert.match(conceptSearchTerm('sleep duration'),/SLD012/);assert.match(conceptSearchTerm('心血管疾病'),/MCQ160C/);assert.match(conceptSearchTerm('血铅'),/LBXBPB/)});
test('catalog discovery retries one transient upstream failure',async()=>{let calls=0;const intent={exposure:{term:'sleep duration',component:'Questionnaire'},outcome:{term:'cardiovascular disease',component:'Questionnaire'},cycles:['2017-2018'],covariates:[]};const result=await discoverVariableMap(intent,{fetchCatalog:async()=>{calls+=1;if(calls===1)throw new Error('temporary timeout');return{items:rows}}});assert.equal(calls,2);assert.equal(result.discovery.errors.length,0);assert.equal(result.discovery.coverage.summary.coreComplete,true)});
