/**
 * Company facts and ICP identity for Barry's two customer-facing flows —
 * the Meet panel (barryGenerateContext) and draft generation
 * (generate-engagement-message). Both previously built their own company
 * representation from whatever the frontend happened to pass (often nothing),
 * which is how a model ends up inventing a founding year or a headquarters
 * nobody gave it. This is the one place that reads the actual company
 * document and the one place that decides what counts as a usable fact.
 *
 * Shared, but deliberately NOT the same module as companyFacts.js (the
 * search/enrichment write-path's shared builder) — that module shapes an
 * Apollo organization payload being written; this one reads an already-
 * written company document for a prompt. Reuses its value-sanitizing
 * helpers rather than duplicating them.
 */

import { realString, realCount } from './companyFacts.js';

/**
 * Two values that claim the same fact from different sources. Equal (after
 * sanitizing) → that value. One present, one absent → the present one. Both
 * present and DIFFERENT → null: a contradiction is not evidence for either
 * side, and guessing which source to trust is exactly the kind of invention
 * this exists to prevent.
 */
function reconcile(a, b) {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return a === b ? a : null;
}

const EMPTY_FACTS = Object.freeze({
  name: null,
  industry: null,
  hq_location: null,
  founded_year: null,
  description: null,
});

/**
 * Reads `users/{userId}/companies/{companyId}` and returns the verified
 * facts plus the ICP this company was decided under, if any.
 *
 * `icpId` comes from the company's own `swipedForICPId` (the explicit
 * decision ICP stamped by companyDecision.js — see its header for why that
 * field, and not the discovery `icpId`, is the one safe to treat as "the
 * deciding ICP"). Absent is left absent — never defaulted to a sentinel ICP,
 * same rule barryGenerateSequenceStep.js already applies for the same
 * reason: a guessed ICP association is worse than none.
 *
 * @returns {Promise<{facts: object, icpId: string|null}>}
 */
export async function loadCompanyFactsForBarry(db, userId, companyId) {
  if (!userId || !companyId) return { facts: EMPTY_FACTS, icpId: null };

  const companyDoc = await db.collection('users').doc(userId).collection('companies').doc(companyId).get();
  if (!companyDoc.exists) return { facts: EMPTY_FACTS, icpId: null };

  const company = companyDoc.data() || {};
  const snapshot = company.apolloEnrichment?.snapshot || {};

  const facts = {
    name: realString(company.name),
    industry: reconcile(realString(snapshot.industry), realString(company.industry)),
    hq_location: reconcile(realString(snapshot.location?.full), realString(company.location)),
    founded_year: reconcile(realCount(snapshot.founded_year), realCount(company.founded_year)),
    // Single source today — no top-level mirror to conflict with.
    description: realString(snapshot.description),
  };

  return { facts, icpId: company.swipedForICPId || null };
}

/**
 * Renders `facts` as prompt lines. A present fact states it; an absent one
 * states that it's unknown and must not be guessed — never silently omitted,
 * because an omitted field invites a model to fill the gap, where an
 * explicit "Unknown" instruction constrains it. This is the same guardrail
 * barryGenerateContext.js already proved for founded_year, extended to the
 * other fields that were missing it entirely.
 */
export function formatCompanyFactsBlock(facts) {
  const line = (label, value, unknownText) => `${label}: ${value != null ? value : unknownText}`;
  const lines = [
    line('Company', facts.name, 'Unknown'),
    line('Industry', facts.industry, 'Unknown — do not state or guess the company’s industry'),
    line('Headquarters', facts.hq_location, 'Unknown — do not state or guess the company’s location'),
    line('Founded', facts.founded_year, 'Unknown — do not reference company age or founding year'),
  ];
  if (facts.description) lines.push(`Description: ${facts.description}`);
  return lines.join('\n');
}
