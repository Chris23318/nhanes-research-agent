const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateResult } = require('../src/quality');

function validResult() { return { status: 'completed', weightRule: 'WTMEC2YR / 6', flow: { merged: 100, adults: 90, complete_phq9: 80, analytic_complete_case: 70, depression_cases: 8 }, coefficients: [{ effect: 0.97, ci_low: 0.9, ci_high: 1.03, p_value: 0.2 }], sensitivityCoefficients: [{ effect: 1, ci_low: .8, ci_high: 1.2, p_value: .9 }], runtime: { rVersion: 'R 4.2', completedAt: '2026-01-01' } }; }
test('valid survey result passes the publication quality gate', () => { const qc = evaluateResult(validResult()); assert.equal(qc.status, 'passed'); assert.equal(qc.summary.failed, 0); });
test('invalid sample flow and confidence interval block publication', () => { const value = validResult(); value.flow.depression_cases = 100; value.coefficients[0].ci_low = 2; const qc = evaluateResult(value); assert.equal(qc.status, 'failed'); assert.ok(qc.summary.failed >= 2); });
