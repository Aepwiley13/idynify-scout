import { useState, useRef, useCallback } from 'react';
import { X, Send, ChevronLeft, Loader, AlertTriangle, Mail, Sparkles, Edit3, Paperclip, FileText, Upload, Users } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import BulkSendExecutor from './BulkSendExecutor';

const MAX_CONTACTS = 25;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function getContactEmail(c) {
  return c.email || c.work_email || '';
}

function getContactName(c) {
  return c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
}

function getFirstName(c) {
  return c.firstName || c.name?.split(' ')[0] || '';
}

function hasPersonalizeTag(text) {
  return /\{\{personalize\}\}/i.test(text);
}

function replacePersonalizeTags(template, replacement) {
  return template.replace(/\{\{personalize\}\}/gi, replacement);
}

export default function BulkComposeModal({ contacts, onClose }) {
  const T = useT();
  const [step, setStep] = useState(1);
  const [activePath, setActivePath] = useState('write_your_own');

  // ─── Path 1 state (Write your own) ───
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [personalizeWithBarry, setPersonalizeWithBarry] = useState(true);

  // ─── Path 2 state (Send with attachment) ───
  const [p2Subject, setP2Subject] = useState('');
  const [p2Body, setP2Body] = useState('');
  const [attachment, setAttachment] = useState(null); // { file, base64, filename, size }
  const [attachmentError, setAttachmentError] = useState(null);
  const [cc, setCc] = useState('');
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  // ─── Shared state ───
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState(null);
  const [sendStarted, setSendStarted] = useState(false);
  const [sendPayload, setSendPayload] = useState(null);

  const contactsWithEmail = contacts.filter(c => getContactEmail(c));
  const contactsWithoutEmail = contacts.filter(c => !getContactEmail(c));

  const isPath2 = activePath === 'send_with_attachment';
  const activeSubject = isPath2 ? p2Subject : subject;
  const activeBody = isPath2 ? p2Body : body;

  // ─── PDF upload handling ───
  function validateAndReadFile(file) {
    setAttachmentError(null);
    if (file.type !== 'application/pdf') {
      setAttachmentError('Only PDF files are accepted.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setAttachmentError(`File exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      setAttachment({ file, base64, filename: file.name, size: file.size });
    };
    reader.readAsDataURL(file);
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) validateAndReadFile(file);
    if (e.target) e.target.value = '';
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) validateAndReadFile(file);
  }, []);

  const handleDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setDragOver(false), []);

  // ─── Preview (Path 1) ───
  async function handlePreviewPath1() {
    setLoading(true);
    try {
      if (personalizeWithBarry) {
        const user = getEffectiveUser();
        const authToken = await user.getIdToken();
        const res = await fetch('/.netlify/functions/barryBulkPersonalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
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
        setPreviews(contacts.map(c => ({ contact: c, openingLine: '', failed: false })));
      }
      setStep(2);
    } catch {
      setPreviews(contacts.map(c => ({ contact: c, openingLine: '', failed: true })));
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  // ─── Preview (Path 2) ───
  async function handlePreviewPath2() {
    setLoading(true);
    try {
      const hasTag = hasPersonalizeTag(p2Body);
      if (hasTag) {
        const user = getEffectiveUser();
        const authToken = await user.getIdToken();
        const res = await fetch('/.netlify/functions/barryBulkPersonalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            mode: 'inline_personalize',
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
            sharedBody: p2Body,
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
        setPreviews(contacts.map(c => ({ contact: c, openingLine: '', failed: false })));
      }
      setStep(2);
    } catch {
      setPreviews(contacts.map(c => ({ contact: c, openingLine: '', failed: true })));
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  function handlePreview() {
    if (isPath2) handlePreviewPath2();
    else handlePreviewPath1();
  }

  function updateOpeningLine(contactId, newLine) {
    setPreviews(prev => prev.map(p =>
      p.contact.id === contactId ? { ...p, openingLine: newLine } : p
    ));
  }

  // ─── Build send payload ───
  function handleSend() {
    let payload;
    if (isPath2) {
      const hasTag = hasPersonalizeTag(p2Body);
      payload = previews
        .filter(p => getContactEmail(p.contact))
        .map(p => {
          let finalBody = p2Body;
          if (hasTag && p.openingLine) {
            finalBody = replacePersonalizeTags(p2Body, p.openingLine);
          }
          const item = { contact: p.contact, subject: p2Subject, body: finalBody };
          if (attachment) {
            item.attachment = { data: attachment.base64, filename: attachment.filename, mimeType: 'application/pdf' };
          }
          if (cc.trim()) item.cc = cc.trim();
          return item;
        });
    } else {
      payload = previews
        .filter(p => getContactEmail(p.contact))
        .map(p => {
          const greeting = `Hi ${getFirstName(p.contact)},`;
          const parts = [greeting];
          if (p.openingLine) parts.push(p.openingLine);
          parts.push(body);
          return { contact: p.contact, subject, body: parts.join('\n\n') };
        });
    }
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

  // ─── Compose validity ───
  const path1Valid = subject.trim() && body.trim();
  const path2Valid = p2Body.trim();
  const composeValid = isPath2 ? path2Valid : path1Valid;

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
    width: '100%', maxWidth: 720,
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

  const bodySection = { flex: 1, overflowY: 'auto', padding: '20px' };

  const footerStyle = {
    padding: '14px 20px',
    borderTop: `1px solid ${T.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px',
    borderRadius: 10, border: `1px solid ${T.border}`,
    background: T.surface, color: T.text,
    fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  const btnPrimary = {
    padding: '8px 20px', borderRadius: 10, border: 'none',
    background: `linear-gradient(135deg, ${BRAND.pink}, ${BRAND.cyan})`,
    color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
  };

  const btnSecondary = {
    padding: '8px 16px', borderRadius: 10,
    border: `1px solid ${T.border}`,
    background: 'transparent', color: T.textMuted,
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 5,
  };

  const sectionLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: T.textMuted, marginBottom: 6 };

  function pathCardStyle(active) {
    return {
      flex: 1, padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
      border: `2px solid ${active ? BRAND.pink : T.border}`,
      background: active ? `${BRAND.pink}08` : T.surface,
      transition: 'all 0.15s',
    };
  }

  const stepLabels = ['Compose', 'Preview', 'Sending'];

  // ─── Render helpers for preview ───
  function renderPreviewBody(p) {
    if (isPath2) {
      const hasTag = hasPersonalizeTag(p2Body);
      let displayBody = p2Body;
      if (hasTag && p.openingLine) {
        displayBody = replacePersonalizeTags(p2Body, p.openingLine);
      }
      return <div style={{ whiteSpace: 'pre-wrap', color: T.textMuted }}>{displayBody}</div>;
    }
    return (
      <>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Hi {getFirstName(p.contact)},</div>
        {personalizeWithBarry && p.openingLine !== undefined && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Sparkles size={11} style={{ color: BRAND.cyan }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: BRAND.cyan }}>Barry's opening</span>
              <button
                onClick={() => { document.getElementById(`opening-${p.contact.id}`)?.focus(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, padding: 0, display: 'flex' }}
              ><Edit3 size={10} /></button>
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
      </>
    );
  }

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
            style={{ background: 'rgba(0,0,0,0.3)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: T.textFaint, display: 'flex' }}
          ><X size={18} /></button>
        </div>

        {/* ─── Step 1: Compose ─── */}
        {step === 1 && (
          <>
            <div style={bodySection}>
              {/* ─── Path Selector ─── */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <div style={pathCardStyle(activePath === 'write_your_own')} onClick={() => setActivePath('write_your_own')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Mail size={16} style={{ color: activePath === 'write_your_own' ? BRAND.pink : T.textFaint }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: activePath === 'write_your_own' ? BRAND.pink : T.text }}>Write your own</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.textFaint }}>Compose email with Barry opening lines</div>
                </div>
                <div style={pathCardStyle(activePath === 'send_with_attachment')} onClick={() => setActivePath('send_with_attachment')}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Paperclip size={16} style={{ color: activePath === 'send_with_attachment' ? BRAND.pink : T.textFaint }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: activePath === 'send_with_attachment' ? BRAND.pink : T.text }}>Send with attachment</span>
                  </div>
                  <div style={{ fontSize: 11, color: T.textFaint }}>Message + PDF + inline personalization</div>
                </div>
              </div>

              {/* ─── Path 1: Write your own ─── */}
              {activePath === 'write_your_own' && (
                <>
                  <label style={sectionLabel}>Subject</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject line" style={inputStyle} />

                  <label style={{ ...sectionLabel, marginTop: 18 }}>Email Body</label>
                  <textarea
                    value={body} onChange={e => setBody(e.target.value)}
                    placeholder="Write the shared email body that all contacts will receive..."
                    rows={8} style={{ ...inputStyle, resize: 'vertical', minHeight: 120, fontFamily: 'inherit' }}
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
                        left: personalizeWithBarry ? 23 : 3, transition: 'left 0.2s',
                      }} />
                    </button>
                  </div>
                </>
              )}

              {/* ─── Path 2: Send with attachment ─── */}
              {activePath === 'send_with_attachment' && (
                <>
                  {/* Section A — Message */}
                  <label style={sectionLabel}>Subject (optional)</label>
                  <input value={p2Subject} onChange={e => setP2Subject(e.target.value)} placeholder="Email subject line" style={inputStyle} />

                  <div style={{ marginTop: 18 }}>
                    <label style={sectionLabel}>Message</label>
                    <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 6, lineHeight: 1.5 }}>
                      Type your message. Where you want Barry to personalize, type <code style={{ background: `${BRAND.cyan}15`, padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>{'{{personalize}}'}</code> — Barry will replace it with something specific to each person.
                    </div>
                    <div style={{
                      fontSize: 11, color: T.textFaint, fontStyle: 'italic', marginBottom: 8,
                      padding: '6px 10px', borderRadius: 6, background: T.surface, border: `1px solid ${T.border}`,
                    }}>
                      Example: "Hi {'{{personalize}}'}, I wanted to reach out because..."
                    </div>
                    <textarea
                      value={p2Body} onChange={e => setP2Body(e.target.value)}
                      placeholder="Write your message..."
                      rows={6} style={{ ...inputStyle, resize: 'vertical', minHeight: 100, fontFamily: 'inherit' }}
                    />
                    {hasPersonalizeTag(p2Body) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <Sparkles size={12} style={{ color: BRAND.cyan }} />
                        <span style={{ fontSize: 11, color: BRAND.cyan, fontWeight: 600 }}>
                          {'{{personalize}}'} detected — Barry will generate contact-specific text
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Section B — Attachment */}
                  <div style={{ marginTop: 18 }}>
                    <label style={sectionLabel}>Attachment (optional, PDF only, max 10MB)</label>
                    {!attachment ? (
                      <div
                        ref={dropZoneRef}
                        onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                        onClick={() => fileInputRef.current?.click()}
                        style={{
                          border: `2px dashed ${dragOver ? BRAND.cyan : T.border}`,
                          borderRadius: 10, padding: '20px 16px',
                          textAlign: 'center', cursor: 'pointer',
                          background: dragOver ? `${BRAND.cyan}06` : T.surface,
                          transition: 'all 0.15s',
                        }}
                      >
                        <Upload size={20} style={{ color: T.textFaint, marginBottom: 6 }} />
                        <div style={{ fontSize: 13, color: T.textMuted }}>Drop a PDF here or click to browse</div>
                        <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" onChange={handleFileSelect} style={{ display: 'none' }} />
                      </div>
                    ) : (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', borderRadius: 10,
                        background: T.surface, border: `1px solid ${T.border}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <FileText size={16} style={{ color: BRAND.pink }} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{attachment.filename}</div>
                            <div style={{ fontSize: 11, color: T.textFaint }}>{(attachment.size / 1024).toFixed(0)} KB</div>
                          </div>
                        </div>
                        <button
                          onClick={() => setAttachment(null)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, padding: 4, display: 'flex' }}
                        ><X size={14} /></button>
                      </div>
                    )}
                    {attachmentError && (
                      <div style={{ marginTop: 6, fontSize: 12, color: BRAND.pink, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertTriangle size={12} />{attachmentError}
                      </div>
                    )}
                  </div>

                  {/* Section C — CC */}
                  <div style={{ marginTop: 18 }}>
                    <label style={sectionLabel}>CC (optional)</label>
                    <input
                      value={cc} onChange={e => setCc(e.target.value)}
                      placeholder="cc@example.com"
                      type="email" style={inputStyle}
                    />
                  </div>

                  {/* Section D — Recipients */}
                  <div style={{ marginTop: 18 }}>
                    <label style={sectionLabel}>Recipients</label>
                    <div style={{
                      padding: '10px 14px', borderRadius: 10, background: T.surface, border: `1px solid ${T.border}`,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <Users size={14} style={{ color: T.textFaint }} />
                      <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{contacts.length}</span>
                      <span style={{ fontSize: 12, color: T.textFaint }}>contact{contacts.length !== 1 ? 's' : ''} selected</span>
                      {contactsWithEmail.length < contacts.length && (
                        <span style={{ fontSize: 11, color: BRAND.pink, marginLeft: 'auto' }}>
                          {contactsWithoutEmail.length} without email
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* ─── Missing email warning (both paths) ─── */}
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
                disabled={!composeValid || loading}
                style={{
                  ...btnPrimary,
                  opacity: (!composeValid || loading) ? 0.5 : 1,
                  cursor: (!composeValid || loading) ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={14} />}
                {loading ? 'Generating...' : (isPath2 ? 'Preview and Send' : 'Preview')}
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
                Subject: <strong style={{ color: T.text }}>{activeSubject || '(no subject)'}</strong>
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
                          <span style={{ fontSize: 10, fontWeight: 600, color: BRAND.pink, background: `${BRAND.pink}15`, padding: '3px 8px', borderRadius: 6 }}>
                            Excluded
                          </span>
                        )}
                      </div>

                      {!noEmail && (
                        <>
                          <div style={{
                            background: T.cardBg, borderRadius: 8, padding: '10px 12px',
                            border: `1px solid ${T.border}`, fontSize: 13, color: T.text,
                            lineHeight: 1.5,
                          }}>
                            {isPath2 && hasPersonalizeTag(p2Body) && p.openingLine !== undefined && (
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                  <Sparkles size={11} style={{ color: BRAND.cyan }} />
                                  <span style={{ fontSize: 10, fontWeight: 600, color: BRAND.cyan }}>Personalized text</span>
                                  <button
                                    onClick={() => { document.getElementById(`opening-${p.contact.id}`)?.focus(); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, padding: 0, display: 'flex' }}
                                  ><Edit3 size={10} /></button>
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
                            {renderPreviewBody(p)}
                          </div>

                          {/* Attachment & CC info (Path 2 only) */}
                          {isPath2 && (attachment || cc.trim()) && (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {attachment && (
                                <div style={{ fontSize: 11, color: T.textFaint, display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <Paperclip size={10} />PDF attached: {attachment.filename}
                                </div>
                              )}
                              {cc.trim() && (
                                <div style={{ fontSize: 11, color: T.textFaint, display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <Mail size={10} />CC: {cc.trim()}
                                </div>
                              )}
                            </div>
                          )}
                        </>
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

        {/* ─── Step 3: Send (BulkSendExecutor — Workstream C) ─── */}
        {step === 3 && (
          <div style={bodySection}>
            <BulkSendExecutor
              payload={sendPayload}
              T={T}
            />
          </div>
        )}
      </div>
    </div>
  );
}
