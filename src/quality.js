function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function check(id, severity, passed, message, evidence = {}) { return { id, severity, status: passed ? 'passed' : severity === 'error' ? 'failed' : 'warning', message, evidence }; }

function evaluateResult(result = {}) {
  if (String(result.analysisMode || '').startsWith('generic_survey_v')) return evaluateGenericResult(result);
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
  const flow = result.flow || {}, coefficients = Array.isArray(result.coefficients) ? result.coefficients : [], sensitivity=Array.isArray(result.sensitivityCoefficients)?result.sensitivityCoefficients:[],missingness=Array.isArray(result.missingnessDiagnostics)?result.missingnessDiagnostics:[],descriptives=Array.isArray(result.descriptiveStatistics)?result.descriptiveStatistics:[];
  const merged = Number(flow.merged), eligible = Number(flow.population_eligible), analytic = Number(flow.analytic_complete_case);
  const flowValid = Number.isInteger(merged) && Number.isInteger(eligible) && Number.isInteger(analytic) && merged >= eligible && eligible >= analytic && analytic >= 30;
  const validCoefficient = item => {
    const effect = Number(item.effect), low = Number(item.ci_low), high = Number(item.ci_high), p = Number(item.p_value);
    const ordered = [item.effect,item.ci_low,item.ci_high].every(finite) && low <= effect && effect <= high;
    return ordered && finite(item.p_value) && p >= 0 && p <= 1 && (!['odds_ratio','rate_ratio'].includes(item.effect_type) || low > 0);
  };
  const exposure = coefficients.find(item => item.term === 'analysis_exposure');
  const weights=result.weightDiagnostics||{},design=result.designDiagnostics||{},weightValues=[weights.min,weights.p01,weights.median,weights.p99,weights.max].map(Number);
  const weightDiagnosticsValid=weightValues.every(Number.isFinite)&&weightValues.every(value=>value>0)&&weightValues.every((value,index)=>index===0||value>=weightValues[index-1])&&Number(weights.positive)===analytic;
  const designDiagnosticsValid=Number(design.degreesFreedom)>0&&Number(design.strata)>0&&Number(design.psu)>Number(design.strata);
  const sensitivityValid=sensitivity.length>=2&&sensitivity.every(validCoefficient)&&new Set(sensitivity.map(item=>item.model)).has('unadjusted')&&new Set(sensitivity.map(item=>item.model)).has('weight_trim_1_99');
  const strictSurvey=['generic_survey_v2','generic_survey_v3','generic_survey_v4','generic_survey_v5','generic_survey_v6'].includes(result.analysisMode),strictDiagnostics=['generic_survey_v3','generic_survey_v4','generic_survey_v5','generic_survey_v6'].includes(result.analysisMode),strictDescriptives=['generic_survey_v4','generic_survey_v5','generic_survey_v6'].includes(result.analysisMode),strictDomain=['generic_survey_v5','generic_survey_v6'].includes(result.analysisMode),isV6=result.analysisMode==='generic_survey_v6',completeCases=result.completeCaseDiagnostics||{},model=result.modelDiagnostics||{},domain=result.domainDiagnostics||{};
  const missingnessValid=missingness.length>=5&&missingness.every(item=>typeof item.variable==='string'&&item.variable&&Number.isInteger(Number(item.missing_n))&&Number(item.missing_n)>=0&&Number(item.missing_n)<=eligible&&finite(item.missing_pct)&&Number(item.missing_pct)>=0&&Number(item.missing_pct)<=100);
  const expectedRetention=eligible>0?analytic/eligible:NaN,completeCaseValid=Number(completeCases.populationN)===eligible&&Number(completeCases.completeN)===analytic&&finite(completeCases.retention)&&Math.abs(Number(completeCases.retention)-expectedRetention)<1e-8;
  const modelDiagnosticsValid=model.converged===true&&Number(model.rank)===Number(model.parameters)&&Number(model.parameters)>0&&Number(model.residualDf)>0;
  const conditionNumber=Number(model.conditionNumber),conditioningAcceptable=Number.isFinite(conditionNumber)&&conditionNumber>0&&conditionNumber<=1000;
  const countModel=result.outcomeFamily==='count',dispersion=Number(model.dispersion),countDispersionValid=!countModel||(Number.isFinite(dispersion)&&dispersion>0);
  const attritionAcceptable=completeCaseValid&&Number(completeCases.retention)>=0.5&&missingness.every(item=>Number(item.missing_pct)<=50);
  const descriptiveMetrics=new Set(['weighted_mean','weighted_prevalence','weighted_proportion']),descriptiveVariables=new Set(descriptives.map(item=>item.variable));
  const descriptivesValid=descriptives.length>=2&&descriptiveVariables.has('analysis_exposure')&&descriptiveVariables.has('analysis_outcome')&&descriptives.every(item=>{const estimate=Number(item.estimate),low=Number(item.ci_low),high=Number(item.ci_high),se=Number(item.std_error),n=Number(item.unweighted_n),bounded=!['weighted_prevalence','weighted_proportion'].includes(item.metric)||(estimate>=0&&estimate<=1);return typeof item.variable==='string'&&item.variable&&descriptiveMetrics.has(item.metric)&&Number.isInteger(n)&&n>0&&n<=analytic&&[item.estimate,item.std_error,item.ci_low,item.ci_high].every(finite)&&se>=0&&low<=estimate&&estimate<=high&&bounded});
  const domainCounts=[domain.fullDesignN,domain.populationEligibleN,domain.analyticDomainN,domain.excludedInvalidDesignN].map(Number),domainValid=domain.method==='survey_subset'&&domainCounts.every(Number.isInteger)&&domainCounts.every(value=>value>=0)&&Number(domain.fullDesignN)>=analytic&&Number(domain.populationEligibleN)===eligible&&Number(domain.analyticDomainN)===analytic&&Number(domain.fullDesignN)+Number(domain.excludedInvalidDesignN)===merged;
  const advanced=result.advancedAnalysisPlan||{},nonlinear=result.nonlinearAnalysis||{},subgroups=Array.isArray(result.subgroupAnalyses)?result.subgroupAnalyses:[],nonlinearRequested=advanced.nonlinearMethod==='restricted_cubic_spline',subgroupRequested=Number(advanced.subgroupCount||0)>0;
  const nonlinearValid=!nonlinearRequested||(nonlinear.method==='restricted_cubic_spline'&&[3,4,5].includes(Number(nonlinear.df))&&nonlinear.converged===true&&finite(nonlinear.p_value)&&Number(nonlinear.p_value)>=0&&Number(nonlinear.p_value)<=1);
  const subgroupValid=!subgroupRequested||(subgroups.length>0&&subgroups.every(item=>typeof item.subgroup==='string'&&item.subgroup&&typeof item.level==='string'&&item.level&&Number(item.unweighted_n)>=30&&validCoefficient(item)&&finite(item.interaction_p)&&Number(item.interaction_p)>=0&&Number(item.interaction_p)<=1));
  const checks = [
    check('result_status','error',result.status === 'completed','分析执行状态必须为 completed',{value:result.status}),
    check('sample_flow','error',flowValid,'合并和完整案例样本数必须有效，且最终样本不少于30',flow),
    check('survey_weight','error',/^WT[A-Z0-9_]+\s*\/\s*[1-9][0-9]*$/i.test(String(result.weightRule||'')),'必须记录有效的 NHANES 合并权重规则',{value:result.weightRule}),
    check('primary_exposure','error',Boolean(exposure),'主模型必须包含 analysis_exposure 系数'),
    check('coefficient_bounds','error',coefficients.length>0&&coefficients.every(validCoefficient),'模型效应、置信区间和 P 值必须有限且范围合法'),
    check('model_spec_digest','error',/^[a-f0-9]{64}$/.test(String(result.modelSpecDigest||'')),'结果必须绑定已冻结模型摘要'),
    check('weight_diagnostics',strictSurvey?'error':'warning',weightDiagnosticsValid,'权重分布必须为正、有序并覆盖全部分析样本',weights),
    check('survey_design_diagnostics',strictSurvey?'error':'warning',designDiagnosticsValid,'复杂抽样设计自由度、分层和 PSU 必须有效',design),
    check('sensitivity_models',strictSurvey?'error':'warning',sensitivityValid,'必须完成未调整模型和权重截尾敏感性分析',{models:sensitivity.map(item=>item.model)}),
    check('missingness_diagnostics',strictDiagnostics?'error':'warning',missingnessValid&&completeCaseValid,'必须逐变量记录缺失数量、比例和完整案例保留率',{rows:missingness.length,completeCases}),
    check('complete_case_attrition','warning',attritionAcceptable,'完整案例保留率或单变量缺失比例低于预设提示阈值',{retention:completeCases.retention,maxMissingPct:missingness.length?Math.max(...missingness.map(item=>Number(item.missing_pct))):null}),
    check('model_stability',strictDiagnostics?'error':'warning',modelDiagnosticsValid,'模型必须收敛、满秩且具有正的残差自由度',model),
    check('model_conditioning','warning',conditioningAcceptable,'模型矩阵条件数应为有限正数且不超过1000',{conditionNumber:model.conditionNumber}),
    ...(countModel?[check('count_dispersion','error',countDispersionValid,'计数模型必须记录有限且为正的离散参数',{dispersion:model.dispersion}),check('count_overdispersion','warning',countDispersionValid&&dispersion<=2,'计数结局存在明显过度离散时需要在报告中说明',{dispersion:model.dispersion})]:[]),
    check('descriptive_statistics',strictDescriptives?'error':'warning',descriptivesValid,'必须为暴露、结局和模型协变量提供加权描述统计、未加权 n 与置信区间',{rows:descriptives.length,variables:[...descriptiveVariables]}),
    ...(strictDomain?[check('survey_domain_analysis','error',domainValid,'必须先在有效抽样设计记录上定义 survey design，再以 survey subset 进入目标分析域',domain)]:[]),
    ...(isV6?[check('nonlinear_analysis','error',nonlinearValid,'如预设限制性立方样条，必须完成收敛的 survey Wald 非线性检验',nonlinear),check('subgroup_analysis','error',subgroupValid,'如预设亚组，每个输出层必须至少30人并报告交互 P 值',{requested:advanced.subgroupCount,rows:subgroups.length})]:[]),
    check('runtime_provenance','error',Boolean(result.runtime?.rVersion&&result.runtime?.completedAt),'必须记录 R 版本和完成时间',result.runtime||{})
  ];
  const failed=checks.filter(item=>item.status==='failed').length,warnings=checks.filter(item=>item.status==='warning').length;
  return {schemaVersion:'1.5',status:failed?'failed':'passed',checkedAt:new Date().toISOString(),summary:{total:checks.length,passed:checks.length-failed-warnings,failed,warnings},checks};
}

module.exports = { evaluateResult, evaluateGenericResult };
