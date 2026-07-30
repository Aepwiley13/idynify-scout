/**
 * QuickEngageDrawer — engage a contact without leaving the screen you are on.
 *
 * Quick Engage is a contextual ACTION, not a destination. It has no route, it
 * does not touch global navigation, and it never unmounts what is underneath —
 * so closing it returns the user to their exact prior context: same Scout
 * filters, same scroll position, same selection, nothing rebuilt.
 *
 * Send path: executeSendAction() in utils/sendActionResolver.js. That is the
 * product's single communication entry point — it resolves real send vs native
 * handoff, logs the activity and timeline event, advances the contact state
 * machine and sets the follow-up reminder. This drawer adds NO new send path.
 *
 * Truth in result states is inherited from the resolver and surfaced verbatim:
 *   SENT        → confirmed externally
 *   OPENED      → handed off to a native app
 *   PREPARED    → draft created
 *   FAILED      → and why
 *   UNAVAILABLE → and what is missing
 * No false-positive success states.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Mail, MessageSquare, Phone, Linkedin,
  Loader2, CheckCircle2, ExternalLink, AlertTriangle, ArrowUpRight,
} from 'lucide-react';
import { useShell, useShellAction } from '../../context/ShellContext';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import {
  executeSendAction,
  resolveSendMethod,
  SEND_RESULT,
  CHANNELS,
} from '../../utils/sendActionResolver';
import './QuickEngageDrawer.css';

const CHANNEL_OPTIONS = [
  { id: CHANNELS.EMAIL,    label: 'Email',    Icon: Mail,          needsBody: true,  needsSubject: true  },
  { id: CHANNELS.TEXT,     label: 'Text',     Icon: MessageSquare, needsBody: true,  needsSubject: false },
  { id: CHANNELS.LINKEDIN, label: 'LinkedIn', Icon: Linkedin,      needsBody: true,  needsSubject: false },
  { id: CHANNELS.CALL,     label: 'Call',     Icon: Phone,         needsBody: false, needsSubject: false },
];

function contactName(contact) {
  if (!contact) return 'this contact';
  const composed = [contact.firstName ?? contact.first_name, contact.lastName ?? contact.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return composed || contact.name || contact.email || 'this contact';
}

export default function QuickEngageDrawer() {
  const navigate = useNavigate();
  const { quickEngage, closeQuickEngage, announce } = useShell();
  const contact = quickEngage?.contact;

  // Tells Barry the user is preparing an engagement, per the Phase 7 contract.
  useShellAction('quick_engage');

  const [channel, setChannel] = useState(quickEngage?.channel || CHANNELS.EMAIL);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [availability, setAvailability] = useState({});
  const [status, setStatus] = useState({ state: 'idle' });

  const panelRef = useRef(null);
  const firstFieldRef = useRef(null);

  const activeChannel = useMemo(
    () => CHANNEL_OPTIONS.find(c => c.id === channel) || CHANNEL_OPTIONS[0],
    [channel]
  );

  // Resolve what each channel can actually do for THIS contact, so the drawer
  // states "Gmail not connected — will open Gmail" up front rather than after
  // the user has written a message.
  useEffect(() => {
    let cancelled = false;
    const user = getEffectiveUser();
    if (!user || !contact) return undefined;

    (async () => {
      const entries = await Promise.all(
        CHANNEL_OPTIONS.map(async (opt) => {
          try {
            const res = await resolveSendMethod(opt.id, user.uid, contact);
            return [opt.id, res];
          } catch {
            return [opt.id, { method: 'disabled', reason: 'Unavailable' }];
          }
        })
      );
      if (!cancelled) setAvailability(Object.fromEntries(entries));
    })();

    return () => { cancelled = true; };
  }, [contact]);

  // Escape closes. Focus moves in on open and is restored by closeQuickEngage.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeQuickEngage(); };
    document.addEventListener('keydown', onKey);
    firstFieldRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [closeQuickEngage]);

  if (!contact) return null;

  const name = contactName(contact);
  const resolution = availability[channel];
  const disabled = resolution?.method === 'disabled';
  const willHandOff = resolution?.method === 'native';

  const canSend =
    !disabled &&
    status.state !== 'sending' &&
    (!activeChannel.needsBody || body.trim().length > 0) &&
    (!activeChannel.needsSubject || subject.trim().length > 0);

  async function handleSend() {
    const user = getEffectiveUser();
    if (!user) {
      setStatus({ state: 'failed', message: 'Session expired — please refresh.' });
      return;
    }

    setStatus({ state: 'sending' });

    try {
      const result = await executeSendAction({
        channel,
        userId: user.uid,
        contact,
        subject: activeChannel.needsSubject ? subject : null,
        body: activeChannel.needsBody ? body : null,
        userIntent: 'quick_engage',
        engagementIntent: 'quick_engage',
      });

      if (result.result === SEND_RESULT.SENT) {
        setStatus({ state: 'sent', message: result.message || 'Sent.' });
        announce({
          message: `${activeChannel.label} sent to ${name}.`,
          detail: 'Follow-up reminder set for 3 days.',
        });
      } else if (result.result === SEND_RESULT.OPENED) {
        setStatus({ state: 'opened', message: result.message || 'Handed off to your app.' });
        announce({
          message: `${activeChannel.label} handed off for ${name}.`,
          detail: result.message || null,
        });
      } else if (result.result === SEND_RESULT.PREPARED) {
        setStatus({ state: 'opened', message: result.message || 'Draft prepared.' });
      } else if (result.result === SEND_RESULT.UNAVAILABLE) {
        setStatus({ state: 'failed', message: result.reason || 'That channel is unavailable.' });
      } else {
        setStatus({ state: 'failed', message: result.error || 'Send failed. Nothing was sent.' });
      }
    } catch (err) {
      console.error('[QuickEngageDrawer] send failed:', err);
      setStatus({ state: 'failed', message: err.message || 'Send failed. Nothing was sent.' });
    }
  }

  const terminal = status.state === 'sent' || status.state === 'opened';

  return (
    <>
      <div className="quick-engage-backdrop" onClick={closeQuickEngage} />

      <aside
        ref={panelRef}
        className="quick-engage-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Quick Engage — ${name}`}
      >
        <header className="quick-engage-header">
          <div className="quick-engage-heading">
            <p className="quick-engage-eyebrow">Quick Engage</p>
            {/* The person is named in the heading and again on the send button.
                "Selected person remains unambiguous throughout." */}
            <h2 className="quick-engage-title">{name}</h2>
            {(contact.title || contact.company_name) && (
              <p className="quick-engage-subtitle">
                {[contact.title, contact.company_name].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <button
            type="button"
            className="quick-engage-close"
            onClick={closeQuickEngage}
            aria-label="Close Quick Engage"
          >
            <X size={18} />
          </button>
        </header>

        <div className="quick-engage-channels" role="tablist" aria-label="Channel">
          {CHANNEL_OPTIONS.map(opt => {
            const res = availability[opt.id];
            const isDisabled = res?.method === 'disabled';
            const selected = channel === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={isDisabled}
                title={isDisabled ? res?.reason : opt.label}
                className={`quick-engage-channel ${selected ? 'selected' : ''}`}
                onClick={() => { setChannel(opt.id); setStatus({ state: 'idle' }); }}
              >
                <opt.Icon size={15} aria-hidden="true" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <div className="quick-engage-body">
          {disabled && (
            <p className="quick-engage-notice warn">
              <AlertTriangle size={14} aria-hidden="true" />
              {resolution?.reason || 'This channel is unavailable for this contact.'}
            </p>
          )}

          {!disabled && willHandOff && (
            <p className="quick-engage-notice">
              <ExternalLink size={14} aria-hidden="true" />
              {resolution?.fallbackReason
                ? `${resolution.fallbackReason} — this will open your app with the message ready.`
                : 'This will open your app with the message ready.'}
            </p>
          )}

          {!disabled && activeChannel.needsSubject && (
            <label className="quick-engage-field">
              <span>Subject</span>
              <input
                ref={firstFieldRef}
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={`Quick note for ${name}`}
                disabled={terminal || status.state === 'sending'}
              />
            </label>
          )}

          {!disabled && activeChannel.needsBody && (
            <label className="quick-engage-field grow">
              <span>Message</span>
              <textarea
                ref={activeChannel.needsSubject ? undefined : firstFieldRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Write your message…"
                rows={8}
                disabled={terminal || status.state === 'sending'}
              />
            </label>
          )}

          {!disabled && channel === CHANNELS.CALL && (
            <p className="quick-engage-notice">
              <Phone size={14} aria-hidden="true" />
              Opens your dialler for {contact.phone || contact.phone_mobile}.
            </p>
          )}

          {/* The AI composer, message angles and full history live on the
              Contact Profile. Quick Engage deliberately does not duplicate
              them — it links to them. */}
          <button
            type="button"
            className="quick-engage-fullview"
            onClick={() => { closeQuickEngage(); navigate(`/scout/contact/${contact.id}`); }}
          >
            Open full profile and message composer
            <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </div>

        <footer className="quick-engage-footer">
          {status.state === 'failed' && (
            <p className="quick-engage-status failed" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              {status.message}
            </p>
          )}
          {terminal && (
            <p className="quick-engage-status ok" role="status">
              <CheckCircle2 size={14} aria-hidden="true" />
              {status.message}
            </p>
          )}

          <div className="quick-engage-actions">
            <button type="button" className="quick-engage-btn ghost" onClick={closeQuickEngage}>
              {terminal ? 'Done' : 'Cancel'}
            </button>
            {!terminal && (
              <button
                type="button"
                className="quick-engage-btn primary"
                onClick={handleSend}
                disabled={!canSend}
              >
                {status.state === 'sending' ? (
                  <>
                    <Loader2 size={14} className="spin" aria-hidden="true" />
                    Sending…
                  </>
                ) : (
                  <>
                    {willHandOff ? `Open ${activeChannel.label}` : `Send ${activeChannel.label}`}
                    <span className="quick-engage-btn-target"> to {name}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </footer>
      </aside>
    </>
  );
}
