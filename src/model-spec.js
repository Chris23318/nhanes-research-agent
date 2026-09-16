const crypto = require('node:crypto');
const CORE_KEYS_V11 = ['schemaVersion','outcomeFamily','exposureTransform','outcomeTransform','outcomeThreshold','population','weightVariable','weightChoiceConfirmed','strataVariable','psuVariable','cycles','exposureMappings','outcomeMappings','covariates','associationOnly','cleaningDigest'];
const CORE_KEYS_V12 = [...CORE_KEYS_V11, 'weightPolicy', 'sensitivityPlan'];
const CORE_KEYS_V13 = [...CORE_KEYS_V12, 'missingDataPolicy'];
function digestCore(core) { return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex'); }
function verifyModelSpec(spec) { if (!spec || typeof spec.digest !== 'string') return false; const keys=spec.schemaVersion==='1.3'?CORE_KEYS_V13:spec.schemaVersion==='1.2'?CORE_KEYS_V12:CORE_KEYS_V11,core=Object.fromEntries(keys.map(key=>[key,spec[key]])); return digestCore(core)===spec.digest; }

function createModelSpec(project, input = {}) {
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  if (project.status !== 'awaiting_approval') fail('请在方案待确认时设置统计模型', 409);
  if (!project.cleaningApproval) fail('请先确认变量映射和清洗规则', 409);
  if (!['continuous', 'binary'].includes(input.outcomeFamily)) fail('结局类型必须为 continuous 或 binary');
  if (!['raw', 'log2', 'per_sd'].includes(input.exposureTransform)) fail('不支持的暴露转换');
  if (!['raw', 'threshold_ge', 'threshold_eq'].includes(input.outcomeTransform)) fail('不支持的结局转换');
  if (input.outcomeFamily === 'binary' && input.outcomeTransform === 'raw') fail('二分类结局必须提供阈值或明确编码');
  const thresholdNeeded = input.outcomeTransform !== 'raw';
  const threshold = Number(input.outcomeThreshold);
  if (thresholdNeeded && !Number.isFinite(threshold)) fail('结局阈值必须为有限数值');
  const populationAgeMin = Number(input.populationAgeMin);
  if (!Number.isFinite(populationAgeMin) || populationAgeMin < 0 || populationAgeMin > 85) fail('最低年龄必须是 0 至 85 岁');
  if (input.acknowledgeAssociationOnly !== true) fail('必须确认横断面结果仅解释为关联');
  if (input.acknowledgeWeightChoice !== true) fail('必须确认所选权重适用于最小分析子样本');
  const missingDataStrategy=input.missingDataStrategy||'complete_case';
  if(missingDataStrategy!=='complete_case')fail('当前受控执行器仅支持 complete_case；多重插补需单独冻结插补模型');
  const variables = project.variables || [], cycles = project.intent?.cycles || [];
  if (!cycles.length) fail('至少需要一个 NHANES 周期', 409);
  const roleMappings = role => variables.filter(item => item.role === role && item.confirmationStatus === 'codebook_and_cleaning_approved');
  const selectByCycle = (role, label, requested = {}) => cycles.map(cycle => {
    const candidates = roleMappings(role).filter(item => item.cycles?.includes(cycle));
    const selected = requested?.[cycle]
      ? candidates.find(item => item.variable === requested[cycle])
      : candidates.length === 1 ? candidates[0] : null;
    if (!selected) fail(candidates.length > 1 ? `${label}变量在 ${cycle} 有多个候选，请明确选择` : `${label}变量未覆盖 ${cycle}`, 409);
    return { variable:selected.variable, sourceFile:selected.sourceFile, cycles:[cycle] };
  });
  const exposure = selectByCycle('exposure', '暴露', input.exposureByCycle);
  const outcome = selectByCycle('outcome', '结局', input.outcomeByCycle);
  const design = name => variables.find(item => item.role === 'design' && item.variable === name && cycles.every(cycle => item.cycles?.includes(cycle)));
  const weight = design(input.weightVariable);
  if (!weight || !design('SDMVSTRA') || !design('SDMVPSU')) fail('权重、分层或 PSU 尚未覆盖全部周期', 409);
  const requested = Array.isArray(input.covariates) ? input.covariates : [];
  if (requested.length > 30) fail('协变量不能超过30个');
  const covariates = requested.map(item => {
    if (!item || typeof item.concept !== 'string' || !item.concept.trim() || !['continuous', 'factor'].includes(item.encoding)) fail('协变量编码无效');
    const mappings=cycles.map(cycle=>{const candidates=variables.filter(value=>value.role==='covariate'&&value.concept===item.concept&&value.confirmationStatus==='codebook_and_cleaning_approved'&&value.cycles?.includes(cycle)),selected=item.byCycle?.[cycle]?candidates.find(value=>value.variable===item.byCycle[cycle]):candidates.length===1?candidates[0]:null;if(!selected)fail(candidates.length>1?`协变量 ${item.concept} 在 ${cycle} 有多个候选`:`协变量未映射全部周期：${item.concept}`);return {variable:selected.variable,sourceFile:selected.sourceFile,cycles:[cycle]}});
    return { concept:item.concept, encoding: item.encoding, mappings };
  });
  if (new Set(covariates.map(item => item.concept)).size !== covariates.length) fail('协变量不能重复');
  const weightAdvice=require('./weight-policy').createWeightAdvice(project,{selectedConcepts:covariates.map(item=>item.concept)});
  if(weightAdvice.blockers.length)fail(`权重策略尚不能自动执行：${weightAdvice.blockers.join('; ')}`,409);
  const overrideReason=typeof input.weightOverrideReason==='string'?input.weightOverrideReason.trim().slice(0,500):'';
  if(weight.variable!==weightAdvice.recommendedWeight&&overrideReason.length<10)fail(`当前最小分析子样本推荐 ${weightAdvice.recommendedWeight}；如需改用 ${weight.variable}，请提供至少10字的依据`);
  const weightPolicy={...weightAdvice,selectedWeight:weight.variable,overrideReason:weight.variable===weightAdvice.recommendedWeight?null:overrideReason,confirmed:true};
  const sensitivityPlan=[{id:'unadjusted',label:'同一完整案例样本的未调整模型'},{id:'weight_trim_1_99',label:'权重按第1和第99百分位截尾'}];
  const missingDataPolicy={strategy:'complete_case',diagnosticsRequired:true,structuralMissingnessRequiresReview:true};
  const core = { schemaVersion:'1.3', outcomeFamily:input.outcomeFamily, exposureTransform:input.exposureTransform, outcomeTransform:input.outcomeTransform, outcomeThreshold:thresholdNeeded?threshold:null, population:{ageMin:populationAgeMin,pregnancyPolicy:project.intent?.population?.pregnancy||'not specified'}, weightVariable:weight.variable, weightChoiceConfirmed:true, strataVariable:'SDMVSTRA', psuVariable:'SDMVPSU', cycles:[...cycles], exposureMappings:exposure, outcomeMappings:outcome, covariates, associationOnly:true, cleaningDigest:project.cleaningApproval.digest, weightPolicy, sensitivityPlan, missingDataPolicy };
  return { ...core, digest:digestCore(core), status:'approved_for_code_generation_not_execution', approvedAt:new Date().toISOString(), actor:typeof input.actor==='string'&&input.actor.trim()?input.actor.trim().slice(0,100):'researcher' };
}

module.exports = { createModelSpec, verifyModelSpec };
