/**
 * BUILD AUTO-INTENT
 *
 * Pure client-side function that constructs a natural language intent string
 * from structured card data + session mode. This eliminates mandatory free-text
 * input (Blocker 1 resolution, C+D Hybrid approved).
 *
 * The output string passes Barry's validation at generate-engagement-message.js:81
 * (non-empty string check) and produces message quality comparable to manual
 * free-form intent (validated by Gate 3 test cases).
 *
 * GUARDRAILS:
 * - G1: Zero backend logic — this is pure string construction
 * - G4: Zero mandatory free-text — auto-intent fires without user typing
 */

/**
 * Session modes map to structured fields from the existing system.
 * These leverage WARMTH_LEVELS (structuredFields.js:23-27) and
 * OUTCOME_GOALS (structuredFields.js:63-71) without importing them
 * to keep the game layer decoupled.
 */
export const SESSION_MODES = {
  direct_pipeline: {
    id: 'direct_pipeline',
    label: 'Build Pipeline',
    description: 'Cold outreach to new prospects',
    icon: 'Target',
    warmth: 'cold',
    relationshipType: 'prospect',
    goalVerb: 'introduce ourselves to',
    goalSuffix: 'schedule a meeting',
    engagementIntent: 'prospect'
  },
  warm_outreach: {
    id: 'warm_outreach',
    label: 'Warm Outreach',
    description: 'Reconnect with known contacts',
    icon: 'Users',
    warmth: 'warm',
    relationshipType: 'known',
    goalVerb: 'reconnect with',
    goalSuffix: 'schedule a meeting',
    engagementIntent: 'warm'
  },
  re_engagement: {
    id: 're_engagement',
    label: 'Re-engage',
    description: 'Follow up with stale contacts',
    icon: 'RefreshCw',
    warmth: 'follow-up',
    relationshipType: 'known',
    goalVerb: 'follow up with',
    goalSuffix: 're-establish connection',
    engagementIntent: 'warm'
  },
  new_introductions: {
    id: 'new_introductions',
    label: 'Introductions',
    description: 'Open new relationships',
    icon: 'Handshake',
    warmth: 'cold',
    relationshipType: 'prospect',
    goalVerb: 'make initial contact with',
    goalSuffix: 'open the relationship',
    engagementIntent: 'prospect'
  }
};

export const SESSION_MODE_LIST = Object.values(SESSION_MODES);

/**
 * Game buckets — user-assigned contact categories that map directly to session modes.
 * Bucket values stored on contact.game_bucket field.
 * Each bucket maps 1:1 to a SESSION_MODES key for auto-intent construction.
 */
export const GAME_BUCKETS = {
  build_pipeline: {
    id: 'build_pipeline',
    label: 'Build Pipeline',
    icon: 'Target',
    emoji: '\uD83C\uDFAF',
    sessionMode: 'direct_pipeline',
    color: '#8b5cf6'
  },
  warm_outreach: {
    id: 'warm_outreach',
    label: 'Warm Outreach',
    icon: 'Users',
    emoji: '\uD83E\uDD1D',
    sessionMode: 'warm_outreach',
    color: '#22c55e'
  },
  re_engage: {
    id: 're_engage',
    label: 'Re-Engage',
    icon: 'RefreshCw',
    emoji: '\uD83D\uDD01',
    sessionMode: 're_engagement',
    color: '#f59e0b'
  },
  introductions: {
    id: 'introductions',
    label: 'Introductions',
    icon: 'UserPlus',
    emoji: '\uD83D\uDC4B',
    sessionMode: 'new_introductions',
    color: '#3b82f6'
  }
};

export const GAME_BUCKET_LIST = Object.values(GAME_BUCKETS);

/**
 * Map a game_bucket value to the corresponding session mode ID.
 * Used when starting a game session from a bucket selection.
 * @param {string} bucketId - One of the GAME_BUCKETS keys
 * @returns {string} SESSION_MODES key
 */
export function bucketToSessionMode(bucketId) {
  return GAME_BUCKETS[bucketId]?.sessionMode || 'direct_pipeline';
}

/** Game constants */
export const GAME_CONSTANTS = {
  SESSION_GOAL: 15,
  SESSION_WINDOW_MINUTES: 30,
  PREFETCH_BATCH_SIZE: 10,
  PREFETCH_REFILL_THRESHOLD: 3,
  PREFETCH_REFILL_BATCH: 5,
  DAILY_CARD_LIMIT: 25,
  MAX_CONCURRENT_BARRY_CALLS: 3
};

/**
 * Build an auto-intent string from card data and session mode.
 *
 * @param {Object} contact - Contact object with name, title, company_name, etc.
 * @param {Object} company - Company object with name, industry, fit_score, etc.
 * @param {string} sessionMode - One of: direct_pipeline, warm_outreach, re_engagement, new_introductions
 * @returns {string} Non-empty intent string for generate-engagement-message
 *
 * Degradation ladder (all produce valid, non-empty strings):
 *   All fields → "Cold outreach — introduce ourselves to VP of Sales at Acme Corp in SaaS. Goal: schedule a meeting"
 *   No industry → "Cold outreach — introduce ourselves to VP of Sales at Acme Corp. Goal: schedule a meeting"
 *   No title   → "Cold outreach — introduce ourselves to contact at Acme Corp. Goal: schedule a meeting"
 *   Minimal    → "Cold outreach — introduce ourselves to contact at their company. Goal: schedule a meeting"
 */
export function buildAutoIntent(contact, company, sessionMode) {
  const mode = SESSION_MODES[sessionMode] || SESSION_MODES.direct_pipeline;

  const title = contact?.title || contact?.current_position_title || 'contact';
  const companyName = company?.name || contact?.company_name || contact?.current_company_name || 'their company';
  const industry = company?.industry || contact?.company_industry || contact?.industry || '';

  const warmthLabel = mode.warmth.charAt(0).toUpperCase() + mode.warmth.slice(1);
  const industryClause = industry ? ` in ${industry}` : '';

  return `${warmthLabel} outreach — ${mode.goalVerb} ${title} at ${companyName}${industryClause}. Goal: ${mode.goalSuffix}`;
}

/**
 * Derive the engagementIntent value to pass to generate-engagement-message
 * from the session mode. Maps to existing ENGAGEMENT_INTENTS in
 * HunterContactDrawer.jsx:42-47.
 *
 * @param {string} sessionMode
 * @returns {string} One of: prospect, warm, customer, partner
 */
export function getEngagementIntent(sessionMode) {
  const mode = SESSION_MODES[sessionMode];
  return mode?.engagementIntent || 'prospect';
}

/**
 * Build the contact payload for generate-engagement-message API call.
 * Mirrors the exact shape constructed in HunterContactDrawer.jsx:261-272.
 *
 * @param {Object} contact - Full contact object from Firestore
 * @returns {Object} Contact payload for API
 */
export function buildContactPayload(contact) {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
    title: contact.title || contact.current_position_title,
    company_name: contact.company_name || contact.current_company_name,
    company_industry: contact.company_industry || contact.industry,
    seniority: contact.seniority,
    email: contact.email,
    phone: contact.phone || contact.phone_mobile,
    linkedin_url: contact.linkedin_url
  };
}
