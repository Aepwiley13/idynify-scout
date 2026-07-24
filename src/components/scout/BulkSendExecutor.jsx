/**
 * BulkSendExecutor — Phase 1 Workstream C: Scout Bulk Send loop + progress UI.
 *
 * Receives the final array of { contact, subject, body } from BulkComposeModal
 * (Step 3) and sends to each contact sequentially through executeSendAction —
 * the unified send pipeline (auth, token refresh, timeline logging, state
 * machine, email_logs). Never calls gmail-send-* functions directly.
 *
 * Loop rules (Phase 1 brief):
 *   - Sequential, with a mandatory 1500ms delay between sends. Do not remove
 *     it — it protects the user's Gmail account from rate limiting/spam flags.
 *   - Per-contact status: pending → sending → sent | opened | failed.
 *   - OPENED (native mail app handoff) is a valid non-failure outcome.
 *   - The loop never aborts early — every contact gets attempted.
 *   - "Retry failed" re-runs the loop for failed contacts only.
 *   - No cancel button during an active send.
 */

import { useState, useEffect, useRef } from 'react';
import {
  Send, CheckCircle2, XCircle, Mail, Clock, Loader, RotateCcw, AlertTriangle,
} from 'lucide-react';
import { executeSendAction, CHANNELS, SEND_RESULT } from '../../utils/sendActionResolver';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';

export const SEND_DELAY_MS = 1500; // mandatory inter-send delay — do not remove

const GREEN = '#22c55e';
const RED   = '#ef4444';
const BLUE  = '#3b82f6';
const GRAY  = '#94a3b8';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const STATUS_CONFIG = {
  pending: { label: 'Pending',            color: GRAY,  icon: Clock },
  sending: { label: 'Sending…',           color: GRAY,  icon: Loader, spin: true },
  sent:    { label: 'Sent',               color: GREEN, icon: CheckCircle2 },
  opened:  { label: 'Opened in mail app', color: BLUE,  icon: Mail },
  failed:  { label: 'Failed',             color: RED,   icon: XCircle },
};

function getContactName(contact) {
  return contact.name
    || [contact.firstName, contact.lastName].filter(Boolean).join(' ')
    || contact.email
    || 'Unknown';
}

export default function BulkSendExecutor({ payload, T: themeProp }) {
  // Theme may arrive as a prop (Phase 1 modal) or from context (Phase 1.5 modal)
  const themeFromContext = useT();
  const T = themeProp || themeFromContext;
  // contactId → { status, reason }
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries((payload || []).map((p) => [p.contact.id, { status: 'pending' }]))
  );
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const startedRef = useRef(false); // guards StrictMode double-mount

  const items = payload || [];
  const total = items.length;

  function setContactStatus(contactId, status, reason = null) {
    setStatuses((prev) => ({ ...prev, [contactId]: { status, reason } }));
  }

  // attachment ({ data, filename, mimeType }) and cc (email string) are
  // optional per payload item (Phase 1.5 "Send with attachment" path) —
  // omitted for Phase 1 sends, which behave exactly as before.
  async function sendOne({ contact, subject, body, attachment, cc }) {
    setContactStatus(contact.id, 'sending');
    try {
      const userId = getEffectiveUser()?.uid;
      const res = await executeSendAction({
        channel: CHANNELS.EMAIL, userId, contact, subject, body,
        ...(attachment ? { attachment } : {}),
        ...(cc ? { cc } : {}),
      });

      switch (res?.result) {
        case SEND_RESULT.SENT:
          setContactStatus(contact.id, 'sent');
          break;
        case SEND_RESULT.OPENED:
          setContactStatus(contact.id, 'opened');
          break;
        case SEND_RESULT.UNAVAILABLE:
          setContactStatus(contact.id, 'failed', 'No email address on file');
          break;
        case SEND_RESULT.FAILED:
          setContactStatus(contact.id, 'failed', res.error || res.reason || 'Send failed');
          break;
        default:
          setContactStatus(contact.id, 'failed', `Unexpected result: ${res?.result || 'none'}`);
      }
    } catch (err) {
      // The loop must never abort — an unhandled error marks this contact
      // failed and the next contact still gets attempted.
      setContactStatus(contact.id, 'failed', err?.message || 'Send failed');
    }
  }

  async function runLoop(toSend) {
    setComplete(false);
    setRunning(true);
    for (let i = 0; i < toSend.length; i++) {
      await sendOne(toSend[i]);
      if (i < toSend.length - 1) await sleep(SEND_DELAY_MS);
    }
    setRunning(false);
    setComplete(true);
  }

  useEffect(() => {
    if (startedRef.current || items.length === 0) return;
    startedRef.current = true;
    runLoop(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetryFailed() {
    const failedItems = items.filter((p) => statuses[p.contact.id]?.status === 'failed');
    if (failedItems.length === 0 || running) return;
    setStatuses((prev) => {
      const next = { ...prev };
      failedItems.forEach((p) => { next[p.contact.id] = { status: 'pending' }; });
      return next;
    });
    runLoop(failedItems);
  }

  const counts = { sent: 0, opened: 0, failed: 0, done: 0 };
  items.forEach((p) => {
    const s = statuses[p.contact.id]?.status;
    if (s === 'sent') counts.sent++;
    if (s === 'opened') counts.opened++;
    if (s === 'failed') counts.failed++;
    if (s === 'sent' || s === 'opened' || s === 'failed') counts.done++;
  });
  const delivered = counts.sent + counts.opened;
  const failedContacts = items.filter((p) => statuses[p.contact.id]?.status === 'failed');

  if (total === 0) {
    return (
      <div style={{ padding: '30px 20px', textAlign: 'center', fontSize: 13, color: T.textMuted }}>
        No contacts to send to.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ─── Header + status message ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: complete ? `${GREEN}15` : `${BLUE}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Send size={16} style={{ color: complete ? GREEN : BLUE }} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            {complete
              ? `${delivered} sent, ${counts.failed} failed`
              : `Sending ${counts.done < total ? counts.done + 1 : total} of ${total}…`}
          </div>
          <div style={{ fontSize: 11, color: running ? RED : T.textFaint, fontWeight: running ? 600 : 400 }}>
            {running
              ? 'Sending — do not close this tab'
              : complete && counts.opened > 0
                ? `${counts.sent} via Gmail, ${counts.opened} opened in mail app`
                : complete ? 'All sends complete' : ''}
          </div>
        </div>
      </div>

      {/* ─── Progress bar: "X of Y sent" ─── */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: T.textFaint, marginBottom: 5,
        }}>
          <span>{delivered} of {total} sent</span>
          <span>{Math.round((counts.done / total) * 100)}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3, background: GREEN,
            width: `${(counts.done / total) * 100}%`,
            transition: 'width 0.3s ease',
          }} />
        </div>
      </div>

      {/* ─── Per-contact status list ─── */}
      <div style={{
        maxHeight: 300, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {items.map((p) => {
          const entry = statuses[p.contact.id] || { status: 'pending' };
          const sc = STATUS_CONFIG[entry.status] || STATUS_CONFIG.pending;
          const StatusIcon = sc.icon;
          return (
            <div
              key={p.contact.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 10,
                border: `1px solid ${entry.status === 'failed' ? `${RED}40` : T.border}`,
                background: entry.status === 'failed' ? `${RED}06` : T.surface,
              }}
            >
              <StatusIcon
                size={15}
                style={{
                  color: sc.color, flexShrink: 0,
                  ...(sc.spin ? { animation: 'spin 1s linear infinite' } : {}),
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 600, color: T.text,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {getContactName(p.contact)}
                </div>
                <div style={{
                  fontSize: 10, color: T.textFaint,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {p.contact.email || p.contact.work_email || ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: sc.color,
                  background: `${sc.color}12`, padding: '3px 8px', borderRadius: 8,
                }}>
                  {sc.label}
                </span>
                {entry.status === 'failed' && entry.reason && (
                  <div style={{ fontSize: 10, color: RED, marginTop: 3, maxWidth: 180 }}>
                    {entry.reason}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Completion summary ─── */}
      {complete && counts.failed > 0 && (
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          background: `${RED}08`, border: `1px solid ${RED}30`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 12, fontWeight: 600, color: RED, marginBottom: 6,
          }}>
            <AlertTriangle size={13} />
            {counts.failed} contact{counts.failed !== 1 ? 's' : ''} failed
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {failedContacts.map((p) => (
              <div key={p.contact.id} style={{ fontSize: 11, color: T.textMuted }}>
                <strong style={{ color: T.text }}>{getContactName(p.contact)}</strong>
                {' — '}{statuses[p.contact.id]?.reason || 'Unknown error'}
              </div>
            ))}
          </div>
          <button
            onClick={handleRetryFailed}
            style={{
              marginTop: 10, padding: '7px 14px', borderRadius: 8,
              border: `1px solid ${RED}`, background: `${RED}12`,
              color: RED, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <RotateCcw size={12} />
            Retry failed ({counts.failed})
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
