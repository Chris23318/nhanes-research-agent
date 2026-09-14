const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretWithModel } = require('../src/model-runtime');
const intent = { exposure: 'blood lead', outcome: 'blood pressure', cycles: ['2017-2018'], covariates: ['age'], ambiguities: ['confirm outcome'], population: { description: 'adults' }, estimand: 'association' };
const final = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(intent) }] }] };
test('model runtime returns tool evidence then accepts structured intent', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => requests.length === 1 ? { status: 'completed', output: [{ type: 'function_call', name: 'search_nhanes_catalog', call_id: 'call1', arguments: JSON.stringify({ concepts: ['lead'], cycles: ['2017-2018'] }) }] } : final }; };
  const result = await interpretWithModel('study lead and blood pressure', { apiKey: 'test', fetchImpl });
  assert.equal(result.intent.exposure, 'blood lead');
  assert.equal(requests[1].input.at(-1).type, 'function_call_output');
  assert.equal(result.trace[0].resultCount, 0);
});
test('model cannot invoke shell or arbitrary tools', async () => {
  await assert.rejects(interpretWithModel('question', { apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'function_call', name: 'shell' }] }) }) }), /MODEL_TOOL_NOT_ALLOWED/);
});
test('model failures never expose upstream response bodies or credentials', async () => {
  await assert.rejects(interpretWithModel('question', { apiKey: 'secret', fetchImpl: async () => ({ ok: false, status: 401 }) }), /^Error: MODEL_HTTP_401$/);
});
