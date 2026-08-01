/**
 * Conversation state machine for inbound email processing.
 *
 * conversationState tracks the current email exchange.
 * It is separate from the contact's primary stage (Scout/Hunter/Sniper/etc).
 *
 * @typedef {"outreach_prepared" | "awaiting_response" | "response_received" |
 *           "user_action_required" | "waiting_on_contact" | "meeting_requested" |
 *           "meeting_scheduled" | "active_conversation" | "nurture" |
 *           "closed_won" | "closed_lost" | "no_action_required"} ConversationState
 */

export const CONVERSATION_STATES = {
  OUTREACH_PREPARED: 'outreach_prepared',
  AWAITING_RESPONSE: 'awaiting_response',
  RESPONSE_RECEIVED: 'response_received',
  USER_ACTION_REQUIRED: 'user_action_required',
  WAITING_ON_CONTACT: 'waiting_on_contact',
  MEETING_REQUESTED: 'meeting_requested',
  MEETING_SCHEDULED: 'meeting_scheduled',
  ACTIVE_CONVERSATION: 'active_conversation',
  NURTURE: 'nurture',
  CLOSED_WON: 'closed_won',
  CLOSED_LOST: 'closed_lost',
  NO_ACTION_REQUIRED: 'no_action_required',
};

// States that transition to response_received on inbound message
const INBOUND_TRANSITIONS = {
  [CONVERSATION_STATES.AWAITING_RESPONSE]: CONVERSATION_STATES.RESPONSE_RECEIVED,
  [CONVERSATION_STATES.WAITING_ON_CONTACT]: CONVERSATION_STATES.RESPONSE_RECEIVED,
  [CONVERSATION_STATES.ACTIVE_CONVERSATION]: CONVERSATION_STATES.RESPONSE_RECEIVED,
  [CONVERSATION_STATES.NURTURE]: CONVERSATION_STATES.RESPONSE_RECEIVED,
};

const SCHEDULING_KEYWORDS = [
  'schedule', 'meeting', 'call', 'calendar', 'book a time',
  'set up a time', 'available', 'free this week', 'hop on a call',
  'let\'s meet', 'zoom', 'teams call', 'google meet',
];

function containsSchedulingLanguage(bodyText) {
  const lower = (bodyText || '').toLowerCase();
  return SCHEDULING_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Determine the next conversation state given an inbound message.
 *
 * @param {ConversationState|null} currentState
 * @param {import('./normalizedMessage.js').NormalizedMessage} message
 * @returns {{ newState: ConversationState, reason: string }}
 */
export function resolveInboundTransition(currentState, message) {
  if (message.category === 'automated') {
    return {
      newState: CONVERSATION_STATES.NO_ACTION_REQUIRED,
      reason: 'Automated message — no state change applied',
    };
  }

  if (currentState === CONVERSATION_STATES.MEETING_REQUESTED) {
    if (containsSchedulingLanguage(message.bodyText)) {
      return {
        newState: CONVERSATION_STATES.MEETING_SCHEDULED,
        reason: 'Scheduling language detected in reply to meeting request',
      };
    }
    return {
      newState: CONVERSATION_STATES.USER_ACTION_REQUIRED,
      reason: 'Reply to meeting request without scheduling confirmation',
    };
  }

  const mapped = INBOUND_TRANSITIONS[currentState];
  if (mapped) {
    const reason = currentState === CONVERSATION_STATES.NURTURE
      ? 'Unexpected reply from nurtured contact — flagged for review'
      : `Inbound message transitions from ${currentState}`;
    return { newState: mapped, reason };
  }

  // No explicit transition rule — default to response_received if state exists,
  // or set initial state if contact had no conversationState
  if (!currentState) {
    return {
      newState: CONVERSATION_STATES.RESPONSE_RECEIVED,
      reason: 'First inbound message — initial conversation state set',
    };
  }

  return {
    newState: currentState,
    reason: `No transition rule from ${currentState} — state unchanged`,
  };
}
