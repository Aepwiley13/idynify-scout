/**
 * Queue ordering for Daily Discoveries.
 *
 * ─── WHY NULL IS NOT ZERO HERE EITHER ──────────────────────────────────────
 *
 * The queue used to sort on `(b.fit_score ?? 0) - (a.fit_score ?? 0)`, which
 * ties an unscored company with a measured 0 and interleaves the two at the
 * bottom of the list. That is the ranking half of the same conflation the
 * display fix removes: a company we never managed to evaluate is not the same
 * as one we evaluated and rejected, and it is strictly more promising.
 *
 * So the queue has three tiers:
 *
 *   0. measured and qualifying (>= 50) — descending
 *   1. unscored                        — most recently discovered first
 *   2. measured and not qualifying     — descending
 *
 * An unknown outranks a known-poor fit, and a known-good fit outranks both.
 * Within the measured tiers the existing G1-06 tie-break still applies: at
 * equal scores, the company whose score rests on more observed dimensions
 * (`fit_confidence`) comes first, so a fully-evaluated match outranks a
 * half-evaluated one.
 */

import { isScored } from './scoreDisplay';

/** At or above this, a measured score is good enough to lead the queue. */
export const QUALIFIED_MIN = 50;

export const TIER = Object.freeze({ QUALIFIED: 0, UNSCORED: 1, BELOW: 2 });

/** Which of the three bands a company's score puts it in. */
export function fitTier(score) {
  if (!isScored(score)) return TIER.UNSCORED;
  return score >= QUALIFIED_MIN ? TIER.QUALIFIED : TIER.BELOW;
}

/**
 * Discovery recency as a sortable number. `found_at` is what search-companies
 * writes; the others are older shapes still present on legacy rows. A row with
 * no usable timestamp sorts last within its tier rather than throwing the whole
 * comparison, and the name tie-break below keeps that case deterministic.
 */
function recencyOf(company) {
  const raw = company?.found_at ?? company?.discovered_at ?? company?.created_at ?? null;
  if (!raw) return 0;
  const ms = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Comparator implementing the three tiers. Stable and total. */
export function compareByFit(a, b) {
  const ta = fitTier(a?.fit_score);
  const tb = fitTier(b?.fit_score);
  if (ta !== tb) return ta - tb;

  if (ta === TIER.UNSCORED) {
    const diff = recencyOf(b) - recencyOf(a);
    if (diff !== 0) return diff;
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  }

  return (b.fit_score - a.fit_score)
    || ((b?.fit_confidence ?? 0) - (a?.fit_confidence ?? 0));
}

/** Non-mutating sort, for callers that would rather not sort in place. */
export function rankByFit(companies) {
  return [...(companies || [])].sort(compareByFit);
}

/**
 * The company that earns the TOP MATCH badge, or null when none does.
 *
 * Only a measured, qualifying score can earn it. The old reduce compared
 * `(c.fit_score || 0)`, so on a queue where nothing was scored it handed the
 * badge to whichever company happened to be first — presenting an arbitrary
 * pick as the best one. There is no "best" in that queue, and saying so is the
 * honest answer.
 */
export function pickTopMatch(companies) {
  const qualified = (companies || []).filter(
    (c) => fitTier(c?.fit_score) === TIER.QUALIFIED,
  );
  if (qualified.length === 0) return null;
  return qualified.reduce((best, c) => (compareByFit(c, best) < 0 ? c : best), qualified[0]);
}
