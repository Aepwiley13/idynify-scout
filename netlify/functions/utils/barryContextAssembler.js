/**
 * BARRY CONTEXT ASSEMBLER — Server-Side (Netlify Functions)
 *
 * Sprint 0: Wire Barry's memory into both generation paths.
 *
 * This is the server-side equivalent of barryMemoryService.assembleBarryContext().
 * Uses Firebase Admin SDK instead of the client SDK.
 *
 * Loads three layers of context before any generation call:
 *   1. Per-contact memory (barry_memory on the contact doc)
 *   2. Per-user preferences (users/{userId}/barry_memory doc)
 *   3. Recent Barry sessions (barry_sessions subcollection)
 *
 * Returns a structured context object AND a prompt-ready string
 * (capped at ~300 tokens) for injection into generation prompts.
 */

// Max recent sessions to load for history context
const RECENT_SESSIONS_TO_LOAD = 5;

// Approximate token budget for history context in prompts
const HISTORY_TOKEN_BUDGET_CHARS = 1200; // ~300 tokens ≈ 1200 chars

/**
 * Assemble full Barry context for a contact using Firebase Admin SDK.
 *
 * @param {import('firebase-admin/firestore').Firestore} db - Admin Firestore instance
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<Object>} { context, promptContext }
 *   - context: full structured object for programmatic use
 *   - promptContext: string ready for injection into Claude prompts (~300 tokens)
 */
export async function assembleBarryContext(db, userId, contactId) {
  try {
    // Load contact, user memory, and recent sessions in parallel
    const [contactSnap, userMemorySnap, recentSessions] = await Promise.all([
      db.collection('users').doc(userId).collection('contacts').doc(contactId).get(),
      db.collection('users').doc(userId).collection('barry_memory').doc('current').get(),
      loadRecentSessions(db, userId, contactId)
    ]);

    if (!contactSnap.exists) {
      return { context: null, promptContext: '' };
    }

    const contact = { id: contactSnap.id, ...contactSnap.data() };
    const memory = contact.barry_memory || createEmptyMemory();
    const userMemory = userMemorySnap.exists ? userMemorySnap.data() : createEmptyUserMemory();
    const engageSummary = contact.engagement_summary || {};

    // Build structured context
    const context = {
      person: {
        name: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
        company: contact.company || contact.company_name || null,
        title: contact.title || contact.current_position_title || null,
      },

      relationship: {
        person_type: contact.person_type || 'lead',
        brigade: contact.brigade || null,
        relationship_type: contact.relationship_type || null,
        warmth_level: contact.warmth_level || null,
        strategic_value: contact.strategic_value || null,
        engagement_intent: contact.engagement_intent || contact.engagementIntent || null,
        contact_status: contact.contact_status || 'New',
        relationship_state: contact.relationship_state || null,
      },

      memory: {
        who_they_are: memory.who_they_are || null,
        current_goal: memory.current_goal || null,
        relationship_summary: memory.relationship_summary || null,
        what_has_been_tried: memory.what_has_been_tried || [],
        what_has_worked: memory.what_has_worked || [],
        what_has_not_worked: memory.what_has_not_worked || [],
        known_facts: memory.known_facts || [],
        tone_preference: memory.tone_preference || null,
        channel_preference: memory.channel_preference || userMemory.preferred_channel || null,
      },

      engage: {
        status: contact.engage_state?.status || 'never_engaged',
        current_goal: contact.engage_state?.current_goal || null,
        last_session_summary: contact.engage_state?.last_barry_session?.summary || null,
        last_session_next_step: contact.engage_state?.last_barry_session?.next_step || null,
      },

      stats: {
        total_sessions: engageSummary.total_sessions || 0,
        total_sent: engageSummary.total_messages_sent || 0,
        replies_received: engageSummary.replies_received || 0,
        positive_replies: engageSummary.positive_replies || 0,
        consecutive_no_replies: engageSummary.consecutive_no_replies || 0,
        last_outcome: engageSummary.last_outcome || null,
        last_contact_at: engageSummary.last_contact_at || null,
      },

      recent_sessions: recentSessions,

      user_preferences: {
        preferred_tone: userMemory.preferred_tone || null,
        preferred_channel: userMemory.preferred_channel || null,
      },
    };

    // Build prompt-ready string (capped at ~300 tokens)
    const promptContext = buildPromptContext(context);

    return { context, promptContext };
  } catch (error) {
    console.error('[BarryContextAssembler] Failed to assemble context:', error);
    return { context: null, promptContext: '' };
  }
}

/**
 * Load the N most recent Barry sessions for a contact.
 */
async function loadRecentSessions(db, userId, contactId, n = RECENT_SESSIONS_TO_LOAD) {
  try {
    const sessionsSnap = await db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .collection('barry_sessions')
      .orderBy('started_at', 'desc')
      .limit(n)
      .get();

    return sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('[BarryContextAssembler] Failed to load sessions:', error);
    return [];
  }
}

/**
 * Build a prompt-ready context string from structured Barry context.
 * Capped at ~300 tokens (HISTORY_TOKEN_BUDGET_CHARS characters).
 *
 * Prioritizes the most useful information:
 *   1. Who they are + current goal (highest value)
 *   2. What has worked / not worked (direct generation guidance)
 *   3. Recent session summaries (continuity)
 *   4. Known facts (color)
 */
function buildPromptContext(context) {
  const parts = [];

  // Always include relationship memory if available
  if (context.memory.who_they_are) {
    parts.push(`Who this person is to the user: ${context.memory.who_they_are}`);
  }

  if (context.memory.current_goal) {
    parts.push(`Current goal with this person: ${context.memory.current_goal}`);
  }

  // What has worked — directly useful for generation
  if (context.memory.what_has_worked.length > 0) {
    parts.push(`What has worked before: ${context.memory.what_has_worked.join('; ')}`);
  }

  // What has NOT worked — avoid repeating failures
  if (context.memory.what_has_not_worked.length > 0) {
    parts.push(`What has NOT worked: ${context.memory.what_has_not_worked.join('; ')}`);
  }

  // What has been tried — avoid repetition
  if (context.memory.what_has_been_tried.length > 0) {
    parts.push(`Approaches already tried: ${context.memory.what_has_been_tried.join('; ')}`);
  }

  // Tone and channel preferences
  if (context.memory.tone_preference) {
    parts.push(`This person responds best to: ${context.memory.tone_preference} tone`);
  }
  if (context.memory.channel_preference) {
    parts.push(`Preferred channel: ${context.memory.channel_preference}`);
  }

  // User's global preferences
  if (context.user_preferences.preferred_tone) {
    parts.push(`User's overall preferred tone: ${context.user_preferences.preferred_tone}`);
  }

  // Engagement stats summary (one line)
  if (context.stats.total_sent > 0) {
    const replyRate = context.stats.replies_received > 0
      ? ` (${context.stats.replies_received} replies, ${context.stats.positive_replies} positive)`
      : ' (no replies yet)';
    parts.push(`Engagement history: ${context.stats.total_sent} messages sent${replyRate}`);
  }

  if (context.stats.consecutive_no_replies >= 2) {
    parts.push(`WARNING: ${context.stats.consecutive_no_replies} consecutive messages with no reply — consider changing approach`);
  }

  // Recent session summaries (most recent first)
  const sessionSummaries = context.recent_sessions
    .filter(s => s.session_summary)
    .slice(0, 3)
    .map(s => `[${(s.started_at || '').slice(0, 10)}] ${s.session_summary}`);

  if (sessionSummaries.length > 0) {
    parts.push(`Recent session history:\n${sessionSummaries.join('\n')}`);
  }

  // Known facts
  if (context.memory.known_facts.length > 0) {
    const factsStr = context.memory.known_facts.slice(0, 5).join('; ');
    parts.push(`Known facts: ${factsStr}`);
  }

  // Last session next step
  if (context.engage.last_session_next_step) {
    parts.push(`Barry's last recommended next step: ${context.engage.last_session_next_step}`);
  }

  // Relationship summary (truncated)
  if (context.memory.relationship_summary) {
    const summary = context.memory.relationship_summary;
    const truncated = summary.length > 200 ? summary.slice(-200) : summary;
    parts.push(`Relationship summary: ${truncated}`);
  }

  // Join and cap at budget
  let result = parts.join('\n');
  if (result.length > HISTORY_TOKEN_BUDGET_CHARS) {
    result = result.slice(0, HISTORY_TOKEN_BUDGET_CHARS) + '...';
  }

  if (!result.trim()) return '';

  return `\nBARRY'S MEMORY — WHAT BARRY KNOWS ABOUT THIS CONTACT:\n${result}\n\nINSTRUCTION: Use this memory to avoid repeating failed approaches, build on what has worked, and maintain continuity with prior sessions. Do NOT repeat the same angle or channel that has already failed. Reference known facts naturally when relevant.\n`;
}

function createEmptyMemory() {
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
    context_by_session: {},
  };
}

function createEmptyUserMemory() {
  return {
    preferred_tone: null,
    preferred_channel: null,
    tone_usage: {},
    channel_usage: {},
    total_sessions: 0,
  };
}
