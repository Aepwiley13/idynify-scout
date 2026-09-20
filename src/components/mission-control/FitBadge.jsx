/**
 * FitBadge — the Match score badge on the Mission Control desktop table and
 * company drawer.
 *
 * ─── WHY THE GUARD LIVES HERE AND NOT AT THE CALL SITE ─────────────────────
 *
 * null means no Company × ICP judgment exists — either no ICP resolved, or
 * (after the industry fix) nothing on the company was measurable. It is not a
 * low score, and `getFitTier` would round it to a grey "Low Fit".
 *
 * The badge already knew that. The defect was that one of its two callers
 * rounded FIRST: `<FitBadge score={Math.round(score)} />` in the company
 * drawer, where `score` is `company.fit_score ?? null`. `Math.round(null)` is
 * 0, so the badge received a number, decided it was scored, and rendered a
 * confident grey "0" for a company nobody had evaluated — with the
 * "Match not scored" tooltip suppressed, because as far as the badge could
 * tell there was a score.
 *
 * A guard a caller can defeat by pre-processing the value is not a guard. So
 * the badge now takes the RAW score and does its own rounding, and treats
 * anything non-finite as unscored — which also means a NaN can never reach the
 * screen as the literal text "NaN".
 *
 * Extracted from MissionControlDashboardV2 so this can be rendered in a test.
 * Every existing test of that page reads its source with readFileSync because
 * importing it pulls 25 top-level modules; source-shape assertions cannot prove
 * what a component renders.
 */

import { getFitTier } from '../../utils/companyDisplay';

export const UNATTRIBUTED_TITLE = 'No active ICP — Match not scored';
export const UNATTRIBUTED_MARK = '—';

/** Grey is preserved exactly — STATUS has no grey token. */
const UNATTRIBUTED_COLOR = '#888';

export default function FitBadge({ score }) {
  const unattributed = !Number.isFinite(score);
  const { color } = unattributed ? { color: UNATTRIBUTED_COLOR } : getFitTier(score);

  return (
    <span
      title={unattributed ? UNATTRIBUTED_TITLE : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '4px 12px', borderRadius: 20, minWidth: 42,
        background: `${color}18`, border: `1px solid ${color}40`,
        fontSize: unattributed ? 11 : 13, fontWeight: 700, color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {unattributed ? UNATTRIBUTED_MARK : Math.round(score)}
    </span>
  );
}
