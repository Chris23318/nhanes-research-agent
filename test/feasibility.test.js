const test = require('node:test');
const assert = require('node:assert/strict');
const { assessFeasibility } = require('../src/feasibility');
const { parseQuestion } = require('../src/question-parser');
const { resolveVariables } = require('../src/catalog');

test('validated vitamin D and PHQ-9 pipeline is executable', () => { const intent = parseQuestion('研究 2017-2018 年成年人维生素 D 与抑郁'); const result = assessFeasibility(intent, resolveVariables(intent)); assert.equal(result.status, 'executable'); assert.equal(result.supportedPipeline, 'vitamin_d_phq9_v1'); });
test('other recognized topics are design-only until variables and runner exist', () => { const intent = parseQuestion('研究 2017-2018 年成年人睡眠时长与心血管疾病'); const result = assessFeasibility(intent, resolveVariables(intent)); assert.equal(result.status, 'design_only'); assert.ok(result.blockers.some(item => item.includes('暴露'))); });
test('unknown concepts require clarification', () => { const intent = parseQuestion('研究 2017-2018 年某种新暴露与新指标的关系'); assert.equal(assessFeasibility(intent, resolveVariables(intent)).status, 'needs_clarification'); });
