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

async function request(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'nhanes-research-agent/0.3' } });
    if (!response.ok) { const error = new Error(`NCBI request failed with ${response.status}`); error.code = 'UPSTREAM_ERROR'; error.status = 502; throw error; }
    return await response.json();
  } finally { clearTimeout(timer); }
}

async function searchPubMed(input, options = {}) {
  const query = input.query || buildQuery(input);
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
  const common = ncbiParams(options);
  const search = new URLSearchParams(common);
  search.set('db', 'pubmed'); search.set('retmode', 'json'); search.set('retmax', String(limit)); search.set('sort', 'relevance'); search.set('term', query);
  const found = await request(`${BASE_URL}/esearch.fcgi?${search}`, options);
  const ids = found.esearchresult?.idlist || [];
  if (!ids.length) return { query, count: Number(found.esearchresult?.count || 0), articles: [], retrievedAt: new Date().toISOString(), source: 'NCBI PubMed E-utilities' };
  const summary = new URLSearchParams(common); summary.set('db', 'pubmed'); summary.set('retmode', 'json'); summary.set('id', ids.join(','));
  const data = await request(`${BASE_URL}/esummary.fcgi?${summary}`, options);
  const articles = ids.map(pmid => data.result?.[pmid]).filter(Boolean).map(item => ({ pmid: item.uid, title: item.title, journal: item.fulljournalname || item.source, published: item.pubdate, authors: (item.authors || []).map(a => a.name), doi: (item.articleids || []).find(x => x.idtype === 'doi')?.value || null }));
  return { query, count: Number(found.esearchresult?.count || articles.length), articles, retrievedAt: new Date().toISOString(), source: 'NCBI PubMed E-utilities' };
}

module.exports = { BASE_URL, buildQuery, searchPubMed };
