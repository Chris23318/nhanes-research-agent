const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelSpec } = require('../src/model-spec');
const { generateModelScript } = require('../src/model-script');
const { evaluateResult } = require('../src/quality');

function project() {
  const cycles = ['2017-2018'];
  return { status: 'awaiting_approval', intent: { cycles }, cleaningApproval: { digest: 'clean' }, variables: [
    { role: 'exposure', variable: 'SLD012', sourceFile: 'SLQ_J', sourceComponent: 'Questionnaire', cycles, confirmationStatus: 'codebook_and_cleaning_approved' },
    { role: 'outcome', variable: 'HUQ051', sourceFile: 'HUQ_J', sourceComponent: 'Questionnaire', cycles, confirmationStatus: 'codebook_and_cleaning_approved' },
    { role: 'design', variable: 'WTINT2YR', cycles }, { role: 'design', variable: 'SDMVSTRA', cycles }, { role: 'design', variable: 'SDMVPSU', cycles }
  ] };
}

const input = { outcomeFamily: 'count', exposureTransform: 'raw', outcomeTransform: 'raw', populationAgeMin: 18, weightVariable: 'WTINT2YR', covariates: [], acknowledgeAssociationOnly: true, acknowledgeWeightChoice: true };

test('count outcomes generate a survey quasipoisson model with rate ratios', () => {
  const spec = createModelSpec(project(), input), script = generateModelScript(spec);
  assert.equal(spec.outcomeFamily, 'count');
  assert.match(script, /quasipoisson\(link="log"\)/);
  assert.match(script, /Count outcome must contain nonnegative integers/);
  assert.match(script, /effect_type <- "rate_ratio"/);
  assert.match(script, /dispersion=as.numeric/);
  assert.throws(() => createModelSpec(project(), { ...input, outcomeTransform: 'threshold_ge', outcomeThreshold: 2 }), /保留原始编码/);
});

test('count outcome quality gate requires dispersion diagnostics', () => {
  const exposure = { term: 'analysis_exposure', effect: 1.1, ci_low: 1.02, ci_high: 1.19, p_value: 0.01, effect_type: 'rate_ratio' };
  const result = { analysisMode: 'generic_survey_v5', outcomeFamily: 'count', status: 'completed', weightRule: 'WTINT2YR / 1', flow: { merged: 100, population_eligible: 90, analytic_complete_case: 80 }, coefficients: [exposure], sensitivityCoefficients: [{ ...exposure, model: 'unadjusted' }, { ...exposure, model: 'weight_trim_1_99' }], weightDiagnostics: { min: .1, p01: .2, median: .5, p99: 1, max: 2, positive: 80 }, designDiagnostics: { degreesFreedom: 12, strata: 15, psu: 30 }, domainDiagnostics: { method: 'survey_subset', fullDesignN: 98, populationEligibleN: 90, analyticDomainN: 80, excludedInvalidDesignN: 2 }, missingnessDiagnostics: ['analysis_outcome','analysis_exposure','analysis_weight','SDMVSTRA','SDMVPSU'].map(variable => ({ variable, missing_n: 0, missing_pct: 0 })), completeCaseDiagnostics: { populationN: 90, completeN: 80, retention: 80/90 }, modelDiagnostics: { converged: true, rank: 2, parameters: 2, residualDf: 12, conditionNumber: 4, dispersion: 1.4 }, descriptiveStatistics: [{ variable: 'analysis_exposure', level: '', metric: 'weighted_mean', unweighted_n: 80, estimate: 7, std_error: .1, ci_low: 6.8, ci_high: 7.2 }, { variable: 'analysis_outcome', level: '', metric: 'weighted_mean', unweighted_n: 80, estimate: 2, std_error: .1, ci_low: 1.8, ci_high: 2.2 }], modelSpecDigest: 'a'.repeat(64), runtime: { rVersion: 'R 4', completedAt: 'now' } };
  assert.equal(evaluateResult(result).status, 'passed');
  delete result.modelDiagnostics.dispersion;
  assert.equal(evaluateResult(result).status, 'failed');
});
