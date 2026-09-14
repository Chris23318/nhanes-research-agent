const crypto = require('node:crypto');
function buildCleaningDraft(project) {
  const rules = [], blockers = [];
  for (const selection of project.candidateSelections || []) {
    const evidence = (project.codebookReviews || []).find(r => r.file === selection.file && r.variable === selection.variable && r.selectedAt === selection.selectedAt && r.variableFound && r.fields);
    if (!evidence || !/^[A-Z][A-Z0-9_]{0,39}$/.test(selection.variable) || !/^[A-Z][A-Z0-9_]{1,40}$/.test(selection.file) || !selection.cycles.includes(evidence.cycle)) { blockers.push(`Missing current codebook evidence: ${selection.variable}`); continue; }
    if (!/^\d{4}-\d{4}$/.test(evidence.cycle)) { blockers.push('Invalid cycle'); continue; }
    const codes = evidence.fields.missingCodes || [];
    if (codes.some(x => !/^(?:\.|-?\d+(?:\.\d+)?)$/.test(x.code))) { blockers.push(`Unsupported missing-code representation: ${selection.variable}`); continue; }
    const numeric = [...new Set(codes.filter(x=>x.code!=='.').map(x=>Number(x.code)))];
    if (!numeric.every(Number.isFinite)) { blockers.push(`Nonfinite missing code: ${selection.variable}`); continue; }
    rules.push({ variable: selection.variable, file: selection.file, cycle: evidence.cycle, missingCodes: numeric, sasMissingAlreadyNA: codes.some(x=>x.code==='.'), source: evidence.url, sha256: evidence.sha256, unit: evidence.fields.unit, status: 'draft_not_approved' });
  }
  if (!rules.length) blockers.push('No current variable rules');
  const digest = crypto.createHash('sha256').update(JSON.stringify(rules)).digest('hex');
  const r = [
    '# Draft missing-code cleaning only. Does not perform model fitting or unit conversion.',
    '# Read the rule manifest and explicitly approve its digest before calling this function.',
    'clean_component <- function(data, file, cycle, approved_digest = NULL) {',
    `  if (!identical(approved_digest, "${digest}")) stop("Review and approve cleaning-rules.json first")`,
    ...(blockers.length ? ['  stop("Unresolved cleaning draft blockers; regenerate after evidence review")'] : []),
    '  stopifnot(is.data.frame(data), is.character(file), length(file) == 1L, is.character(cycle), length(cycle) == 1L)',
    '  audit <- list()', '  matched <- FALSE',
    ...rules.flatMap(rule=>[
      `  if (identical(file, "${rule.file}") && identical(cycle, "${rule.cycle}")) {`,
      '    matched <- TRUE',
      `    if (!("${rule.variable}" %in% names(data))) stop("Required variable absent")`,
      `    x <- data[["${rule.variable}"]]`,
      '    if (!is.numeric(x)) stop("Numeric missing-code rule requires numeric input")',
      `    replace <- !is.na(x) & x %in% c(${rule.missingCodes.join(', ')})`,
      `    data[["${rule.variable}"]][replace] <- NA_real_`,
      `    audit[["${rule.variable}"]] <- list(rows = length(x), before_na = sum(is.na(x)), recoded = sum(replace), after_na = sum(is.na(data[["${rule.variable}"]])))`,
      '  }'
    ]),
    '  if (!matched) stop("No rule for requested file and cycle")',
    '  list(data = data, audit = audit)', '}'
  ].join('\n');
  return { schemaVersion:'1.0', status:'draft_not_executed', digest, rules, blockers, code:r };
}
module.exports = { buildCleaningDraft };
