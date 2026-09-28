const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvidence, summarizeEvidence, summarizeRetrievedEvidence } = require('../src/evidence');

test('evidence screening creates auditable method summaries', () => {
  const items = normalizeEvidence([
    { pmid: '123', decision: 'include', title: 'Study', relevanceScore: 100, methodTags: ['survey-weighted analysis', 'logistic regression', 'multiple imputation'], methodDetails: { studyDesign: 'cross-sectional', modelFamilies: ['logistic regression'], complexSurvey: 'reported', missingData: 'multiple imputation reported' }, publicationTypes: ['Journal Article'] },
    { pmid: '456', decision: 'exclude', reason: 'wrong outcome' }
  ]);
  const summary = summarizeEvidence(items);
  assert.equal(summary.included, 1); assert.equal(summary.excluded, 1);
  assert.equal(summary.methodCounts['logistic regression'], 1);
  assert.ok(summary.recommendations.some(item => item.includes('logistic')));
  assert.equal(summary.methodMatrix[0].studyDesign, 'cross-sectional');
  assert.equal(summary.methodDecisions.find(item => item.topic === '主模型').status, 'selected_by_outcome_semantics');
  const binary = summarizeEvidence(items, { outcomeType: 'binary' });
  assert.equal(binary.methodDecisions.find(item => item.topic === '主模型').status, 'supported_and_applicable');
  assert.deepEqual(binary.methodDecisions.find(item => item.topic === '缺失数据').evidencePmids, ['123']);
});

test('evidence screening rejects unsafe identifiers and decisions', () => {
  assert.throws(() => normalizeEvidence([{ pmid: '../bad', decision: 'include' }]), /invalid PMID/);
  assert.throws(() => normalizeEvidence([{ pmid: '123', decision: 'maybe' }]), /invalid PMID/);
});

test('unscreened PubMed records produce explicitly provisional method guidance', () => {
  const summary = summarizeRetrievedEvidence([{ pmid:'123', title:'Study', methods: { tags: ['survey-weighted analysis', 'restricted cubic spline'], details:{ studyDesign:'cross-sectional' } }, publicationTypes: ['Journal Article'] }], { outcomeType:'continuous' });
  assert.equal(summary.provisional, true); assert.equal(summary.total, 1);
  assert.ok(summary.recommendations.some(item => item.includes('样条')));
  assert.equal(summary.methodMatrix[0].pmid, '123');
  assert.equal(summary.methodDecisions.find(item=>item.topic==='主模型').approach, 'survey-weighted linear regression');
  assert.match(summary.warning, /人工复核/);
});
