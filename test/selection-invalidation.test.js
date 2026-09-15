const test=require('node:test'),assert=require('node:assert/strict');
const {projects,saveCandidate}=require('../src/orchestrator');
test('changing a candidate invalidates all derived approvals and dynamic mappings',()=>{
 const project={id:'prj_aabbccddeeff0011',status:'awaiting_approval',intent:{cycles:['2017-2018']},variables:[{role:'design',variable:'WTMEC2YR'},{role:'exposure',variable:'OLD',confirmationStatus:'codebook_and_cleaning_approved'}],candidateSelections:[],variableDiscovery:{candidates:[{role:'exposure',items:[{variable:'NEW',file:'LAB_J',matchedCycles:['2017-2018']}]}]},codebookReviews:[{variable:'OLD'}],cleaningApproval:{digest:'old'},events:[],approvals:[],createdAt:new Date().toISOString()};
 projects.set(project.id,project);const result=saveCandidate(project.id,{role:'exposure',variable:'NEW',file:'LAB_J',reason:'better evidence'});assert.equal(result.cleaningApproval,undefined);assert.deepEqual(result.codebookReviews,[]);assert.equal(result.variables.some(x=>x.variable==='OLD'),false);
});
