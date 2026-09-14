function inferOutcomeType(intent = {}) {
  const value = `${intent.outcome?.term || ''} ${intent.outcome?.label || ''}`.toLowerCase();
  if (/mortality|death|survival|死亡/.test(value)) return 'time_to_event';
  if (/disease|depress|hypertension|diabetes|cancer|yes\/no|患病|疾病|抑郁/.test(value)) return 'binary';
  if (/count|number of|次数|计数/.test(value)) return 'count';
  return 'continuous_or_unknown';
}

function modelFor(type) {
  return ({ binary: 'survey-weighted quasibinomial logistic regression', time_to_event: 'survey-weighted survival model (requires linked mortality eligibility review)', count: 'survey-weighted count model with dispersion check', continuous_or_unknown: 'survey-weighted linear/generalized model after outcome-type confirmation' })[type];
}

function buildAgentPlan(project) {
  const feasibility = project.feasibility || {}, type = inferOutcomeType(project.intent);
  const candidateCount = (project.variableDiscovery?.candidates || []).reduce((sum, group) => sum + group.items.length, 0);
  const ready = feasibility.status === 'executable';
  return {
    schemaVersion: '1.0', mode: 'agent_orchestrated', generatedAt: new Date().toISOString(),
    objective: project.question, outcomeType: type, proposedPrimaryModel: modelFor(type),
    autonomy: { automaticThrough: 'protocol_draft', researcherApprovalRequiredBefore: 'data_execution', resultClaimsRequireQualityGate: true },
    tasks: [
      { id: 'interpret_question', agent: 'research-question-agent', status: project.intent ? 'completed' : 'pending', output: 'structured research intent' },
      { id: 'discover_variables', agent: 'nhanes-metadata-agent', status: ready ? 'completed' : candidateCount ? 'needs_review' : 'blocked', output: `${candidateCount} official catalog candidates` },
      { id: 'review_evidence', agent: 'pubmed-evidence-agent', status: project.literature ? 'completed' : 'pending', output: `${project.literature?.articles?.length || 0} retrieved records` },
      { id: 'design_analysis', agent: 'statistical-design-agent', status: project.protocol ? 'completed' : 'pending', output: modelFor(type) },
      { id: 'approve_protocol', agent: 'researcher', status: project.status === 'approved' ? 'completed' : 'waiting', output: 'frozen analysis specification' },
      { id: 'generate_and_execute', agent: 'sandboxed-r-agent', status: ready && project.status === 'approved' ? 'ready' : 'blocked', output: 'reproducible artifacts' },
      { id: 'quality_and_report', agent: 'quality-report-agent', status: 'blocked', output: 'audited report or explicit failure' }
    ],
    blockers: feasibility.blockers || [], nextAction: ready ? '研究者确认并冻结分析方案' : candidateCount ? '研究者确认官方目录候选变量及定义' : '补充研究概念或扩大官方变量检索'
  };
}

module.exports = { inferOutcomeType, modelFor, buildAgentPlan };
