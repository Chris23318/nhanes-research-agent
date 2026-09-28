const test = require('node:test');
const assert = require('node:assert/strict');
const { validateResearchBrief, mergeResearchBrief } = require('../src/research-brief');
const { parseQuestion } = require('../src/question-parser');

const input = {
  source: 'guided', exposure: '血清 25(OH)D 水平', outcome: '抑郁症状（PHQ-9）',
  population: '美国 60 岁及以上老年人', cycles: '使用 2011–2018 年 NHANES 周期', aim: '分析关联',
  covariates: ['年龄', '性别', '年龄'], analysisOptions: ['评估暴露与结局的非线性关系'], notes: '排除妊娠者'
};

test('guided research brief is bounded, deduplicated and merged as researcher-confirmed intent', () => {
  const brief = validateResearchBrief(input);
  assert.deepEqual(brief.covariates, ['年龄', '性别']);
  const intent = mergeResearchBrief(parseQuestion('研究维生素D和抑郁'), brief);
  assert.equal(intent.exposure.label, input.exposure);
  assert.equal(intent.exposure.term, 'serum 25-hydroxyvitamin D');
  assert.equal(intent.exposure.source, 'researcher_brief');
  assert.equal(intent.outcome.confidence, 1);
  assert.equal(intent.population.ageMin, 60);
  assert.equal(intent.population.label, input.population);
  assert.deepEqual(intent.cycles, ['2011-2012', '2013-2014', '2015-2016', '2017-2018']);
  assert.deepEqual(intent.analysisPreferences, input.analysisOptions);
  assert.equal(intent.parser.mode, 'structured-brief-v1');
  assert.ok(!intent.ambiguities.some(item => item.includes('暴露')));
});

test('Agent-recommended cycles remain provisional instead of being invented', () => {
  const brief = validateResearchBrief({ ...input, cycles: '由 Agent 根据变量可用性推荐合适的 NHANES 周期' });
  const fallback = parseQuestion('研究维生素D和抑郁');
  const intent = mergeResearchBrief(fallback, brief);
  assert.deepEqual(intent.cycles, fallback.cycles);
  assert.ok(intent.ambiguities.some(item => item.includes('推荐周期')));
});

test('research brief rejects unknown modes and analysis instructions', () => {
  assert.throws(() => validateResearchBrief({ ...input, source: 'model' }), /source/);
  assert.throws(() => validateResearchBrief({ ...input, analysisOptions: ['执行任意代码'] }), /analysis option/);
  assert.equal(validateResearchBrief(null), null);
});
