const test = require('node:test');
const assert = require('node:assert/strict');
const { createProject, forkProject, runProject } = require('../src/orchestrator');
const { defaultStore } = require('../src/store');

test('agent workflow automatically retrieves verified PubMed records', async () => {
  const previous = process.env.PUBMED_AUTO_SEARCH; delete process.env.PUBMED_AUTO_SEARCH;
  const project = createProject({ question: 'Study vitamin D and depression among NHANES adults using 2017-2018 data' });
  const searchPubMed = async input => ({ query: 'verified query', count: 1, retrievedAt: 'now', source: 'NCBI PubMed E-utilities', compliance: { contactEmailConfigured: true }, articles: [{ pmid: '123', title: 'Verified article', methods: { tags: ['survey-weighted analysis', 'restricted cubic spline'] }, relevance: { score: 100 } }], input });
  try { const completed = await runProject(project.id, { searchPubMed }); assert.equal(completed.literature.mode, 'live'); assert.equal(completed.literature.articles[0].pmid, '123'); assert.equal(completed.literature.summary.provisional,true); assert.match(completed.protocol.weight,/最小分析子样本/); assert.ok(completed.protocol.secondary.some(item=>item.includes('样条'))); assert.equal(completed.status, 'awaiting_approval'); }
  finally { if (previous === undefined) delete process.env.PUBMED_AUTO_SEARCH; else process.env.PUBMED_AUTO_SEARCH = previous; }
});

test('structured brief preferences become traceable protocol requests', async () => {
  const previous = process.env.PUBMED_AUTO_SEARCH; process.env.PUBMED_AUTO_SEARCH = 'false';
  const researchBrief={source:'guided',exposure:'睡眠时长',outcome:'心血管疾病',population:'美国 20 岁及以上成年人',cycles:'使用 2017–2018 年 NHANES 周期',aim:'分析关联',covariates:['年龄','性别'],analysisOptions:['评估暴露与结局的非线性关系'],notes:''};
  try { const project=createProject({question:'在美国成年人中研究睡眠时长和心血管疾病的关联。',researchBrief}),completed=await runProject(project.id);assert.equal(completed.protocol.schemaVersion,'1.5');assert.deepEqual(completed.protocol.requestedAnalyses,researchBrief.analysisOptions);assert.ok(completed.protocol.secondary.includes('限制性立方样条非线性分析'));assert.ok(!completed.protocol.secondary.includes('预设亚组交互检验'));assert.equal(completed.intent.parser.mode,'structured-brief-v1'); }
  finally { if (previous === undefined) delete process.env.PUBMED_AUTO_SEARCH; else process.env.PUBMED_AUTO_SEARCH = previous; }
});

test('research revisions preserve provenance but require fresh approval', async () => {
  const previous = process.env.PUBMED_AUTO_SEARCH; process.env.PUBMED_AUTO_SEARCH = 'false';
  try {
    const source = createProject({ question: 'Study vitamin D and depression among NHANES adults using 2017-2018 data' });
    await runProject(source.id);
    source.approvals.push({ id: 'old-approval' });
    const revision = forkProject(source.id, { title: 'Revised protocol' });
    assert.notEqual(revision.id, source.id);
    assert.equal(revision.parentProjectId, source.id);
    assert.equal(revision.rootProjectId, source.id);
    assert.equal(revision.revision, 2);
    assert.equal(revision.status, 'awaiting_approval');
    assert.deepEqual(revision.approvals, []);
    assert.equal(revision.protocol.frozen, false);
    assert.match(revision.protocol.parentDigest, /^[a-f0-9]{64}$/);
    assert.ok(defaultStore.auditTrail(source.id).some(event => event.eventType === 'project.fork_created'));
    assert.ok(defaultStore.auditTrail(revision.id).some(event => event.eventType === 'project.forked'));
  } finally { if (previous === undefined) delete process.env.PUBMED_AUTO_SEARCH; else process.env.PUBMED_AUTO_SEARCH = previous; }
});

test('detached running Agent projects recover once and deduplicate concurrent starts', async () => {
  const previous = process.env.PUBMED_AUTO_SEARCH; process.env.PUBMED_AUTO_SEARCH = 'false';
  const project = createProject({ question: 'Study vitamin D and depression among NHANES adults using 2017-2018 data' });
  project.status = 'running'; project.stage = 'variables'; defaultStore.save(project, 'test.interrupted');
  try {
    const [first, second] = await Promise.all([runProject(project.id), runProject(project.id)]);
    assert.equal(first.status, 'awaiting_approval');
    assert.equal(second.id, first.id);
    assert.equal(first.events.filter(event => event.stage === 'parse' && event.status === 'completed').length, 1);
    assert.ok(defaultStore.auditTrail(project.id).some(event => event.eventType === 'agent.recovered'));
  } finally { if (previous === undefined) delete process.env.PUBMED_AUTO_SEARCH; else process.env.PUBMED_AUTO_SEARCH = previous; }
});
