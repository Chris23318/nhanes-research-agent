function finite(value) { return Number.isFinite(Number(value)); }
function check(id, severity, passed, message, evidence = {}) { return { id, severity, status: passed ? 'passed' : severity === 'error' ? 'failed' : 'warning', message, evidence }; }

function evaluateResult(result = {}) {
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

module.exports = { evaluateResult };
