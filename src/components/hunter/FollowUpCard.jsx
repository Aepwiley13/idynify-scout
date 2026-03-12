import { useState } from 'react';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { EmailDraftCard } from '../shared/EmailDraftCard';
import './FollowUpCard.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

/**
 * FollowUpCard — renders a single follow_up_due notification from
 * users/{uid}/notifications. Used in HunterDashboard's live follow-up section.
 *
 * Props:
 *   notification  — { id, contactId, contactName, companyName, reason, createdAt }
 *   userId        — Firebase user ID
 *   onDismiss     — callback(notificationId) to remove card from parent state
 */

function barryNote(name, days) {
  return days > 14
    ? `${name} has gone quiet — ${days} days, no reply. Time to re-engage or let go.`
    : `No reply from ${name} in ${days} days. Want me to send a follow-up?`;
}

function daysSinceTimestamp(ts) {
  if (!ts) return null;
  const ms = ts?.toMillis ? ts.toMillis() : new Date(ts).getTime();
  if (isNaN(ms)) return null;
  return Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
}

export default function FollowUpCard({ notification, userId, onDismiss }) {
  const [drafting, setDrafting] = useState(false);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftError, setDraftError] = useState(null);
  const [acting, setActing] = useState(false);

  const { id, contactId, contactName, companyName, reason, createdAt } = notification;
  const days = daysSinceTimestamp(createdAt);
  const note = barryNote(contactName || 'this contact', days ?? 0);

  // ── Draft Follow-Up ──────────────────────────────────────

  async function handleDraftFollowUp() {
    if (drafting) return;
    setDrafting(true);
    setDraftError(null);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');

      const idToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/generate-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          contactId,
          outcome: 'no_response',
          originalMessage: ''
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to generate follow-up');
      }

      const data = await res.json();
      setDraftSubject(`Follow-up: ${contactName || 'checking in'}`);
      setDraftBody(data.followUpBody || '');
    } catch (err) {
      setDraftError(err.message || 'Something went wrong');
    }
  }

  // ── Mark as Done ─────────────────────────────────────────

  async function handleMarkDone() {
    if (acting) return;
    setActing(true);
    onDismiss(id);
    try {
      const notifRef = doc(db, 'users', userId, 'notifications', id);
      await updateDoc(notifRef, { read: true, resolvedAt: Timestamp.now() });

      if (contactId) {
        await updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
          contact_status: 'Engaged',
          contact_status_updated_at: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('[FollowUpCard] Mark done failed:', err);
      // onSnapshot will re-render the card if the write failed
    }
  }

  // ── Snooze ───────────────────────────────────────────────

  async function handleSnooze() {
    if (acting) return;
    setActing(true);
    onDismiss(id);
    try {
      const snoozeUntil = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const notifRef = doc(db, 'users', userId, 'notifications', id);
      await updateDoc(notifRef, { read: true });

      if (contactId) {
        await updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
          snoozed_until: snoozeUntil
        });
      }
    } catch (err) {
      console.error('[FollowUpCard] Snooze failed:', err);
      // onSnapshot will re-render the card if the write failed
    }
  }

  return (
    <div className="follow-up-card">
      {/* Header row */}
      <div className="follow-up-card-header">
        <div className="follow-up-card-type">
          <span className="follow-up-card-type-dot">⚡</span>
          <span className="follow-up-card-type-label">FOLLOW UP</span>
        </div>
        <button
          className="follow-up-snooze-btn"
          onClick={handleSnooze}
          disabled={acting}
          title="Snooze 7 days"
        >
          Snooze
        </button>
      </div>

      {/* Contact info */}
      <div className="follow-up-card-contact">
        <div className="follow-up-card-name">{contactName || 'Unknown Contact'}</div>
        <div className="follow-up-card-meta">
          {companyName && <span>{companyName}</span>}
          {companyName && days != null && <span className="follow-up-meta-dot">·</span>}
          {days != null && <span>{days}d since last touch</span>}
        </div>
      </div>

      {/* Barry note */}
      <div className="follow-up-card-barry-note">
        <span className="follow-up-barry-bear">🐻</span>
        <p className="follow-up-barry-text">"{note}"</p>
      </div>

      {/* Actions */}
      <div className="follow-up-card-actions">
        <button
          className="follow-up-btn-draft"
          onClick={handleDraftFollowUp}
          disabled={acting || (drafting && !draftError)}
        >
          {drafting && !draftBody && !draftError ? 'Drafting…' : 'Draft Follow-Up'}
        </button>
        <button
          className="follow-up-btn-done"
          onClick={handleMarkDone}
          disabled={acting}
        >
          Mark as Done
        </button>
      </div>

      {/* Draft error */}
      {draftError && (
        <p className="follow-up-draft-error">{draftError}</p>
      )}

      {/* Inline EmailDraftCard once draft is ready */}
      {draftBody && (
        <div className="follow-up-email-draft">
          <EmailDraftCard
            subject={draftSubject}
            body={draftBody}
            preamble={null}
            userId={userId}
            contactName={contactName || null}
            theme="light"
          />
        </div>
      )}
    </div>
  );
}
