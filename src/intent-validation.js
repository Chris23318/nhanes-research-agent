function validateIntent(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['root must be an object'];
  for (const field of ['exposure', 'outcome', 'estimand']) {
    if (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > 2000) errors.push(`${field} must be a nonempty string, at most 2000 characters`);
  }
  if (typeof value.population?.description !== 'string' || !value.population.description.trim()) errors.push('population.description must be a nonempty string');
  for (const field of ['covariates', 'ambiguities']) {
    if (!Array.isArray(value[field]) || value[field].length > 40 || !value[field].every(x => typeof x === 'string' && x.length <= 2000)) errors.push(`${field} must be an array of at most 40 strings`);
  }
  if (!Array.isArray(value.cycles) || value.cycles.length > 20 || !value.cycles.every(x => typeof x === 'string' && /^\d{4}-\d{4}$/.test(x) && Number(x.slice(0,4)) < Number(x.slice(5)))) errors.push('cycles must be an array of ascending YYYY-YYYY ranges; use [] when uncertain');
  return errors;
}
module.exports = { validateIntent };
