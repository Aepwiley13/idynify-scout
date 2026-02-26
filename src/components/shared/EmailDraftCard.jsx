import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';

// ── Email draft parser ─────────────────────────────────────
// Detects Subject: / Body: blocks in Barry's responses and
// returns structured data for EmailDraftCard.

export function parseEmailDraft(content) {
  const subjectMatch = content.match(/^Subject:\s*(.+)$/m);
  const bodyMatch = content.match(/^Body:\s*([\s\S]+?)(?=\n\[SUGGESTION\]|\[SUGGESTION\]|$)/m);
  if (!subjectMatch || !bodyMatch) return null;

  const preamble = content.slice(0, subjectMatch.index).trim();
  const body = bodyMatch[1].trim();

  // Extract contact name so EmailDraftCard can look up their email.
  // Priority 1: "Hi/Hey/Hello/Dear [Name]" at the start of the body.
  let contactName = null;
  const greetingMatch = body.match(/^(?:Hi|Hey|Hello|Dear)[,\s]+([A-Z][a-z]+)/m);
  if (greetingMatch) contactName = greetingMatch[1];
  // Priority 2: "for [Name]" in the preamble (e.g. "Draft an intro for Peter")
  if (!contactName) {
    const forMatch = preamble.match(/\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (forMatch) contactName = forMatch[1];
  }
  // Priority 3: "[Name] at [Company]" in the preamble
  if (!contactName) {
    const atMatch = preamble.match(/\b([A-Z][a-z]+)\s+at\s+/);
    if (atMatch) contactName = atMatch[1];
  }

  return { subject: subjectMatch[1].trim(), body, preamble, contactName };
}

// ── Theme style maps ───────────────────────────────────────

const darkStyles = {
  wrapper:     'w-full max-w-[82%]',
  preamble:    'text-sm text-gray-200 leading-relaxed mb-3',
  card:        'rounded-2xl rounded-tl-sm border border-cyan-500/30 overflow-hidden',
  cardBg:      'rgba(0,0,0,0.7)',
  header:      'flex items-center justify-between px-4 py-2.5 border-b border-cyan-500/20',
  headerBg:    'rgba(6,182,212,0.08)',
  headerLabel: 'text-xs font-mono font-bold text-cyan-400 tracking-wider',
  copyAllBtn:  'text-xs font-mono text-gray-400 hover:text-cyan-300 transition-colors px-2 py-0.5 rounded border border-gray-700/60 hover:border-cyan-500/40',
  section:     'px-4 py-3 border-b border-white/5',
  fieldLabel:  'text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1',
  toInput:     'w-full bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none border-b border-transparent focus:border-cyan-500/40 transition-colors pb-0.5',
  subjectText: 'text-sm text-white font-medium leading-snug',
  bodyText:    'text-sm text-gray-200 leading-relaxed whitespace-pre-wrap',
  copyBtn:     'flex-shrink-0 text-xs font-mono text-gray-500 hover:text-cyan-300 transition-colors',
  copyBtnTop:  'flex-shrink-0 text-xs font-mono text-gray-500 hover:text-cyan-300 transition-colors disabled:opacity-30',
  gmailSection:'px-4 py-3',
  gmailBtn:    'w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-mono text-xs font-bold transition-all shadow-lg shadow-cyan-500/30',
};

const lightStyles = {
  wrapper:     'w-full',
  preamble:    'text-sm text-gray-600 leading-relaxed mb-3',
  card:        'rounded-2xl border border-gray-200 overflow-hidden',
  cardBg:      '#ffffff',
  header:      'flex items-center justify-between px-4 py-2.5 border-b border-gray-100',
  headerBg:    '#f9fafb',
  headerLabel: 'text-xs font-mono font-bold text-gray-500 tracking-wider',
  copyAllBtn:  'text-xs font-mono text-gray-400 hover:text-gray-600 transition-colors px-2 py-0.5 rounded border border-gray-200 hover:border-gray-400',
  section:     'px-4 py-3 border-b border-gray-100',
  fieldLabel:  'text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1',
  toInput:     'w-full bg-transparent text-sm text-gray-800 placeholder-gray-300 focus:outline-none border-b border-transparent focus:border-blue-400 transition-colors pb-0.5',
  subjectText: 'text-sm text-gray-800 font-medium leading-snug',
  bodyText:    'text-sm text-gray-700 leading-relaxed whitespace-pre-wrap',
  copyBtn:     'flex-shrink-0 text-xs font-mono text-gray-400 hover:text-gray-600 transition-colors',
  copyBtnTop:  'flex-shrink-0 text-xs font-mono text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30',
  gmailSection:'px-4 py-3',
  gmailBtn:    'w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-white font-mono text-xs font-bold transition-all',
};

// ── Email Draft Card ───────────────────────────────────────

export function EmailDraftCard({ preamble, subject, body, contactName, userId, theme = 'dark' }) {
  const [copiedField, setCopiedField] = useState(null);
  const [toEmail, setToEmail] = useState('');

  const s = theme === 'light' ? lightStyles : darkStyles;

  // Auto-lookup the contact's email in Firestore when a name was detected.
  useEffect(() => {
    if (!contactName || !userId) return;
    const q = query(
      collection(db, 'users', userId, 'contacts'),
      where('name', '>=', contactName),
      where('name', '<=', contactName + '\uf8ff')
    );
    getDocs(q).then(snapshot => {
      if (!snapshot.empty) {
        const email = snapshot.docs[0].data().email;
        if (email) setToEmail(email);
      }
    }).catch(() => { /* silent — To field stays empty */ });
  }, [contactName, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    } catch {
      // Clipboard API unavailable — silent fail
    }
  };

  const fullDraft = `${toEmail ? `To: ${toEmail}\n` : ''}Subject: ${subject}\n\n${body}`;

  const openInGmail = () => {
    const params = new URLSearchParams({ view: 'cm', fs: '1', su: subject, body });
    if (toEmail) params.set('to', toEmail);
    window.open(`https://mail.google.com/mail/?${params.toString()}`, '_blank');
  };

  return (
    <div className={s.wrapper}>
      {preamble && (
        <div className={`${s.preamble} mb-3`}>
          <ReactMarkdown className="prose prose-sm max-w-none [&>p]:mt-0 [&>p:last-child]:mb-0">
            {preamble}
          </ReactMarkdown>
        </div>
      )}
      <div className={s.card} style={{ background: s.cardBg }}>

        {/* Header */}
        <div className={s.header} style={{ background: s.headerBg }}>
          <div className="flex items-center gap-2">
            <span className="text-sm">📧</span>
            <span className={s.headerLabel}>EMAIL DRAFT</span>
          </div>
          <button
            onClick={() => copy(fullDraft, 'all')}
            className={s.copyAllBtn}
          >
            {copiedField === 'all' ? '✓ Copied' : 'Copy All'}
          </button>
        </div>

        {/* To field */}
        <div className={s.section}>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className={s.fieldLabel}>To</div>
              <input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="recipient@company.com"
                className={s.toInput}
              />
            </div>
            <button
              onClick={() => copy(toEmail, 'to')}
              disabled={!toEmail}
              className={s.copyBtnTop}
            >
              {copiedField === 'to' ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Subject */}
        <div className={s.section}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className={s.fieldLabel}>Subject</div>
              <div className={s.subjectText}>{subject}</div>
            </div>
            <button
              onClick={() => copy(subject, 'subject')}
              className={`${s.copyBtn} mt-4`}
            >
              {copiedField === 'subject' ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={s.section}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className={`${s.fieldLabel} mb-2`}>Body</div>
              <div className={s.bodyText}>{body}</div>
            </div>
            <button
              onClick={() => copy(body, 'body')}
              className={`${s.copyBtn} mt-4`}
            >
              {copiedField === 'body' ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Open in Gmail — primary action */}
        <div className={s.gmailSection}>
          <button
            onClick={openInGmail}
            className={s.gmailBtn}
          >
            Open in Gmail →
          </button>
        </div>
      </div>
    </div>
  );
}
