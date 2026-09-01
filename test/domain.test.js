const test=require('node:test');
const assert=require('node:assert/strict');
const {validateQuestion,validateVariableMap,validateTransition,validateApproval}=require('../src/domain');
const {resolveVariables}=require('../src/catalog');

test('research questions are normalized and bounded',()=>{
  assert.equal(validateQuestion({question:'  vitamin D and depressive symptoms in NHANES adults  '}),'vitamin D and depressive symptoms in NHANES adults');
  assert.throws(()=>validateQuestion({question:'short'}),/at least 10/);
});

test('catalog variable mappings satisfy the contract',()=>{
  const values=validateVariableMap(resolveVariables());
  assert.equal(values.length,10);
  assert.ok(values.every(value=>value.cycles.length===6));
});

test('unmatched topics never inherit vitamin D or PHQ-9 variables',()=>{
  const variables=resolveVariables({exposure:{term:'sleep duration'},outcome:{term:'cardiovascular disease'}});
  assert.equal(variables.some(item=>item.variable==='LBXVIDMS'),false);
  assert.equal(variables.some(item=>item.variable.includes('DPQ')),false);
  assert.ok(variables.some(item=>item.variable==='WTMEC2YR'));
});

test('state transitions cannot skip quality gates',()=>{
  assert.doesNotThrow(()=>validateTransition('parse','variables'));
  assert.throws(()=>validateTransition('parse','protocol'),/invalid transition/);
});

test('protocol approval requires explicit, causal-safe decisions',()=>{
  const decisions={outcome_definition:'PHQ-9 >= 10',exposure_parameterization:'per 10 nmol/L',covariate_set:'age, sex, race, PIR, BMI',missing_data:'complete case',association_only:true};
  assert.equal(validateApproval({actor:' researcher ',decisions}).actor,'researcher');
  assert.throws(()=>validateApproval({decisions:{...decisions,association_only:false}}),/acknowledgement/);
  assert.throws(()=>validateApproval({decisions:{...decisions,missing_data:''}}),/missing_data/);
});
