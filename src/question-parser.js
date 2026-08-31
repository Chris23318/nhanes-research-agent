const { CYCLES } = require('./catalog');

const concepts = {
  exposures: [
    { pattern: /维生素\s*d|vitamin\s*d|25\s*\(?oh\)?d/i, label: '血清 25(OH)D', term: 'serum 25-hydroxyvitamin D', component: 'Laboratory' },
    { pattern: /膳食炎症|dietary inflammatory|\bdii\b/i, label: '膳食炎症指数', term: 'dietary inflammatory index', component: 'Dietary' },
    { pattern: /睡眠时长|睡眠时间|sleep duration/i, label: '睡眠时长', term: 'sleep duration', component: 'Questionnaire' }
  ],
  outcomes: [
    { pattern: /抑郁|depress|phq-?9/i, label: '抑郁症状', term: 'depressive symptoms', component: 'Questionnaire' },
    { pattern: /慢性肾病|\bckd\b|chronic kidney/i, label: '慢性肾病', term: 'chronic kidney disease', component: 'Laboratory' },
    { pattern: /心血管|cardiovascular|\bcvd\b/i, label: '心血管疾病', term: 'cardiovascular disease', component: 'Questionnaire' }
  ]
};

function match(items, question, fallback) {
  const found = items.find(item => item.pattern.test(question));
  return found ? { label: found.label, term: found.term, component: found.component, confidence: 0.95 } : { label: fallback, term: null, component: null, confidence: 0.25 };
}

function parseCycles(question) {
  const years = [...question.matchAll(/(?:19|20)\d{2}/g)].map(match => Number(match[0]));
  if (years.length < 2) return { values: CYCLES, inferred: true };
  const start = Math.min(...years), end = Math.max(...years);
  const values = CYCLES.filter(cycle => {
    const [cycleStart, cycleEnd] = cycle.split('-').map(Number);
    return cycleStart >= start && cycleEnd <= end;
  });
  return { values: values.length ? values : CYCLES, inferred: !values.length };
}

function parseQuestion(question) {
  const exposure = match(concepts.exposures, question, '待确认暴露');
  const outcome = match(concepts.outcomes, question, '待确认结局');
  const ageMatch = question.match(/(\d{1,2})\s*岁(?:以上|及以上|或以上)/);
  const ageMin = ageMatch ? Number(ageMatch[1]) : (/成年|adult/i.test(question) ? 18 : null);
  const cycles = parseCycles(question);
  const ambiguities = [];
  if (!exposure.term) ambiguities.push('未可靠识别暴露，请研究者确认');
  if (!outcome.term) ambiguities.push('未可靠识别结局，请研究者确认');
  if (cycles.inferred) ambiguities.push('未明确识别 NHANES 周期，暂用默认周期');
  if (ageMin === null) ambiguities.push('未明确识别最低年龄');
  return {
    title: `${exposure.label}与${outcome.label}`,
    population: { ageMin, geography: 'United States', pregnancy: 'not specified' },
    exposure,
    outcome,
    cycles: cycles.values,
    studyDesign: 'cross-sectional complex survey',
    covariates: ['年龄', '性别', '种族/族裔', '教育', '贫困收入比', 'BMI'],
    ambiguities,
    parser: { mode: 'deterministic-v1', requiresResearcherConfirmation: true }
  };
}

module.exports = { parseQuestion, parseCycles };
