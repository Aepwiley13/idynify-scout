/**
 * AllLeads.jsx — Contact grid/list with brigade tabs, Person modal, and full profile.
 *
 * UI: idynify-v5 design (cards + Gmail-style list toggle, Person modal, Contact Profile).
 * Data: Firebase Firestore (all original data loading preserved).
 */
import { useEffect, useState, useRef } from 'react';
import { collection, getDocs, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import {
  Users, Building2, Mail, Linkedin, Search, Download,
  Phone, X, Zap, ExternalLink, ChevronLeft, Menu, RotateCcw,
} from 'lucide-react';
import { BRIGADES } from '../../components/contacts/BrigadeSelector';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
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
function deriveCardEngageState(contact) {
  const status = contact.contact_status || contact.lead_status || contact.status;
  if (status === 'converted' || status === 'customer') return 'converted';
  if (contact.hunter_status === 'active_mission') {
    if (contact.next_step_due && new Date(contact.next_step_due) < new Date()) {
      return 'follow_up_due';
    }
    return 'in_mission';
  }
  return 'not_started';
}

// Sort priority: overdue → active mission → not started → converted
const ENGAGE_SORT_ORDER = { follow_up_due: 0, in_mission: 1, not_started: 2, converted: 3 };

// Button config per engagement state
const CARD_BTN_CONFIG = {
  not_started:   { label: 'Engage',        bg: `linear-gradient(135deg,${BRAND.pink},#c0146a)` },
  in_mission:    { label: 'Follow Up',     bg: 'linear-gradient(135deg,#7c3aed,#5b21b6)' },
  follow_up_due: { label: 'Follow Up Now', bg: 'linear-gradient(135deg,#dc2626,#991b1b)' },
  converted:     { label: 'View',          bg: 'linear-gradient(135deg,#10b981,#047857)' },
};

function formatRelativeTime(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

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

// ─── EngageBadge ─────────────────────────────────────────────────────────────
function EngageBadge({ state }) {
  if (state === 'not_started') return null;
  const configs = {
    in_mission:    { label: 'ACTIVE',    bg: '#7c3aed20', color: '#7c3aed', border: '#7c3aed40' },
    follow_up_due: { label: 'OVERDUE',   bg: '#dc262620', color: '#dc2626', border: '#dc262640' },
    converted:     { label: 'CONVERTED', bg: '#10b98120', color: '#10b981', border: '#10b98140' },
  };
  const cfg = configs[state];
  if (!cfg) return null;
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px', borderRadius: 20,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      fontSize: 9, fontWeight: 700, letterSpacing: 0.5, whiteSpace: 'nowrap',
    }}>
      {cfg.label}
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
function AllLeadsCard({ contact, company, onClick, onCompanyClick, engageState = 'not_started', mode = 'people', onReturnToScout }) {
  const T = useT();
  const color = BRAND.pink;
  const email = contact.email || contact.work_email;
  const status = getLeadStatus(contact);
  const photo = contact.photo_url;
  const btnCfg = CARD_BTN_CONFIG[engageState] || CARD_BTN_CONFIG.not_started;

  return (
    <div
      onClick={onClick}
      style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', transition: 'all 0.15s', display: 'flex', flexDirection: 'column' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = T.borderHov; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = T.border; }}
    >
      {/* Photo area */}
      <div style={{ position: 'relative', paddingTop: '90%' }}>
        {photo ? (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center top' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(155deg,${color}30,${T.cardBg2} 80%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: `${color}20`, border: `2px solid ${color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color }}>
              {getInitials(contact.name)}
            </div>
          </div>
        )}
        {/* Bottom gradient for text legibility */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', background: 'linear-gradient(to top,rgba(0,0,0,0.88) 0%,rgba(0,0,0,0.5) 50%,transparent 100%)' }} />
        {/* Status badge */}
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <StatusBadge status={status} small />
        </div>
        {/* Engagement state badge (top-left, only when not new) */}
        {engageState !== 'not_started' && (
          <div style={{ position: 'absolute', top: 8, left: 8 }}>
            <EngageBadge state={engageState} />
          </div>
        )}
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
        <div style={{ display: 'flex', gap: 5 }}>
          <button style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', background: btnCfg.bg, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            {btnCfg.label}
          </button>
          {mode === 'hunter' ? (
            <button
              onClick={e => { e.stopPropagation(); onReturnToScout && onReturnToScout(); }}
              style={{ padding: '7px 9px', borderRadius: 7, border: '1px solid #9ca3af40', background: 'transparent', color: '#9ca3af', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="Move back to Scout"
            ><RotateCcw size={11} /></button>
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

  // UI
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'list'
  const [brigadeFilter, setBrigadeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dataFilter, setDataFilter] = useState(null);

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
      const companiesSnapshot = await getDocs(collection(db, 'users', user.uid, 'companies'));
      const companiesMap = {};
      companiesSnapshot.docs.forEach(d => { companiesMap[d.id] = d.data(); });
      setCompanies(companiesMap);
      const contactsSnapshot = await getDocs(collection(db, 'users', user.uid, 'contacts'));
      const contactsList = contactsSnapshot.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(c => {
          const s = c.status || '';
          if (['people_mode_archived', 'people_mode_skipped'].includes(s)) return false;
          if (mode === 'scout') return c.hunter_status !== 'active_mission';
          if (mode === 'hunter') return c.hunter_status === 'active_mission';
          return true; // 'people' — show all
        });
      setContacts(contactsList);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load contacts:', error);
      setLoading(false);
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

  function exportToCSV() {
    const list = finalContacts;
    if (list.length === 0) return;
    const headers = ['Name', 'Title', 'Company', 'Email', 'Phone', 'LinkedIn'];
    const rows = list.map(c => {
      const co = companies[c.company_id];
      return [c.name || '', c.title || '', co?.name || c.company_name || '', c.email || c.work_email || '', c.phone_mobile || c.phone_direct || c.phone || '', c.linkedin_url || ''].map(f => `"${f}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-leads-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // ── Computed ─────────────────────────────────────────────────────────────────
  let filtered = contacts;

  // Brigade filter
  if (brigadeFilter !== 'all') filtered = filtered.filter(c => getBrigadeType(c) === brigadeFilter);

  // Data filter
  if (dataFilter === 'has-email') filtered = filtered.filter(c => !!(c.email || c.work_email));
  else if (dataFilter === 'needs-email') filtered = filtered.filter(c => !(c.email || c.work_email));
  else if (dataFilter === 'needs-phone') filtered = filtered.filter(c => !(c.phone_mobile || c.phone_direct || c.phone));

  // Search
  if (searchTerm) {
    const lower = searchTerm.toLowerCase();
    filtered = filtered.filter(c => {
      const co = companies[c.company_id];
      return (c.name || '').toLowerCase().includes(lower) ||
        (c.title || '').toLowerCase().includes(lower) ||
        (co?.name || c.company_name || '').toLowerCase().includes(lower) ||
        (c.email || '').toLowerCase().includes(lower);
    });
  }

  // Sort: overdue first → active mission → not started → converted
  const finalContacts = [...filtered].sort((a, b) => {
    const orderA = ENGAGE_SORT_ORDER[deriveCardEngageState(a)] ?? 2;
    const orderB = ENGAGE_SORT_ORDER[deriveCardEngageState(b)] ?? 2;
    return orderA - orderB;
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
              {mode === 'hunter' ? 'Active Contacts' : 'People'}
            </h2>
            <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>
              {mode === 'hunter'
                ? 'Contacts with active missions.'
                : mode === 'scout'
                ? 'Ready for first contact.'
                : 'Every relationship — one place.'}
            </div>
          </div>
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
            placeholder="Search by name, title, company, or email..."
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
