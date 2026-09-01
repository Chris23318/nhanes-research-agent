const test = require('node:test');
const assert = require('node:assert/strict');
const { executionGate } = require('../src/analysis-runner');

function project(overrides = {}) {
  return { id: 'prj_1234567890abcdef', status: 'approved', intent: { cycles: ['2017-2018'], population: { ageMin: 20 } }, variables: [{ variable: 'LBXVIDMS' }, { variable: 'DPQ010–DPQ090' }], ...overrides };
}

test('R execution gate requires approval and the supported exposure/outcome', () => {
  assert.equal(executionGate(project()).ready, true);
  assert.match(executionGate(project({ status: 'awaiting_approval' })).errors.join(' '), /not approved/);
  assert.match(executionGate(project({ variables: [{ variable: 'RIDAGEYR' }] })).errors.join(' '), /LBXVIDMS/);
});
