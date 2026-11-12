/**
 * deriveContactNextBestStep — Barry's proposed next action for a contact
 * profile, from engagement history and canonical relationship state.
 *
 * Named distinctly from services/nextBestStepService.js's own
 * deriveNextBestStep — that one scores a Scout-stage brigade session
 * outcome, a different input shape and a different surface entirely.
 *
 * Pure and dependency-light (just the relationship/status readers), kept
 * out of NextBestStep.jsx itself: that file exports only the component, and
 * react-refresh/only-export-components forbids mixing a plain function
 * export into it.
 */
import { isInConversation, getLastInboundAt } from './relationshipRead.js';
import { ADVANCED_RELATIONSHIP_STATUSES } from '../constants/contactStatuses.js';

function toMillis(timestamp) {
  if (!timestamp) return null;
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function deriveContactNextBestStep(contact, events) {
  const sentEvents = events.filter(e => e.type === 'message_sent');
  const lastSent = sentEvents[0];
  const lastSentMs = toMillis(lastSent?.timestamp);
  const daysSinceLastSent = lastSentMs !== null
    ? (Date.now() - lastSentMs) / (1000 * 60 * 60 * 24)
    : null;

  // No engagement yet — "Start the Conversation" is a different surface's
  // job; Barry has no next step to propose here.
  if (sentEvents.length === 0) return null;

  // Active Customer, Partner, Network, etc. are a different lifecycle
  // dimension entirely (see contactStateMachine.js) — Barry has no
  // lead-engagement step to propose for them, same as PR A's send guard.
  if (ADVANCED_RELATIONSHIP_STATUSES.has(contact?.contact_status)) return null;

  // Canonical "they replied" signal, not the dead 'replied'/'engaged'
  // string literals this used to compare against (contact_status/
  // hunter_status never hold those values, so this branch could never
  // fire). isInConversation() only goes true off a genuine, verified
  // reply (replyPolling.js never sets it for automated or unverified
  // senders) — chronology then decides whether that reply is still the
  // most recent thing on the thread, or whether we've already followed
  // up since and are waiting again.
  const lastInboundAt = getLastInboundAt(contact);
  const lastInboundMs = lastInboundAt ? Date.parse(lastInboundAt) : null;
  const theirReplyIsMostRecent = lastInboundMs !== null
    && (lastSentMs === null || lastInboundMs > lastSentMs);

  if (isInConversation(contact) && theirReplyIsMostRecent) {
    return {
      type: 'accelerate',
      message: `${contact?.firstName || 'They'} replied — this is momentum. Keep it going.`,
      suggestion: 'Book a call or send a value-led follow-up while the door is open.',
      timing: null
    };
  }

  // Multiple sends, no reply — try a new channel
  if (sentEvents.length >= 2 && daysSinceLastSent > 5) {
    const channels = sentEvents.map(e => e.metadata?.channel).filter(Boolean);
    const uniqueChannels = [...new Set(channels)];
    if (uniqueChannels.length === 1) {
      return {
        type: 'try_new_channel',
        message: `${sentEvents.length} messages via ${uniqueChannels[0]} — no response yet.`,
        suggestion: 'Switch channels. The right message in the wrong place gets ignored.',
        timing: null
      };
    }
  }

  // Single send, awaiting reply
  if (sentEvents.length === 1 && daysSinceLastSent > 3) {
    return {
      type: 'follow_up',
      message: `Sent ${Math.round(daysSinceLastSent)} days ago — no reply yet.`,
      suggestion: `Barry recommends a warm follow-up. Want him to draft it?`,
      timing: '3d'
    };
  }

  // Many attempts, consider low-touch
  if (sentEvents.length >= 3 && daysSinceLastSent > 10) {
    return {
      type: 'low_touch',
      message: `${sentEvents.length} attempts — no response in ${Math.round(daysSinceLastSent)} days.`,
      suggestion: `Is this still a priority? Move to low-touch and check back in a month.`,
      timing: '1m'
    };
  }

  // Standard follow-up if recent send
  if (daysSinceLastSent !== null && daysSinceLastSent > 2) {
    return {
      type: 'follow_up',
      message: `Last contacted ${Math.round(daysSinceLastSent)} day${daysSinceLastSent >= 2 ? 's' : ''} ago.`,
      suggestion: 'Time for a follow-up. Barry will draft it with full context loaded.',
      timing: '2d'
    };
  }

  return null;
}

export default deriveContactNextBestStep;
