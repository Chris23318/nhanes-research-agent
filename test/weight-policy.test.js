const test = require('node:test');
const assert = require('node:assert/strict');
const { inferComponent, createWeightAdvice } = require('../src/weight-policy');

function project(component, cycles = ['2015-2016', '2017-2018']) {
  return { intent: { cycles }, variables: [
    { role: 'exposure', concept: 'x', sourceFile: 'X_I', sourceComponent: component, cycles, confirmationStatus: 'codebook_and_cleaning_approved' },
    { role: 'outcome', concept: 'y', sourceFile: 'Y_I', sourceComponent: 'Questionnaire', cycles, confirmationStatus: 'codebook_and_cleaning_approved' },
    { role: 'design', variable: 'WTMEC2YR', cycles }, { role: 'design', variable: 'WTINT2YR', cycles }
  ] };
}

test('weight advisor recommends MEC weights when any selected variable uses examination data', () => {
  const advice = createWeightAdvice(project('Examination'));
  assert.equal(advice.recommendedWeight, 'WTMEC2YR');
  assert.equal(advice.divisor, 2);
  assert.equal(advice.formula, 'WTMEC2YR / 2');
  assert.equal(advice.status, 'recommended');
});

test('weight advisor recommends interview weights for questionnaire-only analysis', () => {
  const advice = createWeightAdvice(project('Questionnaire'));
  assert.equal(advice.recommendedWeight, 'WTINT2YR');
  assert.equal(advice.analysisDomain, 'interview');
});

test('laboratory weights require codebook review and dietary analyses are blocked', () => {
  assert.equal(createWeightAdvice(project('Laboratory')).status, 'review_required');
  const dietary = createWeightAdvice(project('Dietary'));
  assert.equal(dietary.status, 'blocked');
  assert.match(dietary.blockers.join(' '), /专用权重/);
});

test('nonstandard cycles never receive an automatic divisor', () => {
  const advice = createWeightAdvice(project('Questionnaire', ['2021-2023']));
  assert.equal(advice.divisor, null);
  assert.equal(advice.status, 'blocked');
});

test('component inference is conservative for unknown files', () => {
  assert.equal(inferComponent({ sourceFile: 'DEMO_J' }), 'Demographics');
  assert.equal(inferComponent({ sourceFile: 'PBCD_J' }), 'Unknown');
});
