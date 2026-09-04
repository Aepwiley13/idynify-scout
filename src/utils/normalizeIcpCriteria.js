/**
 * Canonical normalization of ICP criteria that shape a Discovery search.
 *
 * Mirrors the normalization in search-companies.js computeIcpCriteriaFingerprint
 * so client-side change detection agrees with the server's fingerprint.
 *
 * Only fields that reach buildApolloQuery are included. targetTitles is
 * excluded: it is a person filter that never reaches Apollo's organisation
 * search, so editing it must NOT invalidate a company queue.
 */
export function normalizeIcpCriteria(profile) {
  const p = profile || {};

  const norm = (arr) => Array.from(
    new Set((Array.isArray(arr) ? arr : []).map(v => String(v).trim().toLowerCase()).filter(Boolean))
  ).sort();

  return {
    industries: norm(p.industries),
    companyKeywords: norm(p.companyKeywords),
    companySizes: norm(p.companySizes),
    skipRevenue: !!p.skipRevenue,
    revenueRanges: p.skipRevenue ? [] : norm(p.revenueRanges),
    isNationwide: !!p.isNationwide,
    locations: p.isNationwide ? [] : norm(p.locations),
    foundedAgeRange: p.foundedAgeRange
      ? { minAge: p.foundedAgeRange.minAge ?? null, maxAge: p.foundedAgeRange.maxAge ?? null }
      : null,
    searchStrategy: p.searchStrategy || null,
    lookalikeSeed: p.lookalikeSeed?.name ? String(p.lookalikeSeed.name).trim().toLowerCase() : null,
  };
}

export function criteriaChanged(prev, next) {
  return JSON.stringify(normalizeIcpCriteria(prev)) !== JSON.stringify(normalizeIcpCriteria(next));
}
