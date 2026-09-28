const DECISIONS = new Set(['include', 'exclude', 'uncertain']);

const clean = (value, limit = 500) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const cleanList = (value, limit = 20) => Array.isArray(value) ? [...new Set(value.map(item => clean(item, 120)).filter(Boolean))].slice(0, limit) : [];

function normalizeMethodDetails(value = {}) {
  return {
    studyDesign: clean(value.studyDesign || 'not identified in title/abstract', 120),
    modelFamilies: cleanList(value.modelFamilies),
    complexSurvey: clean(value.complexSurvey || 'not identified in title/abstract', 160),
    nonlinear: clean(value.nonlinear || 'not identified in title/abstract', 160),
    missingData: clean(value.missingData || 'not identified in title/abstract', 160),
    secondaryAnalyses: cleanList(value.secondaryAnalyses),
    effectMeasures: cleanList(value.effectMeasures),
    adjustment: clean(value.adjustment || 'not identified in title/abstract', 160),
    nhanesCycles: cleanList(value.nhanesCycles, 12)
  };
}

function normalizeEvidence(items) {
  if (!Array.isArray(items) || items.length > 50) {
    const error = new Error('evidence items must be an array with at most 50 records'); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
  }
  return items.map(item => {
    const pmid = String(item.pmid || '');
    const decision = String(item.decision || 'uncertain');
    if (!/^\d{1,12}$/.test(pmid) || !DECISIONS.has(decision)) {
      const error = new Error('invalid PMID or screening decision'); error.status = 400; error.code = 'VALIDATION_ERROR'; throw error;
    }
    return {
      pmid, decision, reason: clean(item.reason), title: clean(item.title, 1000), doi: clean(item.doi, 200) || null,
      journal: clean(item.journal, 300), published: clean(item.published, 100),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, relevanceScore: Math.min(Math.max(Number(item.relevanceScore) || 0, 0), 100),
      publicationTypes: cleanList(item.publicationTypes), methodTags: cleanList(item.methodTags),
      methodDetails: normalizeMethodDetails(item.methodDetails)
    };
  });
}

function counts(values) {
  return values.flat().reduce((result, value) => { result[value] = (result[value] || 0) + 1; return result; }, {});
}

function methodMatrix(items) {
  return items.filter(item => item.decision === 'include').map(item => ({
    pmid: item.pmid, title: item.title, journal: item.journal, published: item.published, doi: item.doi, url: item.url,
    studyDesign: item.methodDetails.studyDesign, modelFamilies: item.methodDetails.modelFamilies,
    complexSurvey: item.methodDetails.complexSurvey, nonlinear: item.methodDetails.nonlinear,
    missingData: item.methodDetails.missingData, secondaryAnalyses: item.methodDetails.secondaryAnalyses,
    effectMeasures: item.methodDetails.effectMeasures, adjustment: item.methodDetails.adjustment,
    nhanesCycles: item.methodDetails.nhanesCycles, methodTags: item.methodTags,
    evidenceBasis: 'screened PubMed title/abstract extraction; full-text verification required'
  }));
}

function methodDecisions(items, context = {}) {
  const included = items.filter(item => item.decision === 'include'), outcomeType = context.outcomeType || 'unknown';
  const pmidsFor = tag => included.filter(item => item.methodTags.includes(tag)).map(item => item.pmid);
  const primary = ({ binary: ['survey-weighted logistic regression', 'logistic regression'], continuous: ['survey-weighted linear regression', 'linear regression'], continuous_or_unknown: ['survey-weighted linear/generalized model after outcome-type confirmation', null], count: ['survey-weighted quasipoisson regression', 'Poisson regression'], time_to_event: ['survey-weighted Cox regression', 'Cox regression'] })[outcomeType] || ['model selected from the frozen outcome definition', null];
  const surveyPmids = pmidsFor('survey-weighted analysis'), primaryPmids = primary[1] ? pmidsFor(primary[1]) : [], splinePmids = pmidsFor('restricted cubic spline'), imputationPmids = pmidsFor('multiple imputation');
  return [
    { topic: '复杂抽样设计', approach: '使用 NHANES 权重、分层和 PSU，并按合并周期调整权重', status: 'required_by_nhanes_design', evidencePmids: surveyPmids, rationale: surveyPmids.length ? `${surveyPmids.length} 篇纳入文献在题名或摘要中报告复杂抽样方法；最终要求仍以 NHANES 官方分析规范为准。` : '即使摘要未报告，NHANES 官方抽样设计仍要求使用权重、分层和 PSU。' },
    { topic: '主模型', approach: primary[0], status: primaryPmids.length ? 'supported_and_applicable' : 'selected_by_outcome_semantics', evidencePmids: primaryPmids, rationale: primaryPmids.length ? `${primaryPmids.length} 篇纳入文献报告与当前结局类型相符的模型；最终模型由冻结的结局类型决定。` : '纳入摘要未提供直接支持；根据冻结的结局类型和效应尺度选择模型，不能照抄不匹配的文献模型。' },
    { topic: '非线性分析', approach: '限制性立方样条作为预设次要分析', status: splinePmids.length ? 'literature_supported_optional' : 'optional_not_supported_in_abstracts', evidencePmids: splinePmids, rationale: splinePmids.length ? `${splinePmids.length} 篇纳入文献报告样条方法；须在查看结果前冻结自由度和检验方式。` : '纳入摘要未识别样条方法；如研究问题需要，仍可基于科学理由预设，但必须标注为次要分析。' },
    { topic: '缺失数据', approach: '完整案例主分析；协变量多重插补仅作为预设敏感性分析', status: imputationPmids.length ? 'literature_supported_sensitivity' : 'principle_based_sensitivity', evidencePmids: imputationPmids, rationale: imputationPmids.length ? `${imputationPmids.length} 篇纳入文献报告多重插补；暴露和结局是否插补仍需独立论证。` : '纳入摘要未识别多重插补；是否执行取决于缺失比例、缺失机制和冻结方案。' }
  ];
}

function summarizeEvidence(items, context = {}) {
  const included = items.filter(item => item.decision === 'include');
  const excluded = items.filter(item => item.decision === 'exclude');
  const uncertain = items.filter(item => item.decision === 'uncertain');
  const methodCounts = counts(included.map(item => item.methodTags));
  const publicationTypeCounts = counts(included.map(item => item.publicationTypes));
  const recommendations = [];
  if (methodCounts['survey-weighted analysis']) recommendations.push('保留 NHANES 复杂抽样权重、分层和 PSU');
  if (methodCounts['logistic regression']) recommendations.push('二分类结局优先考虑 survey-weighted logistic regression');
  if (methodCounts['linear regression']) recommendations.push('连续结局可使用 survey-weighted linear regression');
  if (methodCounts['restricted cubic spline']) recommendations.push('评估暴露–结局的非线性关系');
  return { total: items.length, included: included.length, excluded: excluded.length, uncertain: uncertain.length, methodCounts, publicationTypeCounts, recommendations, methodMatrix: methodMatrix(items), methodDecisions: methodDecisions(items, context), warning: '方法汇总来自题名与摘要的结构化提取，不替代全文审阅、NHANES 官方规范和偏倚风险评价。' };
}

function summarizeRetrievedEvidence(articles, context = {}) {
  const items = Array.isArray(articles) ? articles : [];
  const methodCounts = counts(items.map(item => Array.isArray(item.methods?.tags) ? item.methods.tags : []));
  const publicationTypeCounts = counts(items.map(item => Array.isArray(item.publicationTypes) ? item.publicationTypes : []));
  const recommendations = [];
  if (methodCounts['survey-weighted analysis']) recommendations.push('既有研究使用复杂抽样方法；主分析应保留权重、分层和 PSU');
  if (methodCounts['logistic regression']) recommendations.push('二分类结局可采用 survey-weighted logistic regression');
  if (methodCounts['linear regression']) recommendations.push('连续结局可作为 survey-weighted linear regression 敏感性分析');
  if (methodCounts['restricted cubic spline']) recommendations.push('预设样条模型评估非线性，避免数据驱动选择切点');
  if (!recommendations.length) recommendations.push('摘要未提供足够方法信息；方案确认前需要阅读全文');
  const provisionalItems = items.map(item => ({ pmid: clean(item.pmid, 12), decision: 'include', title: clean(item.title, 1000), journal: clean(item.journal, 300), published: clean(item.published, 100), doi: clean(item.doi, 200) || null, url: item.url, methodTags: cleanList(item.methods?.tags), publicationTypes: cleanList(item.publicationTypes), methodDetails: normalizeMethodDetails(item.methods?.details) }));
  return { provisional: true, total: items.length, methodCounts, publicationTypeCounts, recommendations, methodMatrix: methodMatrix(provisionalItems), methodDecisions: methodDecisions(provisionalItems, context), warning: '这是对未筛选题名和摘要的自动方法摘要，仅用于提出候选方案；纳入判断、全文方法和偏倚风险仍需人工复核。' };
}

module.exports = { DECISIONS, normalizeEvidence, normalizeMethodDetails, methodMatrix, methodDecisions, summarizeEvidence, summarizeRetrievedEvidence };
