const REGULAR_TWO_YEAR = /^(?:19|20)\d{2}-(?:19|20)\d{2}$/;

function inferComponent(item = {}) {
  if (item.sourceComponent) return item.sourceComponent;
  const source = String(item.source || item.sourceFile || '').replace(/^P_/i,'').replace(/_[A-Z]$/, '').toUpperCase();
  if (source === 'DEMO') return 'Demographics';
  if (/^(BMX|BPX|OHX|AUX|VIX)/.test(source)) return 'Examination';
  if (/^(DPQ|MCQ|SLQ|SMQ|PAQ|BPQ|DIQ|KIQ|HUQ|RXQ)/.test(source)) return 'Questionnaire';
  if (/^(DR|DBQ)/.test(source)) return 'Dietary';
  return item.role === 'design' ? 'Demographics' : 'Unknown';
}

function createWeightAdvice(project = {}, options = {}) {
  const cycles = [...new Set((project.intent?.cycles || []).map(String))];
  const selectedConcepts = options.selectedConcepts ? new Set(options.selectedConcepts) : null;
  const analytic = (project.variables || []).filter(item => {
    if (!['exposure', 'outcome', 'covariate'].includes(item.role)) return false;
    if (item.confirmationStatus !== 'codebook_and_cleaning_approved') return false;
    return item.role !== 'covariate' || !selectedConcepts || selectedConcepts.has(item.concept);
  });
  const components = [...new Set(analytic.map(inferComponent))];
  const files = [...new Set(analytic.map(item => item.sourceFile || item.source).filter(Boolean))];
  const availableWeights = [...new Set((project.variables || []).filter(item => item.role === 'design' && /^WT[A-Z0-9_]+$/.test(item.variable || '') && cycles.every(cycle => item.cycles?.includes(cycle))).map(item => item.variable))];
  const dietary = components.includes('Dietary');
  const mec = components.some(component => component === 'Laboratory' || component === 'Examination' || component === 'Unknown');
  const recommendedWeight = dietary ? null : mec ? 'WTMEC2YR' : 'WTINT2YR';
  const legacyRegularCycles = cycles.length > 0 && cycles.every(cycle => {
    if (!REGULAR_TWO_YEAR.test(cycle)) return false;
    const [start, end] = cycle.split('-').map(Number);
    return end === start + 1 && end <= 2018;
  });
  const latestStandalone=cycles.length===1&&cycles[0]==='2021-2023';
  const regularCycles=legacyRegularCycles||latestStandalone;
  const blockers = [];
  const cautions = [];
  if (!cycles.length) blockers.push('尚未确定 NHANES 周期');
  if (!regularCycles) blockers.push('包含非标准或 2018 年后的周期，不能自动套用两年权重除数');
  if (dietary) blockers.push('膳食数据需要按具体日次和分析目标选择 WTDRD1/WTDR2D 等专用权重');
  if (recommendedWeight && !availableWeights.includes(recommendedWeight)) blockers.push(`推荐权重 ${recommendedWeight} 尚未映射到全部周期`);
  if (components.includes('Laboratory')) cautions.push('实验室或子样本项目可能具有专用权重，必须逐周期核对组件代码本');
  if (components.includes('Unknown')) cautions.push('存在未识别组件，当前按 MEC 域保守推荐，必须人工核对');
  if(latestStandalone)cautions.push('2021–2023 使用新抽样设计；当前仅支持单周期分析，不与早期周期自动合并');
  const divisor = regularCycles ? (latestStandalone?1:cycles.length) : null;
  return {
    schemaVersion: '1.0',
    status: blockers.length ? 'blocked' : cautions.length ? 'review_required' : 'recommended',
    analysisDomain: dietary ? 'dietary_specific' : mec ? 'mec_exam' : 'interview',
    components,
    files,
    availableWeights,
    recommendedWeight,
    divisor,
    formula: recommendedWeight && divisor ? `${recommendedWeight} / ${divisor}` : null,
    rationale: dietary ? '最小分析子样本由膳食访谈定义' : mec ? '最小分析子样本包含 MEC 检查、实验室或未识别组件' : '全部分析变量来自访谈或人口学组件',
    cautions,
    blockers
  };
}

module.exports = { inferComponent, createWeightAdvice };
