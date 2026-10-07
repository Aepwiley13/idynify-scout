import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Send, ChevronLeft, Loader, AlertTriangle, Mail, Sparkles, Edit3, Paperclip, FileText, Upload, Users, Search, Plus, Trash2 } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { checkGmailConnection, sendEmailViaGmail, SEND_RESULT } from '../../utils/sendActionResolver';
import { doc, setDoc, getDoc, deleteDoc, serverTimestamp, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import BulkSendExecutor from './BulkSendExecutor';
import { cleanBarryOpening, displayNameCase } from '../../utils/emailGreeting';
import {
  MAX_BULK_CONTACTS, PERSONALIZE_CHUNK, loadAlreadyDelivered,
  hasPersonalizeTag, firstNameFor, renderCadenceEmail, displayContactName,
} from '../../utils/cadenceSend';

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB — Netlify 6MB payload cap + base64 inflation

function getContactEmail(c) {
  return c.email || c.work_email || '';
}

function getContactName(c) {
  return displayContactName(c) || 'Unknown';
}

function toPersonalizeInput(c) {
  return {
    contactId: c.id,
    firstName: firstNameFor(c),
    lastName: displayNameCase(c.lastName || c.last_name || c.name?.split(' ').slice(1).join(' ') || ''),
    title: c.title || '',
    company: c.company_name || c.company || '',
    industry: c.industry || '',
    job_start_date: c.job_start_date || null,
    barryContext: c.barryContext || null,
    relationship_state: c.relationship_state || null,
    warmth_level: c.warmth_level || null,
    known_contact: c.known_contact || false,
  };
}

export default function BulkComposeModal({
  contacts: initialContacts, allContacts = [], onClose,
  initialSubject = '', initialBody = '',
  initialCc = '', initialPersonalize = true, initialCadenceName = '',
}) {
  const T = useT();
  const [step, setStep] = useState(1);

  // ─── Cadence name (shared across both paths, user-provided) ───
  const [cadenceName, setCadenceName] = useState(initialCadenceName);

  // ─── Selected contacts (mutable via in-modal search) ───
  const [selectedContacts, setSelectedContacts] = useState(initialContacts);

  // ─── Self-loaded contacts when allContacts prop is empty ───
  const [loadedContacts, setLoadedContacts] = useState([]);
  useEffect(() => {
    if (allContacts.length > 0) return;
    (async () => {
      try {
        const user = getEffectiveUser();
        if (!user) return;
        const snap = await getDocs(
          query(collection(db, 'users', user.uid, 'contacts'), orderBy('name'), limit(200))
        );
        setLoadedContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.warn('[BulkComposeModal] Failed to load contacts', err);
      }
    })();
  }, [allContacts.length]);
  const contactPool = allContacts.length > 0 ? allContacts : loadedContacts;

  // ─── In-modal search state ───
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

  // ─── The message ───
  // One subject and one body, whatever else is attached. (There used to be a
  // second, separate message for "Send with attachment"; switching to it to
  // attach a flyer discarded the message being reused.) `initialPath` from
  // older callers is no longer needed: a body containing {{personalize}}
  // renders the way that path did. See renderCadenceEmail.
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [personalizeWithBarry, setPersonalizeWithBarry] = useState(initialPersonalize);

  // ─── Optional additions ───
  const [attachment, setAttachment] = useState(null); // { file, base64, filename, size }
  const [attachmentError, setAttachmentError] = useState(null);
  const [cc, setCc] = useState(initialCc);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const bodyRef = useRef(null);

  // ─── Gmail connection status ───
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailChecking, setGmailChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const user = getEffectiveUser();
        if (!user) return;
        setGmailChecking(true);
        const status = await checkGmailConnection(user.uid);
        setGmailConnected(status.connected);
      } catch {
        setGmailConnected(false);
      } finally {
        setGmailChecking(false);
      }
    })();
  }, []);

  // ─── Shared state ───
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState(null);
  const [sendStarted, setSendStarted] = useState(false);
  const [sendComplete, setSendComplete] = useState(false);
  const [sendPayload, setSendPayload] = useState(null);
  const [personalizeProgress, setPersonalizeProgress] = useState(null); // { done, total }

  // ─── Resend guard ───
  const [alreadySentIds, setAlreadySentIds] = useState(() => new Set());
  const [includeAlreadySent, setIncludeAlreadySent] = useState(false);

  // ─── Send test ───
  const [testState, setTestState] = useState(null); // null | 'sending' | { ok, message }

  // ─── Draft state ───
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [pendingDraft, setPendingDraft] = useState(null);

  // ─── Check for draft on mount (do not auto-apply) ───
  useEffect(() => {
    (async () => {
      try {
        const user = getEffectiveUser();
        if (!user) { setDraftLoaded(true); return; }
        const draftRef = doc(db, 'users', user.uid, 'campaignDrafts', 'latest');
        const snap = await getDoc(draftRef);
        if (snap.exists()) {
          const d = snap.data();
          const age = Date.now() - (d.updatedAt?.toMillis?.() || 0);
          if (age < 7 * 24 * 60 * 60 * 1000) {
            setPendingDraft(d);
          }
        }
      } catch {
        // draft load failure is non-critical
      } finally {
        setDraftLoaded(true);
      }
    })();
  }, []);

  function resumeDraft() {
    if (!pendingDraft) return;
    const d = pendingDraft;
    // Drafts saved before the single message model kept the attachment-path
    // message in p2Subject/p2Body.
    const legacyP2 = d.activePath === 'send_with_attachment';
    const draftSubject = legacyP2 ? (d.p2Subject || d.subject) : d.subject;
    const draftBody = legacyP2 ? (d.p2Body || d.body) : d.body;
    if (draftSubject) setSubject(draftSubject);
    if (draftBody) setBody(draftBody);
    if (d.cc) setCc(d.cc);
    if (typeof d.personalizeWithBarry === 'boolean') setPersonalizeWithBarry(d.personalizeWithBarry);
    setPendingDraft(null);
  }

  function dismissDraft() {
    setPendingDraft(null);
    deleteDraft();
  }

  const contacts = selectedContacts;
  const contactsWithEmail = contacts.filter(c => getContactEmail(c));
  const contactsWithoutEmail = contacts.filter(c => !getContactEmail(c));

  // {{personalize}} in the body → Barry fills it in place, no auto greeting.
  const inlinePersonalize = hasPersonalizeTag(body);
  // Gmail is required to send attachments and CC (the native mail-app
  // fallback can carry neither).
  const needsGmail = Boolean(attachment) || Boolean(cc.trim());

  // ─── In-modal search: filter allContacts by query, exclude already selected ───
  const selectedIdSet = new Set(contacts.map(c => c.id));
  const availableContacts = contactPool.filter(c => !selectedIdSet.has(c.id));
  const searchResults = searchQuery.trim().length >= 2
    ? availableContacts
        .filter(c => {
          const q = searchQuery.toLowerCase();
          return (
            getContactName(c).toLowerCase().includes(q) ||
            (getContactEmail(c) || '').toLowerCase().includes(q) ||
            (c.company_name || c.company || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 8)
    : [];
  const browseList = contacts.length === 0 && searchQuery.trim().length < 2
    ? availableContacts.slice(0, 15)
    : [];

  function addContact(contact) {
    if (contacts.length >= MAX_BULK_CONTACTS) return;
    setSelectedContacts(prev => [...prev, contact]);
    setSearchQuery('');
  }

  function removeContact(contactId) {
    setSelectedContacts(prev => prev.filter(c => c.id !== contactId));
  }

  // ─── Insert template tag at cursor ───
  function insertTag(tag, ref, value, setter) {
    const textarea = ref.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newBody = value.slice(0, start) + tag + value.slice(end);
    setter(newBody);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  function insertPersonalizeTag() {
    insertTag('{{personalize}}', bodyRef, body, setBody);
  }

  // ─── PDF upload handling ───
  function validateAndReadFile(file) {
    setAttachmentError(null);
    if (file.type !== 'application/pdf') {
      setAttachmentError('Only PDF files are accepted.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setAttachmentError(`File exceeds 4MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB).`);
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

  // ─── Preview ───
  /**
   * Barry personalization, PERSONALIZE_CHUNK contacts per request.
   *
   * barryBulkPersonalize refuses more than 25 contacts in one call. Rather than
   * make the user split a 47-person import into two cadences, the modal makes
   * the calls in sequence and shows one progress count. A chunk that fails
   * marks only its own contacts as failed; the user can still edit their lines.
   */
  async function personalizeAll(sharedBody, mode) {
    const user = getEffectiveUser();
    const authToken = await user.getIdToken();
    const resultsMap = {};
    setPersonalizeProgress({ done: 0, total: contacts.length });
    for (let i = 0; i < contacts.length; i += PERSONALIZE_CHUNK) {
      const chunk = contacts.slice(i, i + PERSONALIZE_CHUNK);
      try {
        const res = await fetch('/.netlify/functions/barryBulkPersonalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            ...(mode ? { mode } : {}),
            contacts: chunk.map(toPersonalizeInput),
            sharedBody,
          }),
        });
        const data = await res.json();
        (data.results || []).forEach(r => { resultsMap[r.contactId] = r; });
      } catch (err) {
        console.warn('[BulkComposeModal] personalization chunk failed', err?.message);
      }
      setPersonalizeProgress({ done: Math.min(i + PERSONALIZE_CHUNK, contacts.length), total: contacts.length });
    }
    return contacts.map(c => {
      const result = resultsMap[c.id];
      // Opening-line mode: strip any greeting or leading name Barry added —
      // "Hi {first}," is ours (emailGreeting.js). Inline text is left as is.
      const raw = result?.success ? (result.openingLine || '') : '';
      return {
        contact: c,
        openingLine: mode ? raw : cleanBarryOpening(raw, firstNameFor(c)),
        failed: result ? !result.success : true,
      };
    });
  }

  async function handlePreview() {
    setLoading(true);
    setTestState(null);
    try {
      // Resend guard: who already received a cadence with this name.
      try {
        const user = getEffectiveUser();
        const delivered = await loadAlreadyDelivered(user?.uid, cadenceName);
        setAlreadySentIds(delivered);
      } catch (err) {
        console.warn('[BulkComposeModal] resend check failed — no one excluded', err?.message);
        setAlreadySentIds(new Set());
      }

      const wantsPersonalization = inlinePersonalize || personalizeWithBarry;
      if (wantsPersonalization) {
        setPreviews(await personalizeAll(body, inlinePersonalize ? 'inline_personalize' : undefined));
      } else {
        setPreviews(contacts.map(c => ({ contact: c, openingLine: '', failed: false })));
      }
      setStep(2);
    } catch {
      setPreviews(contacts.map(c => ({ contact: c, openingLine: '', failed: true })));
      setStep(2);
    } finally {
      setLoading(false);
      setPersonalizeProgress(null);
    }
  }

  function updateOpeningLine(contactId, newLine) {
    setPreviews(prev => prev.map(p =>
      p.contact.id === contactId ? { ...p, openingLine: newLine } : p
    ));
  }

  // ─── Build send payload ───
  /** One recipient's final email — the same function the real send and the test send use. */
  function buildPayloadItem(p) {
    // The send pipeline reads `contact.email`; a contact holding only a
    // work_email used to pass the modal's filter and then fail at send.
    const contact = { ...p.contact, email: getContactEmail(p.contact) };
    const rendered = renderCadenceEmail({
      subject, body, contact: p.contact, openingLine: p.openingLine, personalize: personalizeWithBarry,
    });
    const item = { contact, subject: rendered.subject, body: rendered.body, cadenceName };
    if (attachment) {
      item.attachment = { data: attachment.base64, filename: attachment.filename, mimeType: 'application/pdf' };
    }
    if (cc.trim()) item.cc = cc.trim();
    return item;
  }

  const isExcludedAsAlreadySent = (p) => !includeAlreadySent && alreadySentIds.has(p.contact.id);
  const sendablePreviews = previews
    ? previews.filter(p => getContactEmail(p.contact) && !isExcludedAsAlreadySent(p))
    : [];
  const alreadySentInList = previews
    ? previews.filter(p => getContactEmail(p.contact) && alreadySentIds.has(p.contact.id)).length
    : 0;

  function handleSend() {
    const payload = sendablePreviews.map(buildPayloadItem);
    setSendPayload(payload);
    setSendStarted(true);
    setStep(3);
    deleteDraft();
  }

  /**
   * Send the first recipient's real email to the user.
   *
   * Same subject, body, personalization, attachment and Gmail account as the
   * real send, through the same gmail-send-quick function. No contactId and no
   * cadenceId are passed, so no contact is updated, no tracking pixel is
   * embedded and nothing is counted. CC is left off so a test never reaches
   * the CC'd person.
   */
  async function handleSendTest() {
    const user = getEffectiveUser();
    const sample = sendablePreviews[0];
    if (!user?.email || !sample) return;
    setTestState('sending');
    const item = buildPayloadItem(sample);
    const res = await sendEmailViaGmail({
      userId: user.uid,
      contact: { id: null, email: user.email, firstName: 'Test', lastName: 'Send' },
      subject: `[TEST] ${item.subject}`,
      body: item.body,
      ...(item.attachment ? { attachment: item.attachment } : {}),
    });
    if (res?.result === SEND_RESULT.SENT) {
      setTestState({ ok: true, message: `Test sent to ${user.email} — personalized as ${getContactName(sample.contact)}.` });
    } else {
      setTestState({ ok: false, message: `Test failed: ${res?.error || 'unknown error'}` });
    }
  }

  /** What this cadence was composed from — stored so it can be reused. */
  const cadenceMeta = {
    templateSubject: subject,
    templateBody: body,
    // Kept for readers of older docs; the message itself no longer depends on it.
    path: attachment ? 'send_with_attachment' : 'write_your_own',
    personalizedWithBarry: inlinePersonalize || personalizeWithBarry,
    cc: cc.trim(),
    hasAttachment: Boolean(attachment),
  };

  // ─── Draft persistence ───
  async function saveDraft() {
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const draftRef = doc(db, 'users', user.uid, 'campaignDrafts', 'latest');
      await setDoc(draftRef, {
        subject,
        body,
        cc,
        personalizeWithBarry,
        contactIds: contacts.map(c => c.id),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // draft save failure is non-critical
    }
  }

  async function deleteDraft() {
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const draftRef = doc(db, 'users', user.uid, 'campaignDrafts', 'latest');
      await deleteDoc(draftRef);
    } catch {
      // draft delete failure is non-critical
    }
  }

  function handleAddMoreContacts() {
    setSendStarted(false);
    setSendComplete(false);
    setSendPayload(null);
    setPreviews(null);
    setSelectedContacts([]);
    setStep(1);
  }

  function handleClose() {
    if (step === 3 && sendStarted && !sendComplete) {
      if (!window.confirm('Sends in progress — closing will not cancel emails already sent.')) return;
    }
    if (step < 3 && (subject || body)) {
      saveDraft();
    }
    onClose();
  }

  const sendableCount = previews ? sendablePreviews.length : contactsWithEmail.length;

  // ─── Compose validity ───
  // Every reason Preview is unavailable, in the words shown to the user. The
  // button is disabled exactly when this list is non-empty (or a preview is
  // already generating) — never silently. Barry, attachments, CC and template
  // tags are optional and never block it on their own.
  const previewBlockers = [];
  if (!cadenceName.trim()) previewBlockers.push('Cadence name is required');
  if (!subject.trim()) previewBlockers.push('Subject is required');
  if (!body.trim()) previewBlockers.push('Email body is required');
  if (contacts.length === 0) previewBlockers.push('Add at least one recipient');
  if (needsGmail && !gmailConnected) {
    previewBlockers.push(gmailChecking
      ? 'Checking Gmail connection…'
      : 'Connect Gmail to send an attachment or CC');
  }
  const composeValid = previewBlockers.length === 0;

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

  const tagButtonStyle = {
    padding: '4px 10px', borderRadius: 6, border: `1px solid ${BRAND.cyan}40`,
    background: `${BRAND.cyan}08`, color: BRAND.cyan,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 4,
  };

  const stepLabels = ['Compose', 'Preview', 'Sending'];

  // ─── Render helpers for preview ───
  /**
   * A preview card shows the email EXACTLY as it will be sent — the same
   * buildPayloadItem → renderCadenceEmail call the test send and the real send
   * make. Barry's line stays editable above it; the rendered text below is the
   * truth, so the preview cannot look right while Gmail gets something else.
   */
  function renderPreviewBody(p) {
    const item = buildPayloadItem(p);
    return (
      <>
        {!inlinePersonalize && personalizeWithBarry && p.openingLine !== undefined && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Sparkles size={11} style={{ color: BRAND.cyan }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: BRAND.cyan }}>Barry's opening (edit)</span>
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
        <div data-testid={`rendered-${p.contact.id}`}>
          <div style={{ fontSize: 10, fontWeight: 600, color: T.textFaint, marginBottom: 4 }}>EXACTLY AS SENT</div>
          <div data-testid={`rendered-subject-${p.contact.id}`} style={{ fontSize: 12, color: T.textMuted, marginBottom: 6 }}>
            Subject: <strong style={{ color: T.text }}>{item.subject}</strong>
          </div>
          <div data-testid={`rendered-body-${p.contact.id}`} style={{ whiteSpace: 'pre-wrap', color: T.text }}>{item.body}</div>
        </div>
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
                Compose Cadence
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
              {/* ─── Draft resume banner ─── */}
              {pendingDraft && (
                <div style={{
                  marginBottom: 14, padding: '12px 14px', borderRadius: 10,
                  background: `${BRAND.cyan}10`, border: `1px solid ${BRAND.cyan}30`,
                  fontSize: 12, lineHeight: 1.5,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: BRAND.cyan }}>You have a previous draft</div>
                  <div style={{ color: T.textMuted, marginBottom: 10 }}>
                    Subject: {pendingDraft.subject || '(empty)'} — Would you like to resume or start fresh?
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={resumeDraft}
                      style={{
                        padding: '6px 14px', borderRadius: 7, border: 'none',
                        background: BRAND.cyan, color: '#fff',
                        fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}
                    >Resume previous draft</button>
                    <button
                      onClick={dismissDraft}
                      style={{
                        padding: '6px 14px', borderRadius: 7,
                        border: `1px solid ${T.border}`, background: 'transparent',
                        color: T.textMuted, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >Start fresh</button>
                  </div>
                </div>
              )}

              {/* ─── Cadence Name (required, first field) ─── */}
              <label style={sectionLabel}>Cadence Name</label>
              <input
                value={cadenceName}
                onChange={e => setCadenceName(e.target.value)}
                placeholder={'e.g. "Bank CEO Introduction", "Partner Outreach", "Event Follow-up"'}
                style={{ ...inputStyle, marginBottom: 18 }}
              />

              {needsGmail && !gmailChecking && !gmailConnected && (
                <div style={{
                  marginBottom: 16, padding: '12px 14px', borderRadius: 10,
                  background: `${BRAND.pink}10`, border: `1px solid ${BRAND.pink}30`,
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 12, color: BRAND.pink, lineHeight: 1.5,
                }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                  Gmail connection required to send attachments or CC. Connect Gmail in Settings.
                </div>
              )}

              {/* ─── Message ─── */}
              <label style={sectionLabel}>Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject line" style={inputStyle} />

              <label style={{ ...sectionLabel, marginTop: 18 }}>Email Body</label>
              <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 6, lineHeight: 1.5 }}>
                Each email starts with "Hi {'{first name}'}," and Barry's opening line, then this body. To write your own greeting instead, place {'{personalize}'} where Barry should add a personal line.
              </div>
              <textarea
                ref={bodyRef}
                aria-label="Email Body"
                value={body} onChange={e => setBody(e.target.value)}
                placeholder="Write the shared email body that all contacts will receive..."
                rows={8} style={{ ...inputStyle, resize: 'vertical', minHeight: 120, fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <button onClick={() => insertTag('{{first_name}}', bodyRef, body, setBody)} style={tagButtonStyle}>
                  <Plus size={10} />First Name
                </button>
                <button onClick={() => insertTag('{{company}}', bodyRef, body, setBody)} style={tagButtonStyle}>
                  <Plus size={10} />Company
                </button>
                <button onClick={insertPersonalizeTag} style={tagButtonStyle}>
                  <Plus size={10} />Personalize
                </button>
              </div>

              {inlinePersonalize ? (
                <div data-testid="inline-personalize-note" style={{
                  marginTop: 18, display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 14px', borderRadius: 10,
                  background: `${BRAND.cyan}10`, border: `1px solid ${BRAND.cyan}40`,
                  fontSize: 12, color: T.text,
                }}>
                  <Sparkles size={16} style={{ color: BRAND.cyan, flexShrink: 0 }} />
                  {'{personalize}'} detected — Barry writes that part for each contact, and no automatic greeting is added.
                </div>
              ) : (
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
                    aria-label="Personalize with Barry"
                    aria-pressed={personalizeWithBarry}
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
              )}

              {/* Attachment (optional — added to the same message) */}
              <div style={{ marginTop: 18 }}>
                <label style={sectionLabel}>Attachment (optional, PDF only, max 4MB)</label>
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
                    <input ref={fileInputRef} data-testid="attachment-input" type="file" accept=".pdf,application/pdf" onChange={handleFileSelect} style={{ display: 'none' }} />
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

              {/* CC (optional) */}
              <div style={{ marginTop: 18 }}>
                <label style={sectionLabel}>CC (optional)</label>
                <input
                  value={cc} onChange={e => setCc(e.target.value)}
                  placeholder="cc@example.com"
                  type="email" style={inputStyle}
                />
              </div>

              {/* ─── Recipients with search ─── */}
              <div style={{ marginTop: 18 }}>
                {contacts.length === 0 && (
                  <div style={{
                    marginBottom: 8, padding: '8px 12px', borderRadius: 8,
                    background: `${BRAND.pink}08`, border: `1px solid ${BRAND.pink}20`,
                    fontSize: 11, color: T.textMuted, lineHeight: 1.5,
                  }}>
                    Add contacts below, or go to Scout → People to select contacts and click Start Cadence.
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ ...sectionLabel, marginBottom: 0 }}>Recipients</label>
                  {contacts.length > 0 && contacts.length < MAX_BULK_CONTACTS && contactPool.length > 0 && (
                    <button
                      onClick={() => { setSearchOpen(o => !o); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
                      style={{
                        padding: '3px 10px', borderRadius: 6, border: `1px solid ${T.border}`,
                        background: 'transparent', color: T.textMuted,
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Plus size={10} />Add
                    </button>
                  )}
                </div>

                {/* Search input — always visible when zero contacts, toggleable otherwise */}
                {(searchOpen || contacts.length === 0) && (
                  <div style={{ marginBottom: 8, position: 'relative' }}>
                    <div style={{ position: 'relative' }}>
                      <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textFaint }} />
                      <input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder={contacts.length === 0 ? 'Search for contacts to add to this cadence' : 'Search by name, company, or email...'}
                        style={{ ...inputStyle, paddingLeft: 30, fontSize: 12 }}
                      />
                    </div>
                    {(searchResults.length > 0 || browseList.length > 0) && (
                      <div style={{
                        marginTop: 4, borderRadius: 8, border: `1px solid ${T.border}`,
                        background: T.cardBg, maxHeight: 200, overflowY: 'auto',
                      }}>
                        {browseList.length > 0 && (
                          <div style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, color: T.textFaint, borderBottom: `1px solid ${T.border}` }}>
                            Select contacts ({availableContacts.length} available)
                          </div>
                        )}
                        {(searchResults.length > 0 ? searchResults : browseList).map(c => (
                          <div
                            key={c.id}
                            onClick={() => addContact(c)}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '7px 10px', cursor: 'pointer',
                              borderBottom: `1px solid ${T.border}`,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {getContactName(c)}
                              </div>
                              <div style={{ fontSize: 10, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {getContactEmail(c) || c.company_name || c.company || ''}
                              </div>
                            </div>
                            <Plus size={12} style={{ color: BRAND.cyan, flexShrink: 0 }} />
                          </div>
                        ))}
                      </div>
                    )}
                    {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                      <div style={{ marginTop: 4, padding: '8px 10px', fontSize: 11, color: T.textFaint, textAlign: 'center' }}>
                        No matching contacts found
                      </div>
                    )}
                  </div>
                )}

                {/* Selected recipients list */}
                <div style={{
                  borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface,
                  maxHeight: 140, overflowY: 'auto',
                }}>
                  {contacts.map((c, i) => (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderBottom: i < contacts.length - 1 ? `1px solid ${T.border}` : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <Users size={11} style={{ color: T.textFaint, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {getContactName(c)}
                        </span>
                        {!getContactEmail(c) && (
                          <span style={{ fontSize: 9, color: BRAND.pink, fontWeight: 600 }}>no email</span>
                        )}
                      </div>
                      <button
                        onClick={() => removeContact(c.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, padding: 2, display: 'flex' }}
                      ><X size={11} /></button>
                    </div>
                  ))}
                </div>
                {contacts.length >= MAX_BULK_CONTACTS && (
                  <div style={{ fontSize: 10, color: BRAND.pink, marginTop: 4 }}>
                    Maximum {MAX_BULK_CONTACTS} contacts per campaign
                  </div>
                )}
              </div>

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
              {!composeValid && (
                <div
                  role="status"
                  data-testid="preview-blockers"
                  style={{ flex: 1, fontSize: 12, color: BRAND.pink, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                >
                  <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                  {previewBlockers.join(' · ')}
                </div>
              )}
              <button onClick={handleClose} style={btnSecondary}>Cancel</button>
              <button
                onClick={handlePreview}
                disabled={!composeValid || loading}
                title={composeValid ? undefined : previewBlockers.join('\n')}
                style={{
                  ...btnPrimary,
                  opacity: (!composeValid || loading) ? 0.5 : 1,
                  cursor: (!composeValid || loading) ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={14} />}
                {loading
                  ? (personalizeProgress ? `Personalizing ${personalizeProgress.done} of ${personalizeProgress.total}…` : 'Generating...')
                  : 'Preview'}
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

              {alreadySentInList > 0 && (
                <div data-testid="already-sent-banner" style={{
                  marginBottom: 14, padding: '10px 14px', borderRadius: 10,
                  background: '#f59e0b14', border: '1px solid #f59e0b55',
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  fontSize: 12, color: T.text,
                }}>
                  <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
                  <span style={{ flex: 1, minWidth: 200 }}>
                    {alreadySentInList} {alreadySentInList === 1 ? 'person has' : 'people have'} already received "{cadenceName.trim()}".{' '}
                    {includeAlreadySent ? 'They will be sent it again.' : 'They are excluded from this send.'}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={includeAlreadySent}
                      onChange={e => setIncludeAlreadySent(e.target.checked)}
                    />
                    Send to them again
                  </label>
                </div>
              )}

              <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 12 }}>
                Subject: <strong style={{ color: T.text }}>{subject || '(no subject)'}</strong>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {previews.map(p => {
                  const email = getContactEmail(p.contact);
                  const name = getContactName(p.contact);
                  const noEmail = !email;
                  const alreadySent = !noEmail && isExcludedAsAlreadySent(p);

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
                        {alreadySent && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#b45309', background: '#f59e0b22', padding: '3px 8px', borderRadius: 6 }}>
                            Already received — excluded
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
                            {inlinePersonalize && p.openingLine !== undefined && (
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

                          {/* Attachment & CC — the same on every recipient's email */}
                          {(attachment || cc.trim()) && (
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
              {testState && testState !== 'sending' && (
                <span
                  role="status"
                  style={{ flex: 1, fontSize: 11, color: testState.ok ? '#16a34a' : BRAND.pink }}
                >{testState.message}</span>
              )}
              <button onClick={() => setStep(1)} style={btnSecondary}>
                <ChevronLeft size={14} /> Edit
              </button>
              <button
                onClick={handleSendTest}
                disabled={!gmailConnected || sendableCount === 0 || testState === 'sending'}
                title={gmailConnected ? 'Send the first recipient\'s email to yourself' : 'Connect Gmail to send a test'}
                style={{
                  ...btnSecondary,
                  opacity: (!gmailConnected || sendableCount === 0) ? 0.5 : 1,
                  cursor: (!gmailConnected || sendableCount === 0) ? 'not-allowed' : 'pointer',
                }}
              >
                {testState === 'sending'
                  ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  : <Mail size={14} />}
                {testState === 'sending' ? 'Sending test…' : 'Send Test to Me'}
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

        {/* ─── Step 3: Send (BulkSendExecutor — Campaign) ─── */}
        {step === 3 && (
          <div style={bodySection}>
            <BulkSendExecutor
              payload={sendPayload}
              cadenceMeta={cadenceMeta}
              T={T}
              onAddMoreContacts={handleAddMoreContacts}
              onComplete={() => setSendComplete(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
