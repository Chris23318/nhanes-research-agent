const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretWithModel } = require('../src/model-runtime');
const valid = { exposure: 'lead', outcome: 'blood pressure', population: { description: 'adults' }, cycles: ['2017-2018'], covariates: [], ambiguities: [], estimand: 'association' };
test('DeepSeek receives actionable feedback and repairs malformed JSON', async () => {
  const requests = [];
  const result = await interpretWithModel('study lead and blood pressure', { provider: 'deepseek', apiKey: 'test', fetchImpl: async (_, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: requests.length === 1 ? 'invalid JSON' : JSON.stringify(valid) } }] }) };
  } });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /failed validation/);
  assert.equal(result.trace[0].type, 'format_repair');
});
test('repeated invalid output stops after four calls', async () => {
  let calls = 0;
  await assert.rejects(interpretWithModel('question', { apiKey: 'test', fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: 'null' }] }] }) }; } }), /MODEL_INVALID_INTENT/);
  assert.equal(calls, 4);
});
