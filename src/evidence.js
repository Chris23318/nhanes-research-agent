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

module.exports = { DECISIONS, normalizeEvidence, summarizeEvidence };
