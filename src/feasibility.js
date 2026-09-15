function assessFeasibility(intent = {}, variables = []) {
  const roles = new Set(variables.map(item => item.role));
  const names = new Set(variables.map(item => item.variable));
  const cycles = Array.isArray(intent.cycles) ? intent.cycles : [];
  const covers = role => cycles.every(cycle => variables.some(item => item.role === role && item.cycles?.includes(cycle)));
  const checks = [
    { id: 'exposure_identified', passed: Boolean(intent.exposure?.term), message: '已识别暴露概念' },
    { id: 'outcome_identified', passed: Boolean(intent.outcome?.term), message: '已识别结局概念' },
    { id: 'cycles_available', passed: Array.isArray(intent.cycles) && intent.cycles.length > 0, message: '已确定 NHANES 周期' },
    { id: 'exposure_mapped', passed: roles.has('exposure'), message: '暴露已映射到 NHANES 变量' },
    { id: 'outcome_mapped', passed: roles.has('outcome'), message: '结局已映射到 NHANES 变量' },
    { id: 'exposure_cycle_coverage', passed: cycles.length > 0 && covers('exposure'), message: '暴露变量覆盖全部所选周期' },
    { id: 'outcome_cycle_coverage', passed: cycles.length > 0 && covers('outcome'), message: '结局变量覆盖全部所选周期' },
    { id: 'survey_design_mapped', passed: names.has('SDMVPSU') && names.has('SDMVSTRA') && names.has('WTMEC2YR'), message: '抽样权重、分层和 PSU 已映射' }
  ];
  const supportedPipeline = names.has('LBXVIDMS') && [...names].some(name => String(name).startsWith('DPQ010'));
  const mappingReady = checks.every(item => item.passed);
  const status = mappingReady && supportedPipeline ? 'executable' : intent.exposure?.term && intent.outcome?.term ? 'design_only' : 'needs_clarification';
  const blockers = checks.filter(item => !item.passed).map(item => item.message);
  if (mappingReady && !supportedPipeline) blockers.push('当前受控 R 执行模板尚未覆盖该暴露—结局组合');
  return { schemaVersion: '1.0', status, supportedPipeline: supportedPipeline ? 'vitamin_d_phq9_v1' : null, checks, blockers, message: status === 'executable' ? '变量、周期和受控分析模板均已就绪' : status === 'design_only' ? '可以生成研究方案和检索证据，但暂不能声称已完成真实数据分析' : '需要研究者补充或确认研究问题后再继续' };
}

module.exports = { assessFeasibility };
