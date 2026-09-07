const DECISIONS = new Set(['include', 'exclude', 'uncertain']);

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
      pmid, decision, reason: String(item.reason || '').slice(0, 500), title: String(item.title || '').slice(0, 1000),
      journal: String(item.journal || '').slice(0, 300), published: String(item.published || '').slice(0, 100),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, relevanceScore: Math.min(Math.max(Number(item.relevanceScore) || 0, 0), 100),
      publicationTypes: Array.isArray(item.publicationTypes) ? item.publicationTypes.map(String).slice(0, 20) : [],
      methodTags: Array.isArray(item.methodTags) ? item.methodTags.map(String).slice(0, 20) : []
    };
  });
}

function counts(values) {
  return values.flat().reduce((result, value) => { result[value] = (result[value] || 0) + 1; return result; }, {});
}

function summarizeEvidence(items) {
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
  return { total: items.length, included: included.length, excluded: excluded.length, uncertain: uncertain.length, methodCounts, publicationTypeCounts, recommendations, warning: '方法汇总来自题名与摘要标签，不替代全文审阅和偏倚风险评价。' };
}

function summarizeRetrievedEvidence(articles) {
  const items = Array.isArray(articles) ? articles : [];
  const methodCounts = counts(items.map(item => Array.isArray(item.methods?.tags) ? item.methods.tags : []));
  const publicationTypeCounts = counts(items.map(item => Array.isArray(item.publicationTypes) ? item.publicationTypes : []));
  const recommendations = [];
  if (methodCounts['survey-weighted analysis']) recommendations.push('既有研究使用复杂抽样方法；主分析应保留权重、分层和 PSU');
  if (methodCounts['logistic regression']) recommendations.push('二分类结局可采用 survey-weighted logistic regression');
  if (methodCounts['linear regression']) recommendations.push('连续结局可作为 survey-weighted linear regression 敏感性分析');
  if (methodCounts['restricted cubic spline']) recommendations.push('预设样条模型评估非线性，避免数据驱动选择切点');
  if (!recommendations.length) recommendations.push('摘要未提供足够方法信息；方案确认前需要阅读全文');
  return { provisional: true, total: items.length, methodCounts, publicationTypeCounts, recommendations, warning: '这是对未筛选题名和摘要的自动方法摘要，仅用于提出候选方案；纳入判断和偏倚风险仍需人工复核。' };
}

module.exports = { DECISIONS, normalizeEvidence, summarizeEvidence, summarizeRetrievedEvidence };
