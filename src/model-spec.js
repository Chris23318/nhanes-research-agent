const crypto = require('node:crypto');

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
  if (input.acknowledgeAssociationOnly !== true) fail('必须确认横断面结果仅解释为关联');
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
    if (!item || typeof item.variable !== 'string' || !['continuous', 'factor'].includes(item.encoding)) fail('协变量编码无效');
    const mapping = variables.find(value => value.role === 'covariate' && value.variable === item.variable && value.confirmationStatus === 'codebook_and_cleaning_approved' && cycles.every(cycle => value.cycles?.includes(cycle)));
    if (!mapping) fail(`协变量未映射全部周期：${item.variable}`);
    return { variable: mapping.variable, encoding: item.encoding };
  });
  if (new Set(covariates.map(item => item.variable)).size !== covariates.length) fail('协变量不能重复');
  const core = { schemaVersion:'1.0', outcomeFamily:input.outcomeFamily, exposureTransform:input.exposureTransform, outcomeTransform:input.outcomeTransform, outcomeThreshold:thresholdNeeded?threshold:null, weightVariable:weight.variable, strataVariable:'SDMVSTRA', psuVariable:'SDMVPSU', cycles:[...cycles], exposureMappings:exposure, outcomeMappings:outcome, covariates, associationOnly:true, cleaningDigest:project.cleaningApproval.digest };
  return { ...core, digest:crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex'), status:'approved_for_code_generation_not_execution', approvedAt:new Date().toISOString(), actor:typeof input.actor==='string'&&input.actor.trim()?input.actor.trim().slice(0,100):'researcher' };
}

module.exports = { createModelSpec };
