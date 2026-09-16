const { fetchOfficialCatalog, COMPONENTS } = require('./cdc-catalog');
const { resolveVariables } = require('./catalog');
const { buildVariableCoverage } = require('./variable-coverage');

const STOP = new Set(['and', 'the', 'with', 'among', 'between', 'association', 'relationship', 'risk', 'level', 'serum', 'status']);
const cache = new Map();
function covariateSearchTerm(value) {
  const text=String(value||'');
  const aliases=[[/年龄|\bage\b/i,'RIDAGEYR age in years'],[/性别|性别认同|\bsex\b|gender/i,'RIAGENDR sex'],[/种族|族裔|race|ethnic/i,'RIDRETH1 race ethnicity'],[/教育|education/i,'DMDEDUC2 education level adults'],[/贫困|收入比|\bpir\b|poverty income/i,'INDFMPIR poverty income ratio'],[/体重指数|\bbmi\b|body mass/i,'BMXBMI body mass index'],[/吸烟|smok/i,'smoking cigarette'],[/体力活动|physical activity/i,'physical activity']];
  return aliases.find(([pattern])=>pattern.test(text))?.[1]||text;
}

function conceptSearchTerm(value) {
  const text=String(value||'');
  const aliases=[
    [/sleep duration|sleep hours|睡眠时长/i,'SLD012 SLD013 sleep hours duration'],
    [/cardiovascular disease|心血管/i,'MCQ160C MCQ160E MCQ160F coronary heart disease heart attack stroke'],
    [/blood lead|血铅/i,'LBXBPB blood lead'],
    [/hypertension|high blood pressure|高血压/i,'BPQ020 BPXSY BPXDI hypertension blood pressure'],
    [/diabetes|糖尿病/i,'DIQ010 LBXGH diabetes glycohemoglobin'],
    [/kidney disease|chronic kidney|肾病|肾功能/i,'KIQ022 LBXSCR URXUCR kidney disease creatinine'],
    [/depression|抑郁/i,'DPQ010 DPQ020 DPQ030 DPQ040 DPQ050 DPQ060 DPQ070 DPQ080 DPQ090 depression PHQ-9'],
    [/physical activity|体力活动/i,'PAQ physical activity'],
    [/smoking|cigarette|吸烟/i,'SMQ020 smoking cigarette']
  ];
  return aliases.find(([pattern])=>pattern.test(text))?.[1]||text;
}

function tokens(value) {
  return [...new Set(String(value || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g) || [])].filter(x => !STOP.has(x));
}

function scoreItem(item, concept) {
  const primary = `${item.variable} ${item.description}`.toLowerCase();
  const context = `${item.file} ${item.fileDescription}`.toLowerCase();
  const words = tokens(concept);
  if (!words.length) return 0;
  const hits = words.filter(word => primary.includes(word)).length;
  const contextHits = words.filter(word => context.includes(word)).length;
  const auxiliary = /comment code|quality flag|detection limit|status code/.test(primary);
  return 3 * hits / words.length + 0.2 * contextHits / words.length + (hits === words.length ? 1 : 0) - (auxiliary ? 1.5 : 0);
}

function rankCatalogItems(items, concept, limit = 5) {
  const unique = [...new Map(items.map(item => [JSON.stringify([item.variable, item.file, item.beginYear, item.endYear]), item])).values()];
  return unique.map(item => ({ ...item, score: scoreItem(item, concept) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.variable.localeCompare(b.variable))
    .slice(0, limit);
}

async function catalog(component, options) {
  const key = component;
  const existing = cache.get(key);
  if (!options.fetchCatalog && existing && Date.now() - existing.at < 3600000) return existing.items;
  const fetcher=options.fetchCatalog||fetchOfficialCatalog;let result,lastError;
  for(let attempt=0;attempt<2;attempt+=1){
    try{result=await fetcher({component,cycle:'',limit:500},{...options,timeoutMs:options.timeoutMs||25000,internalDiscovery:true});break}
    catch(error){lastError=error;if(attempt===0)await new Promise(resolve=>setTimeout(resolve,150))}
  }
  if(!result){const error=new Error(`${component}: ${String(lastError?.message||lastError||'catalog request failed')}`);error.code=lastError?.code;throw error}
  if (!options.fetchCatalog) cache.set(key, { at: Date.now(), items: result.items || [] });
  return result.items || [];
}

async function discoverVariableMap(intent, options = {}) {
  const verified = resolveVariables(intent);
  const roles = new Set(verified.map(item => item.role));
  const missing = ['exposure', 'outcome'].filter(role => !roles.has(role));
  const covariateConcepts = missing.length ? [...new Set((intent.covariates || []).map(String).filter(Boolean))].slice(0,8) : [];
  if (!missing.length && !covariateConcepts.length) return { variables: verified, discovery: { mode: 'verified_registry', candidates: [] } };
  const requested = new Set(missing.map(role => intent[role]?.component).filter(component => COMPONENTS.has(component)));
  const components = covariateConcepts.length ? [...COMPONENTS] : requested.size ? [...requested] : [...COMPONENTS];
  const results = await Promise.allSettled(components.map(component => catalog(component, options).then(items => ({ component, items }))));
  const pool = results.filter(x => x.status === 'fulfilled').flatMap(x => x.value.items);
  const candidates = [];
  const requestedGroups=[...missing.map(role=>({role,concept:intent[role]?.term||intent[role]?.label,searchTerm:conceptSearchTerm(intent[role]?.term||intent[role]?.label)})),...covariateConcepts.map(concept=>({role:'covariate',concept,searchTerm:covariateSearchTerm(concept)}))];
  for (const {role,concept,searchTerm} of requestedGroups) {
    const selectedCycles = intent.cycles || [];
    const eligible = pool.map(item => ({ ...item, matchedCycles: selectedCycles.filter(cycle => cycle === `${item.beginYear}-${item.endYear}`), cycleVerification: item.beginYear && item.endYear ? 'catalog_dates' : 'unknown' }))
      .filter(item => !selectedCycles.length || item.cycleVerification === 'unknown' || item.matchedCycles.length);
    const ranked = selectedCycles.length ? [...new Map(selectedCycles.flatMap(cycle=>rankCatalogItems(eligible.filter(item=>item.matchedCycles.includes(cycle)||item.cycleVerification==='unknown'),searchTerm,5)).map(item=>[`${item.variable}:${item.file}`,item])).values()] : rankCatalogItems(eligible,searchTerm,10);
    candidates.push({ role, concept, searchTerm, items: ranked, status: ranked.length ? 'researcher_confirmation_required' : 'not_found' });
  }
  const coverage = buildVariableCoverage(intent, candidates);
  return {
    variables: verified,
    discovery: {
      schemaVersion: '2.0', mode: 'official_cdc_catalog', source: 'CDC/NCHS NHANES variable list', retrievedAt: new Date().toISOString(),
      components, candidates, coverage, coverageDigest: coverage.digest,
      errors: results.filter(x => x.status === 'rejected').map(x => String(x.reason?.message || x.reason).slice(0, 300))
    }
  };
}

module.exports = { tokens, scoreItem, rankCatalogItems, covariateSearchTerm, conceptSearchTerm, discoverVariableMap };
