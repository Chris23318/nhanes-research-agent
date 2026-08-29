function generateRProject(project) {
  if (!project.protocol || !project.variables) { const error = new Error('analysis protocol is not ready'); error.status = 409; error.code = 'INVALID_STATE'; throw error; }
  const config = { projectId: project.id, generatedAt: new Date().toISOString(), cycles: project.intent.cycles, outcomeThreshold: 10, weightDivisor: project.intent.cycles.length, status: 'generated_not_executed' };
  const r = [
    'library(nhanesA)', 'library(survey)', 'library(dplyr)', 'library(purrr)', '',
    'options(survey.lonely.psu = "adjust")', `cycles <- c(${project.intent.cycles.map(x => `"${x}"`).join(', ')})`, '',
    '# Download cycle-specific DEMO, VID, DPQ and BMX files.', '# Production execution must resolve file suffixes from the frozen catalog snapshot.',
    'stopifnot(exists("merged"))', 'analytic <- merged |>', '  filter(RIDAGEYR >= 20) |>', '  mutate(depression = phq9_total >= 10,', `         pooled_weight = WTMEC2YR / ${project.intent.cycles.length})`, '',
    'design <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA,', '  weights = ~pooled_weight, nest = TRUE, data = analytic)', '',
    'model <- svyglm(depression ~ vitamin_d + RIDAGEYR + RIAGENDR +', '  RIDRETH1 + INDFMPIR + BMXBMI, design = design,', '  family = quasibinomial())', '',
    'result <- confint(model)', 'stopifnot(all(is.finite(coef(model))))', 'saveRDS(list(model = model, confint = result, session = sessionInfo()), "artifacts/results.rds")'
  ].join('\n');
  const qc = ['check,severity,rule', 'merge_uniqueness,error,SEQN is unique before every join', 'weight,error,pooled weight divisor equals included cycles', 'survey_design,error,PSU strata and weight are present', 'model,error,all fitted coefficients and confidence limits are finite', 'report,error,every reported number has an artifact path'].join('\n');
  return { status: config.status, files: { 'config.json': JSON.stringify(config, null, 2), 'analysis.R': r, 'qc-rules.csv': qc, 'README.md': '# Generated NHANES analysis package\n\nStatus: generated, not executed. Run only after verifying cycle-specific metadata, assay harmonization and inclusion rules.\n' } };
}

module.exports = { generateRProject };
