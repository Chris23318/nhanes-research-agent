const test=require('node:test');
const assert=require('node:assert/strict');
const {createProject,runProject}=require('../src/orchestrator');
const {generateRProject}=require('../src/analysis-package');
const {createAnalysisArchive}=require('../src/archive');
const zlib=require('node:zlib');

test('analysis package is reproducible and never claims execution',async()=>{
  const project=createProject({question:'Study vitamin D and depressive symptoms among NHANES adults'});
  await runProject(project.id);
  const artifact=generateRProject(project);
  assert.equal(artifact.status,'generated_not_executed');
  assert.match(artifact.files['analysis.R'],/svydesign/);
  assert.match(artifact.files['analysis.R'],/full_design/);
  assert.match(artifact.files['analysis.R'],/subset\(full_design/);
  assert.ok(artifact.files['analysis.R'].indexOf('full_design <- svydesign')<artifact.files['analysis.R'].indexOf('design <- subset(full_design'));
  assert.match(artifact.files['analysis.R'],/WTMEC2YR \/ 6/);
  assert.match(artifact.files['README.md'],/not executed/);
  assert.ok(artifact.files['analysis-spec.json']);
  assert.ok(artifact.files['data-manifest.json']);
  assert.ok(artifact.files['prepare-data.R']);
  assert.ok(artifact.files['manifest.json']);
  const archive=createAnalysisArchive(artifact);assert.equal(archive[0],0x1f);assert.match(zlib.gunzipSync(archive).toString('utf8'),/analysis\.R/);
});

test('analysis package blocks unconfirmed exposure and outcome variables',async()=>{
  const project=createProject({question:'Study sleep duration and cardiovascular disease among NHANES adults'});
  await runProject(project.id);const artifact=generateRProject(project);
  assert.equal(artifact.status,'blocked_not_executable');
  assert.ok(artifact.readiness.errors.some(x=>x.includes('exposure')));
});

test('reviewed dynamic mappings require a matching frozen model specification',()=>{
  const project={protocol:{},intent:{cycles:['2017-2018']},variables:[
    {role:'exposure',variable:'X',confirmationStatus:'codebook_and_cleaning_approved'},
    {role:'outcome',variable:'Y'},{role:'design',variable:'WTMEC2YR'},{role:'design',variable:'SDMVSTRA'},{role:'design',variable:'SDMVPSU'}
  ],cleaningApproval:{digest:'clean'}};
  let artifact=generateRProject(project);
  assert.ok(artifact.readiness.errors.some(x=>x.includes('model specification')));
  project.modelSpec={cleaningDigest:'old'};artifact=generateRProject(project);
  assert.ok(artifact.readiness.errors.some(x=>x.includes('does not match')));
});
