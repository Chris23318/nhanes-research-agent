const { buildCleaningDraft } = require('./cleaning-draft');

function approveCleaningDraft(project, input = {}) {
  const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
  if (project.status !== 'awaiting_approval') fail('请在方案待确认时批准清洗规则', 409);
  const draft = buildCleaningDraft(project);
  if (draft.blockers.length) fail(`清洗规则仍有阻断项：${draft.blockers.join('; ')}`, 409);
  if (typeof input.digest !== 'string' || input.digest !== draft.digest) fail('清洗规则已变化，请重新查看后确认', 409);
  const acknowledgements = input.acknowledgements || {};
  for (const key of ['mapping', 'missingCodes', 'unitAndPopulation']) if (acknowledgements[key] !== true) fail(`必须确认 ${key}`);
  const selections = project.candidateSelections || [];
  const mappings = draft.rules.map(rule => {
    const selection = selections.find(item => item.variable === rule.variable && item.file === rule.file && item.cycles.includes(rule.cycle));
    if (!selection) fail(`找不到当前候选记录：${rule.variable}`, 409);
    return {
      role: selection.role, concept: selection.concept || selection.description || project.intent?.[selection.role]?.label || selection.variable,
      variable: rule.variable, source: rule.file.replace(/_[A-Z]$/, ''), sourceFile: rule.file,
      sourceComponent: selection.component || null,
      transform: `missing codes: ${rule.missingCodes.join(', ') || 'SAS missing only'}; unit: ${rule.unit || 'researcher confirmed from codebook'}`,
      confidence: 0.8, cycles: [rule.cycle], confirmationStatus: 'codebook_and_cleaning_approved',
      provenance: { publisher: 'CDC/NCHS', codebookUrl: rule.source, codebookSha256: rule.sha256, selectionReason: selection.reason }
    };
  });
  const dynamicKeys = new Set(mappings.map(item => `${item.role}:${item.sourceFile}:${item.variable}`));
  project.variables = [...(project.variables || []).filter(item => !item.sourceFile || !dynamicKeys.has(`${item.role}:${item.sourceFile}:${item.variable}`)), ...mappings];
  project.cleaningApproval = {
    digest: draft.digest, actor: typeof input.actor === 'string' && input.actor.trim() ? input.actor.trim().slice(0, 100) : 'researcher',
    acknowledgements: { mapping: true, missingCodes: true, unitAndPopulation: true }, approvedAt: new Date().toISOString(),
    ruleCount: draft.rules.length, status: 'approved_for_code_generation_not_execution'
  };
  project.weightAdvice = require('./weight-policy').createWeightAdvice(project,{selectedConcepts:[]});
  return { project, mappings };
}

module.exports = { approveCleaningDraft };
