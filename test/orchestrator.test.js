const test = require('node:test');
const assert = require('node:assert/strict');
const { createProject, runProject } = require('../src/orchestrator');

test('agent workflow automatically retrieves verified PubMed records', async () => {
  const previous = process.env.PUBMED_AUTO_SEARCH; delete process.env.PUBMED_AUTO_SEARCH;
  const project = createProject({ question: 'Study vitamin D and depression among NHANES adults using 2017-2018 data' });
  const searchPubMed = async input => ({ query: 'verified query', count: 1, retrievedAt: 'now', source: 'NCBI PubMed E-utilities', compliance: { contactEmailConfigured: true }, articles: [{ pmid: '123', title: 'Verified article', methods: { tags: ['survey-weighted analysis', 'restricted cubic spline'] }, relevance: { score: 100 } }], input });
  try { const completed = await runProject(project.id, { searchPubMed }); assert.equal(completed.literature.mode, 'live'); assert.equal(completed.literature.articles[0].pmid, '123'); assert.equal(completed.literature.summary.provisional,true); assert.equal(completed.protocol.weight,'WTMEC2YR / 1'); assert.ok(completed.protocol.secondary.some(item=>item.includes('样条'))); assert.equal(completed.status, 'awaiting_approval'); }
  finally { if (previous === undefined) delete process.env.PUBMED_AUTO_SEARCH; else process.env.PUBMED_AUTO_SEARCH = previous; }
});
