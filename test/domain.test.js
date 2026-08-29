const test=require('node:test');
const assert=require('node:assert/strict');
const {validateQuestion,validateVariableMap,validateTransition}=require('../src/domain');
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

test('state transitions cannot skip quality gates',()=>{
  assert.doesNotThrow(()=>validateTransition('parse','variables'));
  assert.throws(()=>validateTransition('parse','protocol'),/invalid transition/);
});
