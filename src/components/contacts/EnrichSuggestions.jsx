/**
 * EnrichSuggestions — what Barry Enrich found that differs from the contact.
 *
 * Enrich never overwrites a title or company the contact already has
 * (src/utils/contactProtection.js). A different title is offered here with
 * one tap; taking it is the user's choice and is recorded as such. A
 * different company is shown for information only: changing it means
 * changing which company the person belongs to. An email found on the
 * company website is offered too (only when the contact has none): it may be
 * a shared inbox, so it is never filled on its own. Same pattern as the
 * LinkedIn confirm screen (src/components/capture/FindLinkedIn.jsx).
 */
import { useState } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';

export default function EnrichSuggestions({ suggestions, onAcceptTitle, onAcceptEmail, onDismiss }) {
  const T = useT();
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [emailState, setEmailState] = useState(null);   // accepting | accepted | failed

  const title = suggestions?.find(s => s.field === 'title' && s.actionable);
  const company = suggestions?.find(s => s.field === 'company');
  const email = onAcceptEmail ? suggestions?.find(s => s.field === 'email' && s.actionable) : null;
  if (!title && !company && !email) return null;

  async function acceptEmail() {
    setEmailState('accepting');
    try {
      await onAcceptEmail(email);
      setEmailState('accepted');
    } catch {
      setEmailState('failed');
    }
  }

  async function accept() {
    setAccepting(true);
    setFailed(false);
    try {
      await onAcceptTitle(title);
      setAccepted(true);
    } catch (err) {
      console.error('[EnrichSuggestions] accept title failed:', err);
      setFailed(true);
    } finally {
      setAccepting(false);
    }
  }

  const box = { border: `1px solid ${T.border}`, borderRadius: 12, padding: 12, background: T.cardBg, display: 'flex', flexDirection: 'column', gap: 8 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }} data-testid="enrich-suggestions">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>Barry found something different</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', padding: 4 }}>
          <X size={16} />
        </button>
      </div>
      {title && (
        <div style={box} data-testid="enrich-title-suggestion">
          <div style={{ fontSize: 14, color: T.text }}>
            Barry&apos;s lookup lists the title as <strong>{title.suggested}</strong>. This contact says <strong>{title.current}</strong>.
          </div>
          {accepted ? (
            <div style={{ fontSize: 13, color: '#16a34a', display: 'flex', gap: 6, alignItems: 'center' }}><CheckCircle size={14} /> Title updated</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" disabled={accepting} onClick={accept} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.cardBg, color: T.text, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Use this title
              </button>
              <span style={{ fontSize: 13, color: T.textMuted }}>or keep this contact&apos;s</span>
            </div>
          )}
          {failed && <p role="alert" style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>Couldn&apos;t update the title. Try again.</p>}
        </div>
      )}
      {email && (
        <div style={box} data-testid="enrich-email-suggestion">
          <div style={{ fontSize: 14, color: T.text, overflowWrap: 'anywhere' }}>
            Found on their company website: <strong>{email.suggested}</strong>. It may be a shared inbox rather than theirs.
          </div>
          {emailState === 'accepted' ? (
            <div style={{ fontSize: 13, color: '#16a34a', display: 'flex', gap: 6, alignItems: 'center' }}><CheckCircle size={14} /> Email added</div>
          ) : (
            <button type="button" disabled={emailState === 'accepting'} onClick={acceptEmail} style={{ alignSelf: 'flex-start', padding: '8px 12px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.cardBg, color: T.text, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Use this email
            </button>
          )}
          {emailState === 'failed' && <p role="alert" style={{ fontSize: 13, color: '#dc2626', margin: 0 }}>Couldn&apos;t add the email. Try again.</p>}
        </div>
      )}
      {company && (
        <div style={box} data-testid="enrich-company-difference">
          <div style={{ fontSize: 14, color: T.text }}>
            Barry&apos;s lookup lists the company as <strong>{company.suggested}</strong>. This contact says <strong>{company.current}</strong>, and that stays.
          </div>
        </div>
      )}
    </div>
  );
}
