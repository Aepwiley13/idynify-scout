import { useState, useRef } from 'react';
import { X, Send, ChevronLeft, Loader, AlertTriangle, Mail, Sparkles, Edit3, CheckCircle } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';

const MAX_CONTACTS = 25;

function getContactEmail(c) {
  return c.email || c.work_email || '';
}

function getContactName(c) {
  return c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
}

export default function BulkComposeModal({ contacts, onClose }) {
  const T = useT();
  const [step, setStep] = useState(1);

  // Step 1 state
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [personalizeWithBarry, setPersonalizeWithBarry] = useState(true);

  // Step 2 state
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState(null); // [{ contact, openingLine, editable }]
  const [sendStarted, setSendStarted] = useState(false);

  // Step 3 state
  const [sendPayload, setSendPayload] = useState(null);

  const contactsWithEmail = contacts.filter(c => getContactEmail(c));
  const contactsWithoutEmail = contacts.filter(c => !getContactEmail(c));

  async function handlePreview() {
    setLoading(true);
    try {
      if (personalizeWithBarry) {
        const res = await fetch('/.netlify/functions/barryBulkPersonalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contacts: contacts.map(c => ({
              contactId: c.id,
              firstName: c.firstName || c.name?.split(' ')[0] || '',
              lastName: c.lastName || c.name?.split(' ').slice(1).join(' ') || '',
              title: c.title || '',
              company: c.company_name || c.company || '',
              industry: c.industry || '',
              job_start_date: c.job_start_date || null,
              barryContext: c.barryContext || null,
            })),
            sharedBody: body,
          }),
        });
        const data = await res.json();
        const resultsMap = {};
        if (data.results) {
          data.results.forEach(r => { resultsMap[r.contactId] = r; });
        }
        setPreviews(contacts.map(c => {
          const result = resultsMap[c.id];
          return {
            contact: c,
            openingLine: result?.success ? (result.openingLine || '') : '',
            failed: result ? !result.success : true,
          };
        }));
      } else {
        setPreviews(contacts.map(c => ({
          contact: c,
          openingLine: '',
          failed: false,
        })));
      }
      setStep(2);
    } catch {
      setPreviews(contacts.map(c => ({
        contact: c,
        openingLine: '',
        failed: true,
      })));
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  function updateOpeningLine(contactId, newLine) {
    setPreviews(prev => prev.map(p =>
      p.contact.id === contactId ? { ...p, openingLine: newLine } : p
    ));
  }

  function handleSend() {
    const payload = previews
      .filter(p => getContactEmail(p.contact))
      .map(p => ({
        contact: p.contact,
        subject,
        body: p.openingLine ? `${p.openingLine}\n\n${body}` : body,
      }));
    setSendPayload(payload);
    setSendStarted(true);
    setStep(3);
  }

  function handleClose() {
    if (step === 3 && sendStarted) {
      if (!window.confirm('Sends in progress — closing will not cancel emails already sent.')) return;
    }
    onClose();
  }

  const sendableCount = previews
    ? previews.filter(p => getContactEmail(p.contact)).length
    : contactsWithEmail.length;

  // ─── Styles ───
  const overlay = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: 16,
    animation: 'fadeIn 0.2s ease-out',
  };

  const container = {
    background: T.cardBg,
    borderRadius: 16,
    width: '100%', maxWidth: 680,
    maxHeight: '85vh',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: `0 20px 60px rgba(0,0,0,0.3)`,
    border: `1px solid ${T.border}`,
    animation: 'slideUp 0.3s ease-out',
  };

  const headerStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: `1px solid ${T.border}`,
  };

  const bodySection = {
    flex: 1, overflowY: 'auto', padding: '20px',
  };

  const footerStyle = {
    padding: '14px 20px',
    borderTop: `1px solid ${T.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px',
    borderRadius: 10, border: `1px solid ${T.border}`,
    background: T.surface, color: T.text,
    fontSize: 14, outline: 'none',
    boxSizing: 'border-box',
  };

  const btnPrimary = {
    padding: '8px 20px', borderRadius: 10, border: 'none',
    background: `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.cyan})`,
    color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
    opacity: 1,
  };

  const btnSecondary = {
    padding: '8px 16px', borderRadius: 10,
    border: `1px solid ${T.border}`,
    background: 'transparent', color: T.textMuted,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5,
  };

  const stepLabels = ['Compose', 'Preview', 'Sending'];

  return (
    <div style={overlay} onClick={handleClose}>
      <div style={container} onClick={e => e.stopPropagation()}>
        {/* ─── Header ─── */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {step === 2 && (
              <button onClick={() => setStep(1)} style={{ ...btnSecondary, padding: '4px 8px', border: 'none' }}>
                <ChevronLeft size={16} />
              </button>
            )}
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
                Compose Bulk Email
              </div>
              <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
                Step {step} of 3 — {stepLabels[step - 1]} · {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'rgba(0,0,0,0.3)', border: 'none',
              borderRadius: 8, padding: 6, cursor: 'pointer',
              color: T.textFaint, display: 'flex',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ─── Step 1: Compose ─── */}
        {step === 1 && (
          <>
            <div style={bodySection}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 6 }}>
                Subject
              </label>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Email subject line"
                style={inputStyle}
              />

              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 6, marginTop: 18 }}>
                Email Body
              </label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Write the shared email body that all contacts will receive..."
                rows={8}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 120, fontFamily: 'inherit' }}
              />

              <div style={{
                marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderRadius: 10,
                background: personalizeWithBarry ? `${BRAND.cyan}10` : T.surface,
                border: `1px solid ${personalizeWithBarry ? `${BRAND.cyan}40` : T.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={16} style={{ color: BRAND.cyan }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Personalize with Barry</div>
                    <div style={{ fontSize: 11, color: T.textFaint }}>Barry generates a unique opening line per contact</div>
                  </div>
                </div>
                <button
                  onClick={() => setPersonalizeWithBarry(p => !p)}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: personalizeWithBarry ? BRAND.cyan : T.border,
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3,
                    left: personalizeWithBarry ? 23 : 3,
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {contactsWithoutEmail.length > 0 && (
                <div style={{
                  marginTop: 14, padding: '10px 14px', borderRadius: 10,
                  background: `${BRAND.pink}10`, border: `1px solid ${BRAND.pink}30`,
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: BRAND.pink,
                }}>
                  <AlertTriangle size={14} />
                  {contactsWithoutEmail.length} contact{contactsWithoutEmail.length !== 1 ? 's' : ''} missing email — will be excluded
                </div>
              )}
            </div>

            <div style={footerStyle}>
              <button onClick={handleClose} style={btnSecondary}>Cancel</button>
              <button
                onClick={handlePreview}
                disabled={!subject.trim() || !body.trim() || loading}
                style={{
                  ...btnPrimary,
                  opacity: (!subject.trim() || !body.trim() || loading) ? 0.5 : 1,
                  cursor: (!subject.trim() || !body.trim() || loading) ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={14} />}
                {loading ? 'Generating...' : 'Preview'}
              </button>
            </div>
          </>
        )}

        {/* ─── Step 2: Preview ─── */}
        {step === 2 && previews && (
          <>
            <div style={bodySection}>
              {contactsWithoutEmail.length > 0 && (
                <div style={{
                  marginBottom: 14, padding: '10px 14px', borderRadius: 10,
                  background: `${BRAND.pink}10`, border: `1px solid ${BRAND.pink}30`,
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: BRAND.pink,
                }}>
                  <AlertTriangle size={14} />
                  {contactsWithoutEmail.length} contact{contactsWithoutEmail.length !== 1 ? 's' : ''} without email will be skipped
                </div>
              )}

              <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 12 }}>
                Subject: <strong style={{ color: T.text }}>{subject}</strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {previews.map(p => {
                  const email = getContactEmail(p.contact);
                  const name = getContactName(p.contact);
                  const noEmail = !email;

                  return (
                    <div
                      key={p.contact.id}
                      style={{
                        borderRadius: 10, padding: '14px 16px',
                        border: `1px solid ${noEmail ? `${BRAND.pink}40` : T.border}`,
                        background: noEmail ? `${BRAND.pink}06` : T.surface,
                        opacity: noEmail ? 0.6 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{name}</div>
                          <div style={{ fontSize: 11, color: noEmail ? BRAND.pink : T.textFaint }}>
                            {noEmail ? 'No email address' : email}
                          </div>
                        </div>
                        {noEmail && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, color: BRAND.pink,
                            background: `${BRAND.pink}15`, padding: '3px 8px', borderRadius: 6,
                          }}>
                            Excluded
                          </span>
                        )}
                      </div>

                      {!noEmail && (
                        <div style={{
                          background: T.cardBg, borderRadius: 8, padding: '10px 12px',
                          border: `1px solid ${T.border}`, fontSize: 13, color: T.text,
                          lineHeight: 1.5,
                        }}>
                          {personalizeWithBarry && p.openingLine !== undefined && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                <Sparkles size={11} style={{ color: BRAND.cyan }} />
                                <span style={{ fontSize: 10, fontWeight: 600, color: BRAND.cyan }}>Barry's opening</span>
                                <button
                                  onClick={() => {
                                    const el = document.getElementById(`opening-${p.contact.id}`);
                                    if (el) el.focus();
                                  }}
                                  style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: T.textFaint, padding: 0, display: 'flex',
                                  }}
                                >
                                  <Edit3 size={10} />
                                </button>
                              </div>
                              <textarea
                                id={`opening-${p.contact.id}`}
                                value={p.openingLine}
                                onChange={e => updateOpeningLine(p.contact.id, e.target.value)}
                                rows={2}
                                style={{
                                  width: '100%', padding: '6px 8px', borderRadius: 6,
                                  border: `1px solid ${BRAND.cyan}30`, background: `${BRAND.cyan}06`,
                                  color: T.text, fontSize: 13, resize: 'vertical',
                                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                                }}
                              />
                            </div>
                          )}
                          <div style={{ whiteSpace: 'pre-wrap', color: T.textMuted }}>{body}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={footerStyle}>
              <button onClick={() => setStep(1)} style={btnSecondary}>
                <ChevronLeft size={14} /> Edit
              </button>
              <button
                onClick={handleSend}
                disabled={sendableCount === 0}
                style={{
                  ...btnPrimary,
                  opacity: sendableCount === 0 ? 0.5 : 1,
                  cursor: sendableCount === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <Send size={14} />
                Send to {sendableCount} contact{sendableCount !== 1 ? 's' : ''}
              </button>
            </div>
          </>
        )}

        {/* ─── Step 3: Send (placeholder for BulkSendExecutor) ─── */}
        {step === 3 && (
          <div style={bodySection}>
            <BulkSendExecutorPlaceholder
              payload={sendPayload}
              T={T}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BulkSendExecutorPlaceholder({ payload, T }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '40px 20px', textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: `${BRAND.cyan}15`, display: 'flex',
        alignItems: 'center', justifyContent: 'center', marginBottom: 16,
      }}>
        <Send size={24} style={{ color: BRAND.cyan }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
        Ready to Send
      </div>
      <div style={{ fontSize: 13, color: T.textMuted, maxWidth: 380, lineHeight: 1.5 }}>
        BulkSendExecutor will handle sending {payload?.length || 0} email{payload?.length !== 1 ? 's' : ''} here.
        This component will be wired in when Workstream C is complete.
      </div>
      <div style={{
        marginTop: 20, padding: '10px 16px', borderRadius: 8,
        background: T.surface, border: `1px solid ${T.border}`,
        fontSize: 12, color: T.textFaint,
      }}>
        Payload: {payload?.length || 0} contacts with subject and personalized body ready
      </div>
    </div>
  );
}
