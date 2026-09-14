const { fetchOfficialCatalog, COMPONENTS } = require('./cdc-catalog');
const { resolveVariables } = require('./catalog');

const STOP = new Set(['and', 'the', 'with', 'among', 'between', 'association', 'relationship', 'risk', 'level', 'serum', 'status']);
const cache = new Map();

function tokens(value) {
  return [...new Set(String(value || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g) || [])].filter(x => !STOP.has(x));
}

function scoreItem(item, concept) {
  const haystack = `${item.variable} ${item.description} ${item.file} ${item.fileDescription}`.toLowerCase();
  const words = tokens(concept);
  if (!words.length) return 0;
  const hits = words.filter(word => haystack.includes(word)).length;
  return hits / words.length + (hits === words.length ? 0.5 : 0) + (/weight|strata|cluster|psu/.test(haystack) ? -0.25 : 0);
}

function rankCatalogItems(items, concept, limit = 5) {
  return items.map(item => ({ ...item, score: scoreItem(item, concept) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.variable.localeCompare(b.variable))
    .slice(0, limit);
}

async function catalog(component, options) {
  const key = component;
  const existing = cache.get(key);
  if (!options.fetchCatalog && existing && Date.now() - existing.at < 3600000) return existing.items;
  const result = await (options.fetchCatalog || fetchOfficialCatalog)({ component, cycle: '', limit: 500 }, { ...options, internalDiscovery: true });
  if (!options.fetchCatalog) cache.set(key, { at: Date.now(), items: result.items || [] });
  return result.items || [];
}

async function discoverVariableMap(intent, options = {}) {
  const verified = resolveVariables(intent);
  const roles = new Set(verified.map(item => item.role));
  const missing = ['exposure', 'outcome'].filter(role => !roles.has(role));
  if (!missing.length) return { variables: verified, discovery: { mode: 'verified_registry', candidates: [] } };
  const requested = new Set(missing.map(role => intent[role]?.component).filter(component => COMPONENTS.has(component)));
  const components = requested.size ? [...requested] : [...COMPONENTS];
  const results = await Promise.allSettled(components.map(component => catalog(component, options).then(items => ({ component, items }))));
  const pool = results.filter(x => x.status === 'fulfilled').flatMap(x => x.value.items);
  const candidates = [];
  for (const role of missing) {
    const concept = intent[role]?.term || intent[role]?.label;
    const selectedCycles = intent.cycles || [];
    const eligible = pool.map(item => ({ ...item, matchedCycles: selectedCycles.filter(cycle => cycle === `${item.beginYear}-${item.endYear}`), cycleVerification: item.beginYear && item.endYear ? 'catalog_dates' : 'unknown' }))
      .filter(item => !selectedCycles.length || item.cycleVerification === 'unknown' || item.matchedCycles.length);
    const ranked = rankCatalogItems(eligible, concept);
    candidates.push({ role, concept, items: ranked, status: ranked.length ? 'researcher_confirmation_required' : 'not_found' });
  }
  return {
    variables: verified,
    discovery: {
      mode: 'official_cdc_catalog', source: 'CDC/NCHS NHANES variable list', retrievedAt: new Date().toISOString(),
      components, candidates, errors: results.filter(x => x.status === 'rejected').map(x => String(x.reason?.message || x.reason).slice(0, 300))
    }
  };
}

module.exports = { tokens, scoreItem, rankCatalogItems, discoverVariableMap };
