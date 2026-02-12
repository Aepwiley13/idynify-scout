/**
 * SEQUENCE EXAMPLES — Step 5 Reference Documentation
 *
 * Three hardcoded example sequences demonstrating how Barry reasons
 * across the full context stack for different scenarios.
 *
 * Purpose:
 *   1. Validate that Barry's output is reasoning correctly
 *   2. Provide concrete reference for debugging/extending sequence logic
 *   3. Show the expected shape of sequence plans and step content
 *
 * These are NOT UI templates. They are internal reference only.
 * A Template Library is post-MVP scope.
 */

// ─────────────────────────────────────────────────────────
// SCENARIO 1: Cold Prospect — Schedule a Meeting
// ─────────────────────────────────────────────────────────

export const EXAMPLE_COLD_PROSPECT = {
  scenario: 'Cold Prospect — Schedule a Meeting',
  description: 'Net new contact, no prior relationship. Goal is to get a meeting on the calendar within 30 days.',

  contactContext: {
    relationship_type: 'prospect',
    engagementIntent: 'prospect',
    warmth_level: 'cold',
    strategic_value: 'high'
  },

  missionFields: {
    outcome_goal: 'schedule_meeting',
    engagement_style: 'moderate',
    timeframe: 'this_month',
    next_step_type: 'send_message'
  },

  expectedSequence: {
    sequenceRationale: 'A moderate 3-step sequence gives enough touchpoints to build familiarity without overwhelming a cold contact, with timing spaced to feel natural over a 30-day window.',
    steps: [
      {
        stepNumber: 1,
        stepType: 'message',
        action: 'Send personalized email introducing yourself and referencing something specific about their company or role',
        channel: 'email',
        purpose: 'Establish first contact with a value-led opening that earns the right to a response',
        reasoning: 'Cold contacts need a reason to engage. Leading with insight about their business shows you did homework and are not blasting templates.',
        suggestedTiming: 'Day 0',
        suggestedDayOffset: 0,
        approvalRequired: true
      },
      {
        stepNumber: 2,
        stepType: 'follow_up',
        action: 'Send follow-up email referencing Step 1, adding a new value point or question',
        channel: 'email',
        purpose: 'Stay top of mind and give them a second reason to respond without repeating the first message',
        reasoning: 'Most cold emails get buried. A well-timed follow-up with a different angle doubles reply rates. 5 days gives them time to see it without feeling pressured.',
        suggestedTiming: 'Day 5',
        suggestedDayOffset: 5,
        approvalRequired: true
      },
      {
        stepNumber: 3,
        stepType: 'message',
        action: 'Direct meeting request with a specific time suggestion and easy way to book',
        channel: 'email',
        purpose: 'Convert interest into a scheduled meeting with a clear, low-friction CTA',
        reasoning: 'After two touches, it is time to be direct. Proposing specific times removes friction and shows respect for their time. This is the close step.',
        suggestedTiming: 'Day 12',
        suggestedDayOffset: 12,
        approvalRequired: true
      }
    ],
    expectedOutcome: 'A meeting scheduled within 30 days, or a clear signal that the contact is not interested, allowing graceful exit.',
    totalSteps: 3
  },

  adaptiveExamples: {
    'Step 1 → no_reply': 'Barry adjusts Step 2 to try a different angle. Instead of just following up on the first email, Barry introduces a new value point that approaches from a different direction.',
    'Step 1 → replied_positive': 'Barry accelerates. Step 2 becomes a direct meeting request instead of a follow-up, since the contact has already shown interest.',
    'Step 2 → replied_negative': 'Barry proposes a graceful exit for Step 3 — acknowledge their position, leave the door open, and offer to reconnect in the future.'
  }
};

// ─────────────────────────────────────────────────────────
// SCENARIO 2: Warm Customer — Gather Feedback
// ─────────────────────────────────────────────────────────

export const EXAMPLE_WARM_CUSTOMER = {
  scenario: 'Warm Customer — Gather Feedback',
  description: 'Existing customer with warm relationship. Goal is to collect feedback or validation on a product/service within the quarter.',

  contactContext: {
    relationship_type: 'known',
    engagementIntent: 'customer',
    warmth_level: 'warm',
    strategic_value: 'medium'
  },

  missionFields: {
    outcome_goal: 'gather_feedback',
    engagement_style: 'light_touch',
    timeframe: 'this_quarter',
    next_step_type: 'send_message'
  },

  expectedSequence: {
    sequenceRationale: 'A light-touch 2-step sequence respects the existing relationship while making the ask clear. Warm customers do not need heavy sequences — a friendly ask followed by one nudge is enough.',
    steps: [
      {
        stepNumber: 1,
        stepType: 'message',
        action: 'Send friendly email asking for their input on a specific topic, making the ask easy and time-bounded',
        channel: 'email',
        purpose: 'Frame the feedback request as a conversation, not a task — make them feel valued, not surveyed',
        reasoning: 'Warm customers respond better to personal, direct asks than formal surveys. Keep it short, specific, and appreciative.',
        suggestedTiming: 'Day 0',
        suggestedDayOffset: 0,
        approvalRequired: true
      },
      {
        stepNumber: 2,
        stepType: 'follow_up',
        action: 'Gentle text or email check-in if no response, reframing the ask as quick and easy',
        channel: 'text',
        purpose: 'Catch them in a different channel where they might respond faster, with a lighter touch',
        reasoning: 'Switching to text for the follow-up feels more personal and less formal. It signals this is a human request, not a workflow.',
        suggestedTiming: 'Day 14',
        suggestedDayOffset: 14,
        approvalRequired: true
      }
    ],
    expectedOutcome: 'Feedback received or a brief conversation that yields the needed input. Relationship maintained or strengthened.',
    totalSteps: 2
  },

  adaptiveExamples: {
    'Step 1 → replied_positive': 'Sequence can complete early. Barry may not even propose Step 2 if the feedback was already received.',
    'Step 1 → no_reply': 'Barry keeps Step 2 as a gentle nudge via text. Tone stays light — no guilt, no pressure.',
    'Step 1 → replied_negative': 'Barry proposes a simple acknowledgment — thank them for their honesty and close the sequence gracefully.'
  }
};

// ─────────────────────────────────────────────────────────
// SCENARIO 3: Known Partner — Get Introduction
// ─────────────────────────────────────────────────────────

export const EXAMPLE_KNOWN_PARTNER = {
  scenario: 'Known Partner — Get Introduction',
  description: 'Existing business partner with strong rapport. Goal is to ask for a warm introduction to someone in their network.',

  contactContext: {
    relationship_type: 'partner',
    engagementIntent: 'partner',
    warmth_level: 'hot',
    strategic_value: 'high'
  },

  missionFields: {
    outcome_goal: 'get_introduction',
    engagement_style: 'high_touch',
    timeframe: 'this_month',
    next_step_type: 'book_call'
  },

  expectedSequence: {
    sequenceRationale: 'A high-touch 4-step sequence leverages the strong existing relationship. Starting with a call builds rapport before the ask. Partners appreciate being treated as collaborators, not targets.',
    steps: [
      {
        stepNumber: 1,
        stepType: 'call',
        action: 'Schedule a brief call to catch up and set context for the introduction request',
        channel: 'phone',
        purpose: 'Re-establish personal connection and naturally lead into the ask during conversation',
        reasoning: 'Hot partners expect personal engagement. A call before the ask shows respect and allows you to gauge their willingness in real-time.',
        suggestedTiming: 'Day 0',
        suggestedDayOffset: 0,
        approvalRequired: true
      },
      {
        stepNumber: 2,
        stepType: 'message',
        action: 'Follow up the call with a clear email summarizing who you want to meet and why, making it easy for them to forward',
        channel: 'email',
        purpose: 'Give them a ready-made asset they can forward to the target person with minimal effort',
        reasoning: 'After a verbal yes, partners need a forwardable email. Making it easy for them to act increases the chance the intro actually happens.',
        suggestedTiming: 'Day 1',
        suggestedDayOffset: 1,
        approvalRequired: true
      },
      {
        stepNumber: 3,
        stepType: 'follow_up',
        action: 'Quick check-in via text asking if they had a chance to make the intro',
        channel: 'text',
        purpose: 'Gentle nudge without being pushy — partners are busy and may need a reminder',
        reasoning: 'A brief text feels personal and low-pressure. It serves as a friendly reminder without creating an obligation.',
        suggestedTiming: 'Day 7',
        suggestedDayOffset: 7,
        approvalRequired: true
      },
      {
        stepNumber: 4,
        stepType: 'message',
        action: 'Send a thank-you note regardless of outcome, reinforcing the partnership',
        channel: 'email',
        purpose: 'Close the loop with gratitude — whether the intro happened or not, the relationship is the priority',
        reasoning: 'High-value partners should always feel appreciated. A thank-you note ensures the relationship is stronger after the sequence, not weaker.',
        suggestedTiming: 'Day 14',
        suggestedDayOffset: 14,
        approvalRequired: true
      }
    ],
    expectedOutcome: 'Warm introduction made to the target person, or a clear understanding of why it is not possible right now, with the partnership intact and strengthened.',
    totalSteps: 4
  },

  adaptiveExamples: {
    'Step 1 (call) → replied_positive': 'Barry moves Step 2 to immediately after the call (Day 0 or Day 1). The partner said yes — strike while the iron is hot.',
    'Step 2 → no_reply': 'Barry keeps Step 3 as a friendly text nudge. No urgency — just a "hey, any update?" to keep it moving.',
    'Step 3 → replied_negative': 'Barry adjusts Step 4 to be purely a thank-you with no ask. The partner said no — respect it, close gracefully, and protect the relationship.'
  }
};

/**
 * All example scenarios for reference.
 */
export const ALL_EXAMPLES = [
  EXAMPLE_COLD_PROSPECT,
  EXAMPLE_WARM_CUSTOMER,
  EXAMPLE_KNOWN_PARTNER
];
