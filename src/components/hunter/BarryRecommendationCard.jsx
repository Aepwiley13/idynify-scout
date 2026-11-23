/**
 * BARRY RECOMMENDATION CARD (Step 7)
 *
 * Reusable card component for Barry's proactive recommendations.
 * Used in:
 *   1. Dashboard Needs Attention section
 *   2. Contact Profile Barry Insight Panel
 *   3. HunterContactDrawer pre-engagement surface
 *
 * Features:
 *   - Barry indicator (bear emoji) so users know this is proactive intelligence
 *   - Reasoning display (observed / why / suggestion / rationale)
 *   - Single action CTA
 *   - Dismissal with reason selection
 *   - Category badge for visual distinction
 */

import { useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import BarryReasoningDisplay from './BarryReasoningDisplay';

const DISMISS_REASONS = [
  { id: 'not_relevant', label: 'Not relevant' },
  { id: 'already_handled', label: 'Already handled' },
  { id: 'remind_later', label: 'Remind me later' }
];

const CATEGORY_STYLES = {
  stalled_engagement: {
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/5',
    badge: 'bg-amber-500/20 text-[color:color-mix(in_srgb,#d97706_60%,var(--text-primary))]',
    label: 'Stalled Engagement'
  },
  high_value_contact: {
    border: 'border-pink-500/40',
    bg: 'bg-pink-500/5',
    badge: 'bg-pink-500/20 text-[color:color-mix(in_srgb,#e8197d_60%,var(--text-primary))]',
    label: 'High-Value Contact'
  },
  mission_momentum: {
    border: 'border-purple-500/40',
    bg: 'bg-purple-500/5',
    badge: 'bg-purple-500/20 text-[color:color-mix(in_srgb,#7c3aed_60%,var(--text-primary))]',
    label: 'Mission Momentum'
  },
  strategic_gap: {
    border: 'border-cyan-500/40',
    bg: 'bg-cyan-500/5',
    badge: 'bg-cyan-500/20 text-[color:color-mix(in_srgb,#00c4cc_45%,var(--text-primary))]',
    label: 'Strategic Gap'
  }
};

export default function BarryRecommendationCard({
  recommendation,
  onAction,
  onDismiss,
  compact = false,
  showCategory = true
}) {
  const [expanded, setExpanded] = useState(false);
  const [showDismissOptions, setShowDismissOptions] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  if (!recommendation) return null;

  const style = CATEGORY_STYLES[recommendation.category] || CATEGORY_STYLES.stalled_engagement;

  async function handleDismiss(reason) {
    setDismissing(true);
    if (onDismiss) {
      await onDismiss(recommendation.id, reason);
    }
    setDismissing(false);
    setShowDismissOptions(false);
  }

  function handleAction() {
    if (onAction) {
      onAction(recommendation);
    }
  }

  if (compact) {
    return (
      <div className={`rounded-lg border ${style.border} ${style.bg} p-3 relative`}>
        <div className="flex items-start gap-2">
          <span className="text-lg flex-shrink-0">🐻</span>
          <div className="flex-1 min-w-0">
            <BarryReasoningDisplay reasoning={recommendation.reasoning} compact />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleAction}
                className="text-xs font-mono font-semibold px-3 py-1 rounded-md bg-cyan-500/20 text-[color:color-mix(in_srgb,#00c4cc_45%,var(--text-primary))] hover:bg-cyan-500/30 transition-colors"
              >
                {recommendation.action.label}
              </button>
              <button
                onClick={() => setShowDismissOptions(true)}
                className="text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>

        {showDismissOptions && (
          <DismissOverlay
            onDismiss={handleDismiss}
            onCancel={() => setShowDismissOptions(false)}
            dismissing={dismissing}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-4 relative backdrop-blur-sm`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <span className="text-xl flex-shrink-0">🐻</span>
          <div className="flex-1 min-w-0">
            {showCategory && (
              <span className={`inline-block text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${style.badge} mb-1.5`}>
                {style.label}
              </span>
            )}
            <p className="text-sm text-[color:var(--text-primary)] leading-snug">
              {recommendation.reasoning.observed}
            </p>
            {recommendation.contactName && (
              <p className="text-xs text-[color:var(--text-secondary)] font-mono mt-1">
                {recommendation.contactName}
                {recommendation.missionName ? ` · ${recommendation.missionName}` : ''}
                {recommendation.campaignName && !recommendation.missionName ? ` · ${recommendation.campaignName}` : ''}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={() => setShowDismissOptions(true)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] rounded transition-colors"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expandable reasoning */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] font-mono mb-3 transition-colors"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? 'Hide reasoning' : "Barry's reasoning"}
      </button>

      {expanded && (
        <div className="mb-3 ml-1">
          <BarryReasoningDisplay reasoning={recommendation.reasoning} />
        </div>
      )}

      {/* Action CTA */}
      <button
        onClick={handleAction}
        className="w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 text-[color:color-mix(in_srgb,#00c4cc_45%,var(--text-primary))] text-sm font-mono font-semibold hover:from-cyan-500/30 hover:to-purple-500/30 transition-all"
      >
        {recommendation.action.label}
      </button>

      {/* Dismiss overlay */}
      {showDismissOptions && (
        <DismissOverlay
          onDismiss={handleDismiss}
          onCancel={() => setShowDismissOptions(false)}
          dismissing={dismissing}
        />
      )}
    </div>
  );
}

function DismissOverlay({ onDismiss, onCancel, dismissing }) {
  return (
    <div className="absolute inset-0 bg-[color:color-mix(in_srgb,var(--bg-card)_95%,transparent)] backdrop-blur-sm rounded-xl flex flex-col items-center justify-center p-4 z-10">
      <p className="text-xs text-[color:var(--text-secondary)] font-mono mb-3">Why are you dismissing this?</p>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        {DISMISS_REASONS.map(reason => (
          <button
            key={reason.id}
            onClick={() => onDismiss(reason.id)}
            disabled={dismissing}
            className="text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] py-2 px-3 rounded-lg border border-[color:var(--border)] hover:border-[color:var(--border-2)] transition-colors font-mono disabled:opacity-50"
          >
            {reason.label}
          </button>
        ))}
        <button
          onClick={onCancel}
          disabled={dismissing}
          className="text-xs text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] py-1.5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
