const { EventEmitter } = require('events');
const { id, validateQuestion, validateVariableMap, validateTransition } = require('./domain');
const { CYCLES, resolveVariables } = require('./catalog');

const projects = new Map();
const bus = new EventEmitter();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createProject(input) {
  const question = validateQuestion(input);
  const project = { id: id('prj'), title: '维生素 D 水平与抑郁症状', question, status: 'draft', stage: null, createdAt: new Date().toISOString(), events: [], approvals: [] };
  projects.set(project.id, project);
  return project;
}

function getProject(projectId) {
  const project = projects.get(projectId);
  if (!project) { const error = new Error('project not found'); error.status = 404; error.code = 'NOT_FOUND'; throw error; }
  return project;
}

function emit(project, stage, status, message, data) {
  const event = { id: id('evt'), projectId: project.id, stage, status, message, data, at: new Date().toISOString() };
  project.events.push(event);
  bus.emit(project.id, event);
  return event;
}

async function runProject(projectId) {
  const project = getProject(projectId);
  if (project.status === 'running') return project;
  project.status = 'running';
  const work = async (stage, message, fn) => {
    if (project.stage) validateTransition(project.stage, stage);
    project.stage = stage;
    emit(project, stage, 'running', message);
    await delay(120);
    const data = fn();
    emit(project, stage, 'completed', `${message}完成`, data);
    return data;
  };
  project.intent = await work('parse', '结构化研究问题', () => ({
    population: { ageMin: 20, pregnancy: 'exclude', geography: 'United States' },
    exposure: 'serum 25-hydroxyvitamin D', outcome: 'clinically relevant depressive symptoms',
    cycles: CYCLES, estimand: 'prevalence odds ratio', ambiguities: ['confirm PHQ-9 threshold', 'confirm assay harmonization']
  }));
  project.variables = await work('variables', '匹配 NHANES 变量', () => validateVariableMap(resolveVariables()));
  project.literature = await work('literature', '构建 PubMed 证据集', () => ({
    query: '(vitamin D[MeSH Terms] OR 25-hydroxyvitamin D) AND (depression[MeSH Terms] OR depressive symptoms) AND (NHANES OR National Health and Nutrition Examination Survey)',
    mode: 'demo', articles: [], warning: 'Live NCBI E-utilities adapter is not configured; no PMID is presented as verified evidence.'
  }));
  project.protocol = await work('protocol', '生成统计分析方案', () => ({
    design: 'pooled cross-sectional complex survey', weight: 'WTMEC2YR / 6', primaryModel: 'survey-weighted quasibinomial logistic regression',
    secondary: ['restricted cubic spline', 'sex/age/race interaction tests', 'multiple imputation sensitivity analysis'],
    approvalRequired: true
  }));
  project.status = 'awaiting_approval';
  emit(project, 'protocol', 'blocked', '等待研究者确认方案', { required: ['outcome_definition', 'covariate_set', 'assay_harmonization'] });
  return project;
}

function approveProject(projectId, input = {}) {
  const project = getProject(projectId);
  if (project.status !== 'awaiting_approval') { const error = new Error('project is not awaiting approval'); error.status = 409; error.code = 'INVALID_STATE'; throw error; }
  const approval = { id: id('apr'), actor: input.actor || 'researcher', decisions: input.decisions || {}, at: new Date().toISOString() };
  project.approvals.push(approval); project.status = 'approved'; emit(project, 'protocol', 'approved', '研究方案已确认', approval); return project;
}

function subscribe(projectId, listener) { bus.on(projectId, listener); return () => bus.off(projectId, listener); }

module.exports = { createProject, getProject, runProject, approveProject, subscribe, projects };
