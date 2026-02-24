/**
 * ENGAGEMENT SCHEMA
 * Squad Alpha Integration Reference — Operation People First
 *
 * This is the canonical data contract between Squad Alpha (data/persistence)
 * and Squad Beta (UX/engagement). Build your persistence layer against this.
 * If something here conflicts with what you find in Firestore, this file wins
 * and the conflict needs to be resolved before the next sprint.
 *
 * Two sections:
 *   1. contact.barryContext   — The intelligence object on every contact doc
 *   2. timeline/{eventId}     — The engagement event subcollection schema
 *
 * Plus the new fields added this sprint (brigade, next_step_*).
 *
 * Path: src/schemas/engagementSchema.js
 * Owner: Squad Beta → hands off to Squad Alpha for persistence design
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. CONTACT DOCUMENT — FULL FIELD MAP
//    Path: users/{userId}/contacts/{contactId}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CONTACT_SCHEMA
 *
 * All fields that can appear on a contact document.
 * Fields marked [NEW] were added in Operation People First sprint.
 * Fields marked [BARRY] are written exclusively by Barry functions.
 * Fields marked [USER] are written by user interaction.
 * Fields marked [SYSTEM] are written by state machine or timeline logger.
 */
export const CONTACT_SCHEMA = {

  // ── Identity ────────────────────────────────────────────────────────────────
  id: 'string',                        // Firestore document ID (auto)
  name: 'string',                      // Full name: "Aaron Smith"
  firstName: 'string',                 // First name: "Aaron"
  lastName: 'string',                  // Last name: "Smith"
  title: 'string',                     // Job title
  company_name: 'string',              // Company name (denormalized)
  company_id: 'string',                // FK → users/{uid}/companies/{companyId}
  email: 'string | null',
  work_email: 'string | null',
  phone: 'string | null',
  phone_mobile: 'string | null',
  phone_direct: 'string | null',
  linkedin_url: 'string | null',
  photo_url: 'string | null',

  // ── Enrichment provenance ────────────────────────────────────────────────────
  apollo_person_id: 'string | null',
  email_status: "'verified' | 'likely' | 'unverified' | null",
  last_enriched_at: 'string (ISO 8601) | null',  // When Apollo/enrichment last ran
  enrichment_provenance: {
    // Each field maps to the source that populated it
    email: "'apollo_match' | 'internal_db' | 'manual' | null",
    linkedin_url: "'apollo_match' | 'manual' | null",
    phone_mobile: "'apollo_match' | 'manual' | null",
  },

  // ── Lifecycle status ─────────────────────────────────────────────────────────
  // [SYSTEM] Set by contactStateMachine.js
  contact_status: "'New' | 'Engaged' | 'In Campaign' | 'Active Mission' | 'Awaiting Reply' | 'In Conversation' | 'Mission Complete' | 'Dormant'",
  contact_status_updated_at: 'string (ISO 8601)',  // ISO timestamp of last status change

  // Legacy field — do not delete, used by getLeadStatus() in AllLeads
  lead_status: "'active' | 'engaged' | 'archived' | 'converted' | null",
  status: 'string | null',   // Even older legacy — presence indicates pre-enrichment state

  // ── Strategic classification ─────────────────────────────────────────────────
  // [USER] Set via StructuredFields component
  relationship_type: "'prospect' | 'known' | 'partner' | 'delegate' | null",
  warmth_level: "'cold' | 'warm' | 'hot' | null",
  strategic_value: "'low' | 'medium' | 'high' | 'critical' | null",
  engagementIntent: "'prospect' | 'warm' | 'customer' | 'partner' | null",

  // [NEW] [USER] Brigade — strategic relationship category (replaces game_bucket in UX)
  // Set by BrigadeSelector component. Also syncs relationship_type for backward compat.
  brigade: "'leads' | 'customers' | 'partners' | 'referrals' | 'network' | 'past_customers' | null",

  // Legacy game field — kept for Scout Game session compatibility, do not repurpose
  game_bucket: "'build_pipeline' | 'warm_outreach' | 're_engage' | 'introductions' | null",

  // ── ICP scoring ──────────────────────────────────────────────────────────────
  icp_score: 'number (0-100) | null',
  fit_score: 'number (0-100) | null',

  // ── Next Best Step ───────────────────────────────────────────────────────────
  // [NEW] [SYSTEM] Written by NextBestStep component when user confirms a step.
  // PersistentEngageBar reads next_step_due to show "Follow-Up Due" state.
  next_step_due: 'string (ISO 8601) | null',       // When the follow-up is due
  next_step_type: "'follow_up' | 'try_new_channel' | 'referral_opportunity' | 'low_touch' | 'accelerate' | 'schedule_meeting' | null",

  // ── Barry intelligence ───────────────────────────────────────────────────────
  // [BARRY] Written by barryGenerateContext Netlify function.
  // Read by: MeetSection, HunterContactDrawer, PersistentEngageBar (zero-state prompt)
  barryContext: {
    // The primary intelligence summary Barry uses for all message generation.
    // Passed verbatim into generate-engagement-message as system context.
    contextBrief: 'string',

    // How confident Barry is in this context (affects UI indicators)
    confidenceLevel: "'high' | 'medium' | 'low'",

    // Quality of the underlying data (0-100, affects Barry's confidence display)
    dataQualityScore: 'number (0-100)',

    // What data was available when context was generated
    enrichmentSummary: {
      fields_found: 'string[]',   // e.g. ['email', 'linkedin_url', 'title']
      fields_missing: 'string[]'  // e.g. ['phone_mobile', 'company_website']
    },

    // ISO timestamp of when this context was generated
    // Used to detect stale context (> 30 days old = regenerate)
    generatedAt: 'string (ISO 8601)',

    // [OPTIONAL] Barry's read on who this person is — shown in zero-state prompt
    // Derived from barryContext by the barryGenerateContext function.
    // If absent, PersistentEngageBar falls back to generic "Barry is ready" language.
    personaSummary: 'string | null',

    // [OPTIONAL] Barry's suggested opening move — shown in zero-state as a prompt
    // e.g. "Start with a warm intro referencing their recent Series B"
    suggestedFirstMove: 'string | null'
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. TIMELINE SUBCOLLECTION — EVENT SCHEMA
//    Path: users/{userId}/contacts/{contactId}/timeline/{eventId}
//
//    Written via: src/utils/timelineLogger.js (logTimelineEvent)
//    Read by: EngagementTimeline, PersistentEngageBar, NextBestStep, recommendationEngine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BASE EVENT — fields present on every timeline document
 */
export const TIMELINE_EVENT_BASE = {
  type: 'string',           // One of TIMELINE_EVENT_TYPES (see below)
  actor: "'user' | 'barry' | 'system'",
  timestamp: 'Firestore Timestamp',  // NOTE: field name is 'timestamp', NOT 'createdAt'
                                      // timelineLogger writes as 'createdAt' but reads
                                      // use 'timestamp' — see EngagementTimeline.jsx.
                                      // Squad Alpha: normalize this. Pick one. We vote timestamp.
  preview: 'string | null',  // Short human-readable description shown in timeline UI
  metadata: 'Object'         // Type-specific payload (see per-type schemas below)
};

/**
 * IMPORTANT: TIMESTAMP FIELD NAMING INCONSISTENCY
 *
 * timelineLogger.js writes the field as 'createdAt' (line: createdAt: Timestamp.now())
 * EngagementTimeline.jsx reads it as 'timestamp' (orderBy('timestamp', 'desc'))
 * PersistentEngageBar reads it as 'timestamp'
 * NextBestStep reads it as 'timestamp'
 *
 * Current behavior: Firestore orderBy('timestamp') silently returns empty results
 * for docs written with 'createdAt'. This means timeline reads correctly only for
 * docs written by the barryDossierBriefing function which uses 'timestamp'.
 *
 * ACTION REQUIRED (Squad Alpha): Migrate 'createdAt' → 'timestamp' in timelineLogger.js
 * or add a Firestore query that handles both. Until fixed, newly written events via
 * NextBestStep may not appear in timeline order.
 *
 * Recommended fix: Change timelineLogger.js line ~80 from:
 *   createdAt: Timestamp.now()
 * to:
 *   timestamp: Timestamp.now(),
 *   createdAt: Timestamp.now()  // keep for backward compat during migration
 */

// ── Per-type metadata schemas ────────────────────────────────────────────────

export const TIMELINE_EVENT_SCHEMAS = {

  /**
   * message_generated
   * Fired when Barry returns message strategy options to the user.
   * Does NOT mean anything was sent.
   */
  message_generated: {
    metadata: {
      strategyCount: 'number',         // Number of strategies returned (typically 3)
      strategies: 'string[]',          // Array of strategy labels/previews
      engagementIntent: "'prospect' | 'warm' | 'customer' | 'partner'",
      userIntent: 'string',            // The free-form intent the user typed
      channel: "'email' | 'text' | 'linkedin' | null"
    }
  },

  /**
   * message_sent
   * Fired when a message is actually sent OR handed off to native app.
   * sendResult distinguishes real sends from prepared/native handoffs.
   */
  message_sent: {
    metadata: {
      channel: "'email' | 'text' | 'call' | 'linkedin' | 'calendar'",
      method: "'real' | 'native'",     // real = Gmail API; native = mailto/sms/tel
      sendResult: "'sent' | 'opened' | 'prepared' | 'failed'",
      gmailMessageId: 'string | null', // Present only when method = 'real'
      subject: 'string | null',        // Email subject if applicable
      bodyPreview: 'string | null'     // First ~100 chars of message body
    }
  },

  /**
   * mission_assigned
   * Fired when a contact is added to a mission.
   * NOTE: missions UI is archived but data model lives on for referral intelligence.
   */
  mission_assigned: {
    metadata: {
      missionId: 'string',
      missionName: 'string'
    }
  },

  /**
   * campaign_assigned
   * Fired when a contact is added to a campaign.
   */
  campaign_assigned: {
    metadata: {
      campaignId: 'string',
      campaignName: 'string'
    }
  },

  /**
   * lead_status_changed
   * Fired when the lead_status field changes.
   */
  lead_status_changed: {
    metadata: {
      statusFrom: 'string',
      statusTo: 'string'
    }
  },

  /**
   * contact_status_changed
   * Fired by contactStateMachine.js on every state transition.
   */
  contact_status_changed: {
    metadata: {
      statusFrom: 'string',
      statusTo: 'string',
      trigger: 'string'   // The STATUS_TRIGGERS constant that caused the transition
    }
  },

  // ── Sequence events (Step 5) ──────────────────────────────────────────────

  sequence_step_proposed: {
    metadata: {
      stepIndex: 'number',
      stepType: "'message' | 'follow_up' | 'call' | 'resource' | 'introduction'",
      channel: "'email' | 'text' | 'phone' | 'linkedin' | 'calendar'",
      suggestedContent: 'string | null'
    }
  },

  sequence_step_approved: {
    metadata: {
      stepIndex: 'number',
      stepType: 'string'
    }
  },

  sequence_step_sent: {
    metadata: {
      stepIndex: 'number',
      stepType: 'string',
      channel: 'string',
      sendResult: "'sent' | 'prepared' | 'failed'"
    }
  },

  sequence_step_skipped: {
    metadata: {
      stepIndex: 'number',
      reason: 'string | null'
    }
  },

  sequence_completed: {
    metadata: {
      totalSteps: 'number',
      sentCount: 'number',
      skippedCount: 'number'
    }
  },

  // ── Next Best Step events (Operation People First) ────────────────────────

  /**
   * next_step_queued
   * [NEW] Fired when user confirms a Barry-proposed next step.
   * PersistentEngageBar reads this to check for overdue follow-ups.
   * NextBestStep reads this to show the "active queued step" view.
   */
  next_step_queued: {
    metadata: {
      stepType: "'follow_up' | 'try_new_channel' | 'referral_opportunity' | 'low_touch' | 'accelerate' | 'schedule_meeting'",
      stepLabel: 'string',              // Human-readable label for the step type
      dueDate: 'string (ISO 8601) | null',  // When Barry expects this to happen
      timing: "'2d' | '3d' | '1w' | '2w' | '1m' | null",  // Timing option selected
      message: 'string',               // Barry's reasoning for the proposal
      status: "'pending' | 'completed' | 'dismissed'"  // Lifecycle of this queued step
    }
  },

  /**
   * next_step_completed
   * [NEW] Fired when user marks a queued next step as done.
   */
  next_step_completed: {
    metadata: {
      originalEventId: 'string',  // ID of the next_step_queued event this closes
      stepType: 'string'
    }
  },

  /**
   * next_step_dismissed
   * [NEW] Fired when user dismisses a Barry next step proposal without confirming.
   */
  next_step_dismissed: {
    metadata: {
      stepType: 'string',
      reason: 'string | null'
    }
  }
};

// ── All valid event types ─────────────────────────────────────────────────────

export const TIMELINE_EVENT_TYPES = Object.keys(TIMELINE_EVENT_SCHEMAS);

// ── Actor constants ───────────────────────────────────────────────────────────

export const ACTORS = {
  USER: 'user',
  BARRY: 'barry',
  SYSTEM: 'system'
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. BRIGADE → BARRY BEHAVIOR CONTRACT
//    Used by: BrigadeSelector (write), HunterContactDrawer (read)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a contact has a brigade assigned, Barry should adjust:
 *   - engagementIntent passed to generate-engagement-message
 *   - Tone and framing in the system prompt
 *   - Next best step logic in NextBestStep component
 *
 * This table is the source of truth for that mapping.
 */
export const BRIGADE_BARRY_CONTRACT = {
  leads: {
    engagementIntent: 'prospect',
    barryToneGuidance: 'Direct and outcome-focused. Clear ask. No fluff.',
    nextStepBias: 'follow_up'
  },
  customers: {
    engagementIntent: 'customer',
    barryToneGuidance: 'Value delivery first. Look for expansion signals. Protect the relationship.',
    nextStepBias: 'schedule_meeting'
  },
  partners: {
    engagementIntent: 'partner',
    barryToneGuidance: 'Mutual value framing. Reciprocity. Co-creation language.',
    nextStepBias: 'referral_opportunity'
  },
  referrals: {
    engagementIntent: 'warm',
    barryToneGuidance: 'Warm and appreciative. Reference the referral relationship explicitly.',
    nextStepBias: 'referral_opportunity'
  },
  network: {
    engagementIntent: 'warm',
    barryToneGuidance: 'Stay warm. Low pressure. Surface overlaps and shared context.',
    nextStepBias: 'low_touch'
  },
  past_customers: {
    engagementIntent: 'warm',
    barryToneGuidance: 'Re-engagement tone. Reference shared history. Find the comeback moment.',
    nextStepBias: 'follow_up'
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. ZERO-STATE BEHAVIOR — PersistentEngageBar
//    Defines what Barry shows when the timeline is empty (first save)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ZERO-STATE DEFINITION
 *
 * Condition: contact.id exists, timeline subcollection is empty, no prior engagement.
 *
 * Three possible sub-states:
 *
 *   A. barryContext exists AND barryContext.suggestedFirstMove is set
 *      → Barry prompts with his specific suggestion for this person
 *      → CTA: "Start with Barry's suggestion"
 *      → sublabel: barryContext.suggestedFirstMove (truncated to 80 chars)
 *
 *   B. barryContext exists, suggestedFirstMove is null
 *      → Barry has analyzed the person but has no specific suggestion yet
 *      → CTA: "Start Engagement"
 *      → sublabel: "Barry knows who this person is — ready when you are"
 *
 *   C. barryContext is null/undefined (context still generating)
 *      → Barry is still analyzing
 *      → CTA: "Start Engagement" (still clickable — Barry generates on demand inside drawer)
 *      → sublabel: "Barry is analyzing this contact..."
 *      → UI: subtle loading indicator on sublabel (no spinner blocking the CTA)
 *
 * Key principle: The bar is NEVER idle. Even in zero-state, it is actionable.
 * The user can always click the CTA and open the drawer — Barry generates
 * context on demand if it's not ready yet.
 *
 * The bar does NOT wait for Barry before rendering. Engagement never blocks on AI.
 */
export const ZERO_STATE_BEHAVIOR = {
  subStateA: {
    condition: 'timeline.length === 0 && barryContext?.suggestedFirstMove',
    label: 'Not Started',
    sublabelSource: 'barryContext.suggestedFirstMove',
    ctaText: "Start with Barry's Suggestion",
    ctaColor: '#7c3aed'
  },
  subStateB: {
    condition: 'timeline.length === 0 && barryContext && !barryContext.suggestedFirstMove',
    label: 'Not Started',
    sublabel: 'Barry knows who this person is — ready when you are',
    ctaText: 'Start Engagement',
    ctaColor: '#7c3aed'
  },
  subStateC: {
    condition: 'timeline.length === 0 && !barryContext',
    label: 'Not Started',
    sublabel: 'Barry is analyzing this contact...',
    ctaText: 'Start Engagement',
    ctaColor: '#6b7280',
    showLoadingIndicator: true
  }
};
