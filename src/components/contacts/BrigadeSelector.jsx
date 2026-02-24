/**
 * BRIGADE SELECTOR
 *
 * Operation People First — Brigade Intelligence.
 *
 * Brigades replace game buckets. Each one tells Barry what kind of
 * relationship this is and what engagement strategy applies next.
 *
 * Brigades are not tags — they are behavioral contracts between the
 * user and the system. When you assign someone to a brigade, Barry
 * changes his entire approach: tone, message type, timing, and goal.
 *
 * Purposeful, not organizational.
 */

import { useState } from 'react';
import { auth } from '../../firebase/config';
import { onBrigadeChange } from '../../utils/brigadeSystem';
import {
  Target, UserCheck, Handshake, Gift, Network,
  Archive, ChevronDown, ChevronUp, Info
} from 'lucide-react';
import './BrigadeSelector.css';

// ── Brigade Definitions ──────────────────────────────────

export const BRIGADES = [
  {
    id: 'leads',
    label: 'Lead',
    icon: Target,
    color: '#7c3aed',
    bgColor: 'rgba(124, 58, 237, 0.08)',
    borderColor: 'rgba(124, 58, 237, 0.25)',
    description: 'Active pursuit — working toward a business outcome',
    barryBehavior: 'Barry defaults to direct, outcome-focused outreach with clear asks',
    engagementIntent: 'prospect'
  },
  {
    id: 'customers',
    label: 'Customer',
    icon: UserCheck,
    color: '#10b981',
    bgColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    description: 'Active customer — relationship is live',
    barryBehavior: 'Barry focuses on value delivery, expansion opportunities, and retention signals',
    engagementIntent: 'customer'
  },
  {
    id: 'partners',
    label: 'Partner',
    icon: Handshake,
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
    description: 'Business partner, collaborator, or referral source',
    barryBehavior: 'Barry emphasizes mutual value, co-creation opportunities, and reciprocity',
    engagementIntent: 'partner'
  },
  {
    id: 'referrals',
    label: 'Referral',
    icon: Gift,
    color: '#ec4899',
    bgColor: 'rgba(236, 72, 153, 0.08)',
    borderColor: 'rgba(236, 72, 153, 0.25)',
    description: 'Someone who sends or receives referrals',
    barryBehavior: 'Barry tracks referral history and surfaces the right introduction moments',
    engagementIntent: 'warm'
  },
  {
    id: 'network',
    label: 'Network',
    icon: Network,
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.08)',
    borderColor: 'rgba(59, 130, 246, 0.25)',
    description: 'Ecosystem contact — worked together, sold to, or built with',
    barryBehavior: 'Barry focuses on staying warm, surfacing overlaps, and keeping the relationship alive',
    engagementIntent: 'warm'
  },
  {
    id: 'past_customers',
    label: 'Past Customer',
    icon: Archive,
    color: '#6b7280',
    bgColor: 'rgba(107, 114, 128, 0.08)',
    borderColor: 'rgba(107, 114, 128, 0.2)',
    description: 'Former customer — relationship paused but valuable',
    barryBehavior: 'Barry uses re-engagement tone, references shared history, and looks for comeback moments',
    engagementIntent: 'warm'
  }
];

export const BRIGADE_MAP = BRIGADES.reduce((acc, b) => {
  acc[b.id] = b;
  return acc;
}, {});

// ── Component ────────────────────────────────────────────

export default function BrigadeSelector({ contact, onUpdate }) {
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const currentBrigade = contact?.brigade
    ? BRIGADE_MAP[contact.brigade]
    : null;

  async function handleBrigadeSelect(brigadeId) {
    const user = auth.currentUser;
    if (!user || !contact?.id) return;

    // Toggle off if already selected
    const newValue = contact.brigade === brigadeId ? null : brigadeId;

    // Optimistic update — brigadeSystem will write Firestore + timeline
    onUpdate({ ...contact, brigade: newValue });

    try {
      setSaving(true);
      await onBrigadeChange({
        userId: user.uid,
        contactId: contact.id,
        fromBrigade: contact.brigade || null,
        toBrigade: newValue,
        contactName: contact.name || contact.firstName || null
      });
    } catch (error) {
      console.error('[BrigadeSelector] Error saving brigade:', error);
      onUpdate(contact); // revert optimistic update
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="brigade-selector">
      {/* Header */}
      <div className="brs-header">
        <div className="brs-header-left">
          <span className="brs-title">Brigade</span>
          {saving && <span className="brs-saving">Saving...</span>}
        </div>
        <button
          className="brs-info-btn"
          onClick={() => setShowDetails(d => !d)}
          aria-label="What is a Brigade?"
        >
          <Info className="w-3.5 h-3.5" />
          {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Brigade info panel */}
      {showDetails && (
        <div className="brs-info-panel">
          <p className="brs-info-text">
            Brigades tell Barry what kind of relationship this is — and that changes everything.
            Tone, strategy, timing, and next-best-action all adapt to the brigade you assign.
          </p>
          {currentBrigade && (
            <div className="brs-current-behavior">
              <span className="brs-behavior-label">Barry's approach for {currentBrigade.label}:</span>
              <p className="brs-behavior-text">{currentBrigade.barryBehavior}</p>
            </div>
          )}
        </div>
      )}

      {/* Brigade options */}
      <div className="brs-options">
        {BRIGADES.map(brigade => {
          const BrigadeIcon = brigade.icon;
          const isActive = contact.brigade === brigade.id;
          return (
            <button
              key={brigade.id}
              className={`brs-option ${isActive ? 'brs-option-active' : ''}`}
              onClick={() => handleBrigadeSelect(brigade.id)}
              style={isActive ? {
                borderColor: brigade.borderColor,
                background: brigade.bgColor,
                color: brigade.color
              } : {}}
              title={brigade.description}
            >
              <BrigadeIcon className="brs-option-icon" />
              <span className="brs-option-label">{brigade.label}</span>
              {isActive && (
                <span className="brs-option-active-dot" style={{ background: brigade.color }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Active brigade detail */}
      {currentBrigade && (
        <div
          className="brs-active-detail"
          style={{
            borderColor: currentBrigade.borderColor,
            background: currentBrigade.bgColor
          }}
        >
          <span
            className="brs-active-label"
            style={{ color: currentBrigade.color }}
          >
            {currentBrigade.label} Brigade
          </span>
          <span className="brs-active-desc">{currentBrigade.description}</span>
        </div>
      )}
    </div>
  );
}
