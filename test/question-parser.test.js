const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuestion } = require('../src/question-parser');

test('question parser identifies concepts, population and cycles', () => {
  const result = parseQuestion('探讨美国 20 岁以上成年人血清维生素 D 与抑郁症状的关联，使用 2007–2018 年 NHANES 数据');
  assert.equal(result.exposure.label, '血清 25(OH)D');
  assert.equal(result.outcome.label, '抑郁症状');
  assert.equal(result.population.ageMin, 20);
  assert.deepEqual(result.cycles, ['2007-2008', '2009-2010', '2011-2012', '2013-2014', '2015-2016', '2017-2018']);
});

test('question parser marks unknown concepts for confirmation', () => {
  const result = parseQuestion('研究某种新型暴露与某项健康指标之间的关系');
  assert.equal(result.parser.requiresResearcherConfirmation, true);
  assert.ok(result.ambiguities.length >= 3);
});
