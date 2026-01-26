import { MessageSquare, Calendar, DollarSign, RotateCcw, AlertCircle } from 'lucide-react';
import './OutcomeSuggestions.css';

/**
 * HUNTER PHASE 2: Outcome Suggestions
 *
 * Purpose: Provide contextual next-step suggestions based on engagement outcome
 * Philosophy: Guide users toward productive next actions, not automation
 *
 * Features:
 * - Outcome-specific suggestions
 * - Manual action triggers (no automation)
 * - Learning hints for users
 *
 * Non-automation: All suggestions require user action
 */

const OUTCOME_SUGGESTIONS = {
  replied: {
    icon: MessageSquare,
    color: '#3b82f6',
    title: 'They Replied!',
    suggestions: [
      'Check your email for their response',
      'Respond promptly to keep momentum',
      'Consider marking outcome as "meeting_booked" or "opportunity_created" if applicable'
    ]
  },
  meeting_booked: {
    icon: Calendar,
    color: '#10b981',
    title: 'Meeting Booked',
    suggestions: [
      'Add meeting to your calendar',
      'Prepare talking points based on RECON intelligence',
      'Send calendar invite with agenda'
    ]
  },
  opportunity_created: {
    icon: DollarSign,
    color: '#8b5cf6',
    title: 'Opportunity Created',
    suggestions: [
      'Create opportunity in your CRM',
      'Document next steps and timeline',
      'Plan follow-up cadence based on sales cycle'
    ]
  },
  no_response: {
    icon: AlertCircle,
    color: '#6b7280',
    title: 'No Response',
    suggestions: [
      'Wait 3-5 days before following up',
      'Try different angle or value proposition',
      'Consider reaching out on LinkedIn'
    ]
  },
  unsubscribed: {
    icon: RotateCcw,
    color: '#ef4444',
    title: 'Unsubscribed',
    suggestions: [
      'Respect their decision - do not re-engage',
      'Review message tone for future campaigns',
      'Focus efforts on more engaged prospects'
    ]
  }
};

export default function OutcomeSuggestions({ outcome, onFollowUp }) {
  if (!outcome || !OUTCOME_SUGGESTIONS[outcome]) {
    return null;
  }

  const suggestion = OUTCOME_SUGGESTIONS[outcome];
  const Icon = suggestion.icon;

  return (
    <div className="outcome-suggestions" style={{ borderLeftColor: suggestion.color }}>
      <div className="outcome-suggestions-header">
        <Icon className="w-5 h-5" style={{ color: suggestion.color }} />
        <h4>{suggestion.title}</h4>
      </div>
      <ul className="outcome-suggestions-list">
        {suggestion.suggestions.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
      {(outcome === 'replied' || outcome === 'no_response') && onFollowUp && (
        <button className="btn-followup-action" onClick={onFollowUp}>
          Compose Follow-Up
        </button>
      )}
    </div>
  );
}
