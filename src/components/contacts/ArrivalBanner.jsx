/**
 * ArrivalBanner — why this screen opened, stated at the top of it.
 *
 * A user clicks "Complete the next step with Gentry Moyes" in Mission Control
 * and lands on Gentry Moyes. Before this banner, the page said nothing about
 * the click: same header, same layout, same twelve panels as arriving from
 * anywhere else. The user had to hold the reason in their head across a
 * navigation, and the one action that mattered was somewhere among the twelve.
 *
 * The banner reads the ephemeral navigation intent and says two things: the
 * reason the record was surfaced, and the action that was recommended. It is
 * not a notification and it is not persisted — refresh the page and it is gone,
 * which is correct, because a user who refreshes is no longer arriving.
 *
 * Rendered only when intent is present. Direct navigation, a bookmark and a
 * refresh all produce no banner rather than an empty one.
 */

import { ArrowLeft, Target } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { reasonText, actionText } from '../../utils/arrivalCopy';

/**
 * @param {object}   props
 * @param {object}   props.intent    Navigation intent from router state.
 * @param {string}   props.entryLabel Human name of the module the user came from.
 * @param {Function} [props.onBack]  Invoked when the user takes the way back.
 * @param {Function} [props.onAction] Invoked when the user takes the recommended action.
 */
export default function ArrivalBanner({ intent, entryLabel, onBack, onAction }) {
  const T = useT();

  if (!intent) return null;

  const reason = reasonText(intent.reason);
  const action = actionText(intent.recommendedAction);

  // Nothing to say. A banner that reads "You arrived from Mission Control" and
  // nothing else is chrome, not information.
  if (!reason && !action) return null;

  return (
    <div
      className="contact-arrival-banner"
      role="status"
      aria-label="Why this contact was opened"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 14,
        padding: '14px 18px',
        marginBottom: 14,
        borderRadius: 12,
        border: `1px solid ${T.accentBdr}`,
        background: `${T.accent}12`,
      }}
    >
      <Target size={18} color={T.accent} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />

      <div style={{ flex: 1, minWidth: 0 }}>
        {entryLabel && (
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: T.accent, marginBottom: 4,
          }}>
            Surfaced by {entryLabel}
          </div>
        )}

        {reason && (
          <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5 }}>
            {reason}
          </div>
        )}

        {action && (
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.5, marginTop: 2 }}>
            <strong style={{ color: T.text, fontWeight: 700 }}>Recommended:</strong>{' '}
            {action}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {action && onAction && (
          <button
            type="button"
            onClick={onAction}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none',
              background: T.accent, color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {action}
          </button>
        )}
        {intent.returnTo && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={entryLabel ? `Back to ${entryLabel}` : 'Back'}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', borderRadius: 8,
              border: `1px solid ${T.border2}`, background: T.surface,
              color: T.textMuted, fontSize: 12, cursor: 'pointer',
            }}
          >
            <ArrowLeft size={13} aria-hidden="true" />
            Back
          </button>
        )}
      </div>
    </div>
  );
}
