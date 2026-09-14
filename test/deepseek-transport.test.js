const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretWithModel } = require('../src/model-runtime');
test('DeepSeek requests use only DeepSeek host and validate structured output', async () => {
  const intent = { exposure: 'lead', outcome: 'pressure', cycles: ['2017-2018'], covariates: [], ambiguities: [], population: { description: 'adults' }, estimand: 'association' };
  const result = await interpretWithModel('Study lead and blood pressure', { provider: 'deepseek', apiKey: 'test', fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.type, 'json_object');
    assert.ok(body.messages[0].content.includes('JSON'));
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(intent) } }] }) };
  } });
  assert.equal(result.intent.exposure, 'lead');
});
