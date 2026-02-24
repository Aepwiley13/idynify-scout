/**
 * BARRY MEMORY SERVICE — Team Alpha
 * Operation People First // Intelligence Layer
 *
 * Barry's learning loop. This service manages the persistent memory that makes
 * Barry smarter over time — so he asks fewer questions, makes better suggestions,
 * and never loses context between sessions.
 *
 * Three levels of memory:
 *
 *   1. Per-contact memory (barry_memory on the contact document)
 *      What Barry knows about THIS person and THIS relationship.
 *      Updated after every engage session.
 *
 *   2. Per-user preferences (users/{userId}/barry_memory document)
 *      What Barry has learned about THIS USER's style and preferences.
 *      e.g. "User prefers direct tone", "User closes on calls not email"
 *
 *   3. Session-level context (stored in barry_sessions subcollection)
 *      Full record of each session — questions, answers, generated messages.
 *      Used for Barry to recall exactly what was said before.
 *
 * Core rule: Barry should NEVER ask a question whose answer is already in memory.
 * The number of questions Barry asks decreases as memory deepens.
 *
 * Design:
 *   - No background jobs or scheduled functions needed
 *   - Memory is updated synchronously at session end
 *   - Barry reads memory before every session — cold start in <200ms
 *   - Memory is human-readable (no embeddings or ML required at MVP scale)
 */

import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { PEOPLE_PATHS, createBarryMemory } from '../schemas/peopleSchema';

// ── Constants ────────────────────────────────────────────

// How many recent sessions to load for "what has been tried" context
const RECENT_SESSIONS_TO_LOAD = 5;

// Minimum sessions before Barry stops asking certain context questions
const SESSIONS_BEFORE_MEMORY_KICKS_IN = 1;

// Fields Barry infers from history (no question needed after threshold)
const INFERRED_AFTER_HISTORY = {
  channel_preference: 2,    // sessions before channel preference is inferred
  tone_preference: 2,
  current_goal: 1           // If there's a previous goal, assume continuity unless told otherwise
};

// ── Per-Contact Memory ───────────────────────────────────

/**
 * Load the full Barry memory for a contact.
 * Returns the barry_memory object, or a fresh one if none exists.
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<Object>} barry_memory object
 */
export async function loadContactMemory(userId, contactId) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);

    if (!snap.exists()) return createBarryMemory();

    return snap.data().barry_memory || createBarryMemory();
  } catch (error) {
    console.error('[BarryMemory] Failed to load contact memory:', error);
    return createBarryMemory();
  }
}

/**
 * Update Barry's memory for a contact after a session.
 *
 * Called at the end of every engage session to update what Barry knows.
 * Merges new information with existing memory — never overwrites.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} sessionData - Data from the completed session
 * @param {string} sessionData.sessionId
 * @param {string} sessionData.goal          - What the user was trying to achieve
 * @param {string} sessionData.outcome       - 'message_sent' | 'channel_blocked' | 'abandoned' | 'pivoted_channel'
 * @param {string} sessionData.channel       - Channel used or attempted
 * @param {string} sessionData.blockedChannel - Channel that was blocked (if any)
 * @param {string} sessionData.tone          - Tone of the selected message
 * @param {string} sessionData.summary       - One-line summary of what happened
 * @param {string[]} sessionData.newFacts    - New facts Barry was told this session
 * @param {boolean} sessionData.gotReply     - Whether a reply was received this session
 * @param {string} sessionData.replyValence  - 'positive' | 'negative' | null
 */
export async function updateContactMemory(userId, contactId, sessionData) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);

    if (!snap.exists()) {
      console.error('[BarryMemory] Contact not found:', contactId);
      return;
    }

    const existing = snap.data();
    const memory = existing.barry_memory || createBarryMemory();
    const now = new Date().toISOString();

    // Update what_has_been_tried
    if (sessionData.channel && !memory.what_has_been_tried.includes(sessionData.channel)) {
      memory.what_has_been_tried = [...memory.what_has_been_tried, sessionData.channel];
    }

    // Track blocked channels
    if (sessionData.blockedChannel) {
      const blockedEntry = `${sessionData.blockedChannel} (blocked)`;
      if (!memory.what_has_not_worked.includes(blockedEntry)) {
        memory.what_has_not_worked = [...memory.what_has_not_worked, blockedEntry];
      }
    }

    // Track what worked (got a positive reply)
    if (sessionData.gotReply && sessionData.replyValence === 'positive' && sessionData.channel) {
      const workedEntry = `${sessionData.channel} (${sessionData.tone || 'message'})`;
      if (!memory.what_has_worked.includes(workedEntry)) {
        memory.what_has_worked = [...memory.what_has_worked, workedEntry];
      }
      // Update channel preference based on what worked
      memory.channel_preference = sessionData.channel;
    }

    // Track what did NOT work (abandoned or no reply)
    if (sessionData.outcome === 'abandoned' || (sessionData.gotReply === false && sessionData.channel)) {
      const didNotWork = `${sessionData.channel} — no response`;
      if (!memory.what_has_not_worked.includes(didNotWork)) {
        memory.what_has_not_worked = [...memory.what_has_not_worked, didNotWork];
      }
    }

    // Update goal if provided
    if (sessionData.goal) {
      memory.current_goal = sessionData.goal;
    }

    // Merge in any new known facts
    if (sessionData.newFacts && sessionData.newFacts.length > 0) {
      const existingFacts = new Set(memory.known_facts);
      sessionData.newFacts.forEach(f => existingFacts.add(f));
      memory.known_facts = Array.from(existingFacts);
    }

    // Update relationship summary (append, do not overwrite)
    if (sessionData.summary) {
      const existingSummary = memory.relationship_summary || '';
      const entry = `[${now.slice(0, 10)}] ${sessionData.summary}`;
      memory.relationship_summary = existingSummary
        ? `${existingSummary}\n${entry}`
        : entry;
    }

    // Log session context (lightweight reference)
    if (sessionData.sessionId && sessionData.summary) {
      memory.context_by_session = {
        ...memory.context_by_session,
        [sessionData.sessionId]: sessionData.summary
      };
    }

    // Infer channel preference from history if enough data
    memory.channel_preference = inferChannelPreference(memory, sessionData.channel);

    // Infer tone preference
    if (sessionData.tone && sessionData.gotReply && sessionData.replyValence === 'positive') {
      memory.tone_preference = sessionData.tone;
    }

    memory.last_updated_at = now;

    await updateDoc(contactRef, {
      barry_memory: memory,
      updatedAt: now
    });
  } catch (error) {
    console.error('[BarryMemory] Failed to update contact memory:', error);
    // Non-blocking — never throw
  }
}

/**
 * Set a specific known fact on a contact's Barry memory.
 * Called when Barry is explicitly told something (or user manually adds a fact).
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} fact - Natural language fact string
 */
export async function addKnownFact(userId, contactId, fact) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);

    if (!snap.exists()) return;

    const memory = snap.data().barry_memory || createBarryMemory();
    const existingFacts = new Set(memory.known_facts || []);
    existingFacts.add(fact);

    await updateDoc(contactRef, {
      'barry_memory.known_facts': Array.from(existingFacts),
      'barry_memory.last_updated_at': new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BarryMemory] Failed to add known fact:', error);
  }
}

/**
 * Update who_they_are — the natural language summary of who this person is.
 * Called when Barry first asks "Who is this person to you?" or when user updates.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} description - Natural language answer to "Who is this person?"
 */
export async function setWhoTheyAre(userId, contactId, description) {
  try {
    await updateDoc(doc(db, PEOPLE_PATHS.person(userId, contactId)), {
      'barry_memory.who_they_are': description,
      'barry_memory.last_updated_at': new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[BarryMemory] Failed to set who_they_are:', error);
  }
}

// ── Barry Session Records ────────────────────────────────

/**
 * Start a new Barry session record for a contact.
 * Creates the session document and returns the session ID.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} sessionInit - { goal, brigadeAtStart, channelAttempted }
 * @returns {Promise<string>} Session document ID
 */
export async function startBarrySession(userId, contactId, sessionInit) {
  try {
    const sessionsRef = collection(db, PEOPLE_PATHS.barrySessions(userId, contactId));
    const session = {
      started_at: new Date().toISOString(),
      ended_at: null,
      status: 'active',
      brigade_at_start: sessionInit.brigadeAtStart || null,
      goal: sessionInit.goal || null,
      channel_attempted: sessionInit.channelAttempted || null,
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

    const docRef = await addDoc(sessionsRef, session);

    // Update engage_state to mark session as active
    await updateDoc(doc(db, PEOPLE_PATHS.person(userId, contactId)), {
      'engage_state.status': 'in_progress',
      'engage_state.last_session_at': new Date().toISOString(),
      'engage_state.current_goal': sessionInit.goal || null,
      'contact_status': 'Engaged',
      'contact_status_updated_at': new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return docRef.id;
  } catch (error) {
    console.error('[BarryMemory] Failed to start Barry session:', error);
    return null;
  }
}

/**
 * Add a generated message to an active Barry session.
 * All four message types are stored — selected or not.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} sessionId
 * @param {Object} message - Generated message data
 * @param {string} message.type      - 'direct_short' | 'warm_personal' | 'value_led' | 'humor_driven'
 * @param {string} message.subject   - Email subject (if applicable)
 * @param {string} message.body      - Full message body
 * @param {string} message.channel   - Intended channel
 */
export async function addGeneratedMessage(userId, contactId, sessionId, message) {
  try {
    const sessionRef = doc(db, PEOPLE_PATHS.barrySession(userId, contactId, sessionId));
    const snap = await getDoc(sessionRef);
    if (!snap.exists()) return null;

    const messageRecord = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: message.type,
      subject: message.subject || null,
      body: message.body,
      channel: message.channel,
      generated_at: new Date().toISOString(),
      was_selected: false,
      was_sent: false,
      send_result: null
    };

    const existing = snap.data().generated_messages || [];
    await updateDoc(sessionRef, {
      generated_messages: [...existing, messageRecord]
    });

    return messageRecord.id;
  } catch (error) {
    console.error('[BarryMemory] Failed to add generated message:', error);
    return null;
  }
}

/**
 * Mark a message as selected and/or sent.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} sessionId
 * @param {string} messageId
 * @param {'selected'|'sent'} action
 * @param {string} [sendResult] - 'sent' | 'prepared' | 'failed'
 */
export async function markMessageAction(userId, contactId, sessionId, messageId, action, sendResult) {
  try {
    const sessionRef = doc(db, PEOPLE_PATHS.barrySession(userId, contactId, sessionId));
    const snap = await getDoc(sessionRef);
    if (!snap.exists()) return;

    const messages = snap.data().generated_messages || [];
    const updated = messages.map(m => {
      if (m.id !== messageId) return m;
      if (action === 'selected') return { ...m, was_selected: true };
      if (action === 'sent') return { ...m, was_selected: true, was_sent: true, send_result: sendResult || 'sent' };
      return m;
    });

    const updates = { generated_messages: updated };
    if (action === 'selected') updates.selected_message_id = messageId;
    if (action === 'sent') {
      updates.sent_message_id = messageId;
      updates['engage_state.status'] = 'awaiting_reply';
    }

    await updateDoc(sessionRef, updates);
  } catch (error) {
    console.error('[BarryMemory] Failed to mark message action:', error);
  }
}

/**
 * Close a Barry session with a summary and outcome.
 * Updates the session document and triggers memory update.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} sessionId
 * @param {Object} closeData
 * @param {string} closeData.outcome      - 'message_sent' | 'message_saved' | 'channel_blocked' | 'abandoned' | 'pivoted_channel'
 * @param {string} closeData.summary      - One-line summary of what happened
 * @param {Object} closeData.proposedNbs  - Next Best Step Barry is proposing
 * @param {string} closeData.channelBlocked - Channel that was blocked (if any)
 * @param {string} closeData.channelPivot  - Channel pivoted to (if any)
 * @param {string[]} closeData.newFacts   - New facts learned this session
 */
export async function closeBarrySession(userId, contactId, sessionId, closeData) {
  try {
    const now = new Date().toISOString();
    const sessionRef = doc(db, PEOPLE_PATHS.barrySession(userId, contactId, sessionId));
    const snap = await getDoc(sessionRef);
    if (!snap.exists()) return;

    const sessionData = snap.data();

    // Close the session document
    await updateDoc(sessionRef, {
      ended_at: now,
      status: 'completed',
      outcome: closeData.outcome,
      session_summary: closeData.summary,
      channel_blocked: closeData.channelBlocked || null,
      channel_pivot: closeData.channelPivot || null,
      proposed_nbs: closeData.proposedNbs || null
    });

    // Update engage_state on the contact
    const engageStatus = closeData.outcome === 'message_sent' ? 'awaiting_reply'
      : closeData.outcome === 'abandoned' ? 'paused'
      : 'in_progress';

    await updateDoc(doc(db, PEOPLE_PATHS.person(userId, contactId)), {
      'engage_state.status': engageStatus,
      'engage_state.last_session_at': now,
      'engage_state.last_barry_session': {
        summary: closeData.summary,
        outcome: closeData.outcome,
        next_step: closeData.proposedNbs?.action || null,
        sessionId
      },
      updatedAt: now
    });

    // Update engagement summary
    await updateEngagementSummary(userId, contactId, {
      sessionCompleted: true,
      messageSent: closeData.outcome === 'message_sent',
      channel: sessionData.channel_attempted,
      blockedChannel: closeData.channelBlocked
    });

    // Update Barry's memory
    await updateContactMemory(userId, contactId, {
      sessionId,
      goal: sessionData.goal,
      outcome: closeData.outcome,
      channel: sessionData.channel_attempted,
      blockedChannel: closeData.channelBlocked,
      tone: null, // Extracted from selected message below
      summary: closeData.summary,
      newFacts: closeData.newFacts || [],
      gotReply: false, // Reply comes later when outcome is recorded
      replyValence: null
    });
  } catch (error) {
    console.error('[BarryMemory] Failed to close Barry session:', error);
  }
}

/**
 * Load the N most recent Barry sessions for a contact.
 * Used by Barry to read "what has been tried" before starting a new session.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {number} [n] - Number of sessions to load (default: 5)
 * @returns {Promise<Array>} Array of session records, newest first
 */
export async function loadRecentSessions(userId, contactId, n = RECENT_SESSIONS_TO_LOAD) {
  try {
    const sessionsRef = collection(db, PEOPLE_PATHS.barrySessions(userId, contactId));
    const q = query(sessionsRef, orderBy('started_at', 'desc'), limit(n));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('[BarryMemory] Failed to load recent sessions:', error);
    return [];
  }
}

// ── Per-User Preferences ─────────────────────────────────

/**
 * Load Barry's learned preferences for a user (global, not per-contact).
 *
 * @param {string} userId
 * @returns {Promise<Object>} User Barry memory document
 */
export async function loadUserBarryMemory(userId) {
  try {
    const memoryRef = doc(db, PEOPLE_PATHS.userBarryMemory(userId));
    const snap = await getDoc(memoryRef);

    if (!snap.exists()) {
      return createUserBarryMemory();
    }
    return snap.data();
  } catch (error) {
    console.error('[BarryMemory] Failed to load user Barry memory:', error);
    return createUserBarryMemory();
  }
}

/**
 * Update user-level Barry preferences after a session.
 * Tracks which tones, channels, and approaches work across all contacts.
 *
 * @param {string} userId
 * @param {Object} update
 */
export async function updateUserBarryMemory(userId, update) {
  try {
    const memoryRef = doc(db, PEOPLE_PATHS.userBarryMemory(userId));
    const snap = await getDoc(memoryRef);
    const existing = snap.exists() ? snap.data() : createUserBarryMemory();

    const now = new Date().toISOString();
    const updated = { ...existing };

    // Track preferred tone
    if (update.selectedTone) {
      updated.tone_usage = updated.tone_usage || {};
      updated.tone_usage[update.selectedTone] = (updated.tone_usage[update.selectedTone] || 0) + 1;
      updated.preferred_tone = derivePreferredTone(updated.tone_usage);
    }

    // Track preferred channel
    if (update.channel) {
      updated.channel_usage = updated.channel_usage || {};
      updated.channel_usage[update.channel] = (updated.channel_usage[update.channel] || 0) + 1;
      updated.preferred_channel = derivePreferredChannel(updated.channel_usage);
    }

    // Track engagement rate per channel
    if (update.channel && update.gotReply !== undefined) {
      updated.channel_reply_rates = updated.channel_reply_rates || {};
      const rates = updated.channel_reply_rates[update.channel] || { attempts: 0, replies: 0 };
      rates.attempts += 1;
      if (update.gotReply) rates.replies += 1;
      updated.channel_reply_rates[update.channel] = rates;
    }

    updated.total_sessions = (updated.total_sessions || 0) + 1;
    updated.last_session_at = now;
    updated.last_updated_at = now;

    await setDoc(memoryRef, updated, { merge: true });
  } catch (error) {
    console.error('[BarryMemory] Failed to update user Barry memory:', error);
  }
}

// ── Context Assembly ─────────────────────────────────────

/**
 * Assemble the full context object Barry needs before starting a session.
 * This is the single function Barry calls to "get smart" before engaging.
 *
 * Returns a structured context object with:
 *   - What Barry knows about this person
 *   - What has been tried and what has worked
 *   - Which questions Barry still needs to ask (vs can infer)
 *   - The current brigade and its behavioral contract
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<Object>} Full Barry session context
 */
export async function assembleBarryContext(userId, contactId) {
  try {
    // Load in parallel for performance
    const [contactSnap, userMemory, recentSessions] = await Promise.all([
      getDoc(doc(db, PEOPLE_PATHS.person(userId, contactId))),
      loadUserBarryMemory(userId),
      loadRecentSessions(userId, contactId, 3)
    ]);

    if (!contactSnap.exists()) {
      return { error: 'Contact not found' };
    }

    const contact = { id: contactSnap.id, ...contactSnap.data() };
    const memory = contact.barry_memory || createBarryMemory();
    const engageSummary = contact.engagement_summary || {};
    const sessionCount = engageSummary.total_sessions || 0;

    // Determine which questions Barry needs to ask vs can infer
    const questionsNeeded = [];
    const inferences = [];

    if (!memory.who_they_are) {
      questionsNeeded.push({
        field: 'who_they_are',
        question: 'Who is this person to you, and what are you trying to achieve with them?',
        required: true
      });
    } else {
      inferences.push({ field: 'who_they_are', value: memory.who_they_are });
    }

    if (!memory.current_goal) {
      questionsNeeded.push({
        field: 'current_goal',
        question: 'What is your goal for this engagement session?',
        required: true
      });
    } else if (sessionCount >= INFERRED_AFTER_HISTORY.current_goal) {
      inferences.push({
        field: 'current_goal',
        value: memory.current_goal,
        note: 'Inferred from last session — confirm or update?'
      });
    }

    if (!contact.brigade) {
      questionsNeeded.push({
        field: 'brigade',
        question: 'To help me calibrate the right approach: is this person a cold prospect, warm prospect, or something else?',
        required: false
      });
    }

    // Assemble what_has_been_tried from memory + recent sessions
    const recentSessionSummaries = recentSessions
      .filter(s => s.session_summary)
      .map(s => `[${s.started_at?.slice(0, 10)}] ${s.session_summary}`);

    return {
      // Person identity
      person: {
        name: contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
        company: contact.company || null,
        title: contact.title || null,
        email: contact.email || null,
        phone: contact.phone || null,
        linkedin_url: contact.linkedin_url || null
      },

      // Relationship context
      relationship: {
        person_type: contact.person_type || 'lead',
        brigade: contact.brigade || null,
        relationship_type: contact.relationship_type || null,
        warmth_level: contact.warmth_level || null,
        strategic_value: contact.strategic_value || null,
        contact_status: contact.contact_status || 'New',
        lead_status: contact.lead_status || null
      },

      // Barry's accumulated knowledge
      memory: {
        who_they_are: memory.who_they_are,
        current_goal: memory.current_goal,
        relationship_summary: memory.relationship_summary,
        what_has_been_tried: memory.what_has_been_tried,
        what_has_worked: memory.what_has_worked,
        what_has_not_worked: memory.what_has_not_worked,
        known_facts: memory.known_facts,
        tone_preference: memory.tone_preference,
        channel_preference: memory.channel_preference || userMemory.preferred_channel
      },

      // Engage state
      engage: {
        status: contact.engage_state?.status || 'never_engaged',
        current_goal: contact.engage_state?.current_goal,
        preferred_channel: contact.engage_state?.preferred_channel,
        channel_blocked: contact.engage_state?.channel_blocked,
        last_session_summary: contact.engage_state?.last_barry_session?.summary,
        last_session_next_step: contact.engage_state?.last_barry_session?.next_step
      },

      // Engagement history stats
      stats: {
        total_sessions: sessionCount,
        total_sent: engageSummary.total_messages_sent || 0,
        total_attempts: engageSummary.total_attempts || 0,
        replies_received: engageSummary.replies_received || 0,
        consecutive_no_replies: engageSummary.consecutive_no_replies || 0,
        last_contact_at: engageSummary.last_contact_at,
        last_outcome: engageSummary.last_outcome,
        channel_history: engageSummary.channel_history || {}
      },

      // Recent session log
      recent_sessions: recentSessionSummaries,

      // Barry's question queue
      questions_needed: questionsNeeded,
      inferences,

      // User preferences (global, across all contacts)
      user_preferences: {
        preferred_tone: userMemory.preferred_tone,
        preferred_channel: userMemory.preferred_channel,
        total_sessions_ever: userMemory.total_sessions
      },

      assembled_at: new Date().toISOString()
    };
  } catch (error) {
    console.error('[BarryMemory] Failed to assemble Barry context:', error);
    return { error: error.message };
  }
}

// ── Outcome Recording ────────────────────────────────────

/**
 * Record the outcome of an engagement attempt (reply received, no reply, etc.).
 * This updates Barry's memory, the engagement summary, and may trigger
 * a brigade transition suggestion.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} outcome
 * @param {string} outcome.result         - 'replied_positive' | 'replied_negative' | 'no_reply' | 'bounced'
 * @param {string} outcome.channel        - Channel the reply came on
 * @param {string} [outcome.sessionId]    - Session this outcome is recording against
 * @param {string} [outcome.notes]        - User notes about the outcome
 * @returns {Promise<{ brigadeTransition: Object|null }>}
 */
export async function recordEngagementOutcome(userId, contactId, outcome) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return { brigadeTransition: null };

    const contact = snap.data();
    const now = new Date().toISOString();
    const memory = contact.barry_memory || createBarryMemory();
    const summary = contact.engagement_summary || {};

    // Update engagement summary
    const gotReply = ['replied_positive', 'replied_negative'].includes(outcome.result);
    const positiveReply = outcome.result === 'replied_positive';

    const updatedSummary = {
      ...summary,
      replies_received: (summary.replies_received || 0) + (gotReply ? 1 : 0),
      positive_replies: (summary.positive_replies || 0) + (positiveReply ? 1 : 0),
      last_outcome: outcome.result,
      last_contact_at: now,
      consecutive_no_replies: outcome.result === 'no_reply'
        ? (summary.consecutive_no_replies || 0) + 1
        : 0  // Reset on any reply
    };

    // Update channel history
    const channelHistory = summary.channel_history || {};
    if (outcome.channel) {
      const ch = channelHistory[outcome.channel] || { attempts: 0, replies: 0 };
      ch.attempts = (ch.attempts || 0);  // Already counted at send time
      ch.replies = (ch.replies || 0) + (gotReply ? 1 : 0);
      channelHistory[outcome.channel] = ch;
    }
    updatedSummary.channel_history = channelHistory;

    // Update Barry memory with what happened
    if (gotReply && positiveReply && outcome.channel) {
      const worked = `${outcome.channel} — positive reply`;
      if (!memory.what_has_worked.includes(worked)) {
        memory.what_has_worked = [...memory.what_has_worked, worked];
      }
      memory.channel_preference = outcome.channel;
    }

    if (outcome.result === 'no_reply' && outcome.channel) {
      const noReply = `${outcome.channel} — no response`;
      if (!memory.what_has_not_worked.includes(noReply)) {
        memory.what_has_not_worked = [...memory.what_has_not_worked, noReply];
      }
    }

    memory.last_updated_at = now;

    await updateDoc(contactRef, {
      engagement_summary: updatedSummary,
      barry_memory: memory,
      'engage_state.status': gotReply ? 'in_progress' : 'awaiting_reply',
      contact_status: gotReply ? 'In Conversation' : 'Awaiting Reply',
      contact_status_updated_at: now,
      updatedAt: now
    });

    // Determine if a brigade transition should be suggested
    const { evaluateBrigadeTransition, BRIGADE_TRANSITION_TRIGGERS } = await import('../data/brigadeSystem.js');
    let brigadeTransition = null;

    if (positiveReply) {
      brigadeTransition = evaluateBrigadeTransition(
        contact.brigade,
        BRIGADE_TRANSITION_TRIGGERS.POSITIVE_REPLY
      );
    } else if (updatedSummary.consecutive_no_replies >= 3) {
      brigadeTransition = evaluateBrigadeTransition(
        contact.brigade,
        BRIGADE_TRANSITION_TRIGGERS.NO_REPLY_3X
      );
    } else if (outcome.result === 'replied_negative') {
      brigadeTransition = evaluateBrigadeTransition(
        contact.brigade,
        BRIGADE_TRANSITION_TRIGGERS.NEGATIVE_REPLY
      );
    }

    return { brigadeTransition: brigadeTransition?.shouldTransition ? brigadeTransition : null };
  } catch (error) {
    console.error('[BarryMemory] Failed to record engagement outcome:', error);
    return { brigadeTransition: null };
  }
}

// ── Engagement Summary Updates ───────────────────────────

/**
 * Increment engagement summary counters.
 * Called at key lifecycle events (session started, message sent, etc.).
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {Object} update
 */
async function updateEngagementSummary(userId, contactId, update) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return;

    const existing = snap.data().engagement_summary || {};
    const now = new Date().toISOString();

    const updated = { ...existing };

    if (update.sessionCompleted) {
      updated.total_sessions = (updated.total_sessions || 0) + 1;
      if (!updated.first_contact_at) updated.first_contact_at = now;
    }

    if (update.messageSent) {
      updated.total_messages_sent = (updated.total_messages_sent || 0) + 1;
      updated.total_attempts = (updated.total_attempts || 0) + 1;
      updated.last_contact_at = now;
      updated.last_message_channel = update.channel;

      // Update channel history
      const ch = updated.channel_history?.[update.channel] || { attempts: 0, replies: 0 };
      ch.attempts = (ch.attempts || 0) + 1;
      updated.channel_history = { ...updated.channel_history, [update.channel]: ch };
    }

    if (update.messagesGenerated) {
      updated.total_messages_generated = (updated.total_messages_generated || 0) + update.messagesGenerated;
    }

    await updateDoc(contactRef, {
      engagement_summary: updated,
      updatedAt: now
    });
  } catch (error) {
    console.error('[BarryMemory] Failed to update engagement summary:', error);
  }
}

// ── Brigade Transitions ──────────────────────────────────

/**
 * Apply a confirmed brigade transition.
 * Creates an immutable log entry and updates the contact.
 * Only called after explicit user confirmation.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} newBrigadeId
 * @param {string} reason - Why the transition happened
 * @param {string} trigger - The event that triggered it
 */
export async function applyBrigadeTransition(userId, contactId, newBrigadeId, reason, trigger) {
  try {
    const contactRef = doc(db, PEOPLE_PATHS.person(userId, contactId));
    const snap = await getDoc(contactRef);
    if (!snap.exists()) return;

    const contact = snap.data();
    const now = new Date().toISOString();
    const previousBrigade = contact.brigade;

    const logEntry = {
      from: previousBrigade || null,
      to: newBrigadeId,
      reason,
      trigger,
      transitioned_at: now
    };

    // Update contact
    const brigadeHistory = Array.isArray(contact.brigade_history)
      ? [...contact.brigade_history, logEntry]
      : [logEntry];

    await updateDoc(contactRef, {
      brigade: newBrigadeId,
      brigade_updated_at: now,
      brigade_history: brigadeHistory,
      updatedAt: now
    });

    // Write immutable log to subcollection
    try {
      const logRef = collection(db, PEOPLE_PATHS.brigadeLog(userId, contactId));
      await addDoc(logRef, {
        ...logEntry,
        createdAt: Timestamp.now()
      });
    } catch {
      // Non-critical — the contact update already succeeded
    }
  } catch (error) {
    console.error('[BarryMemory] Failed to apply brigade transition:', error);
  }
}

// ── Private Helpers ──────────────────────────────────────

function createUserBarryMemory() {
  return {
    preferred_tone: null,
    preferred_channel: null,
    tone_usage: {},
    channel_usage: {},
    channel_reply_rates: {},
    total_sessions: 0,
    last_session_at: null,
    last_updated_at: null
  };
}

function inferChannelPreference(memory, currentChannel) {
  // If we already have a confirmed channel preference (from positive reply), keep it
  if (memory.channel_preference) return memory.channel_preference;

  // If current channel is being tried and has no failures, tentatively prefer it
  const notWorked = memory.what_has_not_worked || [];
  if (currentChannel && !notWorked.some(w => w.startsWith(currentChannel))) {
    return currentChannel;
  }

  return memory.channel_preference;
}

function derivePreferredTone(toneUsage) {
  if (!toneUsage || Object.keys(toneUsage).length === 0) return null;
  return Object.entries(toneUsage).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function derivePreferredChannel(channelUsage) {
  if (!channelUsage || Object.keys(channelUsage).length === 0) return null;
  return Object.entries(channelUsage).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
