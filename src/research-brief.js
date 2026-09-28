const { assert } = require('./domain');
const { SUPPORTED_CYCLES } = require('./catalog');
const { parseQuestion, parseCycles } = require('./question-parser');

const SOURCES = new Set(['guided', 'template']);
const AIMS = new Set(['分析关联', '估计患病率并分析相关因素', '分析时间趋势', '比较不同人群的差异']);
const ANALYSIS_OPTIONS = new Set([
  '评估暴露与结局的非线性关系',
  '预设有依据的亚组和交互分析',
  '评估缺失数据并在适用时进行多重插补敏感性分析',
  '进行稳健性和敏感性分析'
]);

function clean(value, limit) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanList(value, limit = 30) {
  assert(Array.isArray(value), 'research brief list must be an array');
  return [...new Set(value.map(item => clean(item, 120)).filter(Boolean))].slice(0, limit);
}

function validateResearchBrief(value) {
  if (value == null) return null;
  assert(value && typeof value === 'object' && !Array.isArray(value), 'research brief must be an object');
  const source = clean(value.source, 20), exposure = clean(value.exposure, 160), outcome = clean(value.outcome, 160);
  assert(SOURCES.has(source), 'invalid research brief source');
  assert(exposure.length >= 2, 'research brief exposure is required');
  assert(outcome.length >= 2, 'research brief outcome is required');
  const population = clean(value.population, 200), cycles = clean(value.cycles, 160), aim = clean(value.aim, 80);
  assert(population.length >= 2, 'research brief population is required');
  assert(cycles.length >= 2, 'research brief cycles are required');
  assert(AIMS.has(aim), 'invalid research brief aim');
  const covariates = cleanList(value.covariates || []);
  const analysisOptions = cleanList(value.analysisOptions || [], 10);
  assert(analysisOptions.every(item => ANALYSIS_OPTIONS.has(item)), 'invalid research brief analysis option');
  return { schemaVersion: '1.0', source, exposure, outcome, population, cycles, aim, covariates, analysisOptions, notes: clean(value.notes, 400) };
}

function mergeResearchBrief(intent, brief) {
  if (!brief) return intent;
  const populationIntent = parseQuestion(`在${brief.population}中进行研究`).population;
  const explicitlyRecommended = /Agent|推荐|数据可用性/.test(brief.cycles);
  const parsedCycles = parseCycles(brief.cycles);
  const cycles = explicitlyRecommended ? intent.cycles : parsedCycles.values.filter(cycle => SUPPORTED_CYCLES.includes(cycle));
  const remove = new Set(['未可靠识别暴露，请研究者确认', '未可靠识别结局，请研究者确认', '未明确识别最低年龄']);
  const ambiguities = (intent.ambiguities || []).filter(item => !remove.has(item) && !(cycles.length && item.includes('周期')));
  if (explicitlyRecommended && !ambiguities.some(item => item.includes('周期'))) ambiguities.push('研究者要求 Agent 根据变量可用性推荐周期，正式分析前仍需确认');
  return {
    ...intent,
    title: `${brief.exposure}与${brief.outcome}`,
    population: { ...intent.population, ...populationIntent, label: brief.population },
    exposure: { label: brief.exposure, term: intent.exposure?.term || brief.exposure, component: intent.exposure?.component || null, confidence: 1, source: 'researcher_brief' },
    outcome: { label: brief.outcome, term: intent.outcome?.term || brief.outcome, component: intent.outcome?.component || null, confidence: 1, source: 'researcher_brief' },
    cycles: cycles.length ? cycles : intent.cycles,
    covariates: brief.covariates.length ? brief.covariates : intent.covariates,
    researchAim: brief.aim,
    analysisPreferences: brief.analysisOptions,
    researcherNotes: brief.notes,
    ambiguities,
    parser: { mode: 'structured-brief-v1', source: brief.source, requiresResearcherConfirmation: true }
  };
}

module.exports = { SOURCES, AIMS, ANALYSIS_OPTIONS, validateResearchBrief, mergeResearchBrief };
