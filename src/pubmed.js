const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function buildQuery({ exposure, outcome, population = '', nhanesOnly = true }) {
  const clean = value => String(value || '').replace(/[\[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [`(${clean(exposure)}[Title/Abstract])`, `(${clean(outcome)}[Title/Abstract])`];
  if (population) parts.push(`(${clean(population)}[Title/Abstract])`);
  if (nhanesOnly) parts.push('(NHANES[Title/Abstract] OR "National Health and Nutrition Examination Survey"[Title/Abstract])');
  return parts.join(' AND ');
}

function ncbiParams(config = {}) {
  const params = new URLSearchParams({ tool: config.tool || 'nhanes_research_agent' });
  if (config.email) params.set('email', config.email);
  if (config.apiKey) params.set('api_key', config.apiKey);
  return params;
}

async function request(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}, mode = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'nhanes-research-agent/0.3' } });
    if (!response.ok) { const error = new Error(`NCBI request failed with ${response.status}`); error.code = 'UPSTREAM_ERROR'; error.status = 502; throw error; }
    return mode === 'text' ? await response.text() : await response.json();
  } finally { clearTimeout(timer); }
}

const entities = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
const cleanXml = value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/&(?:amp|quot|#39|lt|gt|nbsp);/g, match => entities[match] || match).replace(/\s+/g, ' ').trim();

function parsePubMedXml(xml) {
  const records = new Map();
  for (const chunk of String(xml).split(/<PubmedArticle>/i).slice(1)) {
    const pmid = cleanXml(chunk.match(/<PMID[^>]*>([\s\S]*?)<\/PMID>/i)?.[1]);
    if (!pmid) continue;
    const abstract = [...chunk.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi)].map(match => {
      const label = match[1].match(/Label="([^"]+)"/i)?.[1];
      return `${label ? `${label}: ` : ''}${cleanXml(match[2])}`;
    }).join(' ').slice(0, 6000);
    const publicationTypes = [...chunk.matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/gi)].map(match => cleanXml(match[1])).filter(Boolean);
    records.set(pmid, { abstract: abstract || null, publicationTypes });
  }
  return records;
}

function inferMethods(article) {
  const text = `${article.title || ''} ${article.abstract || ''}`.toLowerCase();
  const tags = [];
  const rules = [
    ['cross-sectional', /cross[- ]sectional/], ['cohort', /cohort|longitudinal/], ['systematic review', /systematic review|meta-analysis/],
    ['survey-weighted analysis', /survey[- ]weighted|sample weight|complex survey/], ['logistic regression', /logistic regression|odds ratio/],
    ['linear regression', /linear regression/], ['Cox regression', /cox proportional|hazard ratio/], ['restricted cubic spline', /restricted cubic spline|spline regression/]
  ];
  for (const [label, pattern] of rules) if (pattern.test(text)) tags.push(label);
  return { tags, basis: 'rule-based inference from title and abstract; verify full text' };
}

async function searchPubMed(input, options = {}) {
  const query = input.query || buildQuery(input);
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const common = ncbiParams(options);
  const search = new URLSearchParams(common);
  search.set('db', 'pubmed'); search.set('retmode', 'json'); search.set('retmax', String(limit)); search.set('sort', 'relevance'); search.set('term', query);
  const found = await request(`${BASE_URL}/esearch.fcgi?${search}`, options);
  const ids = found.esearchresult?.idlist || [];
  if (!ids.length) return { query, count: Number(found.esearchresult?.count || 0), articles: [], retrievedAt: new Date().toISOString(), source: 'NCBI PubMed E-utilities', compliance: { contactEmailConfigured: Boolean(options.email), apiKeyConfigured: Boolean(options.apiKey) } };
  const summary = new URLSearchParams(common); summary.set('db', 'pubmed'); summary.set('retmode', 'json'); summary.set('id', ids.join(','));
  const data = await request(`${BASE_URL}/esummary.fcgi?${summary}`, options);
  const fetchParams = new URLSearchParams(common); fetchParams.set('db', 'pubmed'); fetchParams.set('retmode', 'xml'); fetchParams.set('id', ids.join(','));
  const xml = await request(`${BASE_URL}/efetch.fcgi?${fetchParams}`, options, 'text');
  const records = parsePubMedXml(xml);
  const articles = ids.map(pmid => data.result?.[pmid]).filter(Boolean).map(item => {
    const record = records.get(item.uid) || { abstract: null, publicationTypes: [] };
    const article = { pmid: item.uid, title: item.title, journal: item.fulljournalname || item.source, published: item.pubdate, authors: (item.authors || []).map(a => a.name), doi: (item.articleids || []).find(x => x.idtype === 'doi')?.value || null, abstract: record.abstract, publicationTypes: record.publicationTypes, url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/` };
    article.methods = inferMethods(article); return article;
  });
  return { query, count: Number(found.esearchresult?.count || articles.length), articles, retrievedAt: new Date().toISOString(), source: 'NCBI PubMed E-utilities', compliance: { contactEmailConfigured: Boolean(options.email), apiKeyConfigured: Boolean(options.apiKey) } };
}

module.exports = { BASE_URL, buildQuery, parsePubMedXml, inferMethods, searchPubMed };
