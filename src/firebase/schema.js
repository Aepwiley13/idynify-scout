// Module 2: Database Schema - Firestore Collections Structure
//
// This file documents the Firestore collections structure for the MVP
//
// Collections Structure:
//
// users/{userId}/
//   ├── profile (document)
//   ├── subscription (document)
//   ├── credits (number) - Current credit balance
//   ├── monthlyCredits (number) - Monthly allotment based on tier
//   ├── lastCreditReset (Timestamp) - Last monthly reset date
//   ├── icp (document)
//   ├── icpBrief (document)
//   ├── section1Answers (object) - Section 1: Company Identity & Foundation answers
//   ├── section1Output (object) - Section 1 Executive Summary output
//   ├── reconProgress (object) - RECON questionnaire progress tracking
//   ├── weights/ (subcollection)
//   │   ├── current (document)
//   │   └── history/{versionId} (documents)
//   ├── companies/{companyId} (subcollection)
//   ├── leads/{leadId} (subcollection)
//   ├── events/{eventId} (subcollection) - Includes credit usage events
//   └── quotas/ (subcollection)
//       ├── daily_enrichments (document)
//       └── weekly_enrichments (document)
//   ├── contacts/{contactId} (subcollection)
//   │   └── timeline/{eventId} (subcollection - engagement timeline events)

export const COLLECTION_PATHS = {
  users: 'users',
  profile: 'profile',
  subscription: 'subscription',
  icp: 'icp',
  icpBrief: 'icpBrief',
  section1Answers: 'section1Answers',
  section1Output: 'section1Output',
  reconProgress: 'reconProgress',
  weights: 'weights',
  weightsCurrent: 'weights/current',
  weightsHistory: 'weights/history',
  companies: 'companies',
  leads: 'leads',
  events: 'events',
  quotas: 'quotas',
  dailyEnrichments: 'quotas/daily_enrichments',
  weeklyEnrichments: 'quotas/weekly_enrichments',
  timeline: 'timeline'
};

// Helper functions to get document/collection paths
export const getPath = {
  userProfile: (userId) => `users/${userId}/profile`,
  userSubscription: (userId) => `users/${userId}/subscription`,
  userICP: (userId) => `users/${userId}/icp`,
  userICPBrief: (userId) => `users/${userId}/icpBrief`,
  userWeightsCurrent: (userId) => `users/${userId}/weights/current`,
  userWeightsHistory: (userId) => `users/${userId}/weights/history`,
  userCompanies: (userId) => `users/${userId}/companies`,
  userCompany: (userId, companyId) => `users/${userId}/companies/${companyId}`,
  userLeads: (userId) => `users/${userId}/leads`,
  userLead: (userId, leadId) => `users/${userId}/leads/${leadId}`,
  userEvents: (userId) => `users/${userId}/events`,
  userEvent: (userId, eventId) => `users/${userId}/events/${eventId}`,
  userQuotas: (userId) => `users/${userId}/quotas`,
  userDailyEnrichments: (userId) => `users/${userId}/quotas/daily_enrichments`,
  userWeeklyEnrichments: (userId) => `users/${userId}/quotas/weekly_enrichments`,
  contactTimeline: (userId, contactId) => `users/${userId}/contacts/${contactId}/timeline`,
  contactTimelineEvent: (userId, contactId, eventId) => `users/${userId}/contacts/${contactId}/timeline/${eventId}`
};

// ============================================================================
// SECTION 1: COMPANY IDENTITY & FOUNDATION - Schema Documentation
// ============================================================================

/**
 * section1Answers
 * Stores user's raw answers to Section 1 questionnaire
 *
 * Schema:
 * {
 *   companyName: string,
 *   whatYouDo: string,
 *   industry: string,
 *   stage: string,
 *   role: string,
 *   mainProduct: string,
 *   problemSolved: string,
 *   currentCustomers: string,
 *   ninetyDayGoal: string,
 *   biggestChallenge: string,
 *   lastSaved: Timestamp
 * }
 */

/**
 * section1Output
 * Stores the generated Executive Summary for Section 1
 *
 * Schema:
 * {
 *   section: 1,
 *   title: "Company Identity & Foundation",
 *   status: "completed",
 *   completedAt: string (ISO timestamp),
 *   version: 1,
 *   executiveSummary: {
 *     companyOverview: {
 *       name: string,
 *       industry: string,
 *       stage: string,
 *       elevatorPitch: string
 *     },
 *     coreOffering: {
 *       product: string,
 *       problemSolved: string,
 *       targetCustomer: string
 *     },
 *     currentState: {
 *       ninetyDayGoal: string,
 *       biggestChallenge: string,
 *       implication: string
 *     },
 *     idealCustomerGlance: string,
 *     perfectFitIndicators: string[],
 *     antiProfile: string[],
 *     keyInsight: string
 *   },
 *   rawAnswers: {
 *     // Copy of section1Answers
 *   },
 *   metadata: {
 *     generationTime: number,
 *     model: string,
 *     tokensUsed: number,
 *     editHistory: any[]
 *   },
 *   generatedAt: Timestamp
 * }
 */

/**
 * reconProgress
 * Tracks overall RECON questionnaire progress
 *
 * Schema:
 * {
 *   currentSection: number,
 *   completedSections: number[],
 *   section1Completed: boolean,
 *   lastUpdated: Timestamp
 * }
 */

// ============================================================================
// CREDIT SYSTEM - Schema Documentation (Module 15)
// ============================================================================

/**
 * User Credits
 * Stored in users/{userId} document
 *
 * Fields:
 * {
 *   credits: number,              // Current available credits
 *   monthlyCredits: number,       // Monthly allotment (400 for Starter, 1250 for Pro)
 *   lastCreditReset: Timestamp,   // Last monthly reset date
 *   lastCreditUpdate: Timestamp,  // Last credit transaction
 *   subscriptionTier: string      // 'starter' or 'pro'
 * }
 */

/**
 * Credit Usage Event
 * Stored in users/{userId}/events/{eventId} subcollection
 *
 * Schema:
 * {
 *   type: 'company_enrichment',
 *   companyId: string,
 *   companyName: string,
 *   creditsDeducted: number,      // Should be 10 for full enrichment
 *   costBreakdown: {
 *     companyData: 1,
 *     contactNames: 3,
 *     emails: 3,
 *     phones: 3
 *   },
 *   creditsRemaining: number,
 *   timestamp: Timestamp,
 *   contactsEnriched: number,     // Number of contacts enriched (3)
 *   metadata: {
 *     enrichedFields: string[]    // ['companyData', 'contacts', 'emails', 'phones']
 *   }
 * }
 */

/**
 * Credit Pricing
 * Cost per enrichment: 10 credits
 *
 * Breakdown:
 * - Company data: 1 credit
 * - 3 contact names: 3 credits
 * - 3 emails: 3 credits
 * - 3 phone numbers: 3 credits
 *
 * Monthly Plans:
 * - Starter ($20/mo): 400 credits = 40 companies/month
 * - Pro ($50/mo): 1,250 credits = 125 companies/month
 */

// ============================================================================
// CONTACT STATE MACHINE - Schema Documentation (Step 2)
// ============================================================================

/**
 * Contact Status (System-Controlled State Machine)
 * Stored in users/{userId}/contacts/{contactId} document
 *
 * Separate from lead_status (pipeline stage). This field tracks
 * behavioral momentum — auto-updated by user actions.
 *
 * Fields:
 * {
 *   contact_status: 'New' | 'Engaged' | 'In Campaign' | 'Active Mission' |
 *                   'Awaiting Reply' | 'Mission Complete' | 'Dormant',
 *   contact_status_updated_at: string (ISO timestamp)
 * }
 *
 * Default for legacy contacts (no contact_status field): 'New'
 *
 * Auto-Update Rules:
 *   Contact created        → 'New'
 *   Engage clicked         → 'Engaged'
 *   Campaign assigned      → 'In Campaign'
 *   Mission assigned       → 'Active Mission'
 *   Message sent           → 'Awaiting Reply'
 *   Manual complete action → 'Mission Complete'
 *   (Dormant reserved for future inactivity detection)
 *
 * Transitions only advance forward in priority unless the trigger
 * is MESSAGE_SENT or MANUAL_COMPLETE (which always apply).
 *
 * See: src/utils/contactStateMachine.js
 */

// ============================================================================
// STRUCTURED CONTEXT FIELDS - Schema Documentation (Step 3)
// ============================================================================

/**
 * Contact Structured Context Fields
 * Stored in users/{userId}/contacts/{contactId} document
 *
 * Strategic classification fields that feed Barry's prompt.
 * These are SEPARATE from engagementIntent (Hunter messaging flow).
 *
 * engagementIntent answers: "What kind of relationship do I have right now?"
 *   → Used in Hunter flow for immediate message tone calibration
 *   → Values: prospect | warm | customer | partner
 *
 * These fields answer: "How do I structurally classify this contact for planning?"
 *   → Used across Barry context generation and engagement intelligence
 *
 * Fields:
 * {
 *   relationship_type: 'prospect' | 'known' | 'partner' | 'delegate',
 *     // prospect = net new contact, no prior relationship
 *     // known = existing relationship, met before, have context
 *     // partner = business partner, collaborator, or referral source
 *     // delegate = gatekeeper, referral, or proxy for a decision-maker
 *
 *   warmth_level: 'cold' | 'warm' | 'hot',
 *     // cold = no prior interaction, first touch
 *     // warm = some prior interaction or mutual connection
 *     // hot = active conversation or strong existing rapport
 *
 *   strategic_value: 'low' | 'medium' | 'high'
 *     // low = low strategic importance to current goals
 *     // medium = moderate strategic importance
 *     // high = high strategic importance, priority contact
 * }
 *
 * GUARDRAIL: Do NOT collapse relationship_type into engagementIntent.
 * A customer you're upselling vs one you're checking in on have the
 * same relationship_type but different engagementIntent.
 *
 * See: src/constants/structuredFields.js
 */

/**
 * Campaign/Mission Structured Context Fields
 * Stored in users/{userId}/missions/{missionId} document
 *
 * Strategic classification at the campaign container level.
 * Individual tactics (schedule meeting, send email) belong at the Mission step level.
 *
 * Fields:
 * {
 *   objective_type: 'acquire' | 'activate' | 'expand' | 'retain' | 'influence' | 'partner',
 *     // acquire = new relationship or deal
 *     // activate = move someone from passive to engaged
 *     // expand = upsell, deepen, or grow existing relationship
 *     // retain = renew, maintain, or prevent churn
 *     // influence = political, advisory, or strategic alignment
 *     // partner = referral, collaboration, or co-creation
 *
 *   time_horizon: 'immediate' | 'near_term' | 'long_term' | 'ongoing',
 *     // immediate = 0-30 days
 *     // near_term = 1-3 months
 *     // long_term = 3+ months
 *     // ongoing = no defined end
 *
 *   strategic_priority: 'low' | 'medium' | 'high' | 'critical'
 *     // low = handle when capacity allows
 *     // medium = standard priority
 *     // high = active focus
 *     // critical = requires immediate attention
 * }
 *
 * See: src/constants/structuredFields.js
 */

// ============================================================================
// MISSION STRUCTURED FIELDS - Schema Documentation (Step 4)
// ============================================================================

/**
 * Mission Structured Strategy Fields
 * Stored in users/{userId}/missions/{missionId} document
 *
 * Step 4 converts Missions from labels into structured strategy units.
 * Every Mission must have four required fields so Barry can generate
 * contextually appropriate micro-sequences, not just single messages.
 *
 * Fields:
 * {
 *   outcome_goal: 'schedule_meeting' | 'secure_commitment' | 'rebuild_relationship' |
 *                 'get_introduction' | 'gather_feedback' | 'ask_for_referral' | 'close_deal',
 *     // schedule_meeting = get a meeting on the calendar
 *     // secure_commitment = get a verbal or written yes
 *     // rebuild_relationship = re-establish trust after going dark
 *     // get_introduction = ask for a warm intro to someone else
 *     // gather_feedback = collect input, opinions, or validation
 *     // ask_for_referral = request a referral to a potential customer or partner
 *     // close_deal = drive to a signed agreement or purchase
 *
 *   engagement_style: 'light_touch' | 'moderate' | 'high_touch',
 *     // light_touch = minimal effort, low frequency
 *     // moderate = consistent follow-up over weeks
 *     // high_touch = white glove, frequent personal engagement
 *
 *   timeframe: 'this_week' | 'this_month' | 'this_quarter' | 'no_deadline',
 *     // this_week = urgent, within 7 days
 *     // this_month = active, within 30 days
 *     // this_quarter = strategic, within 90 days
 *     // no_deadline = ongoing, no time pressure
 *
 *   next_step_type: 'send_message' | 'book_call' | 'request_meeting' |
 *                   'send_resource' | 'make_introduction' | 'follow_up'
 *     // send_message = draft and send an email or text
 *     // book_call = schedule a phone or video call
 *     // request_meeting = propose an in-person or virtual meeting
 *     // send_resource = share a document, link, or asset
 *     // make_introduction = connect two people via intro
 *     // follow_up = check in after a previous interaction
 * }
 *
 * How Barry uses these fields:
 *   outcome_goal → aligns CTA and end-state of the sequence
 *   engagement_style → adjusts tone, frequency, and depth
 *   timeframe → calibrates urgency and spacing between steps
 *   next_step_type → determines the logical first action in the sequence
 *
 * Barry generates a suggested micro-sequence (2-3 steps) based on these fields.
 * Every step remains approval-based — nothing sends without user confirmation.
 *
 * GUARDRAIL: Mission fields are tactical execution parameters.
 * They do NOT override Campaign-level strategic fields (objective_type,
 * time_horizon, strategic_priority). Both layers coexist.
 *
 * See: src/constants/structuredFields.js
 */

// ============================================================================
// CONTACT ENRICHMENT PROVENANCE - Schema Documentation (Barry Enrichment)
// ============================================================================

/**
 * Contact Enrichment Provenance Fields
 * Stored in users/{userId}/contacts/{contactId} document
 *
 * Added by barryEnrich function when user triggers enrichment.
 * All enrichment is tool-based (no AI). Barry orchestrates, not "thinks".
 *
 * Pipeline:
 *   Step 0: Internal DB (free — checks alternate field names)
 *   Step 1: Apollo PEOPLE_MATCH / PEOPLE_SEARCH (person-level data)
 *   Step 2: Google Places (company-level fallback: phone, address, website)
 *
 * Fields:
 * {
 *   enrichment_provenance: {         // Maps field name -> source
 *     email: 'apollo_match',
 *     linkedin_url: 'apollo_match',
 *     company_phone: 'google_places',
 *     seniority: 'apollo_search',
 *     // ... each enriched field maps to its data source
 *   },
 *   enrichment_steps: [              // Ordered list of enrichment steps
 *     {
 *       source: 'internal_db' | 'apollo_match' | 'apollo_search' | 'google_places',
 *       status: 'success' | 'error' | 'no_data' | 'no_match' | 'no_results' | 'skipped',
 *       fieldsFound: string[],       // e.g., ['email', 'phone', 'location']
 *       timestamp: string,           // ISO timestamp
 *       message: string | null       // Error or status message
 *     }
 *   ],
 *   enrichment_summary: {            // Rule-based summary (NO AI)
 *     fields_found: string[],        // Field names that were enriched
 *     fields_missing: string[],      // Field names still missing
 *     confidence: 'high' | 'medium' | 'low',  // Rule-based: high=6+ found & <=2 missing
 *     total_steps: number,           // How many pipeline steps ran
 *     sources_used: string[]         // e.g., ['apollo', 'google', 'internal']
 *   },
 *   // Company-level fields (from Google Places):
 *   company_phone: string | null,
 *   company_website: string | null,
 *   company_address: string | null
 * }
 */

// ============================================================================
// SECTION 2: PRODUCT/SERVICE DEEP DIVE - Schema Documentation
// ============================================================================

/**
 * section2Answers
 * Stores user's raw answers to Section 2 questionnaire
 *
 * Schema:
 * {
 *   productName: string,
 *   category: string,
 *   coreFeatures: string[],
 *   differentiation: string,
 *   useCases: string[],
 *   implementationTime: string,
 *   supportLevel: string,
 *   pricingModel: string,
 *   startingPrice: string,
 *   techStack: string,
 *   integrations: string[],
 *   lastSaved: Timestamp
 * }
 */

/**
 * section2Output
 * Stores the generated output for Section 2
 *
 * Schema:
 * {
 *   section: 2,
 *   title: "Product/Service Deep Dive",
 *   status: "completed",
 *   completedAt: string (ISO timestamp),
 *   version: 1,
 *   analysis: {
 *     productOverview: {
 *       name: string,
 *       category: string,
 *       description: string
 *     },
 *     valueAnalysis: {
 *       coreCapabilities: string[],
 *       uniqueDifferentiators: string[],
 *       competitiveAdvantages: string[]
 *     },
 *     targetUseCases: {
 *       primary: string[],
 *       secondary: string[]
 *     },
 *     technicalProfile: {
 *       stack: string,
 *       integrations: string[],
 *       implementationTime: string,
 *       supportModel: string
 *     },
 *     pricingIntelligence: {
 *       model: string,
 *       startingPrice: string,
 *       valueMetric: string,
 *       pricePositioning: string
 *     },
 *     icpAlignment: string,
 *     strategicRecommendations: string[]
 *   },
 *   rawAnswers: object,
 *   metadata: {
 *     generationTime: number,
 *     model: string,
 *     tokensUsed: number,
 *     editHistory: any[]
 *   },
 *   generatedAt: Timestamp
 * }
 */

// ============================================================================
// CONTACT ENGAGEMENT TIMELINE - Schema Documentation
// ============================================================================

/**
 * Timeline Event
 * Stored in users/{userId}/contacts/{contactId}/timeline/{eventId}
 *
 * Structured engagement event log. Subcollection design for:
 * - Queryable by timestamp (reverse chronological)
 * - Queryable by type
 * - Paginated
 * - Expandable without document size limits
 *
 * Does NOT replace or modify the legacy activity_log array.
 * Note: ActivityHistory component (which reads activity_log) was deprecated in Step 3.
 * EngagementTimeline is the sole engagement display surface.
 *
 * Schema:
 * {
 *   type: 'message_generated' | 'message_sent' | 'mission_assigned' |
 *         'campaign_assigned' | 'lead_status_changed' | 'contact_status_changed',
 *   actor: 'user' | 'barry' | 'system',
 *   createdAt: Timestamp,
 *   preview: string | undefined,    // Short preview snippet (subject, intent, status transition)
 *   metadata: {                     // Type-specific structured data
 *     // message_generated:
 *     strategyCount?: number,
 *     strategies?: string[],
 *     engagementIntent?: string,
 *
 *     // message_sent:
 *     channel?: string,             // email, text, call, linkedin, calendar
 *     method?: string,              // real, native
 *     sendResult?: string,          // sent, opened, prepared, failed
 *     engagementIntent?: string,
 *     strategy?: string,
 *     gmailMessageId?: string,
 *
 *     // mission_assigned:
 *     missionId?: string,
 *     missionName?: string,
 *     goalName?: string,
 *
 *     // campaign_assigned:
 *     campaignId?: string,
 *     campaignName?: string,
 *
 *     // lead_status_changed:
 *     statusFrom?: string,
 *     statusTo?: string,
 *     bulkAction?: boolean,
 *
 *     // contact_status_changed:
 *     // statusFrom?: string,
 *     // statusTo?: string,
 *     trigger?: string             // e.g. 'engage_clicked', 'message_sent'
 *   }
 * }
 */