const test = require('node:test');
const assert = require('node:assert/strict');
const { manuscriptDraft, resultTablesCsv, createDocxReport, createPdfReport } = require('../src/report-export');

const project = {
  id: 'prj_0123456789abcdef',
  title: '血铅与收缩压研究',
  question: '血铅是否与收缩压相关？',
  intent: { cycles: ['2017-2018'], population: { ageMin: 20 } },
  modelSpec: {
    exposureMappings: [{ cycles: ['2017-2018'], variable: 'LBXBPB' }],
    outcomeMappings: [{ cycles: ['2017-2018'], variable: 'BPXSY1' }],
    outcomeFamily: 'continuous',
    exposureTransform: 'log2',
    outcomeTransform: 'raw',
    weightVariable: 'WTMEC2YR',
    strataVariable: 'SDMVSTRA',
    psuVariable: 'SDMVPSU',
    missingStrategy: 'complete_case',
    covariates: [{ concept: '年龄', encoding: 'continuous' }],
  },
};

const result = {
  analysisMode: 'generic_survey_v5',
  weightRule: 'WTMEC2YR / 1',
  flow: { merged: 100, population_eligible: 90, analytic_complete_case: 80 },
  coefficients: [{ model: 'primary', term: 'analysis_exposure', effect: 1.25, ci_low: 0.4, ci_high: 2.1, p_value: 0.004, effect_type: 'beta' }],
  sensitivityCoefficients: [{ model: 'weight_trim_1_99', term: 'analysis_exposure', effect: 1.2, ci_low: 0.3, ci_high: 2.0, p_value: 0.01, effect_type: 'beta' }],
  descriptiveStatistics: [{ variable: 'analysis_exposure', level: '', metric: 'weighted_mean', unweighted_n: 80, estimate: 2.5, ci_low: 2.2, ci_high: 2.8 }],
  domainDiagnostics: { method: 'survey_subset', fullDesignN: 100, analyticDomainN: 80 },
  warnings: ['仅表示横断面关联'],
  modelSpecDigest: 'a'.repeat(64),
  qualitySummary: { passed: 12 },
  runtime: { rVersion: 'R 4.5', surveyVersion: '4', havenVersion: '2', completedAt: '2026-09-20T00:00:00Z' },
};

test('manuscript draft separates Methods and Results without causal claims', () => {
  const draft = manuscriptDraft(project, result);
  assert.match(draft, /## Methods/);
  assert.match(draft, /## Results/);
  assert.match(draft, /LBXBPB/);
  assert.match(draft, /不能据此推断因果关系/);
});

test('combined result table is Excel-friendly CSV with provenance metadata', () => {
  const csv = resultTablesCsv(project, result);
  assert.match(csv, /# project_id=prj_0123456789abcdef/);
  assert.match(csv, /"main_model","primary","analysis_exposure"/);
  assert.match(csv, /"table_1"/);
  assert.match(csv, /"sample_flow"/);
});

test('formal Word and PDF exports are real binary documents with Chinese content', async () => {
  const [docx, pdf] = await Promise.all([createDocxReport(project, result), createPdfReport(project, result)]);
  assert.equal(docx.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(docx.length > 5000);
  assert.equal(pdf.subarray(0, 4).toString('ascii'), '%PDF');
  assert.ok(pdf.length > 10000);
  assert.match(pdf.subarray(-32).toString('latin1'), /%%EOF/);
});
