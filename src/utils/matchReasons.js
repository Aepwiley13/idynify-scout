/**
 * Why a company matches the ICP, in words (#006.5).
 *
 * Reads getScoreBreakdown()'s factor results as they are — it never scores.
 * Each active factor (one the ICP actually sets) is in exactly one state:
 *   match 100            → matched
 *   match 50             → partial  (close)
 *   match 0              → missed
 *   unknown: true        → unknown  (no data for this company; not counted
 *                                    against it — never shown as a miss)
 * Factors the ICP doesn't set (`active: false`) are not criteria, so they are
 * not listed.
 */

export const MATCH_STATE = Object.freeze({
  MATCHED: 'matched',
  PARTIAL: 'partial',
  MISSED: 'missed',
  UNKNOWN: 'unknown',
});

/** Read by screen readers before each line; the symbol beside it is decorative. */
export const STATE_LABEL = Object.freeze({
  matched: 'Matches',
  partial: 'Close match',
  missed: "Doesn't match",
  unknown: 'Not available',
});

export const STATE_SYMBOL = Object.freeze({ matched: '✓', partial: '≈', missed: '✗', unknown: '?', neutral: '•' });

const TEXT = {
  industry: {
    matched: () => 'In your target industry',
    partial: () => 'Related to your target industry',
    missed: () => 'Outside your target industries',
    unknown: () => 'Industry information not available',
  },
  location: {
    matched: v => (v ? `In your target region: ${v}` : 'In your target region'),
    partial: () => 'Near your target region',
    missed: () => 'Outside your target region',
    unknown: () => 'Location information not available',
  },
  employeeSize: {
    matched: () => 'Size fits your range',
    partial: () => 'Size near your range',
    missed: () => 'Size outside your range',
    unknown: () => 'Company size information not available',
  },
  revenue: {
    matched: () => 'Revenue fits your range',
    partial: () => 'Revenue near your range',
    missed: () => 'Revenue outside your range',
    unknown: () => 'Revenue information not available',
  },
};

export function stateOf(data) {
  if (!data || data.unknown) return MATCH_STATE.UNKNOWN;
  if (data.match === 100) return MATCH_STATE.MATCHED;
  if (data.match === 50) return MATCH_STATE.PARTIAL;
  return MATCH_STATE.MISSED;
}

const RANK = { matched: 0, partial: 1, missed: 2, unknown: 3 };

/**
 * Every active factor, explained, strongest first (matched → close → missed →
 * not available). `factorPills` is DailyLeads' list of { key, label, data },
 * already filtered to active factors.
 */
export function explainFactors(factorPills = []) {
  return factorPills
    .filter(({ key, data }) => data && data.active !== false && TEXT[key])
    .map(({ key, data }) => {
      const kind = stateOf(data);
      const value = typeof data.value === 'string' ? data.value : null;
      return { key, kind, text: TEXT[key][kind](value) };
    })
    .sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

/** The phone card's reasons: as before, a factor with no data is not a reason. */
export function strongestReasons(factorPills = []) {
  return explainFactors(factorPills).filter(r => r.kind !== MATCH_STATE.UNKNOWN);
}

/**
 * "Matches 2 of 4 criteria · 1 close match · 1 unknown". Counts come straight
 * from the explained factors; unknown is its own count, never a miss. Null when
 * the ICP sets no factor this company can be judged on.
 */
export function summarizeFactors(explained = []) {
  const n = { matched: 0, partial: 0, missed: 0, unknown: 0 };
  for (const r of explained) n[r.kind] += 1;
  const total = explained.length;
  if (total === 0) return null;
  const parts = [`Matches ${n.matched} of ${total} ${total === 1 ? 'criterion' : 'criteria'}`];
  if (n.partial) parts.push(`${n.partial} close ${n.partial === 1 ? 'match' : 'matches'}`);
  if (n.missed) parts.push(`${n.missed} ${n.missed === 1 ? "doesn't" : "don't"} match`);
  if (n.unknown) parts.push(`${n.unknown} unknown`);
  return { ...n, total, text: parts.join(' · ') };
}
