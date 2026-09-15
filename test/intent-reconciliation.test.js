const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuestion } = require('../src/question-parser');
const { reconcileModelIntent } = require('../src/orchestrator');

test('model enrichment preserves high-confidence canonical concepts', () => {
  const fallback = parseQuestion('研究 NHANES 2017-2018 周期中 20岁以上成年人血清维生素D与抑郁症状（PHQ-9≥10）的横断面关联');
  const result = reconcileModelIntent(fallback, {
    population: { description: 'US adults aged 20 years and older' },
    exposure: '血清维生素D（可能是 VID200，需核实）',
    outcome: '抑郁症状，PHQ-9 总分大于等于 10',
    covariates: ['age', 'sex', 'age'],
    cycles: ['2017-2018', '2099-2100'],
    estimand: 'association',
    ambiguities: ['confirm definitions']
  }, 'deepseek-chat');

  assert.equal(result.exposure.term, 'serum 25-hydroxyvitamin D');
  assert.equal(result.outcome.term, 'depressive symptoms');
  assert.equal(result.title, '血清 25(OH)D与抑郁症状');
  assert.deepEqual(result.cycles, ['2017-2018']);
  assert.deepEqual(result.covariates, ['age', 'sex']);
  assert.equal(result.population.ageMin, 20);
  assert.equal(result.parser.mode, 'model-tools');
});

test('model concepts are retained when deterministic parser is uncertain', () => {
  const fallback = parseQuestion('Study an uncommon biomarker and an uncommon clinical score in NHANES 2017-2018 adults');
  const result = reconcileModelIntent(fallback, {
    population: { description: 'adults' },
    exposure: 'uncommon biomarker',
    outcome: 'uncommon clinical score',
    covariates: [],
    cycles: ['2017-2018'],
    estimand: 'association',
    ambiguities: []
  }, 'deepseek-chat');

  assert.equal(result.exposure.term, 'uncommon biomarker');
  assert.equal(result.outcome.term, 'uncommon clinical score');
  assert.equal(result.exposure.confidence, 0);
  assert.equal(result.outcome.confidence, 0);
});
