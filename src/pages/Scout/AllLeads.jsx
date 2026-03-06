/**
 * AllLeads.jsx — Contact grid/list with brigade tabs, Person modal, and full profile.
 *
 * UI: idynify-v5 design (cards + Gmail-style list toggle, Person modal, Contact Profile).
 * Data: Firebase Firestore (all original data loading preserved).
 */
import { useEffect, useState, useRef } from 'react';
import { collection, getDocs, doc, updateDoc, arrayUnion, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building2, Mail, Linkedin, Search, Download,
  Phone, X, Zap, ExternalLink, ChevronLeft, Menu, RotateCcw, RefreshCw, MessageSquare,
  Target, Plus, Loader, ArrowUpDown,
} from 'lucide-react';
import { BRIGADES, BRIGADE_MAP } from '../../components/contacts/BrigadeSelector';
import { onBrigadeChange } from '../../utils/brigadeSystem';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS, BRIGADE, STATUS_COLORS, ASSETS } from '../../theme/tokens';
import ContactProfile from './ContactProfile';
import LinkedInLinkSearch from '../../components/scout/LinkedInLinkSearch';

// ─── BarryAvatar ─────────────────────────────────────────────────────────────
function BarryAvatar({ size = 22, style = {} }) {
  const glow = `0 0 ${size * 0.5}px ${BRAND.cyan}50`;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `linear-gradient(135deg,${BRAND.pink},${BRAND.cyan})`,
      border: `2px solid ${BRAND.cyan}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.46, flexShrink: 0, boxShadow: glow, overflow: 'hidden', ...style,
    }}>
      <img
        src={ASSETS.barryAvatar}
        alt="Barry AI"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
      />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getLeadStatus(contact) {
  const s = contact.contact_status || contact.lead_status || contact.status;
  if (!s || s === 'saved' || s === 'pending_enrichment' || s === 'active' || s === 'exported') return 'not_contacted';
  if (s === 'contacted' || s === 'engaged') return 'engaged';
  if (s === 'awaiting_reply') return 'awaiting_reply';
  if (s === 'in_pipeline') return 'in_pipeline';
  if (s === 'snoozed') return 'snoozed';
  if (s === 'follow_up') return 'follow_up';
  return 'not_contacted';
}

// Lightweight engagement state derived from document fields only (no Firestore reads).
// Used for card button color/label and sort order.
// States: 'not_started' | 'in_mission' | 'follow_up_due' | 'converted'
//
// All hunter statuses that represent active engagement (not just 'active_mission').
const ENGAGED_HUNTER_STATUSES = new Set([
  'active_mission', 'awaiting_reply', 'engaged_pending', 'in_conversation'
]);

// Contact statuses that mean the contact has been engaged — used as a fallback
// when hunter_status is not yet set (e.g. Scout engage before Barry processes).
const ENGAGED_CONTACT_STATUSES = new Set([
  'Engaged', 'Awaiting Reply', 'In Conversation',
  // Legacy statuses — included so old contacts are correctly classified
  'In Campaign', 'Active Mission', 'Mission Complete',
]);

function deriveCardEngageState(contact) {
  const contactStatus = contact.contact_status || contact.lead_status || contact.status;
  const hunterStatus = contact.hunter_status;

  if (contactStatus === 'converted' || contactStatus === 'customer' || hunterStatus === 'converted') return 'converted';

  // Sprint 3: in_conversation → replied (check both hunter and contact status)
  if (hunterStatus === 'in_conversation' || contactStatus === 'In Conversation') return 'replied';

  if (ENGAGED_HUNTER_STATUSES.has(hunterStatus)) {
    if (contact.next_step_due && new Date(contact.next_step_due) < new Date()) {
      return 'follow_up_due';
    }
    return 'in_mission';
  }

  // Fallback: hunter_status not set yet but contact_status shows prior engagement
  // (happens between Scout engage click and Barry processing the mission)
  if (ENGAGED_CONTACT_STATUSES.has(contactStatus)) {
    if (contact.next_step_due && new Date(contact.next_step_due) < new Date()) {
      return 'follow_up_due';
    }
    return 'in_mission';
  }

  return 'not_started';
}

// Sort priority: overdue → replied → active mission → not started → converted
const ENGAGE_SORT_ORDER = { follow_up_due: 0, replied: 1, in_mission: 2, not_started: 3, converted: 4 };

// Button config per engagement state
const CARD_BTN_CONFIG = {
  not_started:   { label: 'Engage',        bg: `linear-gradient(135deg,${BRAND.pink},#c0146a)` },
  in_mission:    { label: 'Follow Up',     bg: 'linear-gradient(135deg,#7c3aed,#5b21b6)' },
  follow_up_due: { label: 'Follow Up Now', bg: 'linear-gradient(135deg,#dc2626,#991b1b)' },
  replied:       { label: 'Respond',       bg: 'linear-gradient(135deg,#0ea5e9,#0284c7)' },
  converted:     { label: 'View',          bg: 'linear-gradient(135deg,#10b981,#047857)' },
};


function getLastAction(contact) {
  if (contact.activity_log?.length > 0) {
    const latest = [...contact.activity_log].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    const time = formatRelativeTime(latest.timestamp);
    if (time) return time;
  }
  const savedAt = contact.saved_at || contact.addedAt;
  if (savedAt) {
    const time = formatRelativeTime(typeof savedAt === 'object' && savedAt.toDate ? savedAt.toDate().toISOString() : savedAt);
    if (time) return `Added ${time}`;
  }
  return 'New';
}

// Hunter-specific last action: prefers reply > sent > engaged timestamps.
function getHunterLastAction(contact) {
  if (contact.last_reply_at) {
    const t = formatRelativeTime(contact.last_reply_at);
    if (t) return `Replied ${t}`;
  }
  if (contact.last_sent_at) {
    const t = formatRelativeTime(contact.last_sent_at);
    if (t) return `Sent ${t}`;
  }
  if (contact.hunter_engaged_at) {
    const t = formatRelativeTime(contact.hunter_engaged_at);
    if (t) return `Engaged ${t}`;
  }
  return getLastAction(contact);
}

function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function getBrigadeType(contact) {
  const b = contact.brigade;
  if (b) return b.toLowerCase();
  const rt = contact.relationship_type;
  if (rt === 'partner') return 'partners';
  if (rt === 'known') return 'network';
  const status = contact.contact_status || contact.lead_status || contact.status;
  if (status === 'converted' || status === 'customer') return 'customers';
  if (status === 'referred') return 'referrals';
  return 'leads';
}

const STATUS_LABELS = {
  not_contacted:  'NOT CONTACTED',
  engaged:        'ENGAGED',
  awaiting_reply: 'AWAITING REPLY',
  in_pipeline:    'IN PIPELINE',
  snoozed:        'SNOOZED',
  follow_up:      'FOLLOW UP',
};

// ─── StatusBadge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, small }) {
  const sc = STATUS_COLORS[status] || STATUS_COLORS.not_contacted;
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '1px 7px' : '3px 10px', borderRadius: 20,
      background: sc.bg, color: sc.c, border: `1px solid ${sc.border}`,
      fontSize: small ? 9 : 10, fontWeight: 700, letterSpacing: 0.5, whiteSpace: 'nowrap',
    }}>
      {STATUS_LABELS[status] || status?.toUpperCase()}
    </span>
  );
}

// ─── Av (avatar — photo if available, else initials) ──────────────────────────
function Av({ initials, color = BRAND.pink, size = 36, src }) {
  const [imgFailed, setImgFailed] = useState(false);
  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt={initials}
        onError={() => setImgFailed(true)}
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', border: `1.5px solid ${color}50`, flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `${color}20`, border: `1.5px solid ${color}50`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 700, color, flexShrink: 0,
    }}>
      {initials}
    </div>
  );
}

// ─── EngageBadge constants (module-scope — not recreated per render) ──────────
const HUNTER_STATUS_LABELS = {
  active_mission:  'ACTIVE MISSION',
  awaiting_reply:  'AWAITING REPLY',
  engaged_pending: 'PROCESSING',
  in_conversation: 'REPLIED',
};

const ENGAGE_BADGE_CONFIGS = {
  not_started:   { label: 'COLD',      bg: '#6b728020', color: '#9ca3af', border: '#6b728040' },
  in_mission:    { label: 'ACTIVE',    bg: '#7c3aed20', color: '#7c3aed', border: '#7c3aed40' },
  follow_up_due: { label: 'OVERDUE',   bg: '#dc262620', color: '#dc2626', border: '#dc262640' },
  replied:       { label: 'REPLIED',   bg: '#0ea5e920', color: '#0ea5e9', border: '#0ea5e940' },
  converted:     { label: 'CONVERTED', bg: '#10b98120', color: '#10b981', border: '#10b98140' },
};

// ─── EngageBadge ─────────────────────────────────────────────────────────────
// hunterStatus: pass contact.hunter_status in Hunter mode for specific labels.
function EngageBadge({ state, hunterStatus }) {
  const cfg = ENGAGE_BADGE_CONFIGS[state];
  if (!cfg) return null;
  const label = (hunterStatus && HUNTER_STATUS_LABELS[hunterStatus]) || cfg.label;
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px', borderRadius: 20,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      fontSize: 9, fontWeight: 700, letterSpacing: 0.5, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ─── Person Modal ─────────────────────────────────────────────────────────────
function PersonModal({ contact, company, onClose, onEngage, onOpenProfile, engageState = 'not_started' }) {
  const T = useT();
  const color = BRAND.pink;
  const email = contact.email || contact.work_email;
  const emailVerified = contact.email_status === 'verified';
  const phone = contact.phone_mobile || contact.phone_direct || contact.phone;
  const status = getLeadStatus(contact);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: T.modalBg, borderRadius: 22, overflow: 'hidden', width: '100%', maxWidth: 480, boxShadow: `0 40px 100px ${T.isDark ? '#000000cc' : '#00000030'}`, animation: 'slideUp 0.2s ease' }}
      >
        {/* Hero header */}
        <div style={{ position: 'relative', height: 188, background: `linear-gradient(150deg,${color}44,${T.cardBg2} 80%)`, display: 'flex', alignItems: 'flex-end', padding: '0 22px 16px' }}>
          <button
            onClick={onClose}
            style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: '50%', background: '#00000060', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          ><X size={15} /></button>
          <Av initials={getInitials(contact.name)} color={color} size={60} src={contact.photo_url} />
          <div style={{ marginLeft: 14 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{contact.name}</div>
            <div style={{ fontSize: 13, color: '#ffffff90' }}>{contact.title}{company?.name ? ` · ${company.name}` : ''}</div>
          </div>
        </div>

        <div style={{ padding: '14px 22px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 13 }}>
            <StatusBadge status={status} />
          </div>

          {/* Action buttons */}
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={onEngage}
              style={{ width: '100%', padding: 13, borderRadius: 11, border: 'none', background: (CARD_BTN_CONFIG[engageState] || CARD_BTN_CONFIG.not_started).bg, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Zap size={16} />{(CARD_BTN_CONFIG[engageState] || CARD_BTN_CONFIG.not_started).label}
            </button>
          </div>

          {/* Contact info */}
          <div style={{ borderTop: `1px solid ${T.modalLine}`, paddingTop: 13, marginBottom: 13 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.modalText, marginBottom: 10 }}>Contact Information</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, fontSize: 13 }}>
              <Mail size={15} color={T.textFaint} />
              {email ? (
                <>
                  <span style={{ color: BRIGADE.blue }}>{email}</span>
                  {emailVerified && <span style={{ fontSize: 9, color: STATUS.green, background: `${STATUS.green}15`, border: `1px solid ${STATUS.green}30`, borderRadius: 10, padding: '2px 7px', marginLeft: 6 }}>✓ VERIFIED</span>}
                </>
              ) : (
                <span style={{ color: T.textFaint }}>No email found</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, fontSize: 13, color: T.textFaint }}>
              <Phone size={15} />{phone || 'Phone not available'}
            </div>
            {contact.linkedin_url && (
              <div
                onClick={() => window.open(contact.linkedin_url, '_blank')}
                style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: BRIGADE.blue, cursor: 'pointer' }}
              ><Linkedin size={15} />View LinkedIn Profile →</div>
            )}
          </div>

          {/* Barry context */}
          {contact.barryContext && (
            <div style={{ borderTop: `1px solid ${T.modalLine}`, paddingTop: 13, marginBottom: 15 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <BarryAvatar size={22} />
                <div style={{ fontSize: 13, fontWeight: 700, color: T.modalText }}>Context by Barry</div>
              </div>
              <div style={{ fontSize: 12, color: T.modalMuted, lineHeight: 1.6, background: T.statBg, borderRadius: 9, padding: '10px 12px', border: `1px solid ${T.modalBdr}` }}>
                {typeof contact.barryContext === 'string'
                  ? contact.barryContext
                  : contact.barryContext?.whoYoureMeeting
                    || contact.barryContext?.summary
                    || contact.barryContext?.whatRoleCaresAbout
                    || ''}
              </div>
            </div>
          )}

          <button
            onClick={onOpenProfile}
            style={{ width: '100%', padding: 12, borderRadius: 11, border: 'none', background: (CARD_BTN_CONFIG[engageState] || CARD_BTN_CONFIG.not_started).bg, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          ><ExternalLink size={16} />Open Full Profile</button>
        </div>
      </div>
    </div>
  );
}

// ─── AllLeadsCard ─────────────────────────────────────────────────────────────
function AllLeadsCard({
  contact, company, onClick, onCompanyClick,
  engageState = 'not_started', mode = 'people', onReturnToScout,
  isSelected = false, bulkMode = false, onSelect,
  onBrigadeUpdate,
  inSniper = false, onAddToSniper,
}) {
  const T = useT();
  const color = BRAND.pink;
  const email = contact.email || contact.work_email;
  const status = getLeadStatus(contact);
  const photo = contact.photo_url;
  const btnCfg = CARD_BTN_CONFIG[engageState] || CARD_BTN_CONFIG.not_started;
  const [brigadeOpen, setBrigadeOpen] = useState(false);
  const [brigadeSaving, setBrigadeSaving] = useState(false);

  const currentBrigade = contact.brigade ? BRIGADE_MAP[contact.brigade] : null;

  // Mission quick-assign state
  const [missionPickerOpen, setMissionPickerOpen] = useState(false);
  const [missions, setMissions] = useState([]);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionAssigning, setMissionAssigning] = useState(false);
  const [missionAssigned, setMissionAssigned] = useState(null); // mission name after success

  async function openMissionPicker(e) {
    e.stopPropagation();
    if (missionPickerOpen) { setMissionPickerOpen(false); return; }
    const user = auth.currentUser;
    if (!user) return;
    setMissionsLoading(true);
    setMissionPickerOpen(true);
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'missions'));
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m.status !== 'completed');
      setMissions(list);
    } catch (err) {
      console.error('[AllLeads] mission fetch failed:', err);
    } finally {
      setMissionsLoading(false);
    }
  }

  async function assignToMission(missionId, missionName, e) {
    e.stopPropagation();
    const user = auth.currentUser;
    if (!user) return;
    setMissionAssigning(true);
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'missions'));
      const missionDoc = snap.docs.find(d => d.id === missionId);
      if (!missionDoc) {
        setMissionAssigned('⚠ Mission not found');
        setTimeout(() => setMissionAssigned(null), 2500);
        return;
      }
      const missionData = missionDoc.data();
      const alreadyIn = (missionData.contacts || []).some(c => c.contactId === contact.id);
      if (!alreadyIn) {
        await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), {
          contacts: arrayUnion({
            contactId: contact.id,
            name: contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
            email: contact.email || null,
            phone: contact.phone || null,
            currentStepIndex: 0,
            lastTouchDate: null,
            status: 'active',
            outcomes: [],
            sequenceStatus: 'pending',
            stepHistory: [],
            lastOutcome: null
          }),
          updatedAt: new Date().toISOString()
        });
      }
      setMissionAssigned(missionName);
      setMissionPickerOpen(false);
      setTimeout(() => setMissionAssigned(null), 2500);
    } catch (err) {
      console.error('[AllLeads] mission assign failed:', err);
      setMissionAssigned('⚠ Failed');
      setTimeout(() => setMissionAssigned(null), 2500);
    } finally {
      setMissionAssigning(false);
    }
  }

  async function handleBrigadeClick(brigadeId, e) {
    e.stopPropagation();
    if (brigadeSaving) return;
    const user = auth.currentUser;
    if (!user) return;
    const newValue = contact.brigade === brigadeId ? null : brigadeId;
    setBrigadeOpen(false);
    setBrigadeSaving(true);
    onBrigadeUpdate && onBrigadeUpdate(contact.id, newValue);
    try {
      await onBrigadeChange({
        userId: user.uid,
        contactId: contact.id,
        fromBrigade: contact.brigade || null,
        toBrigade: newValue,
        contactName: contact.name || null,
      });
    } catch (err) {
      console.error('[AllLeads] brigade update failed:', err);
      onBrigadeUpdate && onBrigadeUpdate(contact.id, contact.brigade); // revert
    } finally {
      setBrigadeSaving(false);
    }
  }

  function handleCardClick(e) {
    if (brigadeOpen) { setBrigadeOpen(false); return; } // close picker without opening modal
    if (bulkMode) { onSelect && onSelect(contact.id); return; }
    onClick && onClick(e);
  }

  return (
    <div
      onClick={handleCardClick}
      style={{
        background: isSelected ? T.accentBg : T.cardBg,
        border: `1px solid ${isSelected ? BRAND.pink : engageState === 'replied' ? ENGAGE_BADGE_CONFIGS.replied.color : T.border}`,
        borderRadius: 14, overflow: 'visible', cursor: 'pointer',
        transition: 'all 0.15s', display: 'flex', flexDirection: 'column',
        position: 'relative',
      }}
      onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = T.borderHov; } }}
      onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = T.border; } }}
    >
      {/* Bulk checkbox */}
      {(bulkMode || isSelected) && (
        <div
          onClick={e => { e.stopPropagation(); onSelect && onSelect(contact.id); }}
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 10,
            width: 20, height: 20, borderRadius: 5,
            background: isSelected ? BRAND.pink : T.surface,
            border: `2px solid ${isSelected ? BRAND.pink : T.border2}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          }}
        >
          {isSelected && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
        </div>
      )}

      {/* Photo area */}
      <div style={{ position: 'relative', paddingTop: '90%', borderRadius: '14px 14px 0 0', overflow: 'hidden' }}>
        {photo ? (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center top' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(155deg,${color}30,${T.cardBg2} 80%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: `${color}20`, border: `2px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color }}>
              {getInitials(contact.name)}
            </div>
          </div>
        )}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(to top,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.5) 50%,transparent 100%)' }} />
        {/* Top-right badge: Brigade in hunter mode, SNIPER in sniper mode, lead status elsewhere */}
        {!bulkMode && !isSelected && (
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            {mode === 'sniper' && inSniper ? (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: '#14b8a625', color: '#14b8a6', border: '1px solid #14b8a650' }}>
                IN SNIPER
              </span>
            ) : mode === 'hunter' ? (
              <button
                onClick={e => { e.stopPropagation(); if (!brigadeSaving) setBrigadeOpen(o => !o); }}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                title={currentBrigade ? 'Change Brigade' : 'Set Brigade'}
              >
                {currentBrigade ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 20,
                    background: currentBrigade.bgColor, color: currentBrigade.color,
                    border: `1px solid ${currentBrigade.borderColor}`,
                    fontSize: 9, fontWeight: 700, letterSpacing: 0.4, whiteSpace: 'nowrap',
                  }}>
                    <currentBrigade.icon size={9} />
                    {currentBrigade.label.toUpperCase()}
                  </span>
                ) : (
                  <span style={{
                    display: 'inline-block', padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.55)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    fontSize: 9, fontWeight: 400, letterSpacing: 0.3, whiteSpace: 'nowrap',
                  }}>
                    + Brigade
                  </span>
                )}
              </button>
            ) : (
              <StatusBadge status={status} small />
            )}
          </div>
        )}
        {/* Engagement state badge (top-left) */}
        <div style={{ position: 'absolute', top: 8, left: 8 }}>
          <EngageBadge
            state={engageState}
            hunterStatus={mode === 'hunter' ? contact.hunter_status : undefined}
          />
        </div>
        {/* Name + title over gradient */}
        <div style={{ position: 'absolute', bottom: 10, left: 12, right: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{contact.title}</div>
        </div>
      </div>

      {/* Info section */}
      <div style={{ padding: '9px 12px 12px' }}>
        {(company?.name || contact.company_name) && (
          <div
            onClick={e => { e.stopPropagation(); onCompanyClick && onCompanyClick(); }}
            style={{ fontSize: 9, color, background: `${color}18`, borderRadius: 5, padding: '2px 7px', display: 'inline-block', marginBottom: 7, fontWeight: 700, cursor: onCompanyClick ? 'pointer' : 'default', textDecoration: onCompanyClick ? 'underline' : 'none', textDecorationColor: `${color}60` }}
          >
            {company?.name || contact.company_name}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 11 }}>
          <Mail size={12} color={T.textFaint} />
          {email ? (
            <span style={{ color: BRIGADE.blue, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{email}</span>
          ) : (
            <>
              <span style={{ color: T.textFaint }}>No email found</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, color: BRAND.pink, background: T.accentBg, borderRadius: 5, padding: '1px 6px', cursor: 'pointer', flexShrink: 0 }}>✦ Enrich</span>
            </>
          )}
        </div>
        {/* Last interaction time */}
        <div style={{ fontSize: 9, color: T.textFaint, marginBottom: 6 }}>
          {mode === 'hunter' ? getHunterLastAction(contact) : getLastAction(contact)}
        </div>

        {/* Inline brigade pill */}
        <div style={{ position: 'relative', marginBottom: 7 }}>
          <button
            onClick={e => { e.stopPropagation(); if (!brigadeSaving) setBrigadeOpen(o => !o); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px',
              borderRadius: 20, border: `1px solid ${currentBrigade ? currentBrigade.borderColor : T.border}`,
              background: currentBrigade ? currentBrigade.bgColor : T.surface,
              color: currentBrigade ? currentBrigade.color : T.textFaint,
              fontSize: 10, fontWeight: currentBrigade ? 600 : 400,
              cursor: 'pointer', width: '100%', justifyContent: 'flex-start',
            }}
          >
            {currentBrigade ? (
              <>
                <currentBrigade.icon size={10} />
                <span>{currentBrigade.label}</span>
              </>
            ) : (
              <span style={{ fontSize: 9, color: T.textFaint }}>+ Set Brigade</span>
            )}
            {brigadeSaving && <span style={{ marginLeft: 'auto', fontSize: 8, color: T.textFaint }}>…</span>}
          </button>

          {/* Brigade picker popover */}
          {brigadeOpen && (
            <div
              onClick={e => e.stopPropagation()}
              style={{
                position: 'absolute', bottom: '110%', left: 0, right: 0, zIndex: 50,
                background: T.cardBg, border: `1px solid ${T.border2}`,
                borderRadius: 10, padding: 8,
                boxShadow: `0 8px 24px ${T.isDark ? '#00000080' : '#00000020'}`,
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                {BRIGADES.map(b => {
                  const BIcon = b.icon;
                  const active = contact.brigade === b.id;
                  return (
                    <button
                      key={b.id}
                      onClick={e => handleBrigadeClick(b.id, e)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        padding: '5px 4px', borderRadius: 7,
                        border: `1px solid ${active ? b.borderColor : 'transparent'}`,
                        background: active ? b.bgColor : 'transparent',
                        color: active ? b.color : T.textFaint,
                        fontSize: 9, cursor: 'pointer', transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.surface; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <BIcon size={12} />
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{b.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={e => {
              e.stopPropagation();
              if (mode === 'sniper') { if (!inSniper) onAddToSniper && onAddToSniper(); }
              else if (!bulkMode) onClick && onClick(e);
            }}
            style={{
              flex: 1, padding: '7px 0', borderRadius: 7, fontSize: 11, fontWeight: 600,
              cursor: mode === 'sniper' && inSniper ? 'default' : 'pointer',
              border: mode === 'sniper' && inSniper ? '1px solid #14b8a640' : 'none',
              background: mode === 'sniper' ? (inSniper ? '#14b8a615' : '#14b8a6') : btnCfg.bg,
              color: mode === 'sniper' && inSniper ? '#14b8a6' : '#fff',
            }}
          >
            {mode === 'sniper' ? (inSniper ? '✓ In SNIPER' : 'Add to SNIPER') : btnCfg.label}
          </button>
          {mode === 'sniper' ? (
            contact.linkedin_url ? (
              <button
                onClick={e => { e.stopPropagation(); window.open(contact.linkedin_url, '_blank'); }}
                style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid #0077b540', background: '#0077b510', color: '#0077b5', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              ><Linkedin size={11} /></button>
            ) : null
          ) : mode === 'hunter' ? (
            <>
              {/* Mission quick-assign */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={openMissionPicker}
                  style={{
                    padding: '7px 9px', borderRadius: 7,
                    border: missionPickerOpen ? '1px solid #a855f760' : '1px solid #a855f730',
                    background: missionPickerOpen ? 'rgba(168,85,247,0.1)' : 'transparent',
                    color: missionAssigned ? '#10b981' : '#a855f7',
                    fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center',
                    transition: 'all 0.15s'
                  }}
                  title={missionAssigned ? `Added to ${missionAssigned}` : 'Add to Mission'}
                >
                  {missionAssigning ? <Loader size={11} className="mission-assign-spin" /> : missionAssigned ? '✓' : <Target size={11} />}
                </button>

                {missionPickerOpen && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{
                      position: 'absolute', bottom: '110%', right: 0, zIndex: 60,
                      background: T.cardBg, border: `1px solid ${T.border2}`,
                      borderRadius: 10, padding: 8, minWidth: 200,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    }}
                  >
                    <div style={{ fontSize: 9, color: T.textFaint, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', padding: '2px 4px 6px' }}>
                      Add to Mission
                    </div>
                    {missionsLoading ? (
                      <div style={{ padding: '8px 4px', color: T.textFaint, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Loader size={11} className="mission-assign-spin" /> Loading...
                      </div>
                    ) : missions.length === 0 ? (
                      <div style={{ padding: '6px 4px', color: T.textFaint, fontSize: 11 }}>No active missions</div>
                    ) : (
                      missions.map(m => (
                        <button
                          key={m.id}
                          onClick={e => assignToMission(m.id, m.name, e)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '7px 8px', borderRadius: 7, border: 'none',
                            background: 'transparent', color: T.text, fontSize: 12,
                            cursor: 'pointer', transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = T.rowHov}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 1 }}>{m.name}</div>
                          <div style={{ fontSize: 10, color: T.textFaint }}>{m.contacts?.length || 0} contacts</div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={e => { e.stopPropagation(); onReturnToScout && onReturnToScout(); }}
                style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid #9ca3af40', background: 'transparent', color: '#9ca3af', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title="Move back to Scout"
              ><RotateCcw size={11} /></button>
            </>
          ) : contact.linkedin_url ? (
            <button
              onClick={e => { e.stopPropagation(); window.open(contact.linkedin_url, '_blank'); }}
              style={{ padding: '7px 9px', borderRadius: 7, border: `1px solid #0077b540`, background: '#0077b510', color: BRIGADE.blue, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            ><Linkedin size={11} /></button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── AllLeadsRow (Gmail-style) ────────────────────────────────────────────────
function AllLeadsRow({ contact, company, selected, onClick, onCompanyClick }) {
  const T = useT();
  const color = BRAND.pink;
  const email = contact.email || contact.work_email;
  const status = getLeadStatus(contact);

  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 15px', borderBottom: `1px solid ${T.border}`, cursor: 'pointer', background: selected ? T.rowSel : 'transparent', borderLeft: `2px solid ${selected ? BRAND.pink : 'transparent'}`, transition: 'all 0.1s' }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = T.rowHov; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <Av initials={getInitials(contact.name)} color={color} size={30} src={contact.photo_url} />
      <div style={{ width: 128, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contact.name}</div>
        <div
          onClick={e => { e.stopPropagation(); onCompanyClick && onCompanyClick(); }}
          style={{ fontSize: 9, color, fontWeight: 700, cursor: onCompanyClick ? 'pointer' : 'default', textDecoration: onCompanyClick ? 'underline' : 'none', textDecorationColor: `${color}60` }}
        >{company?.name || contact.company_name || ''}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', whiteSpace: 'nowrap' }}>{contact.title}</span>
      </div>
      <StatusBadge status={status} small />
      <div style={{ width: 52, flexShrink: 0, textAlign: 'right' }}>
        {email ? <Mail size={12} color={BRIGADE.blue} /> : <span style={{ fontSize: 10, color: T.textFaint }}>—</span>}
      </div>
      <div style={{ width: 80, flexShrink: 0, textAlign: 'right', fontSize: 10, color: T.textFaint }}>
        {getLastAction(contact)}
      </div>
    </div>
  );
}

// ─── Brigade config ───────────────────────────────────────────────────────────
// Derived from the single source of truth in BrigadeSelector — adding a new
// brigade there will automatically add it here as a filter tab.
const BRIGADE_LENSES = [
  { id: 'all', label: 'All People', Icon: Users },
  ...BRIGADES.map(b => ({ id: b.id, label: b.label, Icon: b.icon })),
];

// ─── Contact Profile (full page, embedded) ───────────────────────────────────
function ContactProfileView({ contactId, onBack }) {
  const T = useT();
  const navigate = useNavigate();
  const [contact, setContact] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        // Try to get from Firestore
        const { doc: docFn, getDoc } = await import('firebase/firestore');
        const snap = await getDoc(docFn(db, 'users', user.uid, 'contacts', contactId));
        if (snap.exists()) setContact({ ...snap.data(), id: snap.id });
      } catch (e) {
        console.error('ContactProfileView load error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [contactId]);

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textMuted, fontSize: 13 }}>Loading...</div>;
  }

  if (!contact) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: T.textMuted }}>Contact not found.</div>
        <button onClick={onBack} style={{ padding: '7px 16px', borderRadius: 8, background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, fontSize: 12, cursor: 'pointer' }}>← Back</button>
      </div>
    );
  }

  // Navigate to full profile page
  useEffect(() => {
    navigate(`/scout/contact/${contactId}`);
  }, [contactId]);

  return null;
}

// ─── AllLeads ─────────────────────────────────────────────────────────────────
// mode: 'people' (all contacts, context-aware CTA)
//       'scout'  (unengaged only, always pink Engage)
//       'hunter' (active_mission only, purple Follow Up + Return to Scout)
export default function AllLeads({ mode = 'people' }) {
  const T = useT();
  const navigate = useNavigate();

  // Data
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState({});
  const [loading, setLoading] = useState(true);
  const [sniperIds, setSniperIds] = useState(new Set()); // contactRef IDs already in SNIPER

  // UI
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'list'
  const [brigadeFilter, setBrigadeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dataFilter, setDataFilter] = useState(null);
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('al_sortOrder') || 'newest');

  // Bulk selection
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBrigadeOpen, setBulkBrigadeOpen] = useState(false);

  // Sprint 3: Gmail reply sync (hunter mode only)
  const [syncStatus, setSyncStatus] = useState(null); // null | 'syncing' | 'done' | 'needs_reconnect' | 'error'
  const [syncResult, setSyncResult] = useState(null); // { count: number }

  // LinkedIn modal
  const [showLinkedInModal, setShowLinkedInModal] = useState(false);

  // Modal / profile
  const [modal, setModal] = useState(null);
  const [listSelected, setListSelected] = useState(null);
  const [panelContactId, setPanelContactId] = useState(null);
  const [panelAutoEngage, setPanelAutoEngage] = useState(false);

  const listRef = useRef(null);
  const [listScrollPos, setListScrollPos] = useState(0);
  const savedListScroll = useRef(0);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Tracks whether we pushed a history entry for the mobile profile view,
  // so we can safely call history.back() on UI-initiated closes.
  const mobilePanelHistoryPushed = useRef(false);
  // Touch tracking for swipe-left-to-close gesture.
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
    // Edge case: if a profile is open on desktop and the window is resized to
    // mobile, the list hides and the hamburger appears in the profile header.
    // The user can still navigate back via hamburger → "Back to list". Rare
    // enough not to handle explicitly for now.
  }, []);

  // Close mobile profile (UI-initiated). Pops the history entry we pushed on open.
  function closeMobileProfile() {
    setPanelContactId(null);
    setListSelected(null);
    setPanelAutoEngage(false);
    setDrawerOpen(false);
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = savedListScroll.current;
    });
    if (mobilePanelHistoryPushed.current) {
      mobilePanelHistoryPushed.current = false;
      window.history.back();
    }
  }

  // Open mobile profile. Pushes a history entry so the browser/Android back
  // button closes the profile instead of leaving the page.
  function openMobileProfile(contactId) {
    window.history.pushState({ mobilePanelOpen: true }, '');
    mobilePanelHistoryPushed.current = true;
    setPanelContactId(contactId);
  }

  // Handle browser/Android back button while profile is open.
  // Uses empty deps — reads only refs so no stale-closure risk.
  useEffect(() => {
    const handler = () => {
      if (!mobilePanelHistoryPushed.current) return;
      mobilePanelHistoryPushed.current = false;
      setPanelContactId(null);
      setListSelected(null);
      setPanelAutoEngage(false);
      setDrawerOpen(false);
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = savedListScroll.current;
      });
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  useEffect(() => { loadAllContacts(); }, []);

  async function loadAllContacts() {
    try {
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }
      // Load companies and contacts in parallel to halve the round-trip time
      const fetches = [
        getDocs(collection(db, 'users', user.uid, 'companies')),
        getDocs(collection(db, 'users', user.uid, 'contacts')),
      ];
      if (mode === 'sniper') fetches.push(getDocs(collection(db, 'users', user.uid, 'sniper_contacts')));
      const [companiesSnapshot, contactsSnapshot, sniperSnapshot] = await Promise.all(fetches);

      const companiesMap = {};
      companiesSnapshot.docs.forEach(d => { companiesMap[d.id] = d.data(); });
      setCompanies(companiesMap);

      if (sniperSnapshot) {
        const ids = new Set(sniperSnapshot.docs.map(d => d.data().contactRef).filter(Boolean));
        setSniperIds(ids);
      }

      const contactsList = contactsSnapshot.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(c => {
          const s = c.status || '';
          if (['people_mode_archived', 'people_mode_skipped'].includes(s)) return false;
          const isEngaged = ENGAGED_HUNTER_STATUSES.has(c.hunter_status) || ENGAGED_CONTACT_STATUSES.has(c.contact_status);
          if (mode === 'scout') return !isEngaged;
          if (mode === 'hunter') return isEngaged;
          return true; // 'people' and 'sniper' — show all
        });
      setContacts(contactsList);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      setLoading(false);
    }
  }

  async function handleAddToSniper(contact) {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'sniper_contacts'), {
        contactRef: contact.id,
        firstName: contact.name?.split(' ')[0] || '',
        lastName: contact.name?.split(' ').slice(1).join(' ') || '',
        name: contact.name || '',
        title: contact.title || '',
        company: contact.company_name || companies[contact.company_id]?.name || '',
        email: contact.email || contact.work_email || '',
        stage: 'demo_done',
        createdAt: serverTimestamp(),
        lastTouchAt: serverTimestamp(),
      });
      setSniperIds(prev => new Set([...prev, contact.id]));
    } catch (err) {
      console.error('Error adding contact to SNIPER:', err);
    }
  }

  async function resetContactToScout(contactId) {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contactId), {
        hunter_status: null,
        active_mission_id: null,
        updated_at: new Date().toISOString(),
      });
      await loadAllContacts();
    } catch (err) {
      console.error('[AllLeads] resetContactToScout error:', err);
    }
  }

  // Sprint 3: Poll Gmail for replies and auto-transition contacts
  async function syncGmailReplies() {
    const user = auth.currentUser;
    if (!user) return;
    setSyncStatus('syncing');
    setSyncResult(null);
    try {
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/gmail-poll-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken }),
      });
      const data = await res.json();
      if (data.code === 'NEEDS_RECONNECT' || data.code === 'GMAIL_NOT_CONNECTED') {
        setSyncStatus('needs_reconnect');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSyncResult({ count: data.transitioned?.length ?? 0 });
      setSyncStatus('done');
      if (data.transitioned?.length > 0) await loadAllContacts();
      // Auto-clear done state after 6s
      setTimeout(() => setSyncStatus(null), 6000);
    } catch (err) {
      console.error('[AllLeads] syncGmailReplies error:', err);
      setSyncStatus('error');
      setTimeout(() => setSyncStatus(null), 5000);
    }
  }

  // Optimistic brigade update from inline card picker
  function updateContactBrigade(contactId, newBrigade) {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, brigade: newBrigade } : c));
  }

  // Bulk: toggle one contact in/out of selectedIds
  function toggleSelect(contactId) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId); else next.add(contactId);
      return next;
    });
  }

  // Bulk: assign brigade to all selected contacts
  async function handleBulkBrigadeAssign(brigadeId) {
    const user = auth.currentUser;
    if (!user || selectedIds.size === 0) return;
    setBulkBrigadeOpen(false);
    const ids = [...selectedIds];
    // Optimistic update
    setContacts(prev => prev.map(c => ids.includes(c.id) ? { ...c, brigade: brigadeId } : c));
    // Persist
    await Promise.all(ids.map(id => {
      const contact = contacts.find(c => c.id === id);
      return onBrigadeChange({
        userId: user.uid,
        contactId: id,
        fromBrigade: contact?.brigade || null,
        toBrigade: brigadeId,
        contactName: contact?.name || null,
      }).catch(err => console.error('[AllLeads] bulk brigade error:', err));
    }));
    // Selection intentionally preserved so user can export or continue working
  }

  // Bulk export — CSV of selected contacts only
  function exportSelectedToCSV(list) {
    if (list.length === 0) return;
    const headers = ['Name', 'Title', 'Company', 'Email', 'Phone', 'LinkedIn', 'Brigade'];
    const rows = list.map(c => {
      const co = companies[c.company_id];
      const brigadeLabel = c.brigade ? (BRIGADE_MAP[c.brigade]?.label || c.brigade) : '';
      return [c.name || '', c.title || '', co?.name || c.company_name || '', c.email || c.work_email || '', c.phone_mobile || c.phone_direct || c.phone || '', c.linkedin_url || '', brigadeLabel].map(f => `"${f}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contacts-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  function exportToCSV() {
    const list = finalContacts;
    if (list.length === 0) return;
    exportSelectedToCSV(list);
  }

  // ── Computed ─────────────────────────────────────────────────────────────────
  let filtered = contacts;

  // Brigade filter
  if (brigadeFilter !== 'all') filtered = filtered.filter(c => getBrigadeType(c) === brigadeFilter);

  // Data filter
  if (dataFilter === 'has-email') filtered = filtered.filter(c => !!(c.email || c.work_email));
  else if (dataFilter === 'needs-email') filtered = filtered.filter(c => !(c.email || c.work_email));
  else if (dataFilter === 'needs-phone') filtered = filtered.filter(c => !(c.phone_mobile || c.phone_direct || c.phone));

  // Search — name, title, company, email, phone, LinkedIn URL
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    const digitsOnly = lower.replace(/\D/g, '');
    filtered = filtered.filter(c => {
      const co = companies[c.company_id];
      return (c.name || '').toLowerCase().includes(lower) ||
        (c.title || '').toLowerCase().includes(lower) ||
        (co?.name || c.company_name || '').toLowerCase().includes(lower) ||
        (c.email || c.work_email || '').toLowerCase().includes(lower) ||
        (digitsOnly && (c.phone_mobile || c.phone_direct || c.phone || '').replace(/\D/g, '').includes(digitsOnly)) ||
        (c.linkedin_url || '').toLowerCase().includes(lower);
    });
  }

  // Sort based on user preference
  const finalContacts = [...filtered].sort((a, b) => {
    if (sortOrder === 'name') return (a.name || '').localeCompare(b.name || '');
    if (sortOrder === 'status') {
      const orderA = ENGAGE_SORT_ORDER[deriveCardEngageState(a)] ?? 2;
      const orderB = ENGAGE_SORT_ORDER[deriveCardEngageState(b)] ?? 2;
      return orderA - orderB;
    }
    // newest / oldest — sort by saved_at / addedAt timestamp
    const dA = a.saved_at || a.addedAt || '';
    const dB = b.saved_at || b.addedAt || '';
    return sortOrder === 'oldest'
      ? String(dA).localeCompare(String(dB))
      : String(dB).localeCompare(String(dA)); // default: newest first
  });

  // Stats
  const totalPipeline = contacts.length;
  const uniqueCompanies = new Set(contacts.map(c => c.company_id)).size;
  const withEmail = contacts.filter(c => c.email || c.work_email).length;
  const withPhone = contacts.filter(c => c.phone_mobile || c.phone_direct || c.phone).length;
  const emailRate = totalPipeline > 0 ? Math.round((withEmail / totalPipeline) * 100) : 0;
  const phoneRate = totalPipeline > 0 ? Math.round((withPhone / totalPipeline) * 100) : 0;

  // Brigade counts
  const brigadeCounts = BRIGADE_LENSES.reduce((acc, lens) => {
    acc[lens.id] = lens.id === 'all' ? contacts.length : contacts.filter(c => getBrigadeType(c) === lens.id).length;
    return acc;
  }, {});

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textMuted, fontSize: 13, flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${BRAND.pink}`, borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
        <p style={{ margin: 0 }}>Loading your pipeline...</p>
        <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      </div>
    );
  }

  if (contacts.length === 0) {
    const emptyMsg = mode === 'hunter'
      ? { title: 'No Active Missions', body: 'Engage contacts in Scout to start outreach missions.', cta: null }
      : mode === 'sniper'
      ? { title: 'No Contacts Yet', body: 'Add contacts to Scout first, then use "Add to SNIPER" to move them into your conversion pipeline.', cta: null }
      : mode === 'scout'
      ? { title: 'No Unengaged Contacts', body: 'All contacts are in active missions, or add new ones via Daily Leads.', cta: null }
      : { title: 'No Contacts Yet', body: 'Accept companies in Daily Leads to start building your contact pipeline.', cta: 'View Saved Companies' };
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16, color: T.textMuted }}>
        <Users size={48} color={T.textFaint} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>{emptyMsg.title}</h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, textAlign: 'center' }}>{emptyMsg.body}</p>
        {emptyMsg.cta && (
          <button
            onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
            style={{ padding: '10px 22px', borderRadius: 10, background: `linear-gradient(135deg,${BRAND.pink},#c0146a)`, border: 'none', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
          ><Building2 size={14} />{emptyMsg.cta}</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>

      {/* ── Header ── */}
      <div style={{ padding: '18px 22px 0', background: T.navBg, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>
              {mode === 'hunter' ? 'Active Contacts' : mode === 'sniper' ? 'People' : 'People'}
            </h2>
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
              {mode === 'hunter'
                ? 'Contacts with active missions.'
                : mode === 'sniper'
                ? 'Add contacts to your SNIPER conversion pipeline.'
                : mode === 'scout'
                ? 'Ready for first contact.'
                : 'Every relationship — one place.'}
            </div>
          </div>
          {/* Sprint 3: Sync Replies button — hunter mode only */}
          {mode === 'hunter' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {syncStatus === 'needs_reconnect' && (
                <span style={{ fontSize: 10, color: BRAND.pink, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => window.location.href = '/hunter?tab=weapons'}
                >Reconnect Gmail to sync replies</span>
              )}
              {syncStatus === 'error' && (
                <span style={{ fontSize: 10, color: '#dc2626' }}>Sync failed</span>
              )}
              {syncStatus === 'done' && (
                <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>
                  {syncResult?.count > 0 ? `${syncResult.count} new ${syncResult.count === 1 ? 'reply' : 'replies'}` : 'Up to date'}
                </span>
              )}
              <button
                onClick={syncGmailReplies}
                disabled={syncStatus === 'syncing'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 13px', borderRadius: 8,
                  border: `1px solid ${T.border2}`, background: T.surface,
                  color: syncStatus === 'syncing' ? T.textFaint : T.textMuted,
                  fontSize: 11, fontWeight: 600, cursor: syncStatus === 'syncing' ? 'not-allowed' : 'pointer',
                }}
              >
                <RefreshCw size={12} style={{ animation: syncStatus === 'syncing' ? 'spin 1s linear infinite' : 'none' }} />
                {syncStatus === 'syncing' ? 'Syncing…' : 'Sync Replies'}
              </button>
            </div>
          )}

          {/* View toggle */}
          <div style={{ display: 'flex', gap: 4, background: T.surface, borderRadius: 8, padding: 3 }}>
            {[['cards', '⊞ Cards'], ['list', '☰ List']].map(([m, l]) => (
              <button
                key={m}
                onClick={() => { setViewMode(m); if (m === 'cards') { setPanelContactId(null); setListSelected(null); } }}
                style={{ padding: '5px 13px', borderRadius: 6, border: 'none', background: viewMode === m ? BRAND.pink : 'transparent', color: viewMode === m ? '#fff' : T.textMuted, fontSize: 11, fontWeight: viewMode === m ? 700 : 400, cursor: 'pointer', transition: 'all 0.15s' }}
              >{l}</button>
            ))}
          </div>
        </div>

        {/* Brigade tabs */}
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto', marginBottom: -1 }}>
          {BRIGADE_LENSES.map(lens => (
            <div
              key={lens.id}
              onClick={() => setBrigadeFilter(lens.id)}
              style={{ padding: '7px 13px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: `2px solid ${brigadeFilter === lens.id ? BRAND.pink : 'transparent'}`, color: brigadeFilter === lens.id ? BRAND.pink : T.textMuted, background: brigadeFilter === lens.id ? T.accentBg : 'transparent' }}
            >
              {lens.label} {brigadeCounts[lens.id] > 0 ? brigadeCounts[lens.id] : ''}
            </div>
          ))}
        </div>
      </div>

      {/* ── Stats row ── */}
      <div style={{ padding: '10px 22px', borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 9, overflowX: 'auto' }}>
        {[
          ['Pipeline', totalPipeline, null],
          ['Companies', uniqueCompanies, null],
          ['Email Coverage', `${emailRate}%`, dataFilter === 'has-email'],
          ['Phone Coverage', `${phoneRate}%`, dataFilter === 'needs-phone'],
        ].map(([l, v, active]) => (
          <div
            key={l}
            onClick={() => {
              if (l === 'Email Coverage') setDataFilter(d => d === 'has-email' ? null : 'has-email');
              if (l === 'Phone Coverage') setDataFilter(d => d === 'needs-phone' ? null : 'needs-phone');
            }}
            style={{ background: active ? T.accentBg : T.statBg, border: `1px solid ${active ? T.accentBdr : T.border}`, borderRadius: 9, padding: '9px 13px', flexShrink: 0, minWidth: 108, cursor: l.includes('Coverage') ? 'pointer' : 'default' }}
          >
            <div style={{ fontSize: 9, color: T.textFaint }}>{l}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: active ? BRAND.pink : T.text }}>{v}</div>
          </div>
        ))}
      </div>

      {/* ── Search + filter chips + export ── */}
      <div style={{ padding: '9px 22px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ flex: 1, background: T.input, border: `1px solid ${T.border}`, borderRadius: 7, padding: '6px 11px', display: 'flex', gap: 7, alignItems: 'center' }}>
          <Search size={13} color={T.textFaint} />
          <input
            placeholder="Search name, title, company, email, phone, or LinkedIn..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: T.text, fontSize: 11, flex: 1 }}
          />
        </div>
        {/* Filter chips */}
        {[['Has Email', 'has-email'], ['Needs Email', 'needs-email'], ['Needs Phone', 'needs-phone']].map(([label, id]) => (
          <button
            key={id}
            onClick={() => setDataFilter(d => d === id ? null : id)}
            style={{ padding: '5px 11px', borderRadius: 20, border: `1px solid ${dataFilter === id ? T.accentBdr : T.border}`, background: dataFilter === id ? T.accentBg : 'transparent', color: dataFilter === id ? BRAND.pink : T.textFaint, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >{label}</button>
        ))}
        {/* Sort selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 7, padding: '5px 10px', flexShrink: 0 }}>
          <ArrowUpDown size={11} color={T.textFaint} />
          <select
            value={sortOrder}
            onChange={e => { setSortOrder(e.target.value); localStorage.setItem('al_sortOrder', e.target.value); }}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: T.textMuted, fontSize: 10, cursor: 'pointer' }}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name">A–Z Name</option>
            <option value="status">By Status</option>
          </select>
        </div>
        {/* Select mode toggle */}
        <button
          onClick={() => { setBulkMode(m => { if (m) { setSelectedIds(new Set()); } return !m; }); }}
          style={{ padding: '5px 11px', borderRadius: 20, border: `1px solid ${bulkMode ? T.accentBdr : T.border}`, background: bulkMode ? T.accentBg : 'transparent', color: bulkMode ? BRAND.pink : T.textFaint, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >{bulkMode ? `Selecting (${selectedIds.size})` : 'Select'}</button>
        <button
          onClick={() => setShowLinkedInModal(true)}
          style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: `linear-gradient(135deg,#0077b5,#005f8e)`, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
        ><Linkedin size={12} />Add via LinkedIn</button>
        <button
          onClick={exportToCSV}
          style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: `linear-gradient(135deg,${BRAND.cyan},#009aa0)`, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
        ><Download size={12} />Export CSV</button>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: list/cards */}
        {!(isMobile && panelContactId) && (
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 22px',
            transition: 'flex 0.25s ease',
            minWidth: 0,
          }}
        >
          {finalContacts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: T.textFaint }}>
              <p style={{ fontSize: 13 }}>No contacts match your current filters.</p>
            </div>
          ) : viewMode === 'cards' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 12 }}>
              {finalContacts.map(c => (
                <AllLeadsCard
                  key={c.id}
                  contact={c}
                  company={companies[c.company_id]}
                  engageState={deriveCardEngageState(c)}
                  mode={mode}
                  onReturnToScout={() => resetContactToScout(c.id)}
                  onClick={() => isMobile ? openMobileProfile(c.id) : setModal(c)}
                  onCompanyClick={
                    c.company_id && companies[c.company_id]
                      ? () => navigate(`/scout/company/${c.company_id}`)
                      : c.company_name
                        ? () => navigate('/scout', { state: { activeTab: 'company-search', searchCompanyName: c.company_name } })
                        : undefined
                  }
                  isSelected={selectedIds.has(c.id)}
                  bulkMode={bulkMode}
                  onSelect={toggleSelect}
                  onBrigadeUpdate={updateContactBrigade}
                  inSniper={sniperIds.has(c.id)}
                  onAddToSniper={() => handleAddToSniper(c)}
                />
              ))}
            </div>
          ) : (
            <div style={{ background: T.navBg, borderRadius: 11, overflow: 'hidden', border: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 15px', borderBottom: `1px solid ${T.border}`, fontSize: 9, color: T.textFaint, letterSpacing: 1 }}>
                <div style={{ width: 30 }} />
                <div style={{ width: 128 }}>NAME</div>
                <div style={{ flex: 1 }}>TITLE</div>
                <div style={{ width: 130 }}>STATUS</div>
                <div style={{ width: 52 }}>EMAIL</div>
                <div style={{ width: 80, textAlign: 'right' }}>LAST ACTION</div>
              </div>
              {finalContacts.map(c => (
                <AllLeadsRow
                  key={c.id}
                  contact={c}
                  company={companies[c.company_id]}
                  selected={c.id === listSelected}
                  onClick={() => {
                    savedListScroll.current = listRef.current?.scrollTop ?? 0;
                    setListSelected(c.id);
                    setPanelAutoEngage(false);
                    if (isMobile) openMobileProfile(c.id);
                    else setPanelContactId(c.id);
                  }}
                  onCompanyClick={
                    c.company_id && companies[c.company_id]
                      ? () => navigate(`/scout/company/${c.company_id}`)
                      : c.company_name
                        ? () => navigate('/scout', { state: { activeTab: 'company-search', searchCompanyName: c.company_name } })
                        : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
        )}

        {/* Right: contact profile panel */}
        {panelContactId && (
          <div
            style={{
              width: isMobile ? '100%' : '52%',
              flexShrink: 0,
              borderLeft: isMobile ? 'none' : `1px solid ${T.border}`,
              overflowY: 'auto',
              background: T.appBg,
              display: 'flex',
              flexDirection: 'column',
              animation: 'slideInPanel 0.22s ease',
            }}
            onTouchStart={isMobile ? (e) => {
              touchStartX.current = e.touches[0].clientX;
              touchStartY.current = e.touches[0].clientY;
            } : undefined}
            onTouchEnd={isMobile ? (e) => {
              if (touchStartX.current === null) return;
              const dx = touchStartX.current - e.changedTouches[0].clientX;
              const dy = Math.abs(touchStartY.current - e.changedTouches[0].clientY);
              // Swipe left: horizontal travel > 60px and more horizontal than vertical
              if (dx > 60 && dx > dy) closeMobileProfile();
              touchStartX.current = null;
              touchStartY.current = null;
            } : undefined}
          >
            <style>{`@keyframes slideInPanel { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
            {/* Panel close bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${T.border}`, background: T.navBg, flexShrink: 0 }}>
              {isMobile ? (
                <>
                  <span style={{ flex: 1, fontSize: 11, color: T.textFaint }}>Contact Profile</span>
                  <button
                    aria-label="Open navigation menu"
                    onClick={() => setDrawerOpen(true)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 7, padding: '6px 8px', color: T.textMuted, cursor: 'pointer' }}
                  >
                    <Menu size={16} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setPanelContactId(null);
                      setListSelected(null);
                      setPanelAutoEngage(false);
                      requestAnimationFrame(() => {
                        if (listRef.current) listRef.current.scrollTop = savedListScroll.current;
                      });
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 7, padding: '5px 11px', color: T.textMuted, fontSize: 11, cursor: 'pointer' }}
                  >
                    <ChevronLeft size={13} />Close
                  </button>
                  <span style={{ fontSize: 11, color: T.textFaint }}>Contact Profile</span>
                </>
              )}
            </div>
            <ContactProfile
              key={panelContactId}
              contactId={panelContactId}
              autoEngage={panelAutoEngage}
              onClose={() => isMobile ? closeMobileProfile() : (() => {
                setPanelContactId(null);
                setListSelected(null);
                setPanelAutoEngage(false);
                requestAnimationFrame(() => {
                  if (listRef.current) listRef.current.scrollTop = savedListScroll.current;
                });
              })()}
            />
          </div>
        )}
      </div>

      {/* ── Bulk Action Bar ── */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: T.cardBg, border: `1px solid ${BRAND.pink}40`,
          borderRadius: 12, padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: `0 8px 32px ${T.isDark ? '#00000099' : '#00000025'}`,
          zIndex: 100, animation: 'fadeUp 0.15s ease',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.pink }}>{selectedIds.size} selected</span>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setBulkBrigadeOpen(o => !o)}
              style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${T.border2}`, background: T.surface, color: T.textMuted, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              Assign Brigade ▾
            </button>
            {bulkBrigadeOpen && (
              <div style={{
                position: 'absolute', bottom: '110%', left: 0,
                background: T.cardBg, border: `1px solid ${T.border2}`,
                borderRadius: 10, padding: 8, zIndex: 50,
                boxShadow: `0 8px 24px ${T.isDark ? '#00000080' : '#00000020'}`,
                minWidth: 200,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  {BRIGADES.map(b => {
                    const BIcon = b.icon;
                    return (
                      <button
                        key={b.id}
                        onClick={() => handleBulkBrigadeAssign(b.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          padding: '7px 10px', borderRadius: 7,
                          border: `1px solid ${b.borderColor}`,
                          background: b.bgColor, color: b.color,
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        <BIcon size={12} />{b.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => exportSelectedToCSV(finalContacts.filter(c => selectedIds.has(c.id)))}
            style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${BRAND.cyan},#009aa0)`, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          ><Download size={12} />Export</button>
          <button
            onClick={() => { setSelectedIds(new Set()); setBulkBrigadeOpen(false); }}
            style={{ padding: '6px 11px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: T.textFaint, fontSize: 11, cursor: 'pointer' }}
          >Clear</button>
        </div>
      )}

      {/* ── Mobile Hamburger Drawer ── */}
      {isMobile && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'fixed', inset: 0, background: '#00000060', zIndex: 200 }}
          />
          {/* TODO: drawer nav links are currently hardcoded — should pull from
              a shared nav config in a future refactor to avoid drift. */}
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 240,
              background: T.navBg, zIndex: 201,
              borderLeft: `1px solid ${T.border}`,
              display: 'flex', flexDirection: 'column',
              padding: '20px 0',
            }}
          >
            <div
              onClick={() => closeMobileProfile()}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 20px', fontSize: 14, fontWeight: 700, color: BRAND.pink, cursor: 'pointer', borderBottom: `1px solid ${T.border}`, marginBottom: 8 }}
            >
              <ChevronLeft size={16} />Back to list
            </div>
            {[
              { label: 'Daily Discoveries', tab: 'daily-leads' },
              { label: 'Saved Companies',   tab: 'saved-companies' },
              { label: 'Company Search',    tab: 'company-search' },
              { label: 'Scout+',            tab: 'scout-plus' },
              { label: 'ICP Settings',      tab: 'icp-settings' },
            ].map(item => (
              <div
                key={item.tab}
                onClick={() => { setDrawerOpen(false); navigate(`/scout?tab=${item.tab}`); }}
                style={{ padding: '12px 20px', fontSize: 13, color: T.textMuted, cursor: 'pointer' }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── LinkedIn Link Modal ── */}
      {showLinkedInModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: '#00000099', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowLinkedInModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: T.modalBg, borderRadius: 22, overflow: 'hidden', width: '100%', maxWidth: 560, boxShadow: `0 40px 100px ${T.isDark ? '#000000cc' : '#00000030'}`, maxHeight: '90vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: `1px solid ${T.modalLine}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Linkedin size={18} color="#0077b5" />
                <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>Add via LinkedIn</span>
              </div>
              <button
                onClick={() => setShowLinkedInModal(false)}
                style={{ width: 28, height: 28, borderRadius: '50%', background: T.surface, border: `1px solid ${T.border2}`, color: T.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              ><X size={14} /></button>
            </div>
            <LinkedInLinkSearch
              onContactAdded={() => { setShowLinkedInModal(false); loadAllContacts(); }}
              onCancel={() => setShowLinkedInModal(false)}
            />
          </div>
        </div>
      )}

      {/* ── Person Modal ── */}
      {modal && (
        <PersonModal
          contact={modal}
          company={companies[modal.company_id]}
          engageState={deriveCardEngageState(modal)}
          onClose={() => setModal(null)}
          onEngage={() => {
            setModal(null);
            setPanelAutoEngage(true);
            setPanelContactId(modal.id);
          }}
          onOpenProfile={() => {
            setModal(null);
            setPanelAutoEngage(false);
            setPanelContactId(modal.id);
          }}
        />
      )}
    </div>
  );
}
