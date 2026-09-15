const test=require('node:test'),assert=require('node:assert/strict');
const {generatePreparationScript}=require('../src/data-preparation');
const manifest={files:[{cycle:'2017-2018',code:'DEMO_J'},{cycle:'2017-2018',code:'PBCD_J'}]};
const cleaning={digest:'a'.repeat(64),rules:[{file:'PBCD_J',cycle:'2017-2018'}]};
test('preparation script reads approved XPT files, enforces unique joins and writes audit artifacts',()=>{const r=generatePreparationScript(manifest,cleaning);assert.match(r,/read_xpt/);assert.match(r,/Join produced duplicate SEQN/);assert.doesNotMatch(r,/relationship=/);assert.match(r,/cleaning-audit\.rds/);assert.match(r,/approved_digest/);assert.doesNotMatch(r,/https?:\/\//)});
test('unsafe manifest values cannot enter generated R code',()=>{assert.throws(()=>generatePreparationScript({files:[{cycle:'2017-2018',code:'X\");system(\"id\")'}]},cleaning),/unsafe/)});
