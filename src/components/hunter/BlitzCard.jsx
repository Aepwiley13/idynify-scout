/**
 * BlitzCard.jsx — The engagement card for Blitz Mode
 *
 * Shows everything on one screen per contact:
 *   1. Contact header (avatar, name, title, company, email, last contact)
 *   2. Barry's pre-generated message options (click to select)
 *   3. Editable subject + message textarea
 *   4. "Tell Barry what to say" accordion — custom prompt → regenerate
 *   5. "Use from Arsenal" accordion — saved templates
 *   6. Channel selector + Send + Skip
 *
 * Philosophy: zero modals, zero drawers. Everything inline. 5 seconds per contact.
 */

import { useState, useEffect } from 'react';
import {
  Mail, Linkedin, Sparkles, FileText,
  ChevronDown, ChevronUp, SkipForward, Send,
  RefreshCw, Loader, Check, MessageSquare
} from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { checkGmailConnection } from '../../utils/sendActionResolver';

// ── Avatar helpers ─────────────────────────────────────

const AVATAR_COLORS = ['#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444'];

function getAvatarColor(contact) {
  const seed = (contact.name || contact.email || contact.id || '?').charCodeAt(0);
  return AVATAR_COLORS[seed % AVATAR_COLORS.length];
}

function getInitials(contact) {
  const name = contact.name ||
    `${contact.firstName || contact.first_name || ''} ${contact.lastName || contact.last_name || ''}`.trim();
  return name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
}

// ── Component ──────────────────────────────────────────

export default function BlitzCard({ contact, messagesState, onSend, onSkip, onRegenerate }) {
  const T = useT();
  const color = getAvatarColor(contact);

  // Message selection & editing
  const [selectedOption, setSelectedOption] = useState(null);
  const [editedSubject, setEditedSubject] = useState('');
  const [editedMessage, setEditedMessage] = useState('');

  // Channel
  const [channel, setChannel] = useState('email');
  const [gmailConnected, setGmailConnected] = useState(false);

  // Tell Barry accordion
  const [barryOpen, setBarryOpen] = useState(false);
  const [barryIntent, setBarryIntent] = useState('');

  // Arsenal accordion
  const [arsenalOpen, setArsenalOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  // Send state
  const [sending, setSending] = useState(false);
  const [sendDone, setSendDone] = useState(false);

  const { messages, loading, error } = messagesState || {};

  const hasEmail = !!(contact.email || contact.emails?.[0]);
  const hasLinkedIn = !!contact.linkedin_url;
  const firstName = contact.firstName || contact.first_name || 'this contact';
  const lastContact = contact.last_interaction_at || contact.last_contacted_at;
  const displayEmail = contact.email || contact.emails?.[0] || null;

  // Check Gmail on mount
  useEffect(() => {
    async function check() {
      const user = getEffectiveUser();
      if (!user) return;
      try {
        const status = await checkGmailConnection(user.uid);
        setGmailConnected(status.connected);
      } catch (_) {}
    }
    check();
  }, []);

  // Auto-select first option when messages arrive
  useEffect(() => {
    if (messages?.length > 0 && selectedOption === null) {
      pickOption(0, messages[0]);
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when contact changes
  useEffect(() => {
    setSelectedOption(null);
    setEditedSubject('');
    setEditedMessage('');
    setBarryOpen(false);
    setBarryIntent('');
    setArsenalOpen(false);
    setSendDone(false);
  }, [contact.id]);

  function pickOption(idx, option) {
    setSelectedOption(idx);
    setEditedSubject(option.subject || '');
    setEditedMessage(option.message || '');
  }

  async function loadTemplates() {
    if (templatesLoaded) return;
    setTemplatesLoading(true);
    try {
      const user = getEffectiveUser();
      const idToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/get-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (_) {}
    finally {
      setTemplatesLoading(false);
      setTemplatesLoaded(true);
    }
  }

  function handleUseTemplate(template) {
    setEditedSubject(template.subject || '');
    setEditedMessage(template.body || '');
    setSelectedOption(null);
    setArsenalOpen(false);
  }

  function handleBarryRegenerate() {
    if (!barryIntent.trim()) return;
    setSelectedOption(null);
    setEditedSubject('');
    setEditedMessage('');
    setBarryOpen(false);
    onRegenerate(contact, barryIntent);
  }

  async function handleSend() {
    if (!editedMessage.trim() || sending || sendDone) return;
    setSending(true);
    try {
      await onSend({
        contact,
        subject: editedSubject,
        message: editedMessage,
        channel,
        strategy: messages?.[selectedOption]?.strategy || null,
        userIntent: barryIntent || null
      });
      setSendDone(true);
    } catch (_) {
      // Parent handles error display
    } finally {
      setSending(false);
    }
  }

  const canSend = editedMessage.trim().length > 0;
  const sendLabel = sendDone
    ? 'Sent!'
    : sending
    ? 'Sending...'
    : gmailConnected && channel === 'email'
    ? 'Send Email'
    : channel === 'linkedin'
    ? 'Open LinkedIn'
    : 'Open Draft';

  return (
    <div style={s.root(T)}>

      {/* ── 1. Contact Header ─────────────────────────────── */}
      <div style={s.header}>
        <div style={s.avatar(color)}>{getInitials(contact)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={s.name(T)}>
            {contact.name ||
              `${contact.firstName || contact.first_name || ''} ${contact.lastName || contact.last_name || ''}`.trim() ||
              'Unknown'}
          </div>
          <div style={s.subtitle(T)}>
            {[
              contact.title || contact.current_position_title,
              contact.company_name || contact.current_company_name
            ].filter(Boolean).join(' · ')}
          </div>
          <div style={s.metaRow}>
            {displayEmail && (
              <span style={s.chip('#34d399')}>{displayEmail}</span>
            )}
            {lastContact && (
              <span style={s.chip('#9ca3af')}>
                Last: {formatRelativeTime(lastContact) || 'Unknown'}
              </span>
            )}
            {contact.engagement_summary?.consecutive_no_replies > 0 && (
              <span style={s.chip('#f59e0b')}>
                {contact.engagement_summary.consecutive_no_replies} no-replies
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={s.divider(T)} />

      {/* ── 2. Barry's Message Options ────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionLabel(T)}>
          <Sparkles size={12} color={BRAND.purple} />
          Barry's options — click to select
        </div>

        {loading && (
          <div style={s.statusRow(T)}>
            <Loader size={16} color={BRAND.purple} style={{ animation: 'spin 1s linear infinite' }} />
            <span>Barry is crafting your messages...</span>
          </div>
        )}

        {!loading && error && (
          <div style={s.statusRow(T)}>
            <span style={{ color: '#f87171', fontSize: 12 }}>{error}</span>
            <button
              onClick={() => onRegenerate(contact, `Follow up with ${firstName}`)}
              style={s.smallBtn(T)}
            >
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}

        {!loading && !error && messages?.map((option, idx) => {
          const isSelected = selectedOption === idx;
          return (
            <button
              key={idx}
              onClick={() => pickOption(idx, option)}
              style={s.optionCard(T, isSelected)}
            >
              <div style={s.optionRow}>
                <div style={s.radioDot(isSelected)} />
                <span style={{ fontWeight: 600, fontSize: 12, color: isSelected ? BRAND.purple : T.textMuted }}>
                  {option.label || option.strategy}
                </span>
                {isSelected && <Check size={12} color={BRAND.purple} style={{ marginLeft: 'auto' }} />}
              </div>
              {option.subject && (
                <div style={s.optionSubject(T, isSelected)}>Subj: {option.subject}</div>
              )}
              <div style={s.optionPreview(T)}>
                {(option.message || '').substring(0, 130)}
                {(option.message || '').length > 130 ? '…' : ''}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── 3. Editable Message Area ──────────────────────── */}
      {(editedMessage || selectedOption !== null) && (
        <div style={s.section}>
          <div style={s.sectionLabel(T)}>Edit before sending</div>
          {channel === 'email' && (
            <input
              type="text"
              value={editedSubject}
              onChange={e => setEditedSubject(e.target.value)}
              placeholder="Subject line..."
              style={s.input(T)}
            />
          )}
          <textarea
            value={editedMessage}
            onChange={e => setEditedMessage(e.target.value)}
            rows={5}
            style={s.textarea(T)}
          />
        </div>
      )}

      {/* ── 4 & 5. Accordions ────────────────────────────── */}
      <div style={s.accordions}>

        {/* Tell Barry */}
        <div style={s.accordionWrap(T)}>
          <button
            onClick={() => setBarryOpen(o => !o)}
            style={s.accordionToggle(T)}
          >
            <Sparkles size={12} color={T.textFaint} />
            <span>Tell Barry what to say</span>
            {barryOpen
              ? <ChevronUp size={12} color={T.textFaint} style={{ marginLeft: 'auto' }} />
              : <ChevronDown size={12} color={T.textFaint} style={{ marginLeft: 'auto' }} />
            }
          </button>
          {barryOpen && (
            <div style={s.accordionBody(T)}>
              <textarea
                value={barryIntent}
                onChange={e => setBarryIntent(e.target.value)}
                placeholder={`E.g., "Mention their recent funding round and ask for 15 minutes"`}
                rows={2}
                style={s.textarea(T)}
                autoFocus
              />
              <button
                onClick={handleBarryRegenerate}
                disabled={!barryIntent.trim()}
                style={s.generateBtn(T, barryIntent.trim().length > 0)}
              >
                <RefreshCw size={12} />
                Generate new options
              </button>
            </div>
          )}
        </div>

        {/* Arsenal */}
        <div style={s.accordionWrap(T)}>
          <button
            onClick={() => {
              setArsenalOpen(o => !o);
              if (!arsenalOpen) loadTemplates();
            }}
            style={s.accordionToggle(T)}
          >
            <FileText size={12} color={T.textFaint} />
            <span>Pull from Arsenal</span>
            {arsenalOpen
              ? <ChevronUp size={12} color={T.textFaint} style={{ marginLeft: 'auto' }} />
              : <ChevronDown size={12} color={T.textFaint} style={{ marginLeft: 'auto' }} />
            }
          </button>
          {arsenalOpen && (
            <div style={s.accordionBody(T)}>
              {templatesLoading ? (
                <div style={{ color: T.textFaint, fontSize: 12 }}>Loading templates...</div>
              ) : templates.length === 0 ? (
                <div style={{ color: T.textFaint, fontSize: 12 }}>
                  No templates yet. Create some in the Arsenal tab.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {templates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => handleUseTemplate(t)}
                      style={s.templateItem(T)}
                    >
                      <div style={{ fontWeight: 600, fontSize: 12, color: T.text }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: T.textFaint }}>{t.subject}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={s.divider(T)} />

      {/* ── 6. Channel + Actions ─────────────────────────── */}
      <div style={s.footer}>
        {/* Channel pills */}
        <div style={s.channelRow}>
          <button
            onClick={() => setChannel('email')}
            disabled={!hasEmail}
            style={s.channelPill(T, channel === 'email', hasEmail)}
            title={hasEmail ? '' : 'No email on file'}
          >
            <Mail size={12} />
            {gmailConnected ? 'Gmail' : 'Email'}
          </button>
          <button
            onClick={() => setChannel('linkedin')}
            disabled={!hasLinkedIn}
            style={s.channelPill(T, channel === 'linkedin', hasLinkedIn)}
            title={hasLinkedIn ? '' : 'No LinkedIn profile'}
          >
            <Linkedin size={12} />
            LinkedIn
          </button>
        </div>

        {/* Send / Skip row */}
        <div style={s.actionRow}>
          <button onClick={onSkip} style={s.skipBtn(T)}>
            <SkipForward size={14} />
            Skip
          </button>
          <button
            onClick={handleSend}
            disabled={!canSend || sending}
            style={s.sendBtn(T, canSend)}
          >
            {sending
              ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sending...</>
              : sendDone
              ? <><Check size={14} /> Sent!</>
              : <><Send size={14} /> {sendLabel}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────

const s = {
  root: T => ({
    background: T.cardBg,
    border: `1px solid ${T.border}`,
    borderRadius: 16,
    display: 'flex',
    flexDirection: 'column',
    maxWidth: 620,
    width: '100%',
    margin: '0 auto',
    boxShadow: T.isDark ? '0 8px 32px rgba(0,0,0,0.45)' : '0 4px 20px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  }),
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '16px 16px 14px',
  },
  avatar: color => ({
    width: 46,
    height: 46,
    borderRadius: 12,
    flexShrink: 0,
    background: `${color}20`,
    border: `2px solid ${color}40`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 700,
    color,
  }),
  name: T => ({
    fontSize: 15,
    fontWeight: 700,
    color: T.text,
    lineHeight: 1.3,
    marginBottom: 3,
  }),
  subtitle: T => ({
    fontSize: 12,
    color: T.textMuted,
    lineHeight: 1.4,
    marginBottom: 6,
  }),
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: color => ({
    fontSize: 10,
    color,
    padding: '2px 7px',
    background: `${color}18`,
    borderRadius: 10,
    border: `1px solid ${color}30`,
  }),
  divider: T => ({
    height: 1,
    background: T.border,
  }),
  section: {
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  sectionLabel: T => ({
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 10,
    fontWeight: 700,
    color: T.textFaint,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    marginBottom: 2,
  }),
  statusRow: T => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 0',
    color: T.textFaint,
    fontSize: 13,
  }),
  smallBtn: T => ({
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 11,
    background: T.surface,
    border: `1px solid ${T.border}`,
    color: T.textMuted,
    cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
  }),
  optionCard: (T, isSelected) => ({
    textAlign: 'left',
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    background: isSelected ? `${BRAND.purple}10` : T.surface,
    border: `1.5px solid ${isSelected ? BRAND.purple : T.border2}`,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'border-color 0.12s, background 0.12s',
  }),
  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  radioDot: isSelected => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
    background: isSelected ? BRAND.purple : 'transparent',
    border: `2px solid ${isSelected ? BRAND.purple : '#6b7280'}`,
    transition: 'all 0.12s',
  }),
  optionSubject: (T, isSelected) => ({
    fontSize: 11,
    color: isSelected ? BRAND.purple : T.textFaint,
    marginLeft: 18,
    fontStyle: 'italic',
  }),
  optionPreview: T => ({
    fontSize: 12,
    color: T.textMuted,
    marginLeft: 18,
    lineHeight: 1.5,
  }),
  input: T => ({
    width: '100%',
    padding: '8px 10px',
    background: T.input || T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    color: T.text,
    fontSize: 13,
    fontFamily: 'Inter, system-ui, sans-serif',
    outline: 'none',
    boxSizing: 'border-box',
  }),
  textarea: T => ({
    width: '100%',
    padding: '9px 10px',
    background: T.input || T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    color: T.text,
    fontSize: 13,
    fontFamily: 'Inter, system-ui, sans-serif',
    outline: 'none',
    resize: 'vertical',
    lineHeight: 1.55,
    boxSizing: 'border-box',
  }),
  accordions: {
    padding: '0 16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  accordionWrap: T => ({
    border: `1px solid ${T.border2}`,
    borderRadius: 10,
    overflow: 'hidden',
  }),
  accordionToggle: T => ({
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    width: '100%',
    padding: '9px 12px',
    background: T.surface,
    border: 'none',
    color: T.textMuted,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
  }),
  accordionBody: T => ({
    padding: '10px 12px',
    background: T.cardBg,
    borderTop: `1px solid ${T.border2}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }),
  generateBtn: (T, enabled) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 8,
    fontSize: 12,
    background: enabled ? `${BRAND.purple}18` : T.surface,
    border: `1px solid ${enabled ? `${BRAND.purple}50` : T.border}`,
    color: enabled ? BRAND.purple : T.textFaint,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontWeight: 600,
    fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'all 0.12s',
  }),
  templateItem: T => ({
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 8,
    background: T.surface,
    border: `1px solid ${T.border2}`,
    cursor: 'pointer',
    width: '100%',
    fontFamily: 'Inter, system-ui, sans-serif',
  }),
  footer: {
    padding: '12px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  channelRow: {
    display: 'flex',
    gap: 7,
  },
  channelPill: (T, isActive, isAvailable) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background: isActive ? `${BRAND.purple}18` : T.surface,
    border: `1.5px solid ${isActive ? BRAND.purple : T.border2}`,
    color: isActive ? BRAND.purple : isAvailable ? T.textMuted : T.textFaint,
    cursor: isAvailable ? 'pointer' : 'not-allowed',
    opacity: isAvailable ? 1 : 0.45,
    fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'all 0.12s',
  }),
  actionRow: {
    display: 'flex',
    gap: 8,
  },
  skipBtn: T => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '11px 16px',
    borderRadius: 10,
    fontSize: 13,
    background: T.surface,
    border: `1px solid ${T.border}`,
    color: T.textMuted,
    cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
    flexShrink: 0,
  }),
  sendBtn: (T, enabled) => ({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '11px 20px',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    background: enabled
      ? `linear-gradient(135deg, ${BRAND.purple}, ${BRAND.cyan})`
      : T.surface,
    border: 'none',
    color: enabled ? '#fff' : T.textFaint,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.55,
    fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'opacity 0.12s',
  }),
};
