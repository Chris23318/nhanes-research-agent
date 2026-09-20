const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelSpec, verifyModelSpec } = require('../src/model-spec');
const { generateModelScript } = require('../src/model-script');
const { fileCodeForCycle, fileMatchesCycle, buildDataManifest } = require('../src/data-manifest');
const { codebookUrl } = require('../src/codebook-review');
const { createWeightAdvice } = require('../src/weight-policy');
const { assertOfficialFile } = require('../src/data-cache');

function project() {
  const cycles = ['2017-2018'];
  return { status:'awaiting_approval', intent:{cycles}, cleaningApproval:{digest:'clean'}, variables:[
    {role:'exposure',variable:'LBXBPB',sourceFile:'PBCD_J',sourceComponent:'Laboratory',cycles,confirmationStatus:'codebook_and_cleaning_approved'},
    {role:'outcome',variable:'BPXSY1',sourceFile:'BPX_J',sourceComponent:'Examination',cycles,confirmationStatus:'codebook_and_cleaning_approved'},
    {role:'covariate',concept:'sex',variable:'RIAGENDR',sourceFile:'DEMO_J',sourceComponent:'Demographics',cycles,confirmationStatus:'codebook_and_cleaning_approved'},
    {role:'design',variable:'WTMEC2YR',cycles},{role:'design',variable:'SDMVSTRA',cycles},{role:'design',variable:'SDMVPSU',cycles}
  ]};
}

test('approved v1.6 model freezes spline and subgroup plans into generated survey code',()=>{
  const spec=createModelSpec(project(),{outcomeFamily:'continuous',exposureTransform:'raw',outcomeTransform:'raw',populationAgeMin:18,weightVariable:'WTMEC2YR',covariates:[{concept:'sex',encoding:'factor'}],nonlinearMethod:'restricted_cubic_spline',splineDf:4,subgroupConcepts:['sex'],acknowledgeAssociationOnly:true,acknowledgeWeightChoice:true});
  assert.equal(spec.schemaVersion,'1.6');
  assert.equal(spec.advancedAnalysisPlan.nonlinear.method,'restricted_cubic_spline');
  assert.deepEqual(spec.advancedAnalysisPlan.subgroups.map(item=>item.variable),['cov_1']);
  assert.equal(verifyModelSpec(spec),true);
  const script=generateModelScript(spec);
  assert.match(script,/generic_survey_v6/);
  assert.match(script,/splines::ns\(analysis_exposure,df=4\)/);
  assert.match(script,/regTermTest\(interaction_model/);
  assert.match(script,/subgroup-results\.csv/);
  assert.match(script,/subgroupAnalyses=subgroup_result/);
});

test('subgroups must be selected factor covariates and spline df is bounded',()=>{
  const base={outcomeFamily:'continuous',exposureTransform:'raw',outcomeTransform:'raw',populationAgeMin:18,weightVariable:'WTMEC2YR',covariates:[{concept:'sex',encoding:'continuous'}],acknowledgeAssociationOnly:true,acknowledgeWeightChoice:true};
  assert.throws(()=>createModelSpec(project(),{...base,subgroupConcepts:['sex']}),/分类变量/);
  assert.throws(()=>createModelSpec(project(),{...base,nonlinearMethod:'restricted_cubic_spline',splineDf:9}),/3、4 或 5/);
});

test('new CDC release layouts generate and validate official file names',()=>{
  assert.equal(fileCodeForCycle('DEMO','2017-2020'),'P_DEMO');
  assert.equal(fileCodeForCycle('DEMO','2021-2023'),'DEMO_L');
  assert.equal(fileMatchesCycle('P_BMX','2017-2020'),true);
  assert.equal(fileMatchesCycle('BMX_L','2021-2023'),true);
  assert.match(codebookUrl('DEMO_L','2021-2023'),/\/2021\/DataFiles\/DEMO_L\.htm$/);
  const manifest=buildDataManifest({intent:{cycles:['2021-2023']},variables:[{source:'DEMO'}]});
  assert.equal(manifest.files[0].code,'DEMO_L');
  assert.doesNotThrow(()=>assertOfficialFile({url:'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/P_DEMO.XPT'}));
  assert.doesNotThrow(()=>assertOfficialFile({url:'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/DEMO_L.XPT'}));
});

test('2021-2023 is supported standalone but is not automatically pooled with legacy cycles',()=>{
  const latest={intent:{cycles:['2021-2023']},variables:[{role:'exposure',sourceComponent:'Examination',sourceFile:'BMX_L',confirmationStatus:'codebook_and_cleaning_approved'},{role:'design',variable:'WTMEC2YR',cycles:['2021-2023']}]};
  const advice=createWeightAdvice(latest);
  assert.equal(advice.divisor,1);
  assert.equal(advice.formula,'WTMEC2YR / 1');
  const pooled=structuredClone(latest);pooled.intent.cycles=['2017-2018','2021-2023'];pooled.variables[1].cycles=pooled.intent.cycles;
  assert.equal(createWeightAdvice(pooled).status,'blocked');
});
