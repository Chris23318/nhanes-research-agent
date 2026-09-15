function selectCandidate(project, input = {}) {
  const fail = message => { const error = new Error(message); error.status = 400; throw error; };
  if (project.status !== 'awaiting_approval') fail('只能在方案待确认时选择候选变量');
  if (!['exposure', 'outcome','covariate'].includes(input.role)) fail('无效变量角色');
  const group = project.variableDiscovery?.candidates?.find(x => x.role === input.role && x.concept === input.concept);
  const candidate = group?.items?.find(x => x.variable === input.variable && x.file === input.file);
  if (!candidate) fail('变量必须来自当前项目的官方目录候选');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) fail('请填写选择理由，最多1000字');
  const cycles = (candidate.matchedCycles || []).filter(x => project.intent.cycles.includes(x));
  if (!cycles.length) fail('候选尚未匹配所选周期，需先核对目录日期');
  const selection = { role: input.role, concept:group.concept, variable: candidate.variable, file: candidate.file, description: candidate.description, cycles, reason: input.reason.trim(), selectedAt: new Date().toISOString(), status: 'codebook_review_required' };
  return selection;
}
module.exports = { selectCandidate };
