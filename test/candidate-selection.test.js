const test=require('node:test'),assert=require('node:assert/strict');
const {selectCandidate}=require('../src/candidate-selection');
const project={status:'awaiting_approval',intent:{cycles:['2017-2018']},variables:[],variableDiscovery:{candidates:[{role:'exposure',items:[{variable:'LEAD',file:'LAB_J',matchedCycles:['2017-2018']}]}]}};
const input={role:'exposure',variable:'LEAD',file:'LAB_J',reason:'Matches the exposure'};
test('candidate selection records provenance without promoting execution mappings',()=>{const result=selectCandidate(project,input);assert.equal(result.status,'codebook_review_required');assert.equal(project.variables.length,0);assert.equal(result.file,'LAB_J')});
test('selection rejects invented variables and frozen projects',()=>{assert.throws(()=>selectCandidate(project,{...input,variable:'INVENTED'}));assert.throws(()=>selectCandidate({...project,status:'approved'},input));assert.throws(()=>selectCandidate(project,{...input,reason:''}))});
