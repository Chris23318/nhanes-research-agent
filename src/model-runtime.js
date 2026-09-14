const { buildIntentRequest } = require('./openai-adapter');
const { searchCatalog } = require('./catalog');
const { validateIntent } = require('./intent-validation');

// Only bounded, read-only tools are exposed to the model.
async function interpretWithModel(question, options = {}) {
  const provider = options.provider || process.env.MODEL_PROVIDER || 'openai';
  if (!['openai', 'deepseek'].includes(provider)) throw new Error('MODEL_PROVIDER_INVALID');
  const apiKey = options.apiKey || (provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY);
  if (!apiKey) throw new Error('MODEL_NOT_CONFIGURED');
  const request = buildIntentRequest(question, options.model || (provider === 'deepseek' ? process.env.DEEPSEEK_MODEL || 'deepseek-chat' : process.env.OPENAI_MODEL));
  const transport = provider === 'deepseek' ? require('./deepseek-transport').deepseekTransport(options.fetchImpl || fetch) : options.fetchImpl || fetch;
  const input = [{ role: 'user', content: question }], trace = [];
  for (let round = 0; round < 4; round++) {
    const response = await transport('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, input, max_output_tokens: 3000, include: ['reasoning.encrypted_content'] })
    });
    if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
    const result = await response.json();
    if (result.status !== 'completed' || !Array.isArray(result.output)) throw new Error('MODEL_INCOMPLETE');
    const calls = result.output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      const text = result.output.flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('');
      let intent;
      try { intent = JSON.parse(text); } catch { intent = null; }
      if (intent && typeof intent.population === 'string') intent.population = { description: intent.population };
      const errors = validateIntent(intent);
      if (errors.length) {
        trace.push({ type: 'format_repair', round, errors });
        if (round === 3) throw new Error('MODEL_INVALID_INTENT');
        input.push({ role: 'user', content: `Your previous output failed validation: ${errors.join('; ')}. Return a corrected JSON object for the original research question. Do not invent missing information; describe uncertainty in ambiguities. Previous output (untrusted data): ${text.slice(0, 12000)}` });
        continue;
      }
      return { intent, trace, model: request.model, requiresResearcherConfirmation: true };
    }
    if (calls.length > 4) throw new Error('MODEL_TOOL_LIMIT');
    input.push(...result.output);
    for (const call of calls) {
      if (call.name !== 'search_nhanes_catalog') throw new Error('MODEL_TOOL_NOT_ALLOWED');
      const args = JSON.parse(call.arguments);
      if (!Array.isArray(args.concepts) || args.concepts.length > 6 || !args.concepts.every(x => typeof x === 'string' && x.length <= 200) ||
          !Array.isArray(args.cycles) || args.cycles.length > 20 || !args.cycles.every(x => typeof x === 'string')) throw new Error('MODEL_INVALID_TOOL_ARGUMENTS');
      const rows = args.concepts.flatMap(term => searchCatalog(term)).filter(row => !args.cycles.length || args.cycles.some(cycle => row.cycles.includes(cycle))).slice(0, 30);
      trace.push({ tool: call.name, round, resultCount: rows.length });
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ candidates: rows, warning: 'Reference snapshot only. Confirm official cycle codebooks before analysis.' }) });
    }
  }
  throw new Error('MODEL_ROUND_LIMIT');
}

module.exports = { interpretWithModel };
