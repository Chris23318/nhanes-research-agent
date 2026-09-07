const { EventEmitter } = require('events');
const { id, validateQuestion, validateVariableMap, validateTransition, validateApproval } = require('./domain');
const { CYCLES, resolveVariables } = require('./catalog');
const { defaultStore } = require('./store');
const { parseQuestion } = require('./question-parser');
const { normalizeEvidence, summarizeEvidence, summarizeRetrievedEvidence } = require('./evidence');
const { searchPubMed, buildQuery } = require('./pubmed');

const projects = new Map();
const bus = new EventEmitter();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createProject(input) {
  const question = validateQuestion(input);
  const intent = parseQuestion(question);
  const project = { id: id('prj'), title: intent.title, question, intent, status: 'draft', stage: null, createdAt: new Date().toISOString(), events: [], approvals: [] };
  projects.set(project.id, project);
  defaultStore.save(project, 'project.created', { question });
  return project;
}

function getProject(projectId) {
  const project = projects.get(projectId) || defaultStore.get(projectId);
  if (!project) { const error = new Error('project not found'); error.status = 404; error.code = 'NOT_FOUND'; throw error; }
  projects.set(project.id, project);
  return project;
}

function emit(project, stage, status, message, data) {
  const event = { id: id('evt'), projectId: project.id, stage, status, message, data, at: new Date().toISOString() };
  project.events.push(event);
  defaultStore.save(project, `stage.${stage}.${status}`, { eventId: event.id, message });
  bus.emit(project.id, event);
  return event;
}

async function runProject(projectId, options = {}) {
  const project = getProject(projectId);
  if (project.status === 'running') return project;
  project.status = 'running';
  const work = async (stage, message, fn) => {
    if (project.stage) validateTransition(project.stage, stage);
    project.stage = stage;
    emit(project, stage, 'running', message);
    await delay(120);
    const data = await fn();
    emit(project, stage, 'completed', `${message}完成`, data);
    return data;
  };
  project.intent = await work('parse', '结构化研究问题', () => project.intent || parseQuestion(project.question));
  project.variables = await work('variables', '匹配 NHANES 变量', () => validateVariableMap(resolveVariables(project.intent)));
  project.literature = await work('literature', '自动检索 PubMed 证据', async () => {
    const input = { exposure: project.intent.exposure?.term || project.intent.exposure?.label, outcome: project.intent.outcome?.term || project.intent.outcome?.label, population: project.intent.population?.label || '', nhanesOnly: true, mode: 'expanded', limit: 10 };
    const query = buildQuery(input);
    if (process.env.PUBMED_AUTO_SEARCH === 'false') return { query, mode: 'disabled', articles: [], warning: 'Automated PubMed retrieval is disabled in this environment.' };
    try {
      const result = await (options.searchPubMed || searchPubMed)(input, { email: process.env.NCBI_EMAIL, apiKey: process.env.NCBI_API_KEY, tool: 'nhanes_research_agent', timeoutMs: 10000 });
      return { ...result, mode: 'live', summary: summarizeRetrievedEvidence(result.articles), warning: result.compliance?.contactEmailConfigured ? null : 'NCBI contact email is not configured; configure NCBI_EMAIL before high-volume use.' };
    } catch (error) {
      return { query, mode: 'unavailable', articles: [], retrievedAt: new Date().toISOString(), source: 'NCBI PubMed E-utilities', warning: `PubMed 自动检索失败：${String(error.message || error).slice(0, 300)}。未生成或伪造任何文献。` };
    }
  });
  project.protocol = await work('protocol', '结合证据生成统计分析方案', () => {
    const cycles = project.intent.cycles || [], outcome = String(project.intent.outcome?.term || '').toLowerCase(), recommendations = project.literature.summary?.recommendations || [];
    const binary = /depress|disease|risk|prevalence|ckd|cardiovascular/.test(outcome);
    const secondary = new Set(['暴露连续值与分类编码的稳健性比较', '预设亚组交互检验']);
    if (project.literature.summary?.methodCounts?.['restricted cubic spline']) secondary.add('限制性立方样条非线性分析');
    if (project.literature.summary?.methodCounts?.['linear regression']) secondary.add('连续结局的 survey-weighted linear regression');
    secondary.add('完整案例与多重插补敏感性分析');
    return { schemaVersion: '1.1', design: 'pooled cross-sectional complex survey', estimand: '目标人群中的横断面调整关联', causalInterpretationAllowed: false, weight: `WTMEC2YR / ${cycles.length || 'K'}`, primaryModel: binary ? 'survey-weighted quasibinomial logistic regression' : 'outcome type requires researcher confirmation', secondary: [...secondary], literatureCandidates: project.literature.articles?.length || 0, evidenceMethodRecommendations: recommendations, evidenceStatus: 'provisional_unreviewed', approvalRequired: true };
  });
  project.status = 'awaiting_approval';
  emit(project, 'protocol', 'blocked', '等待研究者确认方案', { required: ['outcome_definition', 'covariate_set', 'assay_harmonization'] });
  return project;
}

function approveProject(projectId, input = {}) {
  const project = getProject(projectId);
  if (project.status !== 'awaiting_approval') { const error = new Error('project is not awaiting approval'); error.status = 409; error.code = 'INVALID_STATE'; throw error; }
  const checked = validateApproval(input), approval = { id: id('apr'), actor: checked.actor, decisions: checked.decisions, schemaVersion: '1.0', at: new Date().toISOString() };
  project.approvals.push(approval); project.status = 'approved'; project.protocol = { ...(project.protocol || {}), frozen: true, frozenAt: approval.at, approvalId: approval.id, decisions: approval.decisions }; emit(project, 'protocol', 'approved', '研究方案已确认并冻结', approval); return project;
}

function saveEvidence(projectId, input = {}) {
  const project = getProject(projectId), items = normalizeEvidence(input.items);
  project.evidence = { query: String(input.query || '').slice(0, 5000), retrievedAt: input.retrievedAt || null, screenedAt: new Date().toISOString(), items, summary: summarizeEvidence(items) };
  project.protocol = { ...(project.protocol || {}), evidenceBasedRecommendations: project.evidence.summary.recommendations, evidenceIncluded: project.evidence.summary.included, evidenceUpdatedAt: project.evidence.screenedAt, approvalRequired: true };
  defaultStore.save(project, 'evidence.screened', { included: project.evidence.summary.included, excluded: project.evidence.summary.excluded, uncertain: project.evidence.summary.uncertain });
  return project;
}

function listProjects(limit){return defaultStore.list(limit)}

function subscribe(projectId, listener) { bus.on(projectId, listener); return () => bus.off(projectId, listener); }

module.exports = { createProject, getProject, listProjects, runProject, approveProject, saveEvidence, subscribe, projects };
