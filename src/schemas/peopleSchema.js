/**
 * PEOPLE SCHEMA — Team Alpha
 * Operation People First // Unified Person Record
 *
 * The individual is the atomic unit. Everything in this system — every action,
 * every message, every Barry interaction, every next step — lives on a person's
 * profile. Not a category. Not a bucket. A person.
 *
 * This schema defines the complete data structure for a person record in Firestore.
 * Path: users/{userId}/contacts/{contactId}
 *
 * Design principles:
 *   1. Nothing is ever deleted — only archived or superseded
 *   2. Every Barry interaction is permanently stored (selected or not)
 *   3. Barry reads this schema before generating anything
 *   4. The profile must answer "where are we with this person" in under 10 seconds
 *   5. Channel failures are never dead ends — they are context
 *
 * ─────────────────────────────────────────────────────────────────
 * COLLECTION: users/{userId}/contacts/{contactId}
 * ─────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────
// FULL SCHEMA DEFINITION
// ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PersonRecord
 *
 * ── IDENTITY ─────────────────────────────────────────────────────
 * @property {string}  id                  - Firestore document ID
 * @property {string}  first_name          - First name
 * @property {string}  last_name           - Last name
 * @property {string}  name                - Full name (denormalized for display + search)
 * @property {string}  [email]             - Primary email
 * @property {string}  [phone]             - Primary phone
 * @property {string}  [linkedin_url]      - LinkedIn profile URL
 * @property {string}  [company]           - Company name
 * @property {string}  [title]             - Job title
 * @property {string}  [industry]          - Industry
 * @property {string}  [location]          - City, State or Country
 * @property {string}  [website]           - Personal or company website
 * @property {string}  [photo_url]         - Profile photo URL
 * @property {string}  [twitter_url]       - Twitter/X profile URL
 *
 * ── RELATIONSHIP CLASSIFICATION ──────────────────────────────────
 * @property {string}  person_type         - 'lead' | 'customer' | 'partner' | 'network' | 'past_customer'
 *                                           The lens that determines which contextual workspace shows this person
 *                                           and how Barry approaches the relationship.
 *
 * @property {string}  brigade             - Brigade ID (from brigadeSystem.js)
 *                                           The behavioral contract that drives Barry's strategy for this person.
 *                                           Barry suggests, user confirms. Never auto-assigned.
 *
 * @property {string}  relationship_type   - 'prospect' | 'known' | 'partner' | 'delegate'
 *                                           How the user characterizes the existing relationship.
 *
 * @property {string}  warmth_level        - 'cold' | 'warm' | 'hot'
 *                                           Temperature of the relationship at the last interaction.
 *
 * @property {string}  strategic_value     - 'low' | 'medium' | 'high' | 'critical'
 *                                           Importance to current user goals. Drives recommendation priority.
 *
 * @property {string}  engagement_intent   - 'prospect' | 'warm' | 'customer' | 'partner'
 *                                           Used specifically in Barry message generation for tone calibration.
 *                                           Separate from relationship_type (different purpose, different question).
 *
 * ── CONTACT STATUS (STATE MACHINE) ───────────────────────────────
 * @property {string}  contact_status      - 'New' | 'Engaged' | 'Awaiting Reply' | 'In Conversation' |
 *                                           'Active Customer' | 'Network' | 'Partner' | 'Dormant'
 *                                           System-controlled behavioral momentum state. Auto-updated by actions.
 *                                           Full definitions in contactStateMachine.js.
 *
 * @property {string}  contact_status_updated_at - ISO timestamp of last status change
 *
 * @property {string}  lead_status         - 'new_lead' | 'contacted' | 'qualified' | 'proposal' |
 *                                           'negotiation' | 'won' | 'lost' | 'on_hold'
 *                                           Pipeline stage — user-controlled, separate from contact_status.
 *
 * ── ENGAGE MODULE STATE (PERSISTENT) ─────────────────────────────
 * The Engage Module is ALWAYS active on every profile. Not a pop-up.
 * Barry picks up exactly where the last session ended.
 *
 * @property {Object}  engage_state        - Persistent engagement state
 * @property {string}  engage_state.status - 'never_engaged' | 'in_progress' | 'awaiting_reply' | 'paused'
 * @property {string}  engage_state.last_session_at   - ISO timestamp of last engage session
 * @property {string}  engage_state.current_goal       - What Barry is working toward right now
 * @property {string}  engage_state.preferred_channel  - Last channel used or user-set preferred channel
 * @property {string}  engage_state.channel_blocked    - Channel that is currently blocked (if any)
 * @property {Object}  engage_state.last_barry_session - Full state of the last Barry session
 * @property {string}  engage_state.last_barry_session.summary   - What happened in the last session
 * @property {string}  engage_state.last_barry_session.outcome   - 'sent' | 'saved' | 'abandoned' | 'pivoted'
 * @property {string}  engage_state.last_barry_session.next_step - What Barry recommended as the next step
 * @property {string}  engage_state.last_barry_session.sessionId - Reference to the full session record
 *
 * ── NEXT BEST STEP (REPLACES MISSIONS) ───────────────────────────
 * @property {Object}  next_best_step      - Barry's current proposed action for this person
 * @property {string}  next_best_step.id            - Unique ID for this NBS instance
 * @property {string}  next_best_step.proposed_at   - ISO timestamp when Barry proposed this
 * @property {string}  next_best_step.type          - 'follow_up' | 'channel_switch' | 'referral_ask' |
 *                                                     'intro_offer' | 'check_in' | 'close' | 'nurture_touch'
 * @property {string}  next_best_step.action        - Human-readable action ("Follow up in 2 days")
 * @property {string}  next_best_step.reasoning     - Why Barry is suggesting this
 * @property {string}  next_best_step.due_at        - ISO timestamp when this step should be taken
 * @property {string}  next_best_step.status        - 'pending' | 'confirmed' | 'completed' | 'dismissed'
 * @property {boolean} next_best_step.user_confirmed - Whether the user confirmed this step
 * @property {string}  next_best_step.confirmed_at  - ISO timestamp of confirmation
 *
 * ── BARRY MEMORY ─────────────────────────────────────────────────
 * Persistent context that Barry reads before every session.
 * Grows over time — Barry asks fewer questions as this fills in.
 *
 * @property {Object}  barry_memory        - Persistent Barry intelligence for this person
 * @property {string}  barry_memory.who_they_are          - Natural language summary of who this person is to the user
 * @property {string}  barry_memory.current_goal          - What the user is trying to achieve with this person
 * @property {string}  barry_memory.relationship_summary  - How the relationship has evolved (auto-updated)
 * @property {string[]} barry_memory.what_has_been_tried  - Channels, approaches, messages that have been attempted
 * @property {string[]} barry_memory.what_has_worked      - Specific things that got responses or positive outcomes
 * @property {string[]} barry_memory.what_has_not_worked  - Things that failed or were ignored
 * @property {string}  barry_memory.tone_preference       - Inferred preferred message tone for this person
 * @property {string}  barry_memory.channel_preference    - Most effective channel based on history
 * @property {string}  barry_memory.last_updated_at       - ISO timestamp of last memory update
 * @property {string[]} barry_memory.known_facts          - Explicit facts Barry has been told or inferred
 *                                                          e.g. "Prefers email over phone", "Has kids", "Moving companies Q3"
 * @property {Object}  barry_memory.context_by_session    - Map of sessionId → key takeaway (lightweight session log)
 *
 * ── ENGAGEMENT HISTORY (DENORMALIZED SUMMARY) ────────────────────
 * Full history lives in the timeline subcollection.
 * These fields are denormalized for fast profile reads without a subcollection query.
 *
 * @property {Object}  engagement_summary  - Denormalized engagement stats
 * @property {number}  engagement_summary.total_sessions       - Total engage sessions opened
 * @property {number}  engagement_summary.total_messages_generated - Total messages Barry generated
 * @property {number}  engagement_summary.total_messages_sent  - Total messages actually sent
 * @property {number}  engagement_summary.total_attempts       - Total outreach attempts across all channels
 * @property {number}  engagement_summary.replies_received     - Number of replies received
 * @property {number}  engagement_summary.positive_replies     - Number of positive replies
 * @property {string}  engagement_summary.first_contact_at     - ISO timestamp of first engagement
 * @property {string}  engagement_summary.last_contact_at      - ISO timestamp of most recent engagement
 * @property {string}  engagement_summary.last_message_channel - Last channel used to send a message
 * @property {string}  engagement_summary.last_outcome         - 'no_reply' | 'replied_positive' | 'replied_negative' | 'bounced'
 * @property {number}  engagement_summary.consecutive_no_replies - Count of consecutive no-reply outcomes (resets on reply)
 * @property {Object}  engagement_summary.channel_history      - Per-channel attempt and reply counts
 *                                                               e.g. { email: { attempts: 3, replies: 1 }, linkedin: { attempts: 1, replies: 0 } }
 *
 * ── REFERRAL DATA ─────────────────────────────────────────────────
 * @property {Object}  referral_data       - Referral relationship intelligence
 * @property {boolean} referral_data.is_referral_source   - Has this person sent referrals?
 * @property {number}  referral_data.referrals_sent        - How many referrals they have sent to the user
 * @property {number}  referral_data.referrals_converted   - How many of those converted
 * @property {string}  referral_data.last_referral_at      - ISO timestamp of last referral received from them
 * @property {boolean} referral_data.is_referral_target    - Should this person be asked for referrals?
 * @property {string[]} referral_data.referred_by_ids      - List of contactIds who referred this person
 * @property {string[]} referral_data.has_referred_ids     - List of contactIds this person has referred
 * @property {string}  referral_data.referral_quality      - 'low' | 'medium' | 'high' (based on conversion rate)
 * @property {string}  referral_data.network_segment       - What type of referrals they tend to send
 *
 * ── ENRICHMENT DATA ──────────────────────────────────────────────
 * @property {Object}  enrichment_provenance  - Maps field name → data source
 * @property {Array}   enrichment_steps       - Ordered enrichment pipeline history
 * @property {Object}  enrichment_summary     - Confidence and coverage summary
 * @property {string}  company_phone          - Company phone (from Google Places)
 * @property {string}  company_website        - Company website
 * @property {string}  company_address        - Company address
 *
 * ── NOTES ────────────────────────────────────────────────────────
 * @property {Array}   sticky_notes           - Array of user-authored notes
 *   @property {string}  sticky_notes[].id
 *   @property {string}  sticky_notes[].text
 *   @property {string}  sticky_notes[].created_at
 *   @property {string}  sticky_notes[].updated_at
 *
 * ── METADATA ─────────────────────────────────────────────────────
 * @property {string}  addedAt              - ISO timestamp when person was first saved
 * @property {string}  addedFrom            - How they were added: 'manual' | 'csv' | 'business_card' |
 *                                            'linkedin_import' | 'apollo' | 'referral'
 * @property {string}  addedFromSource      - Additional source detail (e.g. CSV filename, referring contact ID)
 * @property {string}  updatedAt            - ISO timestamp of last document update
 * @property {boolean} is_archived          - Soft delete — never hard delete a person record
 * @property {string}  archived_at          - ISO timestamp of archival (if is_archived)
 * @property {string}  archived_reason      - Why archived: 'duplicate' | 'not_relevant' | 'spam' | 'other'
 * @property {string[]} tags               - User-defined tags for filtering and search
 *
 * ── ICP SCORING ──────────────────────────────────────────────────
 * @property {number}  icp_score            - 0-100 ICP match score
 * @property {Object}  icp_breakdown        - Per-dimension score breakdown
 * @property {string}  icp_scored_at        - ISO timestamp of last ICP score calculation
 */

// ─────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────

export const PERSON_TYPE_IDS = ['lead', 'customer', 'partner', 'network', 'past_customer'];
export const LEAD_STATUS_IDS  = ['new_lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'on_hold'];
export const ENGAGE_STATUS_IDS = ['never_engaged', 'in_progress', 'awaiting_reply', 'paused'];
export const NBS_TYPES = ['follow_up', 'channel_switch', 'referral_ask', 'intro_offer', 'check_in', 'close', 'nurture_touch'];
export const NBS_STATUSES = ['pending', 'confirmed', 'completed', 'dismissed'];
export const OUTCOME_TYPES = ['no_reply', 'replied_positive', 'replied_negative', 'bounced'];
export const REFERRAL_QUALITY = ['low', 'medium', 'high'];
export const ADDED_FROM_SOURCES = ['manual', 'csv', 'business_card', 'linkedin_import', 'apollo', 'referral'];

/**
 * Build a fresh engage_state object for a new person.
 */
export function createEngageState() {
  return {
    status: 'never_engaged',
    last_session_at: null,
    current_goal: null,
    preferred_channel: null,
    channel_blocked: null,
    last_barry_session: null
  };
}

/**
 * Build a fresh barry_memory object for a new person.
 */
export function createBarryMemory() {
  return {
    who_they_are: null,
    current_goal: null,
    relationship_summary: null,
    what_has_been_tried: [],
    what_has_worked: [],
    what_has_not_worked: [],
    tone_preference: null,
    channel_preference: null,
    last_updated_at: null,
    known_facts: [],
    context_by_session: {}
  };
}

/**
 * Build a fresh engagement_summary object for a new person.
 */
export function createEngagementSummary() {
  return {
    total_sessions: 0,
    total_messages_generated: 0,
    total_messages_sent: 0,
    total_attempts: 0,
    replies_received: 0,
    positive_replies: 0,
    first_contact_at: null,
    last_contact_at: null,
    last_message_channel: null,
    last_outcome: null,
    consecutive_no_replies: 0,
    channel_history: {}
  };
}

/**
 * Build a fresh referral_data object for a new person.
 */
export function createReferralData() {
  return {
    is_referral_source: false,
    referrals_sent: 0,
    referrals_converted: 0,
    last_referral_at: null,
    is_referral_target: false,
    referred_by_ids: [],
    has_referred_ids: [],
    referral_quality: null,
    network_segment: null
  };
}

/**
 * Create a minimal new person record with all required fields initialized.
 *
 * @param {Object} identity - { first_name, last_name, email?, phone?, company?, title? }
 * @param {string} personType - 'lead' | 'customer' | 'partner' | 'network' | 'past_customer'
 * @param {string} addedFrom - Source of the contact addition
 * @returns {Object} Complete person record ready for Firestore
 */
export function createPersonRecord(identity, personType = 'lead', addedFrom = 'manual') {
  const now = new Date().toISOString();
  const fullName = [identity.first_name, identity.last_name].filter(Boolean).join(' ').trim();

  return {
    // Identity
    first_name: identity.first_name || '',
    last_name: identity.last_name || '',
    name: fullName || identity.name || '',
    email: identity.email || null,
    phone: identity.phone || null,
    linkedin_url: identity.linkedin_url || null,
    company: identity.company || null,
    title: identity.title || null,
    industry: identity.industry || null,
    location: identity.location || null,
    website: identity.website || null,
    photo_url: identity.photo_url || null,
    twitter_url: identity.twitter_url || null,

    // Relationship Classification
    person_type: PERSON_TYPE_IDS.includes(personType) ? personType : 'lead',
    brigade: null,              // Barry recommends on first load — user confirms
    brigade_updated_at: null,
    brigade_history: [],        // Immutable log of all brigade transitions
    relationship_type: null,
    warmth_level: null,
    strategic_value: null,
    engagement_intent: null,

    // Contact Status
    contact_status: 'New',
    contact_status_updated_at: now,
    lead_status: 'new_lead',

    // Engage Module State
    engage_state: createEngageState(),

    // Next Best Step
    next_best_step: null,
    next_best_step_history: [], // All prior NBS instances — never deleted

    // Barry Memory
    barry_memory: createBarryMemory(),

    // Engagement Summary
    engagement_summary: createEngagementSummary(),

    // Referral Data
    referral_data: createReferralData(),

    // Notes
    sticky_notes: [],

    // Metadata
    addedAt: now,
    addedFrom: ADDED_FROM_SOURCES.includes(addedFrom) ? addedFrom : 'manual',
    addedFromSource: identity.addedFromSource || null,
    updatedAt: now,
    is_archived: false,
    archived_at: null,
    archived_reason: null,
    tags: [],

    // ICP Scoring
    icp_score: null,
    icp_breakdown: null,
    icp_scored_at: null
  };
}

// ─────────────────────────────────────────────────────────────────
// FIRESTORE PATHS
// ─────────────────────────────────────────────────────────────────

export const PEOPLE_PATHS = {
  // Person document
  person: (userId, contactId) =>
    `users/${userId}/contacts/${contactId}`,

  // Engagement timeline (all events)
  timeline: (userId, contactId) =>
    `users/${userId}/contacts/${contactId}/timeline`,

  timelineEvent: (userId, contactId, eventId) =>
    `users/${userId}/contacts/${contactId}/timeline/${eventId}`,

  // Barry sessions (full session records — richer than timeline events)
  barrySessions: (userId, contactId) =>
    `users/${userId}/contacts/${contactId}/barry_sessions`,

  barrySession: (userId, contactId, sessionId) =>
    `users/${userId}/contacts/${contactId}/barry_sessions/${sessionId}`,

  // Next Best Step history (immutable log)
  nbsHistory: (userId, contactId) =>
    `users/${userId}/contacts/${contactId}/nbs_history`,

  // Brigade transition log (immutable)
  brigadeLog: (userId, contactId) =>
    `users/${userId}/contacts/${contactId}/brigade_log`,

  // All people (root collection for People view)
  allPeople: (userId) =>
    `users/${userId}/contacts`,

  // User-level Barry memory (global preferences, not per-contact)
  userBarryMemory: (userId) =>
    `users/${userId}/barry_memory`,

  // Referral relationships
  referrals: (userId) =>
    `users/${userId}/referrals`,

  referral: (userId, referralId) =>
    `users/${userId}/referrals/${referralId}`,

  // Next Best Step notifications queue
  nbsQueue: (userId) =>
    `users/${userId}/nbs_queue`
};

// ─────────────────────────────────────────────────────────────────
// BARRY SESSION SCHEMA
// ─────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} BarrySession
 * Stored in: users/{userId}/contacts/{contactId}/barry_sessions/{sessionId}
 *
 * Full record of a single Barry engagement session.
 * Contains ALL generated messages (selected or not) and full context.
 * This is the record that ensures "no context is ever lost."
 *
 * @property {string}   id                  - Firestore document ID (= sessionId)
 * @property {string}   started_at          - ISO timestamp of session start
 * @property {string}   ended_at            - ISO timestamp of session end
 * @property {string}   status              - 'active' | 'completed' | 'abandoned' | 'pivoted'
 * @property {string}   brigade_at_start    - Brigade ID when session started
 * @property {string}   goal                - What the user was trying to achieve this session
 * @property {string}   channel_attempted   - Primary channel attempted
 * @property {string}   channel_blocked     - Channel that was blocked or unavailable (if any)
 * @property {string}   channel_pivot       - Channel pivoted to (if any)
 *
 * @property {Object[]} generated_messages  - ALL messages Barry generated this session
 *   @property {string}   id               - Message ID
 *   @property {string}   type             - 'direct_short' | 'warm_personal' | 'value_led' | 'humor_driven'
 *   @property {string}   subject          - Email subject (if email channel)
 *   @property {string}   body             - Full message body
 *   @property {string}   channel          - Intended channel
 *   @property {string}   generated_at     - ISO timestamp
 *   @property {boolean}  was_selected     - Did the user select this version?
 *   @property {boolean}  was_sent         - Did the user send this version?
 *   @property {string}   send_result      - 'sent' | 'prepared' | 'failed' | null
 *
 * @property {string}   selected_message_id - ID of the message the user selected
 * @property {string}   sent_message_id     - ID of the message that was actually sent
 *
 * @property {Object}   barry_questions     - Questions Barry asked and answers given
 *   @property {string}   question          - Question text
 *   @property {string}   answer            - User's answer
 *   @property {boolean}  was_inferred      - Whether Barry inferred this from memory (did not ask)
 *
 * @property {Object}   context_used        - Snapshot of barry_memory fields used this session
 * @property {string}   session_summary     - Barry's one-line summary of what happened this session
 * @property {Object}   proposed_nbs        - The Next Best Step Barry proposed at session end
 * @property {string}   outcome             - 'message_sent' | 'message_saved' | 'channel_blocked' |
 *                                            'abandoned' | 'pivoted_channel'
 */

/**
 * Create a new Barry session record.
 */
export function createBarrySession({ goal, brigadeAtStart, channelAttempted }) {
  return {
    started_at: new Date().toISOString(),
    ended_at: null,
    status: 'active',
    brigade_at_start: brigadeAtStart || null,
    goal: goal || null,
    channel_attempted: channelAttempted || null,
    channel_blocked: null,
    channel_pivot: null,
    generated_messages: [],
    selected_message_id: null,
    sent_message_id: null,
    barry_questions: [],
    context_used: {},
    session_summary: null,
    proposed_nbs: null,
    outcome: null
  };
}
