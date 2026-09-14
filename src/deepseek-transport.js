// Translate the bounded research runtime to DeepSeek Chat Completions.
function deepseekTransport(fetchImpl = fetch) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    const messages = [{ role: 'system', content: `${request.instructions} Return JSON matching this schema: ${JSON.stringify(request.text.format.schema)}` }];
    for (const item of request.input) {
      if (item.type === 'function_call') {
        const call = { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } };
        if (messages.at(-1)?.role === 'assistant') messages.at(-1).tool_calls.push(call);
        else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
      } else if (item.type === 'function_call_output') {
        messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output });
      } else if (item.role === 'user') messages.push(item);
    }
    const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
      ...options,
      body: JSON.stringify({ model: request.model, messages, max_tokens: 3000, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, tools: request.tools.map(({ type, strict, ...definition }) => ({ type: 'function', function: definition })), tool_choice: 'auto' })
    });
    if (!response.ok) return response;
    return { ok: true, json: async () => {
      const data = await response.json(), choice = data.choices?.[0], message = choice?.message;
      const calls = message?.tool_calls || [];
      return { status: ['stop', 'tool_calls'].includes(choice?.finish_reason) ? 'completed' : 'incomplete', output: calls.length ? calls.map(call => ({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments })) : [{ type: 'message', content: [{ type: 'output_text', text: message?.content || '' }] }] };
    } };
  };
}
module.exports = { deepseekTransport };
