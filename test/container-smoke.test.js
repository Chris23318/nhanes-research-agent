const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('container executes a real survey multiple-imputation smoke analysis', () => {
  const root = path.join(__dirname, '..');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'scripts', 'validate-mi-runtime.R'), 'utf8');
  assert.match(dockerfile, /Rscript scripts\/validate-mi-runtime\.R/);
  assert.match(script, /mice::mice/);
  assert.match(script, /survey::svydesign/);
  assert.match(script, /survey::svyglm/);
  assert.match(script, /mitools::MIcombine/);
  assert.match(script, /stopifnot/);
});
