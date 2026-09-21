const { generateModelScript } = require('../src/model-script');

const cycles = ['2017-2018'];
const mapping = variable => [{ variable, sourceFile: 'SMOKE_J', cycles }];
const spec = {
  schemaVersion: '1.7',
  outcomeFamily: 'continuous',
  exposureTransform: 'raw',
  outcomeTransform: 'raw',
  outcomeThreshold: null,
  population: { ageMin: 20, pregnancyPolicy: 'not specified' },
  weightVariable: 'WTMEC2YR',
  strataVariable: 'SDMVSTRA',
  psuVariable: 'SDMVPSU',
  cycles,
  exposureMappings: mapping('LBXBPB'),
  outcomeMappings: mapping('BPXSY1'),
  covariates: [{ concept: 'age', encoding: 'continuous', mappings: mapping('RIDAGEYR') }],
  weightPolicy: { divisor: 1 },
  missingDataPolicy: { strategy: 'multiple_imputation', imputation: { m: 5, maxit: 5, seed: 42 } },
  advancedAnalysisPlan: { nonlinear: { method: 'none' }, subgroups: [] },
  digest: 'a'.repeat(64),
};

process.stdout.write(generateModelScript(spec));
