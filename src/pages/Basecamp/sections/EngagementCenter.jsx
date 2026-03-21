/**
 * EngagementCenter.jsx — Basecamp Engagement Command Center
 *
 * The weekly engagement hub. Run check-in waves, product updates,
 * and meeting requests across your contacts — Barry personalizes each one.
 *
 * Three views:
 *   1. New campaign  — compose message + select recipients + launch wave
 *   2. Past waves    — history, reply rates, what worked
 *   3. Scheduling    — who said yes but hasn't booked yet
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Zap, Clock, TrendingUp, MessageSquare,
  Mail, ChevronDown, Eye, Send,
  Calendar, CheckCircle2, RotateCcw,
  Users, AlertCircle, Radio, ArrowLeft,
  X, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { collection, onSnapshot, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';
import { resolveContactStage } from '../../../constants/stageSystem';
import { checkGmailConnection } from '../../../utils/sendActionResolver';
import { getContactEngageStatus, ENGAGE_STATUS_CONFIG } from '../../../utils/contactEngageStatus';

// ─── Constants ────────────────────────────────────────────────────────────────
const GREEN = '#22c55e';
const RED   = '#ef4444';
const AMBER = '#f59e0b';
const BLUE  = '#3b82f6';
const GRAY  = '#94a3b8';

const OVERDUE_DAYS = 7; // days since last contact = overdue

// Message templates keyed by type
const TEMPLATES = {
  checkin: {
    label: 'Check-in',
    subject: 'Checking in',
    body: `Hey {{first_name}} — just checking in this week. Would love to connect and hear how things are going on your end. Any interest in a quick 20-min call to catch up? Happy to share what we've been building too.`,
  },
  product_update: {
    label: 'Product update',
    subject: 'What we just shipped',
    body: `Hey {{first_name}} — wanted to give you a heads up on what we just released. A few things I think will be directly useful for you. Mind if I share a quick overview?`,
  },
  book_meeting: {
    label: 'Book a meeting',
    subject: 'Worth 20 minutes?',
    body: `Hey {{first_name}} — I'd love to get 20 minutes on the calendar with you this week. I have some things to share that I think are genuinely worth your time. What does your schedule look like?`,
  },
  custom: {
    label: 'Custom',
    subject: '',
    body: '',
  },
};

const CHANNELS = ['via Email', 'via LinkedIn', 'via SMS'];
const PERSONALIZATION = ['Barry personalizes each', 'Send as-is'];

// ─── Status helpers ───────────────────────────────────────────────────────────
// Unified status function — delegates to shared utility.
// See src/utils/contactEngageStatus.js for the canonical implementation.
const getContactWaveStatus = getContactEngageStatus;
const STATUS_CONFIG = ENGAGE_STATUS_CONFIG;

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ value, label, color, T }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, padding: '14px 16px',
      background: T.cardBg, border: `1px solid ${T.border}`,
      borderRadius: 10,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Contact Card (recipient selector) ────────────────────────────────────────
function ContactCard({ contact, selected, onToggle, T }) {
  const status = getContactWaveStatus(contact);
  const cfg = STATUS_CONFIG[status];
  const initials = [contact.first_name?.[0], contact.last_name?.[0]].filter(Boolean).join('').toUpperCase() ||
    contact.name?.slice(0, 2).toUpperCase() || '??';
  const photo = contact.photo_url;
  const email = contact.email || contact.work_email;
  const company = contact.company || contact.company_name;

  return (
    <div
      onClick={onToggle}
      style={{
        background: selected ? `${GREEN}08` : T.cardBg,
        border: `1px solid ${selected ? GREEN + '60' : T.border}`,
        borderRadius: 14, cursor: 'pointer',
        transition: 'all 0.12s',
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        overflow: 'visible',
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = T.border2 || T.border; } }}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = T.border; } }}
    >
      {/* Photo area */}
      <div style={{ position: 'relative', paddingTop: '90%', borderRadius: '14px 14px 0 0', overflow: 'hidden' }}>
        {photo ? (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center top' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(155deg,${GREEN}30,${T.cardBg2 || T.cardBg} 80%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: `${GREEN}20`, border: `2px solid ${GREEN}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: GREEN }}>
              {initials}
            </div>
          </div>
        )}
        {/* Gradient overlay */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(to top,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.5) 50%,transparent 100%)' }} />

        {/* Status badge top-right */}
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
            background: `${cfg.color}25`, color: cfg.color,
            border: `1px solid ${cfg.color}50`,
          }}>
            {cfg.label.toUpperCase()}
          </span>
        </div>

        {/* Selection checkbox top-left */}
        <div style={{
          position: 'absolute', top: 8, left: 8,
          width: 18, height: 18, borderRadius: '50%',
          border: `2px solid ${selected ? GREEN : 'rgba(255,255,255,0.5)'}`,
          background: selected ? GREEN : 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.12s',
        }}>
          {selected && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
        </div>

        {/* Name + title over gradient */}
        <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {contact.name || `${contact.first_name} ${contact.last_name}`}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
            {contact.title}
          </div>
        </div>
      </div>

      {/* Info section */}
      <div style={{ padding: '9px 12px 12px' }}>
        {company && (
          <div style={{ fontSize: 9, color: GREEN, background: `${GREEN}18`, borderRadius: 5, padding: '2px 7px', display: 'inline-block', marginBottom: 7, fontWeight: 700 }}>
            {company}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 11 }}>
          <Mail size={12} color={T.textFaint} />
          {email ? (
            <span style={{ color: T.text, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{email}</span>
          ) : (
            <span style={{ color: T.textFaint }}>No email found</span>
          )}
        </div>
        {/* Wave status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot }} />
          <span style={{ fontSize: 10, color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
        </div>
      </div>
    </div>
  );
}

// ─── WaveRow (past waves list item) ──────────────────────────────────────────
function WaveRow({ wave, T }) {
  const sentAt = wave.sentAt?.toDate?.() || (wave.sentAt ? new Date(wave.sentAt) : null);
  const dateStr = sentAt ? sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  const replyRate = wave.stats?.sent > 0
    ? Math.round((wave.stats.replied / wave.stats.sent) * 100)
    : 0;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', background: T.cardBg,
      border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 8,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: `${GREEN}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Radio size={16} color={GREEN} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{wave.name}</div>
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
          {dateStr} · {wave.stats?.sent ?? 0} sent
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: replyRate > 30 ? GREEN : T.textMuted }}>
          {replyRate}%
        </div>
        <div style={{ fontSize: 10, color: T.textFaint }}>replied</div>
      </div>
    </div>
  );
}

// ─── ScheduleRow (needs follow-through) ──────────────────────────────────────
function ScheduleRow({ contact, T }) {
  const status = getContactWaveStatus(contact);
  const cfg = STATUS_CONFIG[status];
  const initials = [contact.first_name?.[0], contact.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '??';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', background: T.cardBg,
      border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 8,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: `${GREEN}15`, border: `1.5px solid ${GREEN}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: GREEN, flexShrink: 0,
      }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
          {contact.name || `${contact.first_name} ${contact.last_name}`}
        </div>
        <div style={{ fontSize: 11, color: T.textFaint, marginTop: 1 }}>
          {contact.title}{contact.title && contact.company ? ', ' : ''}{contact.company}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot }} />
        <span style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
      </div>
      <button
        style={{
          padding: '5px 12px', borderRadius: 7,
          background: `${GREEN}15`, border: `1px solid ${GREEN}40`,
          color: GREEN, fontSize: 11, fontWeight: 600, cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Follow up
      </button>
    </div>
  );
}

// ─── Preview Panel (inline per-recipient email preview) ──────────────────────
function PreviewPanel({ contacts, selected, messageBody, templateType, channel, personalization, onClose, onLaunch, launching, T }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const recipients = contacts.filter(c => selected.has(c.id));
  const total = recipients.length;

  if (total === 0) return null;

  const contact = recipients[currentIdx];
  const firstName = contact.first_name || contact.name?.split(' ')[0] || 'there';
  const personalizedMsg = messageBody.replace(/\{\{first_name\}\}/gi, firstName);
  const subject = TEMPLATES[templateType]?.subject || 'Custom message';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 24px', borderBottom: `1px solid ${T.border}`, flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', color: T.textMuted,
          fontSize: 12, cursor: 'pointer', padding: 0,
        }}>
          <ArrowLeft size={14} /> Back to campaign
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.textFaint }}>
          Previewing {currentIdx + 1} of {total} recipients
        </span>
      </div>

      {/* Navigator */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 24px', flexShrink: 0,
      }}>
        <button
          onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
          style={{
            width: 28, height: 28, borderRadius: 7, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: T.surface, border: `1px solid ${T.border2}`,
            color: currentIdx === 0 ? T.textFaint : T.text,
            cursor: currentIdx === 0 ? 'default' : 'pointer',
          }}
        >
          <ChevronLeft size={14} />
        </button>

        {/* Recipient pills */}
        <div style={{ flex: 1, display: 'flex', gap: 6, overflow: 'auto' }}>
          {recipients.map((r, i) => {
            const rFirst = r.first_name || r.name?.split(' ')[0] || '?';
            const initials = [r.first_name?.[0], r.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '??';
            return (
              <button
                key={r.id}
                onClick={() => setCurrentIdx(i)}
                style={{
                  padding: '4px 10px', borderRadius: 14, flexShrink: 0,
                  border: `1px solid ${i === currentIdx ? GREEN : T.border2}`,
                  background: i === currentIdx ? `${GREEN}15` : 'transparent',
                  color: i === currentIdx ? GREEN : T.textMuted,
                  fontSize: 11, fontWeight: i === currentIdx ? 600 : 400,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: `${GREEN}18`, fontSize: 8, fontWeight: 700,
                  color: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {initials}
                </span>
                {rFirst}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setCurrentIdx(i => Math.min(total - 1, i + 1))}
          disabled={currentIdx === total - 1}
          style={{
            width: 28, height: 28, borderRadius: 7, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: T.surface, border: `1px solid ${T.border2}`,
            color: currentIdx === total - 1 ? T.textFaint : T.text,
            cursor: currentIdx === total - 1 ? 'default' : 'pointer',
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Email preview */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        <div style={{
          background: T.cardBg, border: `1px solid ${T.border}`,
          borderRadius: 12, overflow: 'hidden',
        }}>
          {/* Email header */}
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.border}` }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: T.textFaint, width: 32 }}>To:</span>
              <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>
                {contact.name || `${contact.first_name} ${contact.last_name}`}
                {contact.email && <span style={{ color: T.textFaint, fontWeight: 400 }}> &lt;{contact.email}&gt;</span>}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: T.textFaint, width: 32 }}>Subj:</span>
              <span style={{ fontSize: 12, color: T.text, fontWeight: 500 }}>{subject}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 11, color: T.textFaint, width: 32 }}>Via:</span>
              <span style={{ fontSize: 11, color: T.textMuted }}>{channel}</span>
            </div>
          </div>

          {/* Email body */}
          <div style={{ padding: '16px 16px 20px' }}>
            <div style={{
              fontSize: 13, color: T.text, lineHeight: 1.75,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {personalizedMsg}
            </div>
          </div>

          {/* Personalization note */}
          {personalization === 'Barry personalizes each' && (
            <div style={{
              padding: '10px 16px', borderTop: `1px solid ${T.border}`,
              background: `${GREEN}08`, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Zap size={12} color={GREEN} />
              <span style={{ fontSize: 11, color: GREEN }}>
                Barry will further personalize this using RECON context and Gmail history
              </span>
            </div>
          )}
        </div>

        {/* Contact info card */}
        <div style={{
          marginTop: 12, padding: '12px 16px',
          background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.textFaint, letterSpacing: 1, marginBottom: 8 }}>
            RECIPIENT DETAILS
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                {contact.name || `${contact.first_name} ${contact.last_name}`}
              </div>
              <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
                {contact.title}{contact.title && contact.company ? ' at ' : ''}{contact.company}
              </div>
            </div>
            {contact.email && (
              <div>
                <div style={{ fontSize: 10, color: T.textFaint }}>Email</div>
                <div style={{ fontSize: 11, color: T.text }}>{contact.email}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, color: T.textFaint }}>Status</div>
              <div style={{ fontSize: 11, color: STATUS_CONFIG[getContactWaveStatus(contact)]?.color }}>
                {STATUS_CONFIG[getContactWaveStatus(contact)]?.label}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom action bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderTop: `1px solid ${T.border}`,
        background: T.cardBg, flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: T.textMuted }}>
          <strong style={{ color: T.text }}>{total} recipients</strong> ready to launch
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            padding: '8px 14px', borderRadius: 8,
            border: `1px solid ${T.border2}`, background: T.surface,
            color: T.textMuted, fontSize: 12, cursor: 'pointer',
          }}>
            Edit campaign
          </button>
          <button
            onClick={onLaunch}
            disabled={launching}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 8,
              border: `1px solid ${GREEN}`, background: `${GREEN}20`,
              color: GREEN, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              opacity: launching ? 0.7 : 1,
            }}
          >
            <Send size={13} /> Launch wave →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mission Email Row (individual sent email in launch center) ──────────────
function MissionEmailRow({ contact, wave, index, sendResult, T }) {
  const [expanded, setExpanded] = useState(false);
  const firstName = contact.first_name || contact.name?.split(' ')[0] || 'there';
  const personalizedMsg = wave.message.replace(/\{\{first_name\}\}/gi, firstName);
  const subject = wave.subject || TEMPLATES[wave.type]?.subject || wave.name || 'Custom message';
  const initials = [contact.first_name?.[0], contact.last_name?.[0]]
    .filter(Boolean).join('').toUpperCase() || '??';
  const displayName = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
  const previewText = personalizedMsg.slice(0, 90) + (personalizedMsg.length > 90 ? '...' : '');

  // Determine send status
  const status = sendResult?.status || (wave._sending ? 'pending' : wave._scheduled ? 'scheduled' : 'sent');
  const statusConfig = {
    sent:      { label: 'Sent',      color: GREEN, icon: CheckCircle2 },
    failed:    { label: 'Failed',    color: RED,   icon: AlertCircle  },
    skipped:   { label: 'Skipped',   color: AMBER, icon: AlertCircle  },
    pending:   { label: 'Sending…',  color: GRAY,  icon: RotateCcw    },
    scheduled: { label: 'Scheduled', color: BLUE,  icon: Clock        },
  };
  const sc = statusConfig[status] || statusConfig.sent;
  const StatusIcon = sc.icon;

  return (
    <div
      style={{
        background: T.cardBg, border: `1px solid ${T.border}`,
        borderRadius: 10, marginBottom: 6, overflow: 'hidden',
        animation: `missionSlideIn 0.3s ease ${index * 0.06}s both`,
      }}
    >
      {/* Row — click to expand */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', cursor: 'pointer',
          transition: 'background 0.1s',
        }}
      >
        {/* Status indicator */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%', background: sc.color, flexShrink: 0,
          boxShadow: `0 0 6px ${sc.color}60`,
          ...(status === 'pending' ? { animation: 'pulse 1.2s ease infinite' } : {}),
        }} />

        {/* Avatar */}
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: `${GREEN}15`, border: `1.5px solid ${GREEN}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: GREEN, flexShrink: 0,
        }}>
          {initials}
        </div>

        {/* To + subject + preview (Gmail-style) */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text, flexShrink: 0, minWidth: 0 }}>
            To: {displayName}
          </span>
          {contact.email && (
            <span style={{ fontSize: 11, color: T.textFaint, flexShrink: 0 }}>
              &lt;{contact.email}&gt;
            </span>
          )}
        </div>

        <div style={{ flex: 2, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{subject}</span>
          <span style={{ fontSize: 12, color: T.textFaint }}> — {previewText}</span>
        </div>

        {/* Status badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 12,
          background: `${sc.color}12`, flexShrink: 0,
        }}>
          <StatusIcon size={11} color={sc.color}
            style={status === 'pending' ? { animation: 'spin 1s linear infinite' } : {}}
          />
          <span style={{ fontSize: 10, fontWeight: 600, color: sc.color }}>{sc.label}</span>
        </div>

        {/* Expand arrow */}
        <ChevronDown
          size={14}
          color={T.textFaint}
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.15s',
            flexShrink: 0,
          }}
        />
      </div>

      {/* Expanded email body */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${T.border}`,
          padding: '14px 16px 16px',
          marginLeft: 48,
        }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10,
              background: `${GREEN}12`, color: GREEN, fontWeight: 600,
            }}>
              {wave.channel}
            </span>
            {wave.personalization === 'Barry personalizes each' && (
              <span style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 10,
                background: `${BLUE}12`, color: BLUE, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 3,
              }}>
                <Zap size={9} /> Barry personalized
              </span>
            )}
          </div>
          <div style={{
            fontSize: 13, color: T.text, lineHeight: 1.75,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {personalizedMsg}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Launch Center (mission deployment view) ─────────────────────────────────
function LaunchCenter({ wave, contacts, onDismiss, sendProgress, launchError, T }) {
  const recipients = contacts.filter(c => wave.recipientIds?.includes(c.id));
  const sentAt = wave.sentAt?.toDate?.() || (wave.sentAt ? new Date(wave.sentAt) : new Date());
  const timeStr = sentAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateStr = sentAt.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  const isSending = wave._sending;
  const isScheduled = wave._scheduled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mission header */}
      <div style={{
        padding: '16px 24px', flexShrink: 0,
        borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: `${GREEN}15`, border: `1.5px solid ${GREEN}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Send size={18} color={GREEN} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
            {isScheduled ? `Mission Scheduled — ${wave.name}`
              : isSending ? `Deploying Mission — ${wave.name}`
              : `Mission Deployed — ${wave.name}`}
          </div>
          <div style={{ fontSize: 12, color: T.textFaint, marginTop: 2 }}>
            {isScheduled
              ? `${recipients.length} emails scheduled for ${dateStr} at ${timeStr}`
              : isSending
                ? `Sending ${sendProgress?.sent || 0} of ${recipients.length} emails…`
                : `${sendProgress?.sent ?? recipients.length} of ${recipients.length} emails sent ${dateStr} at ${timeStr}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onDismiss} style={{
            padding: '7px 14px', borderRadius: 8,
            border: `1px solid ${T.border2}`, background: T.surface,
            color: T.textMuted, fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>
            New campaign
          </button>
          <button onClick={() => onDismiss('past')} style={{
            padding: '7px 14px', borderRadius: 8,
            border: `1px solid ${GREEN}`, background: `${GREEN}15`,
            color: GREEN, fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>
            View all waves
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 10, padding: '14px 24px 0', flexShrink: 0 }}>
        <StatCard value={sendProgress?.sent ?? wave.stats?.sent ?? 0} label="Deployed" color={GREEN} T={T} />
        <StatCard value={sendProgress?.failed ?? 0} label="Failed" color={sendProgress?.failed > 0 ? RED : GRAY} T={T} />
        <StatCard value={wave.stats?.replied || 0} label="Replies" color={BLUE} T={T} />
      </div>

      {/* Error banner */}
      {launchError && (
        <div style={{
          margin: '10px 24px 0', padding: '10px 14px', borderRadius: 8,
          background: `${RED}10`, border: `1px solid ${RED}30`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertCircle size={14} color={RED} />
          <span style={{ fontSize: 12, color: RED }}>{launchError}</span>
        </div>
      )}

      {/* Sending progress bar */}
      {isSending && sendProgress && (
        <div style={{ padding: '10px 24px 0' }}>
          <div style={{
            height: 4, borderRadius: 2, background: T.border,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 2, background: GREEN,
              width: `${Math.round((sendProgress.sent / sendProgress.total) * 100)}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {/* Section label */}
      <div style={{ padding: '14px 24px 8px', flexShrink: 0 }}>
        <div style={{
          fontSize: 11, letterSpacing: 1.5, fontWeight: 700, color: T.textFaint,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Mail size={12} />
          SENT MESSAGES
        </div>
      </div>

      {/* Email list (Gmail-style) */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        {recipients.map((contact, i) => {
          const sendResult = sendProgress?.results?.find(r => r.contactId === contact.id);
          return (
            <MissionEmailRow
              key={contact.id}
              contact={contact}
              wave={wave}
              index={i}
              sendResult={sendResult}
              T={T}
            />
          );
        })}
      </div>

      <style>{`
        @keyframes missionSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EngagementCenter() {
  const T = useT();
  const activeUser = useActiveUser();

  const [contacts, setContacts]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState('new');
  const [templateType, setTemplateType] = useState('checkin');
  const [messageBody, setMessageBody] = useState(TEMPLATES.checkin.body);
  const [channel, setChannel]         = useState(CHANNELS[0]);
  const [personalization, setPersonalization] = useState(PERSONALIZATION[0]);
  const [selected, setSelected]       = useState(new Set());
  const [waves, setWaves]             = useState([]);
  const [launching, setLaunching]     = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [launchedWave, setLaunchedWave] = useState(null);
  const [sendProgress, setSendProgress] = useState(null); // { sent, failed, total, results[] }
  const [launchError, setLaunchError] = useState(null);
  const [scheduleMode, setScheduleMode] = useState('now'); // 'now' | 'scheduled'
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('09:00');

  // ── Load contacts ──────────────────────────────────────────────────────────
  useEffect(() => {
    const user = activeUser || auth.currentUser;
    if (!user) return;

    const ref = collection(db, 'users', user.uid, 'contacts');
    const unsub = onSnapshot(ref, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => !c.is_archived && resolveContactStage(c) === 'basecamp');
      setContacts(docs);
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [activeUser]);

  // ── Load past waves ────────────────────────────────────────────────────────
  useEffect(() => {
    const user = activeUser || auth.currentUser;
    if (!user) return;

    const ref = collection(db, 'users', user.uid, 'waves');
    const unsub = onSnapshot(ref, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const aTime = a.sentAt?.toMillis?.() || 0;
          const bTime = b.sentAt?.toMillis?.() || 0;
          return bTime - aTime;
        });
      setWaves(docs);
    });

    return unsub;
  }, [activeUser]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const overdue  = contacts.filter(c => getContactWaveStatus(c) === 'overdue').length;
    const active   = contacts.filter(c => getContactWaveStatus(c) === 'active').length;
    const replied  = contacts.filter(c => getContactWaveStatus(c) === 'replied').length;
    return { total: contacts.length, overdue, active, replied };
  }, [contacts]);

  const overdueContacts = useMemo(
    () => contacts.filter(c => getContactWaveStatus(c) === 'overdue'),
    [contacts]
  );

  // Contacts needing follow-through (replied or awaiting follow-up)
  const scheduleContacts = useMemo(
    () => contacts.filter(c =>
      c.contact_status === 'Awaiting Reply' ||
      c.contact_status === 'In Conversation' ||
      c.next_best_step?.type === 'schedule_meeting'
    ),
    [contacts]
  );

  // ── Template switching ─────────────────────────────────────────────────────
  const handleTemplateChange = useCallback((type) => {
    setTemplateType(type);
    if (type !== 'custom') setMessageBody(TEMPLATES[type].body);
    else setMessageBody('');
  }, []);

  // ── Selection logic ────────────────────────────────────────────────────────
  const toggleContact = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllOverdue = useCallback(() => {
    setSelected(new Set(overdueContacts.map(c => c.id)));
  }, [overdueContacts]);

  // ── Launch wave ────────────────────────────────────────────────────────────
  const handleLaunchWave = useCallback(async () => {
    if (selected.size === 0 || !messageBody.trim()) return;

    const user = activeUser || auth.currentUser;
    if (!user) return;

    setLaunching(true);
    setLaunchError(null);
    setSendProgress(null);

    try {
      const waveName = TEMPLATES[templateType]?.label || 'Custom wave';
      const subject = TEMPLATES[templateType]?.subject || waveName;
      const recipientIds = Array.from(selected);
      const recipientContacts = contacts.filter(c => selected.has(c.id));

      // If scheduled for later, save to Firestore with pending status
      if (scheduleMode === 'scheduled' && scheduledDate) {
        const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
        const waveData = {
          name: waveName,
          type: templateType,
          message: messageBody,
          subject,
          channel,
          personalization,
          recipientIds,
          status: 'scheduled',
          scheduledFor: scheduledFor.toISOString(),
          createdAt: serverTimestamp(),
          stats: { sent: 0, replied: 0, booked: 0 },
        };

        const docRef = await addDoc(collection(db, 'users', user.uid, 'waves'), waveData);
        setLaunchSuccess(true);
        setShowPreview(false);
        setLaunchedWave({
          id: docRef.id, ...waveData,
          sentAt: scheduledFor,
          _scheduled: true,
        });
        setSelected(new Set());
        return;
      }

      // Check Gmail connection before proceeding
      const gmailStatus = await checkGmailConnection(user.uid);
      if (!gmailStatus.connected) {
        setLaunchError('Gmail not connected. Go to Settings → Integrations to connect Gmail.');
        setLaunching(false);
        return;
      }

      // Create wave doc first (status = sending)
      const waveData = {
        name: waveName,
        type: templateType,
        message: messageBody,
        subject,
        channel,
        personalization,
        recipientIds,
        status: 'sending',
        sentAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        stats: { sent: 0, replied: 0, booked: 0 },
      };

      const docRef = await addDoc(collection(db, 'users', user.uid, 'waves'), waveData);

      // Show launch center immediately with sending state
      setShowPreview(false);
      setLaunchedWave({
        id: docRef.id, ...waveData,
        sentAt: new Date(),
        _sending: true,
      });
      setSendProgress({ sent: 0, failed: 0, total: recipientContacts.length, results: [] });
      setSelected(new Set());

      // Build recipients payload
      const recipients = recipientContacts.map(c => ({
        contactId: c.id,
        email: c.email,
        firstName: c.first_name,
        lastName: c.last_name,
        name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        existingThreadId: c.gmail_thread_id || null,
      }));

      // Call the wave send function
      const authToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/gmail-send-wave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          waveId: docRef.id,
          subject,
          messageTemplate: messageBody,
          recipients,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send wave');
      }

      // Update progress with final results
      setSendProgress({
        sent: data.sent,
        failed: data.total - data.sent,
        total: data.total,
        results: data.results || [],
      });

      // Update launched wave with final stats
      setLaunchedWave(prev => ({
        ...prev,
        _sending: false,
        status: 'processed',
        stats: { sent: data.sent, replied: 0, booked: 0 },
      }));

      setLaunchSuccess(true);

    } catch (err) {
      console.error('Wave launch error:', err);
      setLaunchError(err.message);
      // Update wave status if it was partially sent
      setLaunchedWave(prev => prev ? { ...prev, _sending: false } : null);
    } finally {
      setLaunching(false);
    }
  }, [selected, messageBody, templateType, channel, personalization, activeUser, contacts, scheduleMode, scheduledDate, scheduledTime]);

  // ── Open preview ──────────────────────────────────────────────────────────
  const handleOpenPreview = useCallback(() => {
    if (selected.size === 0 || !messageBody.trim()) return;
    setShowPreview(true);
  }, [selected, messageBody]);

  // ── Dismiss launch center ─────────────────────────────────────────────────
  const handleDismissLaunchCenter = useCallback((goTo) => {
    setLaunchedWave(null);
    setLaunchSuccess(false);
    if (goTo === 'past') setActiveTab('past');
    else setActiveTab('new');
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  // Launch Center view (post-launch review)
  if (launchedWave) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <LaunchCenter
          wave={launchedWave}
          contacts={contacts}
          onDismiss={handleDismissLaunchCenter}
          sendProgress={sendProgress}
          launchError={launchError}
          T={T}
        />
      </div>
    );
  }

  // Preview panel view (pre-launch review)
  if (showPreview) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <PreviewPanel
          contacts={contacts}
          selected={selected}
          messageBody={messageBody}
          templateType={templateType}
          channel={channel}
          personalization={personalization}
          onClose={() => setShowPreview(false)}
          onLaunch={handleLaunchWave}
          launching={launching}
          T={T}
        />
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* ── Page header ── */}
      <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Basecamp Engagement Center</div>
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>
          Run campaigns, check-in waves, and product updates across your Basecamp customers
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{ display: 'flex', gap: 10, padding: '16px 24px 0', flexShrink: 0 }}>
        <StatCard value={stats.total}   label="Total contacts"      color={T.text}  T={T} />
        <StatCard value={stats.overdue} label="Overdue follow-up"   color={RED}     T={T} />
        <StatCard value={stats.active}  label="Active this week"    color={AMBER}   T={T} />
        <StatCard value={stats.replied} label="Replied recently"    color={GREEN}   T={T} />
      </div>

      {/* ── Tab nav ── */}
      <div style={{ display: 'flex', gap: 8, padding: '14px 24px 0', flexShrink: 0 }}>
        {[
          { id: 'new',        label: 'New campaign'  },
          { id: 'past',       label: 'Past waves'    },
          { id: 'scheduling', label: 'Scheduling'    },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '6px 14px', borderRadius: 20,
              border: `1px solid ${activeTab === tab.id ? GREEN : T.border2}`,
              background: activeTab === tab.id ? `${GREEN}15` : T.cardBg,
              color: activeTab === tab.id ? GREEN : T.textMuted,
              fontSize: 12, fontWeight: activeTab === tab.id ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.12s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 24px 0' }}>

        {/* ════ NEW CAMPAIGN TAB ════ */}
        {activeTab === 'new' && (
          <>
            {/* Message composer */}
            <div style={{
              background: T.cardBg, border: `1px solid ${T.border}`,
              borderRadius: 12, padding: 16, marginBottom: 16,
            }}>
              {/* Row: Message label + template tabs */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Message</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(TEMPLATES).map(([key, tpl]) => (
                    <button
                      key={key}
                      onClick={() => handleTemplateChange(key)}
                      style={{
                        padding: '4px 11px', borderRadius: 16,
                        border: `1px solid ${templateType === key ? GREEN : T.border2}`,
                        background: templateType === key ? `${GREEN}15` : 'transparent',
                        color: templateType === key ? GREEN : T.textMuted,
                        fontSize: 11, fontWeight: templateType === key ? 600 : 400,
                        cursor: 'pointer', transition: 'all 0.12s',
                      }}
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message textarea */}
              <textarea
                value={messageBody}
                onChange={e => setMessageBody(e.target.value)}
                placeholder="Write your message... Use {{first_name}} to personalize"
                rows={4}
                style={{
                  width: '100%', resize: 'vertical',
                  background: T.surface, border: `1px solid ${T.border2}`,
                  borderRadius: 8, padding: '10px 12px',
                  fontSize: 13, color: T.text, lineHeight: 1.6,
                  outline: 'none', boxSizing: 'border-box',
                }}
              />

              {/* Channel + personalization + action buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {/* Channel dropdown */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <select
                    value={channel}
                    onChange={e => setChannel(e.target.value)}
                    style={{
                      appearance: 'none', padding: '7px 28px 7px 10px',
                      background: T.surface, border: `1px solid ${T.border2}`,
                      borderRadius: 8, color: T.text, fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {CHANNELS.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <ChevronDown size={12} color={T.textFaint} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                </div>

                {/* Personalization dropdown */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <select
                    value={personalization}
                    onChange={e => setPersonalization(e.target.value)}
                    style={{
                      appearance: 'none', padding: '7px 28px 7px 10px',
                      background: T.surface, border: `1px solid ${T.border2}`,
                      borderRadius: 8, color: T.text, fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {PERSONALIZATION.map(p => <option key={p}>{p}</option>)}
                  </select>
                  <ChevronDown size={12} color={T.textFaint} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                </div>

                {/* Schedule toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => setScheduleMode(scheduleMode === 'now' ? 'scheduled' : 'now')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '7px 10px', borderRadius: 8,
                      border: `1px solid ${scheduleMode === 'scheduled' ? BLUE : T.border2}`,
                      background: scheduleMode === 'scheduled' ? `${BLUE}10` : T.surface,
                      color: scheduleMode === 'scheduled' ? BLUE : T.textMuted,
                      fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    <Clock size={12} />
                    {scheduleMode === 'scheduled' ? 'Scheduled' : 'Send now'}
                  </button>
                  {scheduleMode === 'scheduled' && (
                    <>
                      <input
                        type="date"
                        value={scheduledDate}
                        onChange={e => setScheduledDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        style={{
                          padding: '6px 8px', borderRadius: 8,
                          border: `1px solid ${T.border2}`, background: T.surface,
                          color: T.text, fontSize: 12,
                        }}
                      />
                      <input
                        type="time"
                        value={scheduledTime}
                        onChange={e => setScheduledTime(e.target.value)}
                        style={{
                          padding: '6px 8px', borderRadius: 8,
                          border: `1px solid ${T.border2}`, background: T.surface,
                          color: T.text, fontSize: 12,
                        }}
                      />
                    </>
                  )}
                </div>

                <div style={{ flex: 1 }} />

                {/* Preview button */}
                <button
                  onClick={handleOpenPreview}
                  disabled={selected.size === 0 || !messageBody.trim()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 8,
                    border: `1px solid ${selected.size > 0 && messageBody.trim() ? GREEN : T.border2}`,
                    background: selected.size > 0 && messageBody.trim() ? `${GREEN}10` : T.surface,
                    color: selected.size > 0 && messageBody.trim() ? GREEN : T.textFaint,
                    fontSize: 12, fontWeight: 500,
                    cursor: selected.size === 0 || !messageBody.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Eye size={13} />
                  Preview ↗
                </button>

                {/* Launch wave button */}
                <button
                  onClick={handleLaunchWave}
                  disabled={launching || launchSuccess || selected.size === 0 || !messageBody.trim()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 16px', borderRadius: 8,
                    border: `1px solid ${launchSuccess ? GREEN : selected.size > 0 && messageBody.trim() ? GREEN : T.border2}`,
                    background: launchSuccess ? GREEN : selected.size > 0 && messageBody.trim() ? `${GREEN}20` : T.surface,
                    color: launchSuccess ? '#fff' : selected.size > 0 && messageBody.trim() ? GREEN : T.textFaint,
                    fontSize: 12, fontWeight: 600, cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s', opacity: launching ? 0.7 : 1,
                  }}
                >
                  {launchSuccess
                    ? <><CheckCircle2 size={13} /> Launched!</>
                    : launching
                      ? <><RotateCcw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Launching...</>
                      : <><Send size={13} /> Launch wave →</>
                  }
                </button>
              </div>

              {/* Launch error display */}
              {launchError && !launchedWave && (
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 8,
                  background: `${RED}10`, border: `1px solid ${RED}30`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <AlertCircle size={13} color={RED} />
                  <span style={{ fontSize: 12, color: RED }}>{launchError}</span>
                </div>
              )}
            </div>

            {/* SELECT RECIPIENTS */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 700, color: T.textFaint }}>
                  SELECT RECIPIENTS
                </span>
                {overdueContacts.length > 0 && (
                  <button
                    onClick={selectAllOverdue}
                    style={{
                      background: 'none', border: 'none', padding: 0,
                      color: GREEN, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    }}
                  >
                    Select all overdue ({overdueContacts.length})
                  </button>
                )}
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
                  Loading contacts...
                </div>
              ) : contacts.length === 0 ? (
                <div style={{
                  textAlign: 'center', padding: 40,
                  background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 12,
                  color: T.textFaint, fontSize: 13,
                }}>
                  <Users size={24} style={{ marginBottom: 8, opacity: 0.4 }} />
                  <div>No Basecamp customers yet. Move contacts to Basecamp by setting their type to Customer.</div>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 10,
                  paddingBottom: selected.size > 0 ? 80 : 24,
                }}>
                  {contacts.map(contact => (
                    <ContactCard
                      key={contact.id}
                      contact={contact}
                      selected={selected.has(contact.id)}
                      onToggle={() => toggleContact(contact.id)}
                      T={T}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ════ PAST WAVES TAB ════ */}
        {activeTab === 'past' && (
          <div style={{ paddingBottom: 24 }}>
            {waves.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '48px 24px',
                background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 12,
                color: T.textFaint,
              }}>
                <Radio size={28} style={{ marginBottom: 10, opacity: 0.35 }} />
                <div style={{ fontSize: 14, fontWeight: 500, color: T.textMuted, marginBottom: 6 }}>
                  No waves launched yet
                </div>
                <div style={{ fontSize: 12 }}>
                  Launch your first wave from the New campaign tab.
                </div>
              </div>
            ) : (
              waves.map(wave => <WaveRow key={wave.id} wave={wave} T={T} />)
            )}
          </div>
        )}

        {/* ════ SCHEDULING TAB ════ */}
        {activeTab === 'scheduling' && (
          <div style={{ paddingBottom: 24 }}>
            <div style={{ fontSize: 12, color: T.textFaint, marginBottom: 14 }}>
              Contacts awaiting follow-through — who said yes but hasn't booked yet.
            </div>
            {scheduleContacts.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '48px 24px',
                background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 12,
                color: T.textFaint,
              }}>
                <Calendar size={28} style={{ marginBottom: 10, opacity: 0.35 }} />
                <div style={{ fontSize: 14, fontWeight: 500, color: T.textMuted, marginBottom: 6 }}>
                  No pending follow-throughs
                </div>
                <div style={{ fontSize: 12 }}>
                  When contacts are awaiting replies or meetings, they'll show here.
                </div>
              </div>
            ) : (
              scheduleContacts.map(c => <ScheduleRow key={c.id} contact={c} T={T} />)
            )}
          </div>
        )}
      </div>

      {/* ── Fixed bottom bar (when contacts selected) ── */}
      {activeTab === 'new' && selected.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, left: 0, right: 0,
          background: T.cardBg, borderTop: `1px solid ${T.border}`,
          padding: '12px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, zIndex: 10,
          boxShadow: `0 -4px 20px ${T.isDark ? '#00000060' : '#0000001a'}`,
        }}>
          <span style={{ fontSize: 12, color: T.textMuted }}>
            <strong style={{ color: T.text }}>{selected.size} contacts selected</strong>
            {personalization === PERSONALIZATION[0]
              ? ' — Barry will personalize each message using RECON context and Gmail history'
              : ' — message will be sent as-is'
            }
          </span>
          <button
            onClick={handleOpenPreview}
            disabled={!messageBody.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 8,
              border: `1px solid ${GREEN}`, background: `${GREEN}20`,
              color: GREEN, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <Eye size={13} /> Preview messages ↗
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
