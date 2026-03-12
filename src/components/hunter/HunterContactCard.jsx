/**
 * HunterContactCard — Front face of the Hunter card.
 *
 * Layout per spec:
 *   [Company Logo / Initials]
 *   First Last · Title · Company
 *   ● Relationship State
 *   ◈ Strategic Value
 *   ↩ Last Interaction
 *   ─────────────────
 *   Barry's one-line read (field commander voice)
 *   [RECON confidence dot]
 *   [ ARCHIVE ]  [ 🚀 ENGAGE ]
 *
 * Color system: pink/dark (Hunter identity, vs Scout's cyan/light)
 * RECON confidence: green (80%+), yellow (40–80%), red (<40%), gray (no data)
 */

import { useEffect, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { auth } from '../../firebase/config';
import { getCTAForContact } from '../../constants/structuredFields';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import './HunterContactCard.css';
import { getEffectiveUser } from '../context/ImpersonationContext';

// ── RECON confidence dot ────────────────────────────────
// Accepts reconConfidencePct (0-100) — the new interface from reconConfidence.js.
// Also accepts legacy reconCompletion (0-1) for backward compatibility.

function ReconDot({ reconConfidencePct, reconCompletion }) {
  // Normalise to a 0-100 integer
  let pct = reconConfidencePct;
  if (pct === null || pct === undefined) {
    pct = reconCompletion !== null && reconCompletion !== undefined
      ? Math.round(reconCompletion * 100)
      : null;
  }
  if (pct === null || pct === undefined) {
    return <span className="hcc-recon-dot hcc-recon-dot--none" title="No RECON data" />;
  }
  const level = pct >= 80 ? 'high' : pct >= 40 ? 'mid' : 'low';
  const labels = { high: 'Strong context', mid: 'Partial context', low: 'Limited context' };
  return (
    <span
      className={`hcc-recon-dot hcc-recon-dot--${level}`}
      title={`RECON: ${labels[level]} (${pct}%)`}
      aria-label={`RECON: ${labels[level]}`}
    />
  );
}

// ── Relationship state badge ────────────────────────────

const STATE_COLORS = {
  unaware: '#9ca3af',
  aware: '#60a5fa',
  engaged: '#34d399',
  warm: '#fb923c',
  trusted: '#a78bfa',
  advocate: '#f472b6',
  dormant: '#6b7280',
  strained: '#f87171',
  strategic_partner: '#818cf8'
};

function RelationshipBadge({ state }) {
  const color = STATE_COLORS[state] || '#9ca3af';
  const label = state
    ? state.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
    : 'Unknown';
  return (
    <span className="hcc-badge" style={{ color, borderColor: `${color}40` }}>
      <span className="hcc-badge-dot" style={{ background: color }} />
      {label}
    </span>
  );
}

// ── Company initials avatar ─────────────────────────────

function CompanyAvatar({ contact }) {
  const [imgError, setImgError] = useState(false);
  const logoUrl = contact.company_logo_url || contact.logo_url;
  const name = contact.company_name || contact.name || '?';
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  if (logoUrl && !imgError) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className="hcc-avatar hcc-avatar-img"
        onError={() => setImgError(true)}
      />
    );
  }
  return <div className="hcc-avatar hcc-avatar-initials">{initials}</div>;
}

// ── Last interaction label ──────────────────────────────

function lastInteractionLabel(contact) {
  const date = contact.last_interaction_at || contact.last_contacted_at;
  if (!date) return 'Never';
  return formatRelativeTime(date) || 'Unknown';
}

function strategicValueLabel(val) {
  const map = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
  return map[val] || '—';
}

// ── Barry one-liner ─────────────────────────────────────

function BarryRead({ contact }) {
  const [read, setRead] = useState(contact.barry_hunter_read || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Use cached read if state matches; otherwise fetch
    const cachedState = contact.barry_hunter_read_state;
    const currentState = contact.relationship_state;
    if (contact.barry_hunter_read && cachedState === currentState) {
      setRead(contact.barry_hunter_read);
      return;
    }

    let cancelled = false;
    async function fetchRead() {
      setLoading(true);
      try {
        const user = getEffectiveUser();
        if (!user) return;
        const authToken = await user.getIdToken();
        const res = await fetch('/.netlify/functions/barryHunterCardRead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid, authToken, contact })
        });
        const data = await res.json();
        if (!cancelled && data.success) setRead(data.read);
      } catch {
        // Non-fatal — card works without the one-liner
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRead();
    return () => { cancelled = true; };
  }, [contact.id, contact.relationship_state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <p className="hcc-barry-read hcc-barry-read--loading">Barry is reading the situation...</p>;
  }
  if (!read) return null;
  return <p className="hcc-barry-read">"{read}"</p>;
}

// ── Main card component ─────────────────────────────────

export default function HunterContactCard({
  contact,
  reconConfidencePct,
  reconCompletion,       // legacy — accepted for compat
  hasActiveMission,
  onEngage,
  onArchive,
  onQuickMissionAssign,  // Sprint 1.2: lightweight mission picker, no full Barry load
  isBackground
}) {
  const cta = getCTAForContact(contact.relationship_state, hasActiveMission);
  // reconEnhanced: true when user has enough RECON for Barry to be grounded (≥40%)
  const pct = reconConfidencePct ?? (reconCompletion != null ? Math.round(reconCompletion * 100) : null);
  const reconEnhanced = pct !== null && pct >= 40;

  if (isBackground) {
    return (
      <div className="hcc-card hcc-card--background">
        <CompanyAvatar contact={contact} />
        <div className="hcc-name">{contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()}</div>
        <div className="hcc-subtitle">
          {[contact.title, contact.company_name].filter(Boolean).join(' · ')}
        </div>
      </div>
    );
  }

  return (
    <div className="hcc-card">
      {/* Avatar */}
      <CompanyAvatar contact={contact} />

      {/* Name + title */}
      <div className="hcc-name">
        {contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()}
      </div>
      <div className="hcc-subtitle">
        {[contact.title, contact.company_name].filter(Boolean).join(' · ')}
      </div>

      {/* Relationship intel row */}
      <div className="hcc-intel">
        <RelationshipBadge state={contact.relationship_state} />

        <span className="hcc-intel-item">
          <span className="hcc-intel-icon">◈</span>
          <span className="hcc-intel-label">Strategic Value</span>
          <span className="hcc-intel-value">{strategicValueLabel(contact.strategic_value)}</span>
        </span>

        <span className="hcc-intel-item">
          <span className="hcc-intel-icon">↩</span>
          <span className="hcc-intel-label">Last contact</span>
          <span className="hcc-intel-value">{lastInteractionLabel(contact)}</span>
        </span>
      </div>

      {/* Divider */}
      <div className="hcc-divider" />

      {/* Barry's read */}
      <div className="hcc-barry-section">
        <div className="hcc-barry-header">
          <span className="hcc-barry-label">Barry</span>
          <ReconDot reconConfidencePct={pct} />
          {reconEnhanced && (
            <span
              className="hcc-recon-enhanced-badge"
              title="Barry has enhanced context on this contact"
            >
              ◈ Enhanced
            </span>
          )}
        </div>
        <BarryRead contact={contact} />
      </div>

      {/* Action buttons */}
      <div className="hcc-actions">
        <button
          className="hcc-btn hcc-btn--archive"
          onClick={() => onArchive(contact)}
          aria-label="Archive contact"
        >
          Archive
        </button>
        {onQuickMissionAssign && (
          <button
            className="hcc-btn hcc-btn--mission"
            onClick={(e) => { e.stopPropagation(); onQuickMissionAssign(contact); }}
            aria-label="Add to mission"
            title="Quick-add to mission"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Mission
          </button>
        )}
        <button
          className="hcc-btn hcc-btn--engage"
          onClick={() => onEngage(contact)}
          aria-label={cta.label}
        >
          🚀 {cta.label}
        </button>
      </div>
    </div>
  );
}
