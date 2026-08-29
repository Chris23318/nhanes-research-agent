const test=require('node:test');
const assert=require('node:assert/strict');
const {createProject,runProject}=require('../src/orchestrator');
const {generateRProject}=require('../src/analysis-package');

test('analysis package is reproducible and never claims execution',async()=>{
  const project=createProject({question:'Study vitamin D and depressive symptoms among NHANES adults'});
  await runProject(project.id);
  const artifact=generateRProject(project);
  assert.equal(artifact.status,'generated_not_executed');
  assert.match(artifact.files['analysis.R'],/svydesign/);
  assert.match(artifact.files['analysis.R'],/WTMEC2YR \/ 6/);
  assert.match(artifact.files['README.md'],/not executed/);
});
