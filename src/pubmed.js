const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const CONCEPTS = [
  { match: /vitamin\s*d|25[- ]?hydroxyvitamin|25ohd/i, terms: ['vitamin D', '25-hydroxyvitamin D', '25OHD'], mesh: 'Vitamin D' },
  { match: /depress|phq-?9/i, terms: ['depression', 'depressive symptoms', 'PHQ-9'], mesh: 'Depression' },
  { match: /sleep duration|sleep time/i, terms: ['sleep duration', 'sleep time', 'short sleep', 'long sleep'], mesh: 'Sleep Duration' },
  { match: /cardiovascular|\bcvd\b/i, terms: ['cardiovascular disease', 'cardiovascular diseases', 'CVD'], mesh: 'Cardiovascular Diseases' },
  { match: /dietary inflammatory|\bdii\b/i, terms: ['dietary inflammatory index', 'DII'] },
  { match: /chronic kidney|\bckd\b/i, terms: ['chronic kidney disease', 'CKD', 'renal insufficiency'], mesh: 'Renal Insufficiency, Chronic' }
];

const cleanTerm = value => String(value || '').replace(/[\[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
const tagged = term => `"${cleanTerm(term)}"[Title/Abstract]`;

function conceptTerms(value) {
  const clean = cleanTerm(value), known = CONCEPTS.find(item => item.match.test(clean));
  return known ? { terms: known.terms, mesh: known.mesh } : { terms: clean ? [clean] : [], mesh: null };
}

function conceptClause(value, mode = 'expanded') {
  const concept = conceptTerms(value);
  if (mode === 'precise') return concept.terms[0] ? `(${tagged(concept.terms[0])})` : '';
  const alternatives = concept.terms.map(tagged);
  if (concept.mesh) alternatives.unshift(`"${concept.mesh}"[MeSH Terms]`);
  return alternatives.length ? `(${alternatives.join(' OR ')})` : '';
}

function buildQuery({ exposure, outcome, population = '', nhanesOnly = true, mode = 'expanded', includePopulation = false }) {
  const parts = [conceptClause(exposure, mode), conceptClause(outcome, mode)].filter(Boolean);
  if (includePopulation && population) parts.push(`(${tagged(population)})`);
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
    ['linear regression', /linear regression/], ['Poisson regression', /poisson regression|prevalence ratio|rate ratio/],
    ['Cox regression', /cox proportional|hazard ratio/], ['restricted cubic spline', /restricted cubic spline|spline regression/],
    ['multiple imputation', /multiple imputation|chained equations|\bmice\b/], ['complete-case analysis', /complete[- ]case|complete cases/],
    ['subgroup analysis', /subgroup|stratified analys/], ['interaction analysis', /interaction term|effect modification/],
    ['trend test', /p for trend|test for trend/], ['propensity score', /propensity score/], ['mediation analysis', /mediation analys/]
  ];
  for (const [label, pattern] of rules) if (pattern.test(text)) tags.push(label);
  const design = ['cross-sectional', 'cohort', 'systematic review'].find(label => tags.includes(label)) || 'not identified in title/abstract';
  const modelFamilies = ['logistic regression', 'linear regression', 'Poisson regression', 'Cox regression'].filter(label => tags.includes(label));
  const effectMeasures = [['odds ratio', /odds ratio|\bORs?\b/i], ['hazard ratio', /hazard ratio|\bHRs?\b/i], ['risk/rate/prevalence ratio', /risk ratio|rate ratio|prevalence ratio/i], ['regression coefficient', /regression coefficient|beta coefficient|β/i]].filter(([, pattern]) => pattern.test(`${article.title || ''} ${article.abstract || ''}`)).map(([label]) => label);
  const cycles = [...new Set([...text.matchAll(/(?:nhanes[^.]{0,80})?\b((?:19|20)\d{2})\s*[-–—/]\s*((?:19|20)\d{2})\b/gi)].map(match => `${match[1]}-${match[2]}`))].slice(0, 12);
  return {
    tags,
    details: {
      studyDesign: design,
      modelFamilies,
      complexSurvey: tags.includes('survey-weighted analysis') ? 'reported' : 'not identified in title/abstract',
      nonlinear: tags.includes('restricted cubic spline') ? 'restricted cubic spline reported' : 'not identified in title/abstract',
      missingData: tags.includes('multiple imputation') ? 'multiple imputation reported' : tags.includes('complete-case analysis') ? 'complete-case analysis reported' : 'not identified in title/abstract',
      secondaryAnalyses: ['subgroup analysis', 'interaction analysis', 'trend test', 'mediation analysis'].filter(label => tags.includes(label)),
      effectMeasures,
      adjustment: /adjusted for|multivariable|covariates? (?:included|were|comprised)/i.test(`${article.title || ''} ${article.abstract || ''}`) ? 'multivariable adjustment reported' : 'not identified in title/abstract',
      nhanesCycles: cycles
    },
    basis: 'rule-based extraction from title and abstract; verify the full text before freezing the protocol'
  };
}

function scoreRelevance(article, input) {
  const text = `${article.title || ''} ${article.abstract || ''}`.toLowerCase();
  const signals = [];
  const hasConcept = (value, label, weight) => {
    const matched = conceptTerms(value).terms.filter(term => text.includes(term.toLowerCase()));
    if (matched.length) signals.push({ label, matched, weight });
    return matched.length ? weight : 0;
  };
  let score = hasConcept(input.exposure, 'exposure', 35) + hasConcept(input.outcome, 'outcome', 35);
  if (/\bnhanes\b|national health and nutrition examination survey/i.test(text)) { score += 30; signals.push({ label: 'NHANES', matched: ['NHANES'], weight: 30 }); }
  return { score, signals, basis: 'title/abstract term matching; not a risk-of-bias assessment' };
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
    article.methods = inferMethods(article); article.relevance = scoreRelevance(article, input); return article;
  }).sort((a, b) => b.relevance.score - a.relevance.score);
  return { query, count: Number(found.esearchresult?.count || articles.length), articles, retrievedAt: new Date().toISOString(), source: 'NCBI PubMed E-utilities', compliance: { contactEmailConfigured: Boolean(options.email), apiKeyConfigured: Boolean(options.apiKey) } };
}

module.exports = { BASE_URL, CONCEPTS, buildQuery, parsePubMedXml, inferMethods, scoreRelevance, searchPubMed };
