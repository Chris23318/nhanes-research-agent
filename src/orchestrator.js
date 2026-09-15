const { EventEmitter } = require('events');
const { id, validateQuestion, validateVariableMap, validateTransition, validateApproval } = require('./domain');
const { CYCLES, resolveVariables } = require('./catalog');
const { defaultStore } = require('./store');
const { parseQuestion } = require('./question-parser');
const { interpretWithModel } = require('./model-runtime');
const { normalizeEvidence, summarizeEvidence, summarizeRetrievedEvidence } = require('./evidence');
const { searchPubMed, buildQuery } = require('./pubmed');
const { assessFeasibility } = require('./feasibility');
const { discoverVariableMap } = require('./variable-discovery');
const { buildAgentPlan, inferOutcomeType, modelFor } = require('./research-agent');

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
  project.intent = await work('parse', '结构化研究问题', async () => {
    const fallback = project.intent || parseQuestion(project.question);
    if (process.env.MODEL_AGENT_ENABLED !== 'true') return fallback;
    try {
      const result = await interpretWithModel(project.question, options.modelOptions);
      project.modelTrace = result.trace;
      const value = result.intent;
      return { ...fallback, title: `${value.exposure}与${value.outcome}`, exposure: { label: value.exposure, term: value.exposure, component: null, confidence: 0 }, outcome: { label: value.outcome, term: value.outcome, component: null, confidence: 0 }, population: { ...fallback.population, label: value.population.description }, cycles: value.cycles, covariates: value.covariates, ambiguities: [...value.ambiguities, '模型提出的概念、周期及变量定义需要确认'], parser: { mode: 'model-tools', model: result.model, requiresResearcherConfirmation: true } };
    } catch (error) {
      const reason = ({ MODEL_INVALID_INTENT: '模型多次返回不合规字段', MODEL_ROUND_LIMIT: '模型达到调用轮次上限', MODEL_NOT_CONFIGURED: '模型尚未配置', MODEL_HTTP_402: '模型账户余额不足' })[error.message] || '模型调用未成功';
      return { ...fallback, ambiguities: [...fallback.ambiguities, `${reason}，当前采用规则解析`], parser: { ...fallback.parser, modelStatus: 'unavailable', fallbackReason: reason } };
    }
  });
  project.title = project.intent.title;
  const variableResult = await work('variables', 'Agent 检索并匹配 NHANES 官方变量', async () => {
    try { return await discoverVariableMap(project.intent, options); }
    catch (error) { return { variables: resolveVariables(project.intent), discovery: { mode: 'unavailable', candidates: [], errors: [String(error.message || error).slice(0, 300)] } }; }
  });
  project.variables = validateVariableMap(variableResult.variables);
  project.variableDiscovery = variableResult.discovery;
  project.feasibility = assessFeasibility(project.intent, project.variables);
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
    const cycles = project.intent.cycles || [], outcomeType = inferOutcomeType(project.intent), recommendations = project.literature.summary?.recommendations || [];
    const secondary = new Set(['暴露连续值与分类编码的稳健性比较', '预设亚组交互检验']);
    if (project.literature.summary?.methodCounts?.['restricted cubic spline']) secondary.add('限制性立方样条非线性分析');
    if (project.literature.summary?.methodCounts?.['linear regression']) secondary.add('连续结局的 survey-weighted linear regression');
    secondary.add('完整案例与多重插补敏感性分析');
    return { schemaVersion: '1.2', design: 'pooled cross-sectional complex survey', estimand: '目标人群中的横断面调整关联', causalInterpretationAllowed: false, outcomeType, weight: `WTMEC2YR / ${cycles.length || 'K'}`, primaryModel: modelFor(outcomeType), secondary: [...secondary], literatureCandidates: project.literature.articles?.length || 0, evidenceMethodRecommendations: recommendations, evidenceStatus: 'provisional_unreviewed', approvalRequired: true };
  });
  project.agentPlan = buildAgentPlan(project);
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

function saveCandidate(projectId, input) {
  const project = getProject(projectId);
  const selection = require('./candidate-selection').selectCandidate(project, input);
  project.variables = (project.variables || []).filter(item => item.confirmationStatus !== 'codebook_and_cleaning_approved');
  delete project.cleaningApproval;
  project.codebookReviews = [];
  project.candidateSelections = [...(project.candidateSelections || []).filter(x => !(x.role === selection.role && x.file === selection.file)), selection];
  project.candidateSelectionHistory = [...(project.candidateSelectionHistory || []), selection];
  defaultStore.save(project, 'candidate.selected', selection);
  return project;
}
function listProjects(limit){return defaultStore.list(limit)}
async function reviewCodebooks(projectId, options = {}) {
  const project = getProject(projectId);
  if (project.status !== 'awaiting_approval') { const error = new Error('请在方案待确认时核验代码本'); error.status = 409; throw error; }
  const selections = structuredClone(project.candidateSelections || []);
  if (!selections.length || selections.length > 20) { const error = new Error('请选择1至20个候选文件'); error.status = 400; throw error; }
  const fingerprint = JSON.stringify(project.candidateSelections);
  const reviews = await Promise.all(selections.map(async selection => {
    const cycle = selection.cycles[0];
    try { return await require('./codebook-review').inspectCodebook(selection, cycle, options); }
    catch (error) { return { variable: selection.variable, file: selection.file, cycle, status: 'retrieval_failed', error: String(error.message).slice(0,200) }; }
  }));
  if (project.status !== 'awaiting_approval' || JSON.stringify(project.candidateSelections) !== fingerprint) { const error = new Error('候选选择或方案状态已变化，请重新核验'); error.status = 409; throw error; }
  project.codebookReviews = reviews;
  defaultStore.save(project, 'codebooks.retrieved', { total: reviews.length, found: reviews.filter(x=>x.variableFound).length });
  return project;
}

function approveCleaning(projectId, input = {}) {
  const project = getProject(projectId);
  const result = require('./cleaning-approval').approveCleaningDraft(project, input);
  project.feasibility = assessFeasibility(project.intent, project.variables);
  project.agentPlan = buildAgentPlan(project);
  defaultStore.save(project, 'cleaning.approved', { digest: project.cleaningApproval.digest, ruleCount: result.mappings.length, actor: project.cleaningApproval.actor });
  return project;
}

function subscribe(projectId, listener) { bus.on(projectId, listener); return () => bus.off(projectId, listener); }

module.exports = { createProject, getProject, listProjects, runProject, approveProject, saveEvidence, saveCandidate, reviewCodebooks, approveCleaning, subscribe, projects };
