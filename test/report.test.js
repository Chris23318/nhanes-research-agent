const test = require('node:test');
const assert = require('node:assert/strict');
const { htmlReport, markdownReport, flowSvg, forestSvg } = require('../src/report');
const project = { title: '<script>alert(1)</script>', question: 'Vitamin D & depression?', intent: { cycles: ['2017-2018'], population: { ageMin: 20 } } };
const result = { weightRule: 'WTMEC2YR / 1', flow: { merged: 10, adults: 9, complete_phq9: 8, analytic_complete_case: 7, depression_cases: 1 }, coefficients: [{ model: 'primary', term: 'I(LBXVIDMS/10)', effect: 0.9, ci_low: 0.8, ci_high: 1.01, p_value: 0.07 }], sensitivityCoefficients: [], warnings: ['No causality'], runtime: { rVersion: 'R 4', surveyVersion: '4', havenVersion: '2', completedAt: 'now' } };
test('structured report escapes HTML and contains reproducible results', () => { const html = htmlReport(project, result); assert.doesNotMatch(html, /<script>alert/); assert.match(html, /0\.900/); assert.match(html, /不支持因果推断/); assert.match(markdownReport(project, result), /最终完整案例/); });
test('report diagrams are standalone SVG', () => { assert.match(flowSvg(result), /^<svg/); assert.match(forestSvg(result), /^<svg/); });
