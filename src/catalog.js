const CYCLES = ['2007-2008', '2009-2010', '2011-2012', '2013-2014', '2015-2016', '2017-2018'];

const VARIABLES = [
  { role: 'exposure', concept: '血清 25(OH)D', variable: 'LBXVIDMS', source: 'VID', transform: 'nmol/L; verify cycle-specific assay harmonization', confidence: 0.96 },
  { role: 'outcome', concept: 'PHQ-9 抑郁症状', variable: 'DPQ010–DPQ090', source: 'DPQ', transform: 'sum valid items; primary threshold >= 10', confidence: 0.98 },
  { role: 'covariate', concept: '年龄', variable: 'RIDAGEYR', source: 'DEMO', transform: 'restrict >= 20', confidence: 1 },
  { role: 'covariate', concept: '性别', variable: 'RIAGENDR', source: 'DEMO', transform: 'categorical', confidence: 1 },
  { role: 'covariate', concept: '种族/族裔', variable: 'RIDRETH1', source: 'DEMO', transform: 'harmonize categories', confidence: 0.99 },
  { role: 'covariate', concept: '贫困收入比', variable: 'INDFMPIR', source: 'DEMO', transform: 'continuous and category', confidence: 1 },
  { role: 'covariate', concept: 'BMI', variable: 'BMXBMI', source: 'BMX', transform: 'continuous', confidence: 1 },
  { role: 'design', concept: 'MEC 权重', variable: 'WTMEC2YR', source: 'DEMO', transform: 'divide by number of pooled 2-year cycles', confidence: 1 },
  { role: 'design', concept: '分层变量', variable: 'SDMVSTRA', source: 'DEMO', transform: 'retain', confidence: 1 },
  { role: 'design', concept: 'PSU', variable: 'SDMVPSU', source: 'DEMO', transform: 'retain', confidence: 1 }
].map(item => ({ ...item, cycles: CYCLES }));

function resolveVariables() {
  return structuredClone(VARIABLES);
}

module.exports = { CYCLES, VARIABLES, resolveVariables };
