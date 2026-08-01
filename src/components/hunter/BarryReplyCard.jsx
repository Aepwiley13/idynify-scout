/**
 * BARRY REPLY CARD — Sprint 3 Team Alpha
 *
 * The surface that closes the inbox loop. When a prospect replies and Barry has
 * read it and prepared an answer, this card shows — at the top of the Hunter
 * contact drawer — what they said, what Barry understood, and Barry's draft.
 *
 * Four zones:
 *   1. Inbound signal   — Barry's plain-English summary + intent/sentiment
 *   2. Barry's read     — extracted questions, objections, positive signals
 *   3. The draft        — editable before sending, always
 *   4. Actions          — Snooze · Dismiss · Send Reply
 *
 * Barry never sends on its own. The Send button is the only path out, the body
 * always comes from the editable textarea, and every failure is shown inline.
 *
 * `analysis` may be null — Team B writes it before the draft, but a failed
 * fetch must degrade to "draft only" rather than blanking the card.
 */

import { useState, useMemo } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Send, Loader, AlertCircle, Clock, X, Sparkles } from 'lucide-react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { DRAFT_APPROVAL } from '../../hooks/usePendingReplies';
import './BarryReplyCard.css';

/** Soft warning threshold — no hard limit on reply length. */
export const SOFT_BODY_LIMIT = 2000;

/** Intent → badge treatment. Mirrors the Hunter colour conventions. */
export const INTENT_BADGES = {
  information:    { label: 'Wants information', tone: 'blue' },
  scheduling:     { label: 'Wants to meet',     tone: 'green' },
  objection:      { label: 'Raised a concern',  tone: 'amber' },
  positive:       { label: 'Positive signal',   tone: 'green' },
  acknowledgment: { label: 'Acknowledgement',   tone: 'gray' },
  unknown:        { label: 'Unclear intent',    tone: 'gray' },
};

const SENTIMENT_TONES = {
  positive: 'green',
  neutral: 'gray',
  negative: 'amber',
  mixed: 'blue',
};

/** The three signal arrays worth surfacing, in the order they read best. */
export const SIGNAL_SECTIONS = [
  { key: 'questionsAsked',  label: 'Questions to answer' },
  { key: 'objections',      label: 'Concerns raised' },
  { key: 'positiveSignals', label: 'Positive signals' },
];

/**
 * Which signal sections actually have content. Zone 2 is skipped entirely when
 * this is empty rather than rendering three empty headings.
 * @param {object|null} analysis
 */
export function visibleSignals(analysis) {
  if (!analysis) return [];
  return SIGNAL_SECTIONS
    .map(({ key, label }) => ({ key, label, items: analysis[key] }))
    .filter(({ items }) => Array.isArray(items) && items.length > 0);
}

function Badge({ tone, children }) {
  return <span className={`brc-badge brc-badge--${tone}`}>{children}</span>;
}

export default function BarryReplyCard({
  contact,
  draft,
  analysis,
  userId,
  onSent,
  onSnooze,
  onDismiss,
}) {
  const [bodyText, setBodyText] = useState(draft?.bodyText || '');
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(null);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);

  const signals = useMemo(() => visibleSignals(analysis), [analysis]);
  const intent = INTENT_BADGES[analysis?.intent] || INTENT_BADGES.unknown;
  const sentimentTone = SENTIMENT_TONES[analysis?.sentiment] || 'gray';

  const firstName = contact?.firstName || contact?.name?.split(' ')[0] || 'them';
  const busy = sending || acting;
  const overSoftLimit = bodyText.length > SOFT_BODY_LIMIT;

  // The draft document ID is the messageRecordId — Team B keys both
  // barry_drafts and barry_analysis by it.
  const draftId = draft?.messageRecordId || draft?.id;

  const draftRef = () =>
    doc(db, 'users', userId, 'contacts', contact.id, 'barry_drafts', draftId);

  // ── Snooze ───────────────────────────────────────────────────────────────
  // Drops the reply out of the pending list and the morning brief count, but
  // leaves conversationState alone so the card is still there next time this
  // contact's drawer is opened.
  async function handleSnooze() {
    if (busy) return;
    setActing(true);
    setError(null);
    try {
      await updateDoc(draftRef(), {
        approvalStatus: DRAFT_APPROVAL.SNOOZED,
        snoozedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onSnooze?.();
    } catch (err) {
      console.error('[BarryReplyCard] snooze failed:', err);
      setError('Could not snooze this reply. Try again.');
      setActing(false);
    }
  }

  // ── Dismiss ──────────────────────────────────────────────────────────────
  // Retires the draft and clears the "needs you" flag, so the contact is not
  // left stuck in user_action_required with nothing to act on.
  async function handleDismiss() {
    if (busy) return;
    if (!confirmingDismiss) {
      setConfirmingDismiss(true);
      return;
    }
    setActing(true);
    setError(null);
    try {
      await updateDoc(draftRef(), {
        approvalStatus: DRAFT_APPROVAL.DISMISSED,
        dismissedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', userId, 'contacts', contact.id), {
        conversationState: 'active_conversation',
        updatedAt: serverTimestamp(),
      });
      onDismiss?.();
    } catch (err) {
      console.error('[BarryReplyCard] dismiss failed:', err);
      setError('Could not dismiss this reply. Try again.');
      setActing(false);
      setConfirmingDismiss(false);
    }
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  async function handleSend() {
    if (busy) return;
    const body = bodyText.trim();
    if (!body) {
      setError('The reply is empty — write something before sending.');
      return;
    }

    setSending(true);
    setError(null);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barry-approve-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          userId,
          authToken,
          contactId: contact.id,
          messageRecordId: draftId,
          bodyText: body,
          gmailThreadId: draft?.gmailThreadId,
          recipientEmail: draft?.recipientEmail,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Send failed (${res.status})`);
      }

      onSent?.(data);
    } catch (err) {
      console.error('[BarryReplyCard] send failed:', err);
      setError(err.message || 'Could not send the reply. Try again.');
      setSending(false);
    }
  }

  if (!draft) return null;

  return (
    <div className="barry-reply-card">
      {/* Header */}
      <div className="brc-header">
        <span className="brc-bear">🐻</span>
        <div className="brc-header-text">
          <div className="brc-title">{firstName} replied — Barry drafted an answer</div>
          {analysis?.recommendedActionReason && (
            <div className="brc-subtitle">{analysis.recommendedActionReason}</div>
          )}
        </div>
        {analysis?.urgency && (
          <Badge tone={analysis.urgency === 'high' ? 'amber' : 'gray'}>
            {analysis.urgency} priority
          </Badge>
        )}
      </div>

      {/* ── Zone 1: what they said ─────────────────────────────────────── */}
      {analysis?.summary ? (
        <div className="brc-zone brc-zone--summary">
          <p className="brc-summary">{analysis.summary}</p>
          <div className="brc-badges">
            <Badge tone={intent.tone}>{intent.label}</Badge>
            {analysis.sentiment && (
              <Badge tone={sentimentTone}>{analysis.sentiment}</Badge>
            )}
          </div>
        </div>
      ) : (
        <div className="brc-zone brc-zone--summary">
          <p className="brc-summary brc-summary--muted">
            Barry prepared this reply. The read of their message isn't available.
          </p>
        </div>
      )}

      {/* ── Zone 2: Barry's read ───────────────────────────────────────── */}
      {signals.length > 0 && (
        <div className="brc-zone brc-zone--signals">
          {signals.map(({ key, label, items }) => (
            <div key={key} className="brc-signal-group">
              <div className="brc-signal-label">{label}</div>
              <ul className="brc-signal-list">
                {items.map((item, i) => (
                  <li key={i} className="brc-signal-item">{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* ── Zone 3: the draft ──────────────────────────────────────────── */}
      <div className="brc-zone brc-zone--draft">
        <label className="brc-draft-label" htmlFor="brc-draft-body">
          <Sparkles className="brc-draft-icon" />
          Barry's suggested reply — edit freely before sending.
        </label>
        <textarea
          id="brc-draft-body"
          className="brc-textarea"
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          disabled={busy}
          rows={10}
          spellCheck
        />
        <div className="brc-draft-meta">
          <span className={overSoftLimit ? 'brc-count brc-count--warn' : 'brc-count'}>
            {bodyText.length.toLocaleString()} characters
            {overSoftLimit && ' — long for a reply, consider trimming'}
          </span>
          {draft.recipientEmail && (
            <span className="brc-recipient">to {draft.recipientEmail}</span>
          )}
        </div>
      </div>

      {/* ── Zone 4: actions ────────────────────────────────────────────── */}
      {error && (
        <div className="brc-error" role="alert">
          <AlertCircle className="brc-error-icon" />
          <span>{error}</span>
        </div>
      )}

      <div className="brc-actions">
        <button
          type="button"
          className="brc-btn brc-btn--ghost"
          onClick={handleSnooze}
          disabled={busy}
        >
          <Clock className="brc-btn-icon" />
          Snooze
        </button>

        <button
          type="button"
          className={`brc-btn brc-btn--ghost${confirmingDismiss ? ' brc-btn--danger' : ''}`}
          onClick={handleDismiss}
          onBlur={() => setConfirmingDismiss(false)}
          disabled={busy}
        >
          <X className="brc-btn-icon" />
          {confirmingDismiss ? 'Tap again to confirm' : 'Dismiss'}
        </button>

        <button
          type="button"
          className="brc-btn brc-btn--primary"
          onClick={handleSend}
          disabled={busy || !bodyText.trim()}
        >
          {sending ? (
            <>
              <Loader className="brc-btn-icon brc-spin" />
              Sending…
            </>
          ) : (
            <>
              <Send className="brc-btn-icon" />
              Send Reply
            </>
          )}
        </button>
      </div>
    </div>
  );
}
