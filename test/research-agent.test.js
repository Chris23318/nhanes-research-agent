const test = require('node:test');
const assert = require('node:assert/strict');
const { inferOutcomeType, buildAgentPlan } = require('../src/research-agent');

test('statistical agent selects a model family from outcome semantics', () => {
  assert.equal(inferOutcomeType({ outcome: { term: 'cardiovascular disease' } }), 'binary');
  assert.equal(inferOutcomeType({ outcome: { term: 'all-cause mortality' } }), 'time_to_event');
});

test('agent plan exposes automation, gates and the next action', () => {
  const plan = buildAgentPlan({ question: 'sleep and cardiovascular disease', intent: { outcome: { term: 'cardiovascular disease' } }, variableDiscovery: { candidates: [{ items: [{ variable: 'SLD012' }] }] }, feasibility: { status: 'design_only', blockers: ['confirm variables'] }, literature: { articles: [] }, protocol: {}, status: 'awaiting_approval' });
  assert.equal(plan.mode, 'agent_orchestrated');
  assert.equal(plan.tasks.find(x => x.id === 'discover_variables').status, 'needs_review');
  assert.match(plan.nextAction, /确认/);
});
