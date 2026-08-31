const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvidence, summarizeEvidence } = require('../src/evidence');

test('evidence screening creates auditable method summaries', () => {
  const items = normalizeEvidence([
    { pmid: '123', decision: 'include', title: 'Study', relevanceScore: 100, methodTags: ['survey-weighted analysis', 'logistic regression'], publicationTypes: ['Journal Article'] },
    { pmid: '456', decision: 'exclude', reason: 'wrong outcome' }
  ]);
  const summary = summarizeEvidence(items);
  assert.equal(summary.included, 1); assert.equal(summary.excluded, 1);
  assert.equal(summary.methodCounts['logistic regression'], 1);
  assert.ok(summary.recommendations.some(item => item.includes('logistic')));
});

test('evidence screening rejects unsafe identifiers and decisions', () => {
  assert.throws(() => normalizeEvidence([{ pmid: '../bad', decision: 'include' }]), /invalid PMID/);
  assert.throws(() => normalizeEvidence([{ pmid: '123', decision: 'maybe' }]), /invalid PMID/);
});
