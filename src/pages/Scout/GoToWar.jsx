/**
 * GoToWar.jsx — Go To War view in Command Center.
 *
 * Dedicated 8-phase wizard for launching bulk missions against a roster of contacts.
 * NOT a modal — this is a full section inside the Command Center shell.
 *
 * Phase 1: Brief     — Define objective (goal type + mission name)
 * Phase 2: Roster    — Select contacts via checkbox list (new component, not CompanyCard)
 * Phase 3: Approach  — Engagement style + channel [stub — Sprint Day 2]
 * Phase 4: Sequence  — Barry-generated message plan [stub — Sprint Day 2]
 * Phase 5: Approve   — Per-message review + edit [stub — Sprint Day 2]
 * Phase 6: Launch    — Fire [stub — Sprint Day 3]
 * Phase 7: Monitor   — Reply tracking [stub — Sprint Day 3]
 * Phase 8: Debrief   — Outcome recording [stub — Sprint Day 3]
 *
 * Scout company card audit (Day 1):
 *   CompanyCard is swipe-only and cannot be extended for list+checkbox mode.
 *   Go To War uses a new ContactRosterRow component (see below) for Phase 2.
 *
 * Data model:
 *   mission.roster[n].replyStatus:     'no-reply' | 'replied' | 'bounced'
 *   mission.roster[n].lastContactedAt: Timestamp | null
 *   (replaces the previously-planned `waitingForReply: bool` on the mission root)
 */

import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import {
  Swords, Target, MessageSquare, RefreshCw,
  ChevronRight, ChevronLeft, Check, Search,
  AlertCircle, Loader, Users,
} from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import BarryHUD, { PHASE_LABELS } from '../../components/BarryHUD';

const WAR_ACCENT = '#f97316'; // orange — distinct from CC cyan so Go To War feels like action
const TOTAL_PHASES = 8;

// ─── Goal options (reuse missionTemplates goal IDs) ───────────────────────────
const GOAL_OPTIONS = [
  {
    id: 'book_meetings',
    label: 'Book Meetings',
    icon: Target,
    desc: 'Multi-touch sequence designed to get time on the calendar.',
    color: '#6366f1',
  },
  {
    id: 'warm_conversations',
    label: 'Warm Conversations',
    icon: MessageSquare,
    desc: 'Build relationship before pitching. Low pressure, high value.',
    color: '#10b981',
  },
  {
    id: 'reengage_stalled',
    label: 'Reengage Stalled',
    icon: RefreshCw,
    desc: 'Wake up contacts who went quiet. Different angle, fresh energy.',
    color: '#f59e0b',
  },
];

// ─── ContactRosterRow ─────────────────────────────────────────────────────────
// Replaces CompanyCard swipe UI. Built specifically for bulk list+checkbox selection.
// CompanyCard audit result: swipe-only, not extensible for multi-select — new component needed.
function ContactRosterRow({ contact, selected, onToggle, T }) {
  const initials = (contact.name || contact.email || 'XX')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      onClick={() => onToggle(contact.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 10,
        marginBottom: 2,
        cursor: 'pointer',
        background: selected ? `${WAR_ACCENT}10` : T.cardBg,
        border: `1.5px solid ${selected ? `${WAR_ACCENT}40` : T.border2}`,
        transition: 'all 0.12s',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = T.surface;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = selected ? `${WAR_ACCENT}10` : T.cardBg;
      }}
    >
      {/* Checkbox */}
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `2px solid ${selected ? WAR_ACCENT : T.border2}`,
          background: selected ? WAR_ACCENT : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.12s',
        }}
      >
        {selected && <Check size={11} color="#fff" strokeWidth={3} />}
      </div>

      {/* Avatar */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: `${BRAND.cyan}20`,
          border: `1.5px solid ${BRAND.cyan}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: BRAND.cyan,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: T.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
        >
          {contact.name || 'Unknown'}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.textFaint,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {[contact.title, contact.company].filter(Boolean).join(' · ') || contact.email || '—'}
        </div>
      </div>

      {/* Status badge (if contact is already on an active mission) */}
      {contact.hunter_status === 'active_mission' && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: '#f59e0b',
            background: '#f59e0b15',
            border: '1px solid #f59e0b30',
            padding: '2px 7px',
            borderRadius: 20,
            flexShrink: 0,
          }}
        >
          ACTIVE
        </span>
      )}
    </div>
  );
}

// ─── Phase stubs (Phases 3–8) ─────────────────────────────────────────────────
function PhaseStub({ phaseIndex, T }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 48,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: `${WAR_ACCENT}15`,
          border: `1.5px solid ${WAR_ACCENT}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Swords size={22} color={WAR_ACCENT} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>
        Phase {phaseIndex + 1} — {PHASE_LABELS[phaseIndex]}
      </div>
      <div style={{ fontSize: 13, color: T.textFaint, maxWidth: 360, lineHeight: 1.6 }}>
        Building this phase in the current sprint. Complete Phases 1 and 2 to continue.
      </div>
    </div>
  );
}

// ─── GoToWar ──────────────────────────────────────────────────────────────────
export default function GoToWar() {
  const T = useT();

  // Phase state (0-indexed)
  const [phase, setPhase] = useState(0);

  // Phase 1: Brief
  const [goalId, setGoalId]       = useState('');
  const [missionName, setMissionName] = useState('');

  // Phase 2: Roster
  const [contacts, setContacts]       = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError]     = useState(null);
  const [selected, setSelected]       = useState(new Set());
  const [search, setSearch]           = useState('');

  // Load contacts when entering Phase 2
  useEffect(() => {
    if (phase !== 1) return;
    if (contacts.length > 0) return; // already loaded
    loadContacts();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadContacts() {
    setContactsLoading(true);
    setContactsError(null);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'contacts'), orderBy('name'))
      );
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('[GoToWar] contacts load error:', err);
      setContactsError('Failed to load contacts. Try refreshing.');
    } finally {
      setContactsLoading(false);
    }
  }

  const toggleContact = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const visible = filteredContacts.map((c) => c.id);
    const allSelected = visible.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visible.forEach((id) => next.delete(id));
      else visible.forEach((id) => next.add(id));
      return next;
    });
  };

  const filteredContacts = contacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.title?.toLowerCase().includes(q)
    );
  });

  // Phase gate: can the user advance?
  const canAdvance = () => {
    if (phase === 0) return goalId !== '';
    if (phase === 1) return selected.size > 0;
    return true;
  };

  // ── Phase 1: Brief ──────────────────────────────────────────────────────────
  const renderPhase1 = () => (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            margin: 0,
            fontSize: '1.25rem',
            fontWeight: 700,
            color: T.text,
            letterSpacing: '-0.02em',
            marginBottom: 6,
          }}
        >
          What are you going after?
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
          Choose the goal that drives this mission. Barry builds the plan around it.
        </p>
      </div>

      {/* Goal cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {GOAL_OPTIONS.map((g) => {
          const active = goalId === g.id;
          const Icon = g.icon;
          return (
            <div
              key={g.id}
              onClick={() => setGoalId(g.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 12,
                border: `2px solid ${active ? g.color : T.border2}`,
                background: active ? `${g.color}10` : T.cardBg,
                cursor: 'pointer',
                transition: 'all 0.12s',
                userSelect: 'none',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = T.surface;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = active ? `${g.color}10` : T.cardBg;
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: `${g.color}18`,
                  border: `1.5px solid ${g.color}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon size={19} color={g.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: active ? g.color : T.text,
                    marginBottom: 3,
                  }}
                >
                  {g.label}
                </div>
                <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.45 }}>
                  {g.desc}
                </div>
              </div>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: `2px solid ${active ? g.color : T.border2}`,
                  background: active ? g.color : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {active && <Check size={11} color="#fff" strokeWidth={3} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mission name */}
      {goalId && (
        <div style={{ animation: 'fadeUp 0.18s ease' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: T.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Name this mission (optional)
          </div>
          <input
            type="text"
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            placeholder={
              GOAL_OPTIONS.find((g) => g.id === goalId)?.label + ' — ' +
              new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            }
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 10,
              border: `1.5px solid ${T.border2}`,
              background: T.cardBg,
              color: T.text,
              fontSize: 13,
              outline: 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
              boxSizing: 'border-box',
              transition: 'border-color 0.12s',
            }}
            onFocus={(e) => { e.target.style.borderColor = WAR_ACCENT; }}
            onBlur={(e) => { e.target.style.borderColor = T.border2; }}
          />
        </div>
      )}
    </div>
  );

  // ── Phase 2: Roster ─────────────────────────────────────────────────────────
  const renderPhase2 = () => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 12px', flexShrink: 0 }}>
        <h2
          style={{
            margin: 0,
            fontSize: '1.15rem',
            fontWeight: 700,
            color: T.text,
            letterSpacing: '-0.02em',
            marginBottom: 4,
          }}
        >
          Select your roster
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint }}>
          {selected.size > 0
            ? `${selected.size} contact${selected.size !== 1 ? 's' : ''} selected`
            : 'Choose who goes into this wave.'}
        </p>
      </div>

      {/* Search bar */}
      <div style={{ padding: '0 24px 10px', flexShrink: 0 }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={14}
            color={T.textFaint}
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, company, title…"
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              borderRadius: 9,
              border: `1.5px solid ${T.border2}`,
              background: T.surface,
              color: T.text,
              fontSize: 12,
              outline: 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => { e.target.style.borderColor = WAR_ACCENT; }}
            onBlur={(e) => { e.target.style.borderColor = T.border2; }}
          />
        </div>
      </div>

      {/* Select all row */}
      {filteredContacts.length > 0 && (
        <div
          style={{
            padding: '4px 24px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, color: T.textFaint }}>
            {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}
            {search ? ' matching' : ''}
          </span>
          <button
            onClick={toggleAll}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: WAR_ACCENT,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {filteredContacts.every((c) => selected.has(c.id)) ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      )}

      {/* Contact list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
        {contactsLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 40,
              color: T.textFaint,
              fontSize: 13,
            }}
          >
            <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
            Loading contacts…
          </div>
        ) : contactsError ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '16px 0',
              color: '#ef4444',
              fontSize: 13,
            }}
          >
            <AlertCircle size={15} />
            {contactsError}
          </div>
        ) : filteredContacts.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: 40,
              color: T.textFaint,
              fontSize: 13,
            }}
          >
            {search ? 'No contacts match that filter.' : 'No contacts found. Add contacts in Scout first.'}
          </div>
        ) : (
          filteredContacts.map((c) => (
            <ContactRosterRow
              key={c.id}
              contact={c}
              selected={selected.has(c.id)}
              onToggle={toggleContact}
              T={T}
            />
          ))
        )}
      </div>
    </div>
  );

  // ── Render active phase ─────────────────────────────────────────────────────
  const renderPhase = () => {
    if (phase === 0) return renderPhase1();
    if (phase === 1) return renderPhase2();
    return <PhaseStub phaseIndex={phase} T={T} />;
  };

  // ─── Layout ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: T.text,
      }}
    >
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Barry HUD — persistent top strip */}
      <BarryHUD phase={phase} totalPhases={TOTAL_PHASES} />

      {/* Phase pills */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
          overflowX: 'auto',
        }}
      >
        {PHASE_LABELS.map((label, i) => {
          const done    = i < phase;
          const active  = i === phase;
          const locked  = i > phase;
          return (
            <button
              key={i}
              onClick={() => { if (!locked) setPhase(i); }}
              disabled={locked}
              style={{
                flexShrink: 0,
                padding: '5px 11px',
                borderRadius: 20,
                border: `1.5px solid ${
                  active  ? WAR_ACCENT :
                  done    ? `${WAR_ACCENT}50` :
                  T.border2
                }`,
                background: active ? `${WAR_ACCENT}18` : 'transparent',
                color: active ? WAR_ACCENT : done ? T.textMuted : T.textFaint,
                fontSize: 11,
                fontWeight: active || done ? 600 : 400,
                cursor: locked ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: 'Inter, system-ui, sans-serif',
                transition: 'all 0.12s',
                opacity: locked ? 0.45 : 1,
              }}
            >
              {done && <Check size={10} strokeWidth={3} />}
              {!done && <span style={{ fontSize: 9, fontWeight: 700 }}>{i + 1}</span>}
              {label}
            </button>
          );
        })}
      </div>

      {/* Phase content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderPhase()}
      </div>

      {/* Navigation footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '12px 24px',
          borderTop: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: T.cardBg,
        }}
      >
        {/* Back */}
        <button
          onClick={() => setPhase((p) => Math.max(0, p - 1))}
          disabled={phase === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 9,
            border: `1.5px solid ${T.border2}`,
            background: 'transparent',
            color: phase === 0 ? T.textFaint : T.textMuted,
            fontSize: 13,
            fontWeight: 600,
            cursor: phase === 0 ? 'default' : 'pointer',
            opacity: phase === 0 ? 0.35 : 1,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <ChevronLeft size={14} />
          Back
        </button>

        {/* Context label */}
        <div style={{ fontSize: 12, color: T.textFaint }}>
          Phase {phase + 1} of {TOTAL_PHASES} — {PHASE_LABELS[phase]}
        </div>

        {/* Next / Launch */}
        <button
          onClick={() => {
            if (phase < TOTAL_PHASES - 1) setPhase((p) => p + 1);
          }}
          disabled={!canAdvance()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 20px',
            borderRadius: 9,
            border: 'none',
            background: canAdvance() ? WAR_ACCENT : T.border2,
            color: canAdvance() ? '#fff' : T.textFaint,
            fontSize: 13,
            fontWeight: 700,
            cursor: canAdvance() ? 'pointer' : 'default',
            fontFamily: 'Inter, system-ui, sans-serif',
            boxShadow: canAdvance() ? `0 4px 14px ${WAR_ACCENT}40` : 'none',
            transition: 'all 0.15s',
          }}
        >
          {phase === TOTAL_PHASES - 1 ? (
            <>
              <Swords size={14} />
              Finish
            </>
          ) : (
            <>
              Next
              <ChevronRight size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
