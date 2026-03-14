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
    // Load contact, user memory, recent sessions, strategy stats, and attributions in parallel
    const [contactSnap, userMemorySnap, recentSessions, strategyStats, recentAttributions] = await Promise.all([
      db.collection('users').doc(userId).collection('contacts').doc(contactId).get(),
      db.collection('users').doc(userId).collection('barry_memory').doc('current').get(),
      loadRecentSessions(db, userId, contactId),
      loadStrategyStats(db, userId),
      loadRecentAttributions(db, userId, contactId)
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
        warmth_level_source: contact.warmth_level_source || null,
        strategic_value: contact.strategic_value || null,
        engagement_intent: contact.engagement_intent || contact.engagementIntent || null,
        contact_status: contact.contact_status || 'New',
        relationship_state: contact.relationship_state || null,
        relationship_state_source: contact.relationship_state_source || null,
        known_contact: contact.known_contact || false,
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

      // Sprint 3: Strategy effectiveness from outcome attribution
      strategy_stats: strategyStats,

      // Recent attribution outcomes for this contact
      recent_attributions: recentAttributions,
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
 * Load per-user strategy effectiveness stats (Sprint 3: Outcome Attribution).
 */
async function loadStrategyStats(db, userId) {
  try {
    const statsSnap = await db
      .collection('users').doc(userId)
      .collection('barry_memory').doc('strategy_stats')
      .get();

    if (!statsSnap.exists) return null;

    const stats = statsSnap.data();
    if (!stats.total_attributions || stats.total_attributions < 3) return null; // Not enough data yet

    return {
      angle_outcomes: stats.angle_outcomes || {},
      channel_outcomes: stats.channel_outcomes || {},
      guardrail_outcomes: stats.guardrail_outcomes || {},
      total_attributions: stats.total_attributions
    };
  } catch (error) {
    console.error('[BarryContextAssembler] Failed to load strategy stats:', error);
    return null;
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
 * Load recent attribution outcomes for a contact.
 * Surfaces what worked/didn't in the last few engagements.
 */
async function loadRecentAttributions(db, userId, contactId, limit = 5) {
  try {
    const snap = await db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .collection('barry_attributions')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get();

    if (snap.empty) return [];

    return snap.docs.map(d => {
      const data = d.data();
      return {
        outcome: data.outcome,
        outcome_class: data.outcome_class,
        strategy_used: data.strategy_used,
        channel_used: data.channel_used,
        followed_advice: data.followed_advice,
        guardrail_type: data.guardrail_type,
        guardrail_action: data.guardrail_action,
        attributed_at: data.attributed_at,
      };
    });
  } catch (error) {
    console.error('[BarryContextAssembler] Failed to load attributions:', error.message);
    return [];
  }
}

/**
 * Build a prompt-ready context string from structured Barry context.
 * Capped at ~300 tokens (HISTORY_TOKEN_BUDGET_CHARS characters).
 *
 * Uses priority-based truncation: when over budget, drops lowest-priority
 * sections first so strategy insights and core memory are never silently cut.
 *
 * Priority tiers (highest first):
 *   P0: Known contact flag, who they are, current goal
 *   P1: What has worked/not worked, strategy insights, no-reply warnings
 *   P2: Tone/channel preferences, engagement stats, last next step
 *   P3: Session summaries, known facts, relationship summary
 */
function buildPromptContext(context) {
  // Build sections with explicit priority (lower number = higher priority)
  const sections = [];

  // P0 — Critical identity and relationship signals
  if (context.relationship.known_contact) {
    sections.push({ priority: 0, text: 'IMPORTANT: This is a KNOWN contact (added manually by the user). Treat as a warm relationship — do NOT use cold prospecting tone.' });
  }
  if (context.memory.who_they_are) {
    sections.push({ priority: 0, text: `Who this person is to the user: ${context.memory.who_they_are}` });
  }
  if (context.memory.current_goal) {
    sections.push({ priority: 0, text: `Current goal with this person: ${context.memory.current_goal}` });
  }

  // P1 — Direct generation guidance (what to do / avoid)
  if (context.memory.what_has_worked.length > 0) {
    sections.push({ priority: 1, text: `What has worked before: ${context.memory.what_has_worked.join('; ')}` });
  }
  if (context.memory.what_has_not_worked.length > 0) {
    sections.push({ priority: 1, text: `What has NOT worked: ${context.memory.what_has_not_worked.join('; ')}` });
  }
  if (context.memory.what_has_been_tried.length > 0) {
    sections.push({ priority: 1, text: `Approaches already tried: ${context.memory.what_has_been_tried.join('; ')}` });
  }
  if (context.stats.consecutive_no_replies >= 2) {
    sections.push({ priority: 1, text: `WARNING: ${context.stats.consecutive_no_replies} consecutive messages with no reply — consider changing approach` });
  }
  if (context.strategy_stats && context.strategy_stats.total_attributions >= 5) {
    const insights = buildStrategyInsights(context.strategy_stats);
    if (insights) {
      sections.push({ priority: 1, text: insights });
    }
  }

  // P1 — Recent attribution outcomes (last engagement results)
  if (context.recent_attributions && context.recent_attributions.length > 0) {
    const attrLines = context.recent_attributions.slice(0, 3).map(a => {
      let line = `${a.strategy_used || 'unknown strategy'}`;
      if (a.channel_used) line += ` via ${a.channel_used}`;
      line += ` → ${a.outcome_class}`;
      if (a.followed_advice === true) line += ' (followed Barry\'s advice)';
      if (a.followed_advice === false) line += ' (ignored Barry\'s advice)';
      return line;
    });
    sections.push({ priority: 1, text: `Recent outcomes for this contact: ${attrLines.join('; ')}` });
  }

  // P2 — Preferences and stats
  if (context.memory.tone_preference) {
    sections.push({ priority: 2, text: `This person responds best to: ${context.memory.tone_preference} tone` });
  }
  if (context.memory.channel_preference) {
    sections.push({ priority: 2, text: `Preferred channel: ${context.memory.channel_preference}` });
  }
  if (context.user_preferences.preferred_tone) {
    sections.push({ priority: 2, text: `User's overall preferred tone: ${context.user_preferences.preferred_tone}` });
  }
  if (context.stats.total_sent > 0) {
    const replyRate = context.stats.replies_received > 0
      ? ` (${context.stats.replies_received} replies, ${context.stats.positive_replies} positive)`
      : ' (no replies yet)';
    sections.push({ priority: 2, text: `Engagement history: ${context.stats.total_sent} messages sent${replyRate}` });
  }
  if (context.engage.last_session_next_step) {
    sections.push({ priority: 2, text: `Barry's last recommended next step: ${context.engage.last_session_next_step}` });
  }

  // P3 — Color and continuity (first to drop)
  const sessionSummaries = context.recent_sessions
    .filter(s => s.session_summary)
    .slice(0, 3)
    .map(s => `[${(s.started_at || '').slice(0, 10)}] ${s.session_summary}`);
  if (sessionSummaries.length > 0) {
    sections.push({ priority: 3, text: `Recent session history:\n${sessionSummaries.join('\n')}` });
  }
  if (context.memory.known_facts.length > 0) {
    const factsStr = context.memory.known_facts.slice(0, 5).join('; ');
    sections.push({ priority: 3, text: `Known facts: ${factsStr}` });
  }
  if (context.memory.relationship_summary) {
    const summary = context.memory.relationship_summary;
    const truncated = summary.length > 200 ? summary.slice(-200) : summary;
    sections.push({ priority: 3, text: `Relationship summary: ${truncated}` });
  }

  // Assemble with priority-based truncation
  // Sort by priority (stable — preserves insertion order within same priority)
  sections.sort((a, b) => a.priority - b.priority);

  let result = sections.map(s => s.text).join('\n');

  if (result.length > HISTORY_TOKEN_BUDGET_CHARS) {
    // Drop sections from lowest priority until we fit
    let kept = [...sections];
    const maxPriority = Math.max(...kept.map(s => s.priority));

    for (let dropPriority = maxPriority; dropPriority >= 0; dropPriority--) {
      if (kept.map(s => s.text).join('\n').length <= HISTORY_TOKEN_BUDGET_CHARS) break;
      kept = kept.filter(s => s.priority !== dropPriority);
    }

    result = kept.map(s => s.text).join('\n');

    // If still over budget after dropping all but P0, truncate at word boundary
    if (result.length > HISTORY_TOKEN_BUDGET_CHARS) {
      const truncPoint = result.lastIndexOf(' ', HISTORY_TOKEN_BUDGET_CHARS);
      result = result.slice(0, truncPoint > 0 ? truncPoint : HISTORY_TOKEN_BUDGET_CHARS) + '...';
    }
  }

  if (!result.trim()) return '';

  return `\nBARRY'S MEMORY — WHAT BARRY KNOWS ABOUT THIS CONTACT:\n${result}\n\nINSTRUCTION: Use this memory to avoid repeating failed approaches, build on what has worked, and maintain continuity with prior sessions. Do NOT repeat the same angle or channel that has already failed. Reference known facts naturally when relevant.\n`;
}

/**
 * Build a concise strategy effectiveness summary from attribution stats.
 * Only surfaces clear winners/losers — no noise.
 */
function buildStrategyInsights(stats) {
  const insights = [];

  // Find best-performing angle (min 3 uses, >50% positive rate)
  const bestAngle = findBestPerformer(stats.angle_outcomes, 3);
  if (bestAngle) {
    insights.push(`Best-performing strategy: "${bestAngle.key}" (${bestAngle.rate}% positive, ${bestAngle.total} uses)`);
  }

  // Find worst-performing angle (min 3 uses, <20% positive rate)
  const worstAngle = findWorstPerformer(stats.angle_outcomes, 3);
  if (worstAngle) {
    insights.push(`Avoid: "${worstAngle.key}" strategy (${worstAngle.rate}% positive, ${worstAngle.total} uses)`);
  }

  // Find best channel
  const bestChannel = findBestPerformer(stats.channel_outcomes, 3);
  if (bestChannel) {
    insights.push(`Best channel: ${bestChannel.key} (${bestChannel.rate}% positive)`);
  }

  if (insights.length === 0) return null;
  return `Strategy insights (from ${stats.total_attributions} tracked outcomes): ${insights.join('. ')}`;
}

function findBestPerformer(outcomes, minUses) {
  let best = null;
  for (const [key, data] of Object.entries(outcomes || {})) {
    if (data.total < minUses) continue;
    const rate = Math.round((data.positive / data.total) * 100);
    if (rate >= 50 && (!best || rate > best.rate)) {
      best = { key, rate, total: data.total };
    }
  }
  return best;
}

function findWorstPerformer(outcomes, minUses) {
  let worst = null;
  for (const [key, data] of Object.entries(outcomes || {})) {
    if (data.total < minUses) continue;
    const rate = Math.round((data.positive / data.total) * 100);
    if (rate < 20 && (!worst || rate < worst.rate)) {
      worst = { key, rate, total: data.total };
    }
  }
  return worst;
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
