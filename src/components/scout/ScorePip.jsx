/**
 * ScorePip — the compact fit-score badge used across the Daily Discoveries
 * queue panels.
 *
 * ─── WHY A NULL SCORE IS NOT A ZERO ────────────────────────────────────────
 *
 * calculateICPScore returns null for "the ICP configures criteria, but nothing
 * on this company was measurable" (G1-06). That is an absence of evidence. A 0
 * is a measured verdict — we checked, and it does not fit. Rendering the first
 * as the second is the dishonesty Gate 1 exists to remove, and it was happening
 * at every call site: each passed `co.fit_score || co.score || 0`, so null was
 * coerced to 0 before this component ever saw it and came out as a red "0".
 *
 * The pip is too small for the swipe card's full "Not enough data" sentence, so
 * it shows an em dash in the muted colour and carries the sentence as its title.
 * Same verdict, same vocabulary, sized for the space.
 *
 * Lives in its own module rather than inline in DailyLeads so the behaviour can
 * be rendered in a test without mounting the entire Scout queue.
 */

import { useT } from '../../theme/ThemeContext';
import { STATUS } from '../../theme/tokens';
import { isScored, UNSCORED_TITLE, UNSCORED_SHORT } from '../../utils/scoreDisplay';

export default function ScorePip({ score }) {
  const T = useT();

  if (!isScored(score)) {
    const c = T.textFaint || '#888';
    return (
      <span
        title={UNSCORED_TITLE}
        style={{
          fontSize: 10, fontWeight: 700, color: c, padding: '2px 6px',
          background: `${c}18`, borderRadius: 4, border: `1px solid ${c}40`,
        }}
      >
        {UNSCORED_SHORT}
      </span>
    );
  }

  const c = score >= 75 ? STATUS.green : score >= 50 ? STATUS.amber : STATUS.red;
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, color: c, padding: '2px 6px',
        background: `${c}18`, borderRadius: 4, border: `1px solid ${c}40`,
      }}
    >
      {score}
    </span>
  );
}
