/**
 * companyKeywordsResidue.js — the ONE sanitizer for companyKeywords.
 *
 * companyKeywords is documented to the model, in every ICP extraction prompt
 * across this codebase, as "company type keywords" / "stage/type signals"
 * (saas, startup, agency, series A, etc.) — never as a place to carry
 * geography. The structured contract has no field for sub-state geography
 * ("Salt Lake County" has nowhere to go once locations is reduced to the
 * state-level US_STATES whitelist), and unlike industries/companySizes/
 * locations, nothing validated companyKeywords at all until this existed, so
 * a model's attempt to preserve "headquartered in Salt Lake County" could
 * land as a nonsensical, zero-matching Apollo keyword filter instead of
 * being dropped. Production: a Jordan River confirmation did exactly that —
 * companyKeywords: ["headquarters"] reached Apollo as
 * q_organization_keyword_tags: ["headquarters"] and returned zero companies.
 *
 * ── Two runtimes, one engine ────────────────────────────────────────────────
 * There are two independent places in this codebase that produce or merge a
 * companyKeywords value: the from-scratch targeting extraction
 * (netlify/functions/barryICPConversation.js, server/Node runtime) and the
 * existing-ICP update path (src/utils/updateIcpFromChat.js, browser/client
 * runtime, called from BarryChatPanel.jsx). Both must apply the identical
 * rule, or the one that falls behind reopens this exact incident through a
 * different door — which is exactly what happened: the server-side extractor
 * was fixed, and the client-side update path still let the old value survive
 * a merge. This file has no imports and no side effects (no firebase, no
 * Anthropic SDK) specifically so it is safe to import from both — the same
 * pattern already established by src/utils/identityResolution.js ("no
 * firebase import, of any kind, in this file") and src/constants/
 * targetingCanon.js, both already imported directly by Netlify functions.
 * Do not fork this logic into a second copy; import this module from both
 * runtimes instead.
 *
 * Some of the geography-adjacent words are NOT exclusively geographic,
 * though — "based", "local" and "city" are also legitimate company-type
 * language ("account-based marketing", "local government", "city
 * government"), and so are "county" and "metro" ("county government",
 * "county hospital", "metro transit" — real organization categories a
 * relationship-intelligence product may target). A flat "any whole word"
 * rule drops those along with the real residue, so the groups are split by
 * the grammatical pattern that actually marks geography:
 *
 *   - ABSOLUTE: no legitimate company-type keyword is ever built from
 *     these at all — dropped wherever they appear.
 *   - LEADING-context (based/local/city): residue only in a location-
 *     prepositional phrase ("based IN Utah", "local TO Salt Lake") or
 *     standing alone — a category noun afterward ("local GOVERNMENT")
 *     is left untouched.
 *   - TRAILING-context (county/metro): a bare place name followed by one
 *     of these is a geographic qualifier ("Salt Lake COUNTY", "Salt Lake
 *     METRO") — residue only when something precedes it (or it stands
 *     alone); as the FIRST word of a category noun phrase ("COUNTY
 *     government", "METRO transit") it is left untouched.
 */
const ABSOLUTE_RESIDUE_TERMS = new Set([
  'headquarters', 'headquartered', 'located', 'near',
]);
const LEADING_RESIDUE_TERMS = new Set(['based', 'local', 'city']);
const TRAILING_RESIDUE_TERMS = new Set(['county', 'metro']);
const LOCATION_PREPOSITIONS = new Set(['in', 'to', 'near']);

/** Drops any companyKeywords entry that is, or contains, geography/
 * structural residue rather than a company-type signal — see
 * ABSOLUTE_RESIDUE_TERMS / LEADING_RESIDUE_TERMS / TRAILING_RESIDUE_TERMS above.
 * Exported for direct unit coverage — see src/test/companyKeywordsGeographyResidue.test.js
 * and src/test/updateIcpFromChatCompanyKeywords.test.js. */
export function sanitizeCompanyKeywords(keywords) {
  if (!Array.isArray(keywords)) return keywords;
  return keywords.filter(kw => {
    if (typeof kw !== 'string') return true;
    const words = kw.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (words.some(w => ABSOLUTE_RESIDUE_TERMS.has(w))) return false;
    const hasLeadingResidue = words.some((w, i) =>
      LEADING_RESIDUE_TERMS.has(w) &&
      (words.length === 1 || LOCATION_PREPOSITIONS.has(words[i + 1]))
    );
    if (hasLeadingResidue) return false;
    const hasTrailingResidue = words.some((w, i) =>
      TRAILING_RESIDUE_TERMS.has(w) && (words.length === 1 || i !== 0)
    );
    return !hasTrailingResidue;
  });
}
