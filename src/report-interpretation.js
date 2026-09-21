function finite(value) { return Number.isFinite(Number(value)); }
function number(value, digits = 3) { return finite(value) ? Number(value).toFixed(digits) : '未记录'; }
function pvalue(value) { return !finite(value) ? '未记录' : Number(value) < 0.001 ? '<0.001' : number(value, 3); }
function pExpression(value) { return !finite(value) ? 'P 未记录' : Number(value) < 0.001 ? 'P<0.001' : `P=${number(value, 3)}`; }
function effect(row) { return row?.effect ?? row?.odds_ratio ?? row?.estimate; }
function ratioScale(row) { return ['odds_ratio', 'rate_ratio', 'risk_ratio'].includes(row?.effect_type); }
function nullValue(row) { return ratioScale(row) ? 1 : 0; }
function excludesNull(row) { return finite(row?.ci_low) && finite(row?.ci_high) && (Number(row.ci_high) < nullValue(row) || Number(row.ci_low) > nullValue(row)); }
function significant(row) { return finite(row?.p_value) && Number(row.p_value) < 0.05 && excludesNull(row); }

function exposureLabel(project) {
  const spec = project.modelSpec || {};
  return project.intent?.exposure?.label || project.intent?.exposure?.concept || spec.exposureConcept || (spec.exposureMappings || []).map(item => item.variable).filter(Boolean).join('/') || '主要暴露';
}

function outcomeLabel(project) {
  const spec = project.modelSpec || {};
  return project.intent?.outcome?.label || project.intent?.outcome?.concept || spec.outcomeConcept || (spec.outcomeMappings || []).map(item => item.variable).filter(Boolean).join('/') || '研究结局';
}

function unitLabel(project) {
  const transform = project.modelSpec?.exposureTransform;
  if (transform === 'log2') return '每增加 1 个 log2 单位（即原始暴露约翻倍）';
  if (transform === 'per_sd') return '每增加 1 个标准差';
  return '每增加 1 个建模单位';
}

function effectLabel(row) {
  if (row?.effect_type === 'odds_ratio') return 'OR';
  if (row?.effect_type === 'rate_ratio') return 'RR';
  if (row?.effect_type === 'risk_ratio') return 'RR';
  return 'β';
}

function mainInterpretation(project, result) {
  const row = (result.coefficients || []).find(item => item.term === 'analysis_exposure') || (result.coefficients || []).find(item => item.term === 'I(LBXVIDMS/10)');
  if (!row || !finite(effect(row)) || !finite(row.ci_low) || !finite(row.ci_high)) return '主要效应估计不完整，不能进行统计或流行病学解释。';
  const estimate = Number(effect(row));
  const exp = exposureLabel(project), out = outcomeLabel(project), scale = effectLabel(row);
  let direction;
  if (ratioScale(row)) {
    const percentage = Math.abs((estimate - 1) * 100).toFixed(1);
    const noun = row.effect_type === 'odds_ratio' ? '优势（odds）' : '发生率';
    direction = estimate >= 1 ? `${out}的${noun}估计升高 ${percentage}%` : `${out}的${noun}估计降低 ${percentage}%`;
  } else direction = `${out}的加权均值估计${estimate >= 0 ? '升高' : '降低'} ${Math.abs(estimate).toFixed(3)} 个结局单位`;
  const evidence = significant(row)
    ? `95% 置信区间未跨越无效值，数据提供了统计学关联证据（${pExpression(row.p_value)}）。`
    : `95% 置信区间包含无效值或 P≥0.05，当前数据不足以确认存在统计学关联；这不等同于证明“没有关联”（${pExpression(row.p_value)}）。`;
  return `在复杂抽样加权并调整预设协变量后，${exp}${unitLabel(project)}与${direction}相关（${scale}=${number(estimate)}，95% CI ${number(row.ci_low)}–${number(row.ci_high)}）。${evidence}`;
}

function sensitivityInterpretation(result) {
  const main = (result.coefficients || []).find(item => item.term === 'analysis_exposure') || (result.coefficients || []).find(item => item.term === 'I(LBXVIDMS/10)');
  const rows = (result.sensitivityCoefficients || []).filter(row => finite(effect(row)) && finite(row.ci_low) && finite(row.ci_high));
  if (!rows.length || !main || !finite(effect(main))) return '未执行或未记录可解释的敏感性分析。';
  const mainDirection = Number(effect(main)) >= nullValue(main);
  const sameDirection = rows.filter(row => (Number(effect(row)) >= nullValue(row)) === mainDirection).length;
  const corroborating = rows.filter(significant).length;
  return `${rows.length} 个敏感性估计中，${sameDirection} 个与主模型方向一致，${corroborating} 个的 95% 置信区间未跨越无效值。方向一致可增强稳健性判断，但不能消除残余混杂、选择偏倚或模型设定偏倚。`;
}

function missingnessInterpretation(result) {
  const complete = result.completeCaseDiagnostics || {};
  const retention = finite(complete.retention) ? Number(complete.retention) : null;
  const missing = (result.missingnessDiagnostics || []).filter(row => finite(row.missing_pct)).sort((a, b) => Number(b.missing_pct) - Number(a.missing_pct));
  if (retention === null && !missing.length) return '缺失数据诊断未记录，无法判断完整案例选择偏倚风险。';
  const top = missing[0];
  const retentionText = retention === null ? '完整案例保留率未记录' : `完整案例保留率为 ${(retention * 100).toFixed(1)}%`;
  const concern = retention !== null && retention < 0.8 ? '保留率低于 80%，完整案例分析的选择偏倚风险较高。' : retention !== null && retention < 0.9 ? '存在一定样本损失，应结合缺失机制进行解释。' : '样本保留率尚可，但仍不能假定缺失完全随机。';
  const topText = top ? `缺失率最高的分析字段为 ${top.variable}（${Number(top.missing_pct).toFixed(1)}%）。` : '';
  return `${retentionText}。${topText}${concern}`;
}

function diagnosticsInterpretation(result) {
  const model = result.modelDiagnostics || {}, design = result.designDiagnostics || {};
  const parts = [];
  if (model.converged === true) parts.push('模型已收敛');
  else if (model.converged === false) parts.push('模型未收敛，效应估计不得用于结论');
  if (finite(model.conditionNumber)) parts.push(Number(model.conditionNumber) >= 30 ? `条件数为 ${number(model.conditionNumber, 1)}，提示较强共线性或数值不稳定` : `条件数为 ${number(model.conditionNumber, 1)}，未见明显数值不稳定信号`);
  if (finite(design.degreesFreedom)) parts.push(Number(design.degreesFreedom) < 8 ? `设计自由度仅 ${number(design.degreesFreedom, 0)}，置信区间和检验可能不稳定` : `设计自由度为 ${number(design.degreesFreedom, 0)}`);
  return parts.length ? `${parts.join('；')}。这些诊断用于判断估计是否可解释，不代表研究已排除所有偏倚。` : '模型稳定性和复杂抽样设计诊断记录不足。';
}

function nonlinearInterpretation(result) {
  const nonlinear = result.nonlinearAnalysis || {};
  if (nonlinear.method !== 'restricted_cubic_spline') return '未预设非线性分析。';
  if (!finite(nonlinear.p_value)) return '限制性立方样条已预设，但模型比较 P 值不可用，不能判断非线性。';
  return Number(nonlinear.p_value) < 0.05
    ? `线性模型与限制性立方样条模型的 survey Wald 比较 ${pExpression(nonlinear.p_value)}，提示暴露–结局关系可能偏离简单线性；应结合剂量–反应曲线的形状和置信区间解读。`
    : `线性模型与限制性立方样条模型的 survey Wald 比较 ${pExpression(nonlinear.p_value)}，未发现明确的非线性证据；这不等同于证明关系严格线性。`;
}

function subgroupInterpretation(result) {
  const rows = Array.isArray(result.subgroupAnalyses) ? result.subgroupAnalyses : [];
  if (!rows.length) return '未产生符合最小样本量要求的亚组估计。';
  const variables = [...new Set(rows.map(row => row.subgroup))];
  const heterogeneous = [...new Map(rows.filter(row => finite(row.interaction_p)).map(row => [row.subgroup, Number(row.interaction_p)])).entries()].filter(([, value]) => value < 0.05);
  return `共报告 ${variables.length} 个预设亚组变量、${rows.length} 个分层估计。${heterogeneous.length ? `${heterogeneous.map(([name, value]) => `${name}（交互 ${pExpression(value)}）`).join('、')}出现探索性效应异质性信号。` : '未观察到交互 P<0.05 的明确异质性信号。'}亚组结果未进行多重性校正，不应根据单个分层 P 值宣称人群差异。`;
}

function epidemiologicConclusion(project, result) {
  const main = (result.coefficients || []).find(item => item.term === 'analysis_exposure') || (result.coefficients || []).find(item => item.term === 'I(LBXVIDMS/10)');
  const exp = exposureLabel(project), out = outcomeLabel(project);
  if (!main || !finite(effect(main))) return `现有输出不足以形成关于${exp}与${out}的流行病学结论。`;
  const association = significant(main) ? '观察到统计学关联证据' : '未获得足以确认统计学关联的证据';
  return `在所选 NHANES 周期和目标人群中，${exp}与${out}${association}。该结论面向美国非机构化人群的复杂抽样加权横断面估计；不能确定时间先后或因果方向，也不能直接转化为个体诊疗建议。解释时必须同时考虑置信区间宽度、临床或公共卫生意义、缺失数据、残余混杂、反向因果和多重比较。`;
}

function buildInterpretation(project, result) {
  return {
    main: mainInterpretation(project, result),
    sensitivity: sensitivityInterpretation(result),
    missingness: missingnessInterpretation(result),
    diagnostics: diagnosticsInterpretation(result),
    nonlinear: nonlinearInterpretation(result),
    subgroup: subgroupInterpretation(result),
    conclusion: epidemiologicConclusion(project, result),
  };
}

module.exports = { buildInterpretation, mainInterpretation, sensitivityInterpretation, missingnessInterpretation, diagnosticsInterpretation, nonlinearInterpretation, subgroupInterpretation, epidemiologicConclusion };
