const test = require('node:test');
const assert = require('node:assert/strict');
const { assessFeasibility } = require('../src/feasibility');
const { parseQuestion } = require('../src/question-parser');
const { resolveVariables } = require('../src/catalog');

test('validated vitamin D and PHQ-9 pipeline is executable', () => { const intent = parseQuestion('研究 2017-2018 年成年人维生素 D 与抑郁'); const result = assessFeasibility(intent, resolveVariables(intent)); assert.equal(result.status, 'executable'); assert.equal(result.supportedPipeline, 'vitamin_d_phq9_v1'); });
test('other recognized topics are design-only until variables and runner exist', () => { const intent = parseQuestion('研究 2017-2018 年成年人睡眠时长与心血管疾病'); const result = assessFeasibility(intent, resolveVariables(intent)); assert.equal(result.status, 'design_only'); assert.ok(result.blockers.some(item => item.includes('暴露'))); });
test('unknown concepts require clarification', () => { const intent = parseQuestion('研究 2017-2018 年某种新暴露与新指标的关系'); assert.equal(assessFeasibility(intent, resolveVariables(intent)).status, 'needs_clarification'); });
test('partial candidate coverage cannot become executable',()=>{const intent={exposure:{term:'lead'},outcome:{term:'pressure'},cycles:['2015-2016','2017-2018']};const variables=[{role:'exposure',variable:'LEAD',cycles:['2017-2018']},{role:'outcome',variable:'BP',cycles:['2017-2018']},{role:'design',variable:'WTMEC2YR',cycles:intent.cycles},{role:'design',variable:'SDMVSTRA',cycles:intent.cycles},{role:'design',variable:'SDMVPSU',cycles:intent.cycles}];const result=assessFeasibility(intent,variables);assert.equal(result.status,'design_only');assert.ok(result.blockers.some(x=>x.includes('全部所选周期')))});
