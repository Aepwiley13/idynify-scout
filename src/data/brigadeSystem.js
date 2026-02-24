/**
 * BRIGADE SYSTEM — Team Alpha
 * Operation People First // Data & Intelligence Layer
 *
 * Brigades are behavioral contracts between the user and Barry.
 * They are NOT tags or organizational buckets — they are signals that change
 * how Barry thinks about a person: tone, strategy, urgency, and next best action.
 *
 * A brigade tells Barry:
 *   1. What kind of relationship this is right now
 *   2. What engagement strategy applies
 *   3. What message tone to default to
 *   4. What the logical next action is
 *   5. How frequently to re-surface this person
 *
 * Brigade Assignment Rules:
 *   - Barry suggests a brigade when a person is first saved
 *   - User can override at any time
 *   - Barry recommends brigade transitions based on observed behavior
 *   - Brigade changes are always user-confirmed, never auto-applied
 *
 * Brigade Transitions:
 *   Brigades only change on explicit events:
 *   - User confirmation of a Barry suggestion
 *   - Manual user override
 *   - Outcome recording (e.g. positive reply → warm_prospect)
 *
 * ─────────────────────────────────────────────────────────────────
 * LEAD BRIGADES (person_type === 'lead')
 * ─────────────────────────────────────────────────────────────────
 */

// ── Lead Brigades ────────────────────────────────────────

export const LEAD_BRIGADES = {
  HOT: 'hot_prospect',
  WARM: 'warm_prospect',
  COLD: 'cold_prospect',
  NURTURE: 'nurture',
  STALLED: 'stalled'
};

// ── Network / Relationship Brigades ─────────────────────

export const NETWORK_BRIGADES = {
  CUSTOMER_ACTIVE: 'customer_active',
  CUSTOMER_PAST: 'customer_past',
  PARTNER_REFERRAL: 'partner_referral',
  PARTNER_STRATEGIC: 'partner_strategic',
  NETWORK_CLOSE: 'network_close',
  NETWORK_CASUAL: 'network_casual'
};

// ── All brigades combined ────────────────────────────────

export const ALL_BRIGADES = { ...LEAD_BRIGADES, ...NETWORK_BRIGADES };

// ─────────────────────────────────────────────────────────────────
// BRIGADE DEFINITIONS — Full behavioral contracts
// ─────────────────────────────────────────────────────────────────

export const BRIGADE_DEFINITIONS = {

  // ── Lead Brigades ──────────────────────────────────────

  hot_prospect: {
    id: 'hot_prospect',
    label: 'Hot Prospect',
    group: 'lead',
    color: '#e53e3e',
    description: 'Active conversation. High intent signals. This person is in motion — act now.',
    barryBehavior: {
      defaultTone: 'direct_short',
      urgency: 'high',
      followUpCadence: 2,           // Days between follow-ups
      questionAggression: 'low',    // Barry asks fewer clarifying questions
      messagingGoal: 'close_or_advance',
      channelPreference: ['email', 'phone', 'linkedin'],
      contextAssumptions: [
        'User has established rapport with this person',
        'They have expressed interest or intent',
        'Follow-ups should assume continuity, not restart the conversation',
        'Do not re-explain value proposition — they already understand it'
      ],
      firstQuestion: 'What is the specific next step you are driving toward with this person?'
    },
    transitionSuggestions: {
      no_reply_3x: 'stalled',
      positive_outcome: null,       // Stay hot
      negative_outcome: 'cold_prospect',
      deal_closed: null             // User transitions person_type to customer
    },
    nextBestStepDefaults: [
      'Follow up on last conversation — ask for the specific commitment',
      'Send a brief, direct check-in with a clear single ask',
      'Book the next call or meeting'
    ]
  },

  warm_prospect: {
    id: 'warm_prospect',
    label: 'Warm Prospect',
    group: 'lead',
    color: '#dd6b20',
    description: 'Building momentum. Some engagement. Not ready to buy, but clearly interested.',
    barryBehavior: {
      defaultTone: 'warm_personal',
      urgency: 'medium',
      followUpCadence: 5,
      questionAggression: 'medium',
      messagingGoal: 'build_trust_and_advance',
      channelPreference: ['email', 'linkedin', 'phone'],
      contextAssumptions: [
        'Some prior interaction exists — reference it',
        'Trust is building but not fully established',
        'Value messaging is appropriate — lead with what you bring to them',
        'Do not push for commitment too early'
      ],
      firstQuestion: 'What has been your engagement with this person so far, and what is the goal?'
    },
    transitionSuggestions: {
      positive_reply: 'hot_prospect',
      no_reply_3x: 'stalled',
      negative_outcome: 'cold_prospect'
    },
    nextBestStepDefaults: [
      'Send a value-led message referencing something relevant to their business',
      'Share a resource or insight that earns a reply',
      'Invite them to a call to explore fit'
    ]
  },

  cold_prospect: {
    id: 'cold_prospect',
    label: 'Cold Prospect',
    group: 'lead',
    color: '#718096',
    description: 'No prior interaction or negative prior engagement. First touch or restart.',
    barryBehavior: {
      defaultTone: 'value_led',
      urgency: 'low',
      followUpCadence: 7,
      questionAggression: 'high',   // Barry needs more context, asks more questions
      messagingGoal: 'earn_attention',
      channelPreference: ['email', 'linkedin'],
      contextAssumptions: [
        'This person does not know the user — or has gone completely cold',
        'The message must earn attention before making any ask',
        'Lead with value, not need',
        'Keep the first message extremely short'
      ],
      firstQuestion: 'Who is this person and why are you reaching out to them right now?'
    },
    transitionSuggestions: {
      positive_reply: 'warm_prospect',
      no_reply_3x: null             // Stay cold, surface for low-touch nurture
    },
    nextBestStepDefaults: [
      'Send a short, value-led cold outreach (under 75 words)',
      'Follow up once with a different angle if no reply',
      'Move to nurture if still no engagement after 2 attempts'
    ]
  },

  nurture: {
    id: 'nurture',
    label: 'Nurture',
    group: 'lead',
    color: '#4a9079',
    description: 'Long-term play. Not ready now — but keep warm. No pressure, stay relevant.',
    barryBehavior: {
      defaultTone: 'warm_personal',
      urgency: 'low',
      followUpCadence: 21,          // 3 weeks — light touch
      questionAggression: 'low',
      messagingGoal: 'stay_relevant_and_warm',
      channelPreference: ['email', 'linkedin'],
      contextAssumptions: [
        'This person is not ready to engage commercially right now',
        'Do not push — stay on their radar with value',
        'Reference what they are doing in the world, not what you want from them',
        'Timing is everything — watch for re-entry signals'
      ],
      firstQuestion: 'What happened the last time you engaged with this person?'
    },
    transitionSuggestions: {
      re_engagement_signal: 'warm_prospect',
      positive_reply: 'warm_prospect'
    },
    nextBestStepDefaults: [
      'Send a non-ask check-in referencing something in their world',
      'Share a relevant article, intro, or resource — no string attached',
      'Check in quarterly to stay on radar'
    ]
  },

  stalled: {
    id: 'stalled',
    label: 'Stalled',
    group: 'lead',
    color: '#d69e2e',
    description: 'Was active but has gone quiet. Channel failed or timing was off. Do not give up — change the approach.',
    barryBehavior: {
      defaultTone: 'value_led',
      urgency: 'medium',
      followUpCadence: 10,
      questionAggression: 'medium',
      messagingGoal: 'break_through_silence',
      channelPreference: ['phone', 'linkedin', 'email'],  // Prefer new channel
      contextAssumptions: [
        'Previous attempts have not received a response',
        'Channel or approach needs to change',
        'Do not repeat the previous message — try a completely different angle',
        'Consider a humor-driven message to break the pattern',
        'A direct call may work better than email'
      ],
      firstQuestion: 'What channel have you tried so far, and what was the last message you sent?'
    },
    transitionSuggestions: {
      positive_reply: 'warm_prospect',
      no_reply_after_pivot: 'nurture'
    },
    nextBestStepDefaults: [
      'Try a completely different channel (phone if email, LinkedIn if phone)',
      'Send a humor-driven message to break the pattern — earn a reply by being different',
      'Send one final value-driven message, then move to nurture if no response'
    ]
  },

  // ── Network / Relationship Brigades ───────────────────

  customer_active: {
    id: 'customer_active',
    label: 'Active Customer',
    group: 'network',
    color: '#2b6cb0',
    description: 'Current paying customer. Relationship is active. Focus on retention, expansion, and delight.',
    barryBehavior: {
      defaultTone: 'warm_personal',
      urgency: 'medium',
      followUpCadence: 14,
      questionAggression: 'low',
      messagingGoal: 'retain_and_expand',
      channelPreference: ['email', 'phone', 'calendar'],
      contextAssumptions: [
        'This person is already a customer — do not pitch',
        'The goal is retention, satisfaction, and expansion',
        'Reference their usage, results, or recent interactions',
        'Look for upsell or deepening opportunities naturally'
      ],
      firstQuestion: 'What was the last touchpoint with this customer, and is there anything specific you want to check in on?'
    },
    transitionSuggestions: {
      churned: 'customer_past',
      referred_someone: null        // Barry flags referral opportunity, logs to referral engine
    },
    nextBestStepDefaults: [
      'Check in on their experience — make it personal, not scripted',
      'Share a new feature, case study, or result relevant to their use case',
      'Ask for feedback or a case study/testimonial'
    ]
  },

  customer_past: {
    id: 'customer_past',
    label: 'Past Customer',
    group: 'network',
    color: '#553c9a',
    description: 'Former customer. High potential for re-engagement or referral. Treat with care — they know the product.',
    barryBehavior: {
      defaultTone: 'warm_personal',
      urgency: 'low',
      followUpCadence: 45,
      questionAggression: 'low',
      messagingGoal: 'rebuild_and_re_engage',
      channelPreference: ['email', 'linkedin'],
      contextAssumptions: [
        'They have used the product before — they understand the value proposition',
        'Do not re-pitch — acknowledge the gap and lead with what has changed',
        'They are the most qualified possible re-engagement target',
        'Referrals from past customers are highly credible'
      ],
      firstQuestion: 'Why did this person stop being a customer, and what has changed that makes now a good time to reconnect?'
    },
    transitionSuggestions: {
      re_converted: 'customer_active',
      referred_someone: null
    },
    nextBestStepDefaults: [
      'Re-engage with a personal note acknowledging time apart and leading with what is new',
      'Ask for a referral — past customers are often happy to refer even if they do not re-subscribe',
      'Share a relevant update that would catch their attention based on what they cared about before'
    ]
  },

  partner_referral: {
    id: 'partner_referral',
    label: 'Referral Partner',
    group: 'network',
    color: '#2f855a',
    description: 'Sends referrals. This relationship has direct revenue impact. Maintain, reciprocate, reward.',
    barryBehavior: {
      defaultTone: 'warm_personal',
      urgency: 'medium',
      followUpCadence: 14,
      questionAggression: 'low',
      messagingGoal: 'nurture_referral_relationship',
      channelPreference: ['phone', 'email', 'calendar'],
      contextAssumptions: [
        'This person sends business — treat them like a partner, not a prospect',
        'Reciprocity matters — track what they have sent and what you have done in return',
        'Regular check-ins, gratitude, and reciprocal referrals are the currency here',
        'Barry flags when it has been too long since the last touchpoint'
      ],
      firstQuestion: 'When did you last speak with this partner, and have you sent any reciprocal referrals recently?'
    },
    transitionSuggestions: {
      referral_dried_up: 'network_close'
    },
    nextBestStepDefaults: [
      'Send a personal check-in — thank them for their most recent referral specifically',
      'Look for a reciprocal referral opportunity in your network to offer them',
      'Invite them to lunch, a call, or an event to strengthen the relationship'
    ]
  },

  partner_strategic: {
    id: 'partner_strategic',
    label: 'Strategic Partner',
    group: 'network',
    color: '#1a6cf5',
    description: 'Alliance, co-creator, or collaborator. This relationship is about mutual amplification.',
    barryBehavior: {
      defaultTone: 'direct_short',
      urgency: 'medium',
      followUpCadence: 10,
      questionAggression: 'low',
      messagingGoal: 'activate_and_co_create',
      channelPreference: ['calendar', 'email', 'phone'],
      contextAssumptions: [
        'This is a peer or near-peer relationship — mutual respect is the foundation',
        'The goal is to activate joint opportunities, not to pitch',
        'Follow through on commitments — strategic partners notice when you do not',
        'Look for opportunities to bring them value before asking for anything'
      ],
      firstQuestion: 'What is the current active opportunity or collaboration with this partner?'
    },
    transitionSuggestions: {},
    nextBestStepDefaults: [
      'Follow up on any open action items from your last conversation',
      'Surface a specific joint opportunity or collaboration idea',
      'Set up a regular cadence call to stay in strategic alignment'
    ]
  },

  network_close: {
    id: 'network_close',
    label: 'Close Network',
    group: 'network',
    color: '#285e61',
    description: 'Someone you know well. Strong relationship. Mutual trust established. A key node in your network graph.',
    barryBehavior: {
      defaultTone: 'warm_personal',
      urgency: 'low',
      followUpCadence: 30,
      questionAggression: 'low',
      messagingGoal: 'maintain_and_leverage',
      channelPreference: ['phone', 'email', 'linkedin'],
      contextAssumptions: [
        'Formalities are not necessary — this is a real relationship',
        'The ask can be direct — they know you, they trust you',
        'Do not over-communicate — check in meaningfully, not frequently',
        'Look for introduction opportunities — they likely know the right people'
      ],
      firstQuestion: null  // Barry has enough context — no question needed
    },
    transitionSuggestions: {
      becomes_referral_source: 'partner_referral'
    },
    nextBestStepDefaults: [
      'Reach out personally — no agenda, just staying connected',
      'Ask for a specific introduction to someone in their network',
      'Look for a way to add value before making any ask'
    ]
  },

  network_casual: {
    id: 'network_casual',
    label: 'Casual Network',
    group: 'network',
    color: '#4a5568',
    description: 'Connected, but loosely. You know them — they know you. Not a deep relationship yet.',
    barryBehavior: {
      defaultTone: 'warm_personal',
      urgency: 'low',
      followUpCadence: 60,
      questionAggression: 'medium',
      messagingGoal: 'deepen_relationship',
      channelPreference: ['linkedin', 'email'],
      contextAssumptions: [
        'Connection exists but the relationship is surface level',
        'An ask would feel premature — invest first',
        'Reference something specific about them — shows you are paying attention',
        'The goal is to move this toward close network, not to extract value immediately'
      ],
      firstQuestion: 'What is your connection to this person — how do you know them?'
    },
    transitionSuggestions: {
      deepens: 'network_close',
      becomes_lead: null  // User changes person_type to lead
    },
    nextBestStepDefaults: [
      'Engage with their content or share something relevant to them — low friction first touch',
      'Send a brief personal note referencing a shared experience or connection',
      'Look for a way to be useful to them before asking for anything'
    ]
  }
};

// ─────────────────────────────────────────────────────────────────
// BRIGADE DECISION TREE — Barry's initial brigade recommendation
// ─────────────────────────────────────────────────────────────────

/**
 * When a person is first saved, Barry uses this decision tree to recommend
 * the initial brigade assignment. Barry always confirms with the user —
 * never auto-assigns.
 *
 * Input signals:
 *   - person_type (lead | customer | partner | network | past_customer)
 *   - relationship_type (prospect | known | partner | delegate)
 *   - warmth_level (cold | warm | hot)
 *   - Any prior engagement data in the system
 *
 * Returns: { brigadeId, reasoning, confidence }
 */
export function recommendBrigade({ personType, relationshipType, warmthLevel, priorEngagement }) {
  // Network and partner person types map directly
  if (personType === 'customer') {
    return {
      brigadeId: 'customer_active',
      reasoning: 'This person is a current customer — the Active Customer brigade applies.',
      confidence: 'high'
    };
  }

  if (personType === 'past_customer') {
    return {
      brigadeId: 'customer_past',
      reasoning: 'This is a former customer — the Past Customer brigade unlocks re-engagement and referral strategies.',
      confidence: 'high'
    };
  }

  if (personType === 'partner') {
    if (relationshipType === 'partner') {
      return {
        brigadeId: 'partner_referral',
        reasoning: 'This person is a partner — starting with Referral Partner to track reciprocal value.',
        confidence: 'medium'
      };
    }
    return {
      brigadeId: 'partner_strategic',
      reasoning: 'Strategic partner identified — collaboration and alignment are the primary goals.',
      confidence: 'medium'
    };
  }

  if (personType === 'network') {
    if (warmthLevel === 'hot') {
      return {
        brigadeId: 'network_close',
        reasoning: 'Strong existing relationship — Close Network is the right starting point.',
        confidence: 'high'
      };
    }
    return {
      brigadeId: 'network_casual',
      reasoning: 'Network contact with moderate warmth — Casual Network until the relationship deepens.',
      confidence: 'medium'
    };
  }

  // Lead logic
  if (personType === 'lead' || !personType) {
    if (warmthLevel === 'hot') {
      return {
        brigadeId: 'hot_prospect',
        reasoning: 'Active conversation and strong intent signals — Hot Prospect brigade applies.',
        confidence: 'high'
      };
    }

    if (warmthLevel === 'warm') {
      if (priorEngagement?.hasReplied) {
        return {
          brigadeId: 'hot_prospect',
          reasoning: 'They have replied previously — momentum exists. Starting as Hot Prospect.',
          confidence: 'high'
        };
      }
      return {
        brigadeId: 'warm_prospect',
        reasoning: 'Some prior interaction or mutual connection — Warm Prospect is the right starting point.',
        confidence: 'medium'
      };
    }

    // Cold or unknown
    if (priorEngagement?.attemptCount >= 3) {
      return {
        brigadeId: 'stalled',
        reasoning: 'Multiple outreach attempts without a response — Stalled brigade triggers a channel pivot strategy.',
        confidence: 'high'
      };
    }

    return {
      brigadeId: 'cold_prospect',
      reasoning: 'No prior interaction detected — Cold Prospect brigade applies. Barry will earn attention before making any ask.',
      confidence: 'medium'
    };
  }

  // Default fallback
  return {
    brigadeId: 'cold_prospect',
    reasoning: 'Defaulting to Cold Prospect until more context is available.',
    confidence: 'low'
  };
}

// ─────────────────────────────────────────────────────────────────
// BRIGADE TRANSITION RULES — Event-driven, user-confirmed
// ─────────────────────────────────────────────────────────────────

/**
 * Events that can trigger a brigade transition suggestion.
 * Barry suggests — user confirms. Never auto-applied.
 */
export const BRIGADE_TRANSITION_TRIGGERS = {
  POSITIVE_REPLY:       'positive_reply',
  NEGATIVE_REPLY:       'negative_reply',
  NO_REPLY_3X:          'no_reply_3x',
  DEAL_CLOSED:          'deal_closed',
  CUSTOMER_CHURNED:     'customer_churned',
  REFERRAL_GIVEN:       'referral_given',
  RE_ENGAGEMENT:        're_engagement',
  MANUAL_OVERRIDE:      'manual_override'
};

/**
 * Evaluate whether a brigade transition should be suggested.
 *
 * @param {string} currentBrigade - Current brigade ID
 * @param {string} trigger - One of BRIGADE_TRANSITION_TRIGGERS
 * @returns {{ shouldTransition: boolean, targetBrigade: string|null, suggestion: string|null }}
 */
export function evaluateBrigadeTransition(currentBrigade, trigger) {
  const definition = BRIGADE_DEFINITIONS[currentBrigade];
  if (!definition) return { shouldTransition: false, targetBrigade: null, suggestion: null };

  const targetBrigade = definition.transitionSuggestions[trigger];

  if (!targetBrigade) {
    return { shouldTransition: false, targetBrigade: null, suggestion: null };
  }

  const targetDef = BRIGADE_DEFINITIONS[targetBrigade];
  if (!targetDef) return { shouldTransition: false, targetBrigade: null, suggestion: null };

  const suggestions = {
    [BRIGADE_TRANSITION_TRIGGERS.POSITIVE_REPLY]:
      `They replied positively — Barry recommends moving them to ${targetDef.label}. Confirm?`,
    [BRIGADE_TRANSITION_TRIGGERS.NO_REPLY_3X]:
      `Three attempts without a response — Barry recommends moving them to ${targetDef.label} and changing the approach. Confirm?`,
    [BRIGADE_TRANSITION_TRIGGERS.NEGATIVE_REPLY]:
      `Negative outcome recorded — Barry recommends moving them to ${targetDef.label}. Confirm?`,
    [BRIGADE_TRANSITION_TRIGGERS.CUSTOMER_CHURNED]:
      `Customer relationship ended — moving to ${targetDef.label}. Confirm?`,
    [BRIGADE_TRANSITION_TRIGGERS.RE_ENGAGEMENT]:
      `Re-engagement signal detected — Barry recommends elevating to ${targetDef.label}. Confirm?`
  };

  return {
    shouldTransition: true,
    targetBrigade,
    suggestion: suggestions[trigger] || `Barry recommends transitioning to ${targetDef.label}. Confirm?`
  };
}

// ─────────────────────────────────────────────────────────────────
// PERSON TYPE DEFINITIONS — The universal People view lenses
// ─────────────────────────────────────────────────────────────────

export const PERSON_TYPES = [
  {
    id: 'lead',
    label: 'Lead',
    description: 'Anyone you are actively working toward a business outcome with',
    barryContext: 'This person is a lead — Barry focuses on advancing toward a business outcome.',
    defaultBrigade: 'cold_prospect',
    availableBrigades: ['hot_prospect', 'warm_prospect', 'cold_prospect', 'nurture', 'stalled']
  },
  {
    id: 'customer',
    label: 'Customer',
    description: 'Currently paying or actively engaged in a commercial relationship',
    barryContext: 'This person is a current customer — Barry focuses on retention, satisfaction, and expansion.',
    defaultBrigade: 'customer_active',
    availableBrigades: ['customer_active']
  },
  {
    id: 'partner',
    label: 'Partner',
    description: 'Collaborator, referral source, or strategic alliance',
    barryContext: 'This person is a partner — Barry focuses on co-creation, reciprocity, and mutual value.',
    defaultBrigade: 'partner_referral',
    availableBrigades: ['partner_referral', 'partner_strategic']
  },
  {
    id: 'network',
    label: 'Network',
    description: 'Part of your relationship ecosystem — not a current lead or customer',
    barryContext: 'This person is in your network — Barry focuses on maintaining the relationship and surfacing introduction opportunities.',
    defaultBrigade: 'network_casual',
    availableBrigades: ['network_close', 'network_casual']
  },
  {
    id: 'past_customer',
    label: 'Past Customer',
    description: 'Former customer — high potential for re-engagement or referral',
    barryContext: 'This person is a past customer — Barry focuses on re-engagement and referral opportunities.',
    defaultBrigade: 'customer_past',
    availableBrigades: ['customer_past']
  }
];

/**
 * Get the person type definition by ID.
 */
export function getPersonType(id) {
  return PERSON_TYPES.find(t => t.id === id) || null;
}

/**
 * Get the brigade definition by ID.
 */
export function getBrigadeDefinition(brigadeId) {
  return BRIGADE_DEFINITIONS[brigadeId] || null;
}

/**
 * Get available brigades for a given person type.
 */
export function getAvailableBrigades(personTypeId) {
  const personType = getPersonType(personTypeId);
  if (!personType) return [];
  return personType.availableBrigades.map(id => BRIGADE_DEFINITIONS[id]).filter(Boolean);
}

/**
 * Get Barry's behavioral context string for a given brigade.
 * Used in prompt construction.
 */
export function getBarryBehaviorContext(brigadeId) {
  const def = BRIGADE_DEFINITIONS[brigadeId];
  if (!def) return null;

  return {
    tone: def.barryBehavior.defaultTone,
    urgency: def.barryBehavior.urgency,
    followUpCadence: def.barryBehavior.followUpCadence,
    goal: def.barryBehavior.messagingGoal,
    channelPreference: def.barryBehavior.channelPreference,
    contextAssumptions: def.barryBehavior.contextAssumptions,
    firstQuestion: def.barryBehavior.firstQuestion,
    nextBestStepDefaults: def.nextBestStepDefaults
  };
}
