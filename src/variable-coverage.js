const crypto = require('crypto');

const CORE_ROLES = new Set(['exposure', 'outcome']);

function matchStrength(score) {
  const value = Number(score) || 0;
  if (value >= 3) return 'strong';
  if (value >= 1.5) return 'moderate';
  return 'weak';
}

function publicCandidate(item = {}) {
  return {
    variable: item.variable,
    description: item.description,
    file: item.file,
    fileDescription: item.fileDescription,
    component: item.component,
    constraints: item.constraints,
    beginYear: item.beginYear,
    endYear: item.endYear,
    matchedCycles: [...(item.matchedCycles || [])],
    score: Number((Number(item.score) || 0).toFixed(4)),
    matchStrength: matchStrength(item.score)
  };
}

function digestPayload(cycles, groups) {
  return {
    cycles,
    groups: groups.map(group => ({
      role: group.role,
      concept: group.concept,
      items: (group.items || []).map(item => ({
        variable: item.variable,
        file: item.file,
        description: item.description,
        constraints: item.constraints,
        matchedCycles: [...(item.matchedCycles || [])].sort(),
        score: Number((Number(item.score) || 0).toFixed(4))
      })).sort((a, b) => `${a.file}:${a.variable}`.localeCompare(`${b.file}:${b.variable}`))
    })).sort((a, b) => `${a.role}:${a.concept}`.localeCompare(`${b.role}:${b.concept}`))
  };
}

function coverageDigest(cycles, groups) {
  return crypto.createHash('sha256').update(JSON.stringify(digestPayload(cycles, groups))).digest('hex');
}

function buildVariableCoverage(intent = {}, candidateGroups = []) {
  const cycles = [...new Set((intent.cycles || []).map(String).filter(Boolean))];
  const groups = candidateGroups.map(group => {
    const cells = cycles.map(cycle => {
      const ranked = (group.items || [])
        .filter(item => item.matchedCycles?.includes(cycle))
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || String(a.variable).localeCompare(String(b.variable)));
      const preferred = ranked[0] ? publicCandidate(ranked[0]) : null;
      const ambiguous = Boolean(preferred && ranked[1] && Math.abs((Number(ranked[0].score) || 0) - (Number(ranked[1].score) || 0)) < 0.05);
      return {
        cycle,
        status: !preferred ? 'missing' : preferred.matchStrength === 'weak' ? 'weak_match' : ambiguous ? 'ambiguous' : 'candidate_found',
        preferred,
        alternatives: ranked.slice(1, 3).map(publicCandidate),
        ambiguous
      };
    });
    const preferredNames = [...new Set(cells.map(cell => cell.preferred?.variable).filter(Boolean))];
    const issues = [];
    if (cells.some(cell => cell.status === 'missing')) issues.push('cycle_gap');
    if (cells.some(cell => cell.status === 'weak_match')) issues.push('weak_catalog_match');
    if (cells.some(cell => cell.ambiguous)) issues.push('ambiguous_top_matches');
    if (preferredNames.length > 1) issues.push('variable_name_changes');
    if (cells.some(cell => cell.preferred?.constraints)) issues.push('eligibility_constraints_present');
    if (cycles.length > 1 && CORE_ROLES.has(group.role)) issues.push('cross_cycle_codebook_review_required');
    return {
      role: group.role,
      concept: group.concept,
      required: CORE_ROLES.has(group.role),
      coveredCycles: cells.filter(cell => cell.preferred).length,
      totalCycles: cycles.length,
      complete: cycles.length > 0 && cells.every(cell => cell.preferred),
      preferredVariables: preferredNames,
      issues: [...new Set(issues)],
      cells
    };
  });
  const coreGroups = groups.filter(group => group.required);
  const allCells = groups.flatMap(group => group.cells);
  const recommendations = groups.flatMap(group => group.cells.flatMap(cell => cell.preferred ? [{
    role: group.role,
    concept: group.concept,
    cycle: cell.cycle,
    ...cell.preferred
  }] : []));
  const uniqueRecommendations = [...new Map(recommendations.map(item => [`${item.role}:${item.concept}:${item.file}:${item.variable}`, item])).values()];
  return {
    schemaVersion: '2.0',
    digest: coverageDigest(cycles, candidateGroups),
    cycles,
    summary: {
      groups: groups.length,
      totalCells: allCells.length,
      coveredCells: allCells.filter(cell => cell.preferred).length,
      missingCells: allCells.filter(cell => !cell.preferred).length,
      weakCells: allCells.filter(cell => cell.status === 'weak_match').length,
      ambiguousCells: allCells.filter(cell => cell.ambiguous).length,
      coreComplete: coreGroups.length >= 2 && coreGroups.every(group => group.complete),
      autoSelectionReady: coreGroups.length >= 2 && coreGroups.every(group => group.complete && !group.issues.includes('weak_catalog_match') && !group.issues.includes('ambiguous_top_matches'))
    },
    groups,
    recommendations: uniqueRecommendations,
    warnings: [...new Set(groups.flatMap(group => group.issues))]
  };
}

module.exports = { matchStrength, coverageDigest, buildVariableCoverage };
