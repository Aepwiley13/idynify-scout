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
  Users, AlertCircle, Radio,
} from 'lucide-react';
import { collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { useT } from '../../../theme/ThemeContext';
import { useActiveUser } from '../../../context/ImpersonationContext';

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
function getContactWaveStatus(contact) {
  const now = Date.now();
  const lastContactAt = contact.engagement_summary?.last_contact_at;
  const nbsDueAt = contact.next_best_step?.due_at;
  const contactStatus = contact.contact_status;
  const warmth = contact.warmth_level;

  // Replied = in conversation recently
  if (
    contactStatus === 'In Conversation' ||
    (lastContactAt && (now - new Date(lastContactAt).getTime()) < 3 * 86400_000 &&
      contact.engagement_summary?.replies_received > 0)
  ) return 'replied';

  // Active = contacted within the week
  if (
    contactStatus === 'Active Customer' ||
    contactStatus === 'Engaged' ||
    (lastContactAt && (now - new Date(lastContactAt).getTime()) < OVERDUE_DAYS * 86400_000)
  ) return 'active';

  // Cold = never reached out, cold warmth, or New status
  if (
    !lastContactAt ||
    contactStatus === 'New' ||
    warmth === 'cold'
  ) return 'cold';

  // Overdue = NBS past due, or Dormant, or just too long
  if (
    nbsDueAt && new Date(nbsDueAt).getTime() < now ||
    contactStatus === 'Dormant' ||
    contactStatus === 'Awaiting Reply' ||
    (lastContactAt && (now - new Date(lastContactAt).getTime()) >= OVERDUE_DAYS * 86400_000)
  ) return 'overdue';

  return 'overdue';
}

const STATUS_CONFIG = {
  overdue: { label: 'Overdue', color: RED,   dot: RED   },
  active:  { label: 'Active',  color: GREEN, dot: GREEN },
  cold:    { label: 'Cold',    color: AMBER, dot: AMBER },
  replied: { label: 'Replied', color: BLUE,  dot: BLUE  },
};

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

  return (
    <div
      onClick={onToggle}
      style={{
        padding: '12px 14px',
        background: selected ? `${GREEN}08` : T.cardBg,
        border: `1px solid ${selected ? GREEN + '60' : T.border}`,
        borderRadius: 10, cursor: 'pointer',
        transition: 'all 0.12s',
        position: 'relative',
      }}
    >
      {/* Checkbox */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        width: 16, height: 16, borderRadius: '50%',
        border: `1.5px solid ${selected ? GREEN : T.border2}`,
        background: selected ? GREEN : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.12s',
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
      </div>

      {/* Avatar */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: `${GREEN}18`, border: `1.5px solid ${GREEN}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: GREEN, marginBottom: 8,
      }}>
        {initials}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, lineHeight: 1.3 }}>
        {contact.name || `${contact.first_name} ${contact.last_name}`}
      </div>
      <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2, marginBottom: 8, lineHeight: 1.3 }}>
        {contact.title}{contact.title && contact.company ? ', ' : ''}{contact.company}
      </div>

      {/* Status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot }} />
        <span style={{ fontSize: 10, color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
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

  // ── Load contacts ──────────────────────────────────────────────────────────
  useEffect(() => {
    const user = activeUser || auth.currentUser;
    if (!user) return;

    const ref = collection(db, 'users', user.uid, 'contacts');
    const unsub = onSnapshot(ref, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => !c.is_archived);
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
    try {
      const waveName = TEMPLATES[templateType]?.label || 'Custom wave';
      const waveData = {
        name: waveName,
        type: templateType,
        message: messageBody,
        channel,
        personalization,
        recipientIds: Array.from(selected),
        status: 'sent',
        sentAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        stats: {
          sent: selected.size,
          replied: 0,
          booked: 0,
        },
      };

      await addDoc(collection(db, 'users', user.uid, 'waves'), waveData);

      setLaunchSuccess(true);
      setSelected(new Set());
      setTimeout(() => {
        setLaunchSuccess(false);
        setActiveTab('past');
      }, 2000);
    } catch (err) {
      console.error('Wave launch error:', err);
    } finally {
      setLaunching(false);
    }
  }, [selected, messageBody, templateType, channel, personalization, activeUser]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* ── Page header ── */}
      <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Engagement center</div>
        <div style={{ fontSize: 12, color: T.textFaint, marginTop: 3 }}>
          Run campaigns, check-in waves, and product updates across your contacts
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

                <div style={{ flex: 1 }} />

                {/* Preview button */}
                <button
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 8,
                    border: `1px solid ${T.border2}`, background: T.surface,
                    color: T.textMuted, fontSize: 12, fontWeight: 500, cursor: 'pointer',
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
                  <div>No contacts yet. Add some from the People tab.</div>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
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
            onClick={handleLaunchWave}
            disabled={launching || !messageBody.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 8,
              border: `1px solid ${GREEN}`, background: `${GREEN}20`,
              color: GREEN, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Preview messages ↗
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
