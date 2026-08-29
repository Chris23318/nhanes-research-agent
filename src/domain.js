const crypto = require('crypto');

const STAGES = ['parse', 'variables', 'literature', 'protocol', 'analysis', 'quality', 'report'];
const ROLES = new Set(['exposure', 'outcome', 'covariate', 'design']);

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

function assert(condition, message, code = 'VALIDATION_ERROR') {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    error.status = 400;
    throw error;
  }
}

function validateQuestion(input) {
  assert(input && typeof input.question === 'string', 'question is required');
  const question = input.question.trim();
  assert(question.length >= 10, 'question must contain at least 10 characters');
  assert(question.length <= 4000, 'question cannot exceed 4000 characters');
  return question;
}

function validateVariableMap(items) {
  assert(Array.isArray(items) && items.length > 0, 'variable map cannot be empty');
  for (const item of items) {
    assert(ROLES.has(item.role), `invalid variable role: ${item.role}`);
    assert(/^[A-Z][A-Z0-9_–-]+$/i.test(item.variable), `invalid NHANES variable: ${item.variable}`);
    assert(item.source && item.cycles?.length, `variable ${item.variable} needs source and cycles`);
    assert(item.confidence >= 0 && item.confidence <= 1, 'confidence must be between 0 and 1');
  }
  return items;
}

function validateTransition(from, to) {
  const current = STAGES.indexOf(from);
  const next = STAGES.indexOf(to);
  assert(next === current + 1, `invalid transition from ${from} to ${to}`, 'INVALID_TRANSITION');
}

module.exports = { STAGES, id, assert, validateQuestion, validateVariableMap, validateTransition };
