const test = require('node:test');
const assert = require('node:assert/strict');
const { matchStrength, buildVariableCoverage } = require('../src/variable-coverage');

const cycles = ['2015-2016', '2017-2018'];
const item = (variable, file, cycle, score = 4, constraints = '') => ({
  variable,
  file,
  description: `${variable} measurement`,
  matchedCycles: [cycle],
  score,
  constraints
});

test('coverage matrix exposes every concept-cycle cell and changing variable names', () => {
  const groups = [
    { role: 'exposure', concept: 'blood lead', items: [item('LBXBPB', 'PBCD_I', cycles[0]), item('LBXBPB', 'PBCD_J', cycles[1])] },
    { role: 'outcome', concept: 'sleep duration', items: [item('SLD010H', 'SLQ_I', cycles[0], 2), item('SLD012', 'SLQ_J', cycles[1], 2)] }
  ];
  const report = buildVariableCoverage({ cycles }, groups);
  assert.equal(report.summary.coreComplete, true);
  assert.equal(report.summary.coveredCells, 4);
  assert.equal(report.groups[1].issues.includes('variable_name_changes'), true);
  assert.equal(report.recommendations.length, 4);
  assert.match(report.digest, /^[a-f0-9]{64}$/);
});

test('coverage matrix blocks an incomplete core mapping and labels weak matches', () => {
  const groups = [
    { role: 'exposure', concept: 'lead', items: [item('LEAD', 'LAB_I', cycles[0], 1)] },
    { role: 'outcome', concept: 'disease', items: [item('OUT1', 'Q_I', cycles[0]), item('OUT2', 'Q_J', cycles[1])] }
  ];
  const report = buildVariableCoverage({ cycles }, groups);
  assert.equal(report.summary.coreComplete, false);
  assert.equal(report.summary.missingCells, 1);
  assert.equal(report.summary.weakCells, 1);
  assert.equal(report.summary.autoSelectionReady, false);
  assert.equal(matchStrength(1), 'weak');
});

test('coverage digest is stable when candidate ordering changes', () => {
  const exposure = { role: 'exposure', concept: 'lead', items: [item('B', 'B_J', cycles[1]), item('A', 'A_I', cycles[0])] };
  const outcome = { role: 'outcome', concept: 'sleep', items: [item('S2', 'S_J', cycles[1]), item('S1', 'S_I', cycles[0])] };
  const first = buildVariableCoverage({ cycles }, [exposure, outcome]);
  const second = buildVariableCoverage({ cycles }, [{ ...outcome, items: [...outcome.items].reverse() }, { ...exposure, items: [...exposure.items].reverse() }]);
  assert.equal(first.digest, second.digest);
});
