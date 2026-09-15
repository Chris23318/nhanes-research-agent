function finite(value) { return Number.isFinite(Number(value)); }
function check(id, severity, passed, message, evidence = {}) { return { id, severity, status: passed ? 'passed' : severity === 'error' ? 'failed' : 'warning', message, evidence }; }

function evaluateResult(result = {}) {
  if (result.analysisMode === 'generic_survey_v1') return evaluateGenericResult(result);
  const flow = result.flow || {}, coefficients = Array.isArray(result.coefficients) ? result.coefficients : [], sensitivity = Array.isArray(result.sensitivityCoefficients) ? result.sensitivityCoefficients : [];
  const counts = ['merged', 'adults', 'complete_phq9', 'analytic_complete_case', 'depression_cases'].map(key => Number(flow[key]));
  const flowFinite = counts.every(value => Number.isInteger(value) && value >= 0);
  const flowOrdered = flowFinite && counts[0] >= counts[1] && counts[1] >= counts[2] && counts[2] >= counts[3] && counts[3] >= counts[4];
  const validCoefficient = item => finite(item.effect ?? item.odds_ratio) && finite(item.ci_low) && finite(item.ci_high) && finite(item.p_value) && Number(item.ci_low) > 0 && Number(item.ci_low) <= Number(item.effect ?? item.odds_ratio) && Number(item.effect ?? item.odds_ratio) <= Number(item.ci_high) && Number(item.p_value) >= 0 && Number(item.p_value) <= 1;
  const weightValid = /^WT[A-Z0-9_]+\s*\/\s*[1-9][0-9]*$/i.test(String(result.weightRule || ''));
  const checks = [
    check('result_status', 'error', result.status === 'completed', '分析执行状态必须为 completed', { value: result.status }),
    check('sample_counts', 'error', flowFinite, '样本流程计数必须为非负整数', { counts }),
    check('sample_flow', 'error', flowOrdered, '样本流程必须逐步递减且病例数不超过分析样本', flow),
    check('survey_weight', 'error', weightValid, '必须记录有效的 NHANES 合并权重规则', { value: result.weightRule }),
    check('primary_model', 'error', coefficients.length > 0, '主模型至少需要一个系数', { rows: coefficients.length }),
    check('coefficient_bounds', 'error', coefficients.length > 0 && coefficients.every(validCoefficient), '主模型效应、置信区间和 P 值必须有限且范围合法'),
    check('sensitivity_models', 'warning', sensitivity.length > 0, '建议至少提供一项敏感性分析', { rows: sensitivity.length }),
    check('runtime_provenance', 'error', Boolean(result.runtime?.rVersion && result.runtime?.completedAt), '必须记录 R 版本和完成时间', result.runtime || {})
  ];
  const failed = checks.filter(item => item.status === 'failed').length, warnings = checks.filter(item => item.status === 'warning').length;
  return { schemaVersion: '1.0', status: failed ? 'failed' : 'passed', checkedAt: new Date().toISOString(), summary: { total: checks.length, passed: checks.length - failed - warnings, failed, warnings }, checks };
}

function evaluateGenericResult(result = {}) {
  const flow = result.flow || {}, coefficients = Array.isArray(result.coefficients) ? result.coefficients : [];
  const merged = Number(flow.merged), eligible = Number(flow.population_eligible), analytic = Number(flow.analytic_complete_case);
  const flowValid = Number.isInteger(merged) && Number.isInteger(eligible) && Number.isInteger(analytic) && merged >= eligible && eligible >= analytic && analytic >= 30;
  const validCoefficient = item => {
    const effect = Number(item.effect), low = Number(item.ci_low), high = Number(item.ci_high), p = Number(item.p_value);
    const ordered = Number.isFinite(effect) && Number.isFinite(low) && Number.isFinite(high) && low <= effect && effect <= high;
    return ordered && p >= 0 && p <= 1 && (item.effect_type !== 'odds_ratio' || low > 0);
  };
  const exposure = coefficients.find(item => item.term === 'analysis_exposure');
  const checks = [
    check('result_status','error',result.status === 'completed','分析执行状态必须为 completed',{value:result.status}),
    check('sample_flow','error',flowValid,'合并和完整案例样本数必须有效，且最终样本不少于30',flow),
    check('survey_weight','error',/^WT[A-Z0-9_]+\s*\/\s*[1-9][0-9]*$/i.test(String(result.weightRule||'')),'必须记录有效的 NHANES 合并权重规则',{value:result.weightRule}),
    check('primary_exposure','error',Boolean(exposure),'主模型必须包含 analysis_exposure 系数'),
    check('coefficient_bounds','error',coefficients.length>0&&coefficients.every(validCoefficient),'模型效应、置信区间和 P 值必须有限且范围合法'),
    check('model_spec_digest','error',/^[a-f0-9]{64}$/.test(String(result.modelSpecDigest||'')),'结果必须绑定已冻结模型摘要'),
    check('sensitivity_models','warning',Array.isArray(result.sensitivityCoefficients)&&result.sensitivityCoefficients.length>0,'通用执行器尚未运行敏感性分析'),
    check('runtime_provenance','error',Boolean(result.runtime?.rVersion&&result.runtime?.completedAt),'必须记录 R 版本和完成时间',result.runtime||{})
  ];
  const failed=checks.filter(item=>item.status==='failed').length,warnings=checks.filter(item=>item.status==='warning').length;
  return {schemaVersion:'1.1',status:failed?'failed':'passed',checkedAt:new Date().toISOString(),summary:{total:checks.length,passed:checks.length-failed-warnings,failed,warnings},checks};
}

module.exports = { evaluateResult, evaluateGenericResult };
