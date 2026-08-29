const RESEARCH_INTENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['population', 'exposure', 'outcome', 'covariates', 'cycles', 'estimand', 'ambiguities'],
  properties: {
    population: { type: 'object', additionalProperties: false, required: ['description'], properties: { description: { type: 'string' } } },
    exposure: { type: 'string' }, outcome: { type: 'string' }, covariates: { type: 'array', items: { type: 'string' } },
    cycles: { type: 'array', items: { type: 'string' } }, estimand: { type: 'string' }, ambiguities: { type: 'array', items: { type: 'string' } }
  }
};

function buildIntentRequest(question, model = process.env.OPENAI_MODEL || 'gpt-5.4-mini') {
  return {
    model,
    instructions: 'You structure NHANES epidemiology questions. Mark uncertainty explicitly. Never invent variables, datasets, PMIDs, or results.',
    input: question,
    text: { format: { type: 'json_schema', name: 'research_intent', strict: true, schema: RESEARCH_INTENT_SCHEMA } },
    tools: [{ type: 'function', name: 'search_nhanes_catalog', description: 'Search the locally verified NHANES metadata catalog.', strict: true, parameters: { type: 'object', additionalProperties: false, required: ['concepts', 'cycles'], properties: { concepts: { type: 'array', items: { type: 'string' } }, cycles: { type: 'array', items: { type: 'string' } } } } }],
    parallel_tool_calls: true,
    store: false
  };
}

module.exports = { RESEARCH_INTENT_SCHEMA, buildIntentRequest };
