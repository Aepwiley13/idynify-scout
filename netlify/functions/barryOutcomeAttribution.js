/**
 * BARRY OUTCOME ATTRIBUTION — Sprint 3: Intelligence Upgrade
 *
 * Closes the learning loop: when an engagement outcome is recorded,
 * Barry traces it back to the guardrail suggestion, warmth inference,
 * and message strategy that preceded it — then updates memory with
 * what worked and what didn't.
 *
 * Called after outcomes are recorded (post-send reply tracking,
 * manual outcome logging). Not on the hot path — runs async.
 *
 * Attribution chain:
 *   1. Load the contact's recent timeline (guardrail events + outcomes)
 *   2. Find the most recent guardrail_response before this outcome
 *   3. Correlate: did the user follow Barry's suggestion? What was the result?
 *   4. Update barry_memory with attribution data
 *   5. Aggregate per-user strategy effectiveness stats
 *
 * No AI calls — pure rule-based attribution from structured timeline data.
 */

import { db } from './firebase-admin.js';
import { logApiUsage } from './utils/logApiUsage.js';

// ── Outcome Classification ──────────────────────────────────────────────────

const POSITIVE_OUTCOMES = ['positive_reply', 'scheduled', 'meeting_booked', 'opportunity_created'];
const NEGATIVE_OUTCOMES = ['no_reply', 'negative_reply', 'not_interested', 'bounced'];
const NEUTRAL_OUTCOMES = ['neutral_reply', 'opened', 'clicked'];

function classifyOutcome(outcome) {
  if (POSITIVE_OUTCOMES.includes(outcome)) return 'positive';
  if (NEGATIVE_OUTCOMES.includes(outcome)) return 'negative';
  if (NEUTRAL_OUTCOMES.includes(outcome)) return 'neutral';
  return 'unknown';
}

// ── Attribution Engine ──────────────────────────────────────────────────────

/**
 * Find the most recent guardrail response for a contact that preceded
 * the given outcome timestamp.
 */
async function findPrecedingGuardrail(userId, contactId, outcomeBefore) {
  try {
    const timelineRef = db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .collection('timeline');

    const snap = await timelineRef
      .where('type', '==', 'barry_guardrail_response')
      .orderBy('timestamp', 'desc')
      .limit(3)
      .get();

    if (snap.empty) return null;

    // Find the most recent guardrail response that happened before the outcome
    for (const doc of snap.docs) {
      const event = doc.data();
      const eventTime = event.timestamp?.toDate?.() || new Date(event.timestamp);
      if (!outcomeBefore || eventTime < outcomeBefore) {
        return {
          id: doc.id,
          guardrail_type: event.metadata?.guardrail_type || event.preview?.split(':')[0]?.trim(),
          action_taken: event.metadata?.action_taken,
          severity: event.metadata?.severity,
          timestamp: eventTime,
          warning_message: event.metadata?.warning_message
        };
      }
    }

    // If no guardrail found before outcome, use the most recent one
    // (outcome timestamp might not be set yet)
    const latest = snap.docs[0].data();
    return {
      id: snap.docs[0].id,
      guardrail_type: latest.metadata?.guardrail_type || null,
      action_taken: latest.metadata?.action_taken || null,
      severity: latest.metadata?.severity || null,
      timestamp: latest.timestamp?.toDate?.() || new Date(latest.timestamp),
      warning_message: latest.metadata?.warning_message || null
    };
  } catch (error) {
    console.error('[OutcomeAttribution] Error finding guardrail:', error.message);
    return null;
  }
}

/**
 * Find the most recent Barry session for this contact to identify
 * the message strategy (angle) that was used.
 */
async function findPrecedingSession(userId, contactId) {
  try {
    const sessionsSnap = await db
      .collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .collection('barry_sessions')
      .orderBy('started_at', 'desc')
      .limit(1)
      .get();

    if (sessionsSnap.empty) return null;

    const session = sessionsSnap.docs[0].data();
    return {
      id: sessionsSnap.docs[0].id,
      selected_angle: session.selected_angle || null,
      generated_message: session.generated_message || null,
      engagement_intent: session.engagement_intent || null,
      channel: session.channel || null,
      started_at: session.started_at
    };
  } catch (_) {
    return null;
  }
}

/**
 * Build attribution record connecting outcome to Barry's prior advice.
 */
function buildAttribution(outcome, outcomeClass, guardrail, session, contact) {
  const attribution = {
    outcome,
    outcome_class: outcomeClass,
    attributed_at: new Date().toISOString(),

    // What Barry suggested
    guardrail_type: guardrail?.guardrail_type || null,
    guardrail_action: guardrail?.action_taken || null,
    guardrail_severity: guardrail?.severity || null,

    // What the user actually did
    strategy_used: session?.selected_angle || null,
    channel_used: session?.channel || null,
    engagement_intent: session?.engagement_intent || contact?.engagement_intent || null,

    // Relationship context at time of outcome
    warmth_at_send: contact?.warmth_level || null,
    relationship_state_at_send: contact?.relationship_state || null,
    known_contact: contact?.known_contact || false,

    // Whether user followed Barry's advice
    followed_advice: null // computed below
  };

  // Determine if user followed Barry's guardrail suggestion
  if (guardrail?.action_taken) {
    const followedActions = ['warm_up', 'reference_history', 'classify_known'];
    const dismissedActions = ['send_anyway', 'skip', 'keep_professional', 'start_fresh', 'classify_prospect'];

    if (followedActions.includes(guardrail.action_taken)) {
      attribution.followed_advice = true;
    } else if (dismissedActions.includes(guardrail.action_taken)) {
      attribution.followed_advice = false;
    }
  }

  return attribution;
}

// ── Memory Updates ──────────────────────────────────────────────────────────

/**
 * Update per-contact Barry memory based on outcome attribution.
 * Adds to what_has_worked or what_has_not_worked lists.
 */
async function updateContactMemory(userId, contactId, attribution) {
  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);

  const updates = {};
  const strategy = attribution.strategy_used;
  const channel = attribution.channel_used;
  const timestamp = new Date().toISOString();

  if (attribution.outcome_class === 'positive' && strategy) {
    // Add to what has worked
    const entry = `${strategy}${channel ? ` via ${channel}` : ''} → ${attribution.outcome}`;
    updates['barry_memory.what_has_worked'] = arrayUnion(entry);
    updates['barry_memory.last_updated_at'] = timestamp;

    // If guardrail advice was followed and outcome was positive, note it
    if (attribution.followed_advice === true && attribution.guardrail_type) {
      const guardrailNote = `Barry suggested "${attribution.guardrail_action}" (${attribution.guardrail_type}) — followed, led to ${attribution.outcome}`;
      updates['barry_memory.known_facts'] = arrayUnion(guardrailNote);
    }
  }

  if (attribution.outcome_class === 'negative' && strategy) {
    const entry = `${strategy}${channel ? ` via ${channel}` : ''} → ${attribution.outcome}`;
    updates['barry_memory.what_has_not_worked'] = arrayUnion(entry);
    updates['barry_memory.last_updated_at'] = timestamp;

    // If guardrail advice was ignored and outcome was negative, note it
    if (attribution.followed_advice === false && attribution.guardrail_type) {
      const guardrailNote = `Barry suggested "${attribution.guardrail_action}" (${attribution.guardrail_type}) — skipped, result was ${attribution.outcome}`;
      updates['barry_memory.known_facts'] = arrayUnion(guardrailNote);
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = timestamp;
    await contactRef.update(updates);
    return true;
  }

  return false;
}

/**
 * Update per-user strategy effectiveness stats.
 * Aggregates: which guardrail actions lead to positive outcomes?
 * Which angles/channels have the best results?
 */
async function updateUserStats(userId, attribution) {
  const statsRef = db.collection('users').doc(userId)
    .collection('barry_memory').doc('strategy_stats');

  const statsSnap = await statsRef.get();
  const stats = statsSnap.exists ? statsSnap.data() : {
    guardrail_outcomes: {},
    angle_outcomes: {},
    channel_outcomes: {},
    total_attributions: 0,
    last_updated_at: null
  };

  // Track guardrail action outcomes
  if (attribution.guardrail_action) {
    const key = attribution.guardrail_action;
    if (!stats.guardrail_outcomes[key]) {
      stats.guardrail_outcomes[key] = { positive: 0, negative: 0, neutral: 0, total: 0 };
    }
    stats.guardrail_outcomes[key][attribution.outcome_class] =
      (stats.guardrail_outcomes[key][attribution.outcome_class] || 0) + 1;
    stats.guardrail_outcomes[key].total += 1;
  }

  // Track angle/strategy outcomes
  if (attribution.strategy_used) {
    const key = attribution.strategy_used;
    if (!stats.angle_outcomes[key]) {
      stats.angle_outcomes[key] = { positive: 0, negative: 0, neutral: 0, total: 0 };
    }
    stats.angle_outcomes[key][attribution.outcome_class] =
      (stats.angle_outcomes[key][attribution.outcome_class] || 0) + 1;
    stats.angle_outcomes[key].total += 1;
  }

  // Track channel outcomes
  if (attribution.channel_used) {
    const key = attribution.channel_used;
    if (!stats.channel_outcomes[key]) {
      stats.channel_outcomes[key] = { positive: 0, negative: 0, neutral: 0, total: 0 };
    }
    stats.channel_outcomes[key][attribution.outcome_class] =
      (stats.channel_outcomes[key][attribution.outcome_class] || 0) + 1;
    stats.channel_outcomes[key].total += 1;
  }

  stats.total_attributions += 1;
  stats.last_updated_at = new Date().toISOString();

  await statsRef.set(stats, { merge: true });
  return stats;
}

// Firestore arrayUnion helper for Admin SDK
function arrayUnion(value) {
  const { FieldValue } = require('firebase-admin/firestore');
  return FieldValue.arrayUnion(value);
}

// ── Main Attribution Function ───────────────────────────────────────────────

/**
 * Run outcome attribution for a single contact engagement.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {string} outcome - The engagement outcome ('positive_reply', 'no_reply', etc.)
 * @param {Date} [outcomeTimestamp] - When the outcome occurred
 * @returns {Promise<Object>} { attributed: boolean, attribution: Object }
 */
async function runAttribution(userId, contactId, outcome, outcomeTimestamp) {
  // Load contact data
  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);
  const contactSnap = await contactRef.get();

  if (!contactSnap.exists) {
    return { attributed: false, attribution: null, reason: 'contact_not_found' };
  }

  const contact = { id: contactSnap.id, ...contactSnap.data() };
  const outcomeClass = classifyOutcome(outcome);

  // Find the guardrail response and session that preceded this outcome
  const [guardrail, session] = await Promise.all([
    findPrecedingGuardrail(userId, contactId, outcomeTimestamp),
    findPrecedingSession(userId, contactId)
  ]);

  // Build attribution record
  const attribution = buildAttribution(outcome, outcomeClass, guardrail, session, contact);

  // Deduplication check: prevent duplicate attributions for the same outcome + session
  const dedupKey = `${outcome}_${session?.id || 'no_session'}_${guardrail?.id || 'no_guardrail'}`;
  const existingSnap = await contactRef.collection('barry_attributions')
    .where('dedup_key', '==', dedupKey)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    console.log(`[OutcomeAttribution] Duplicate attribution skipped: ${dedupKey}`);
    return { attributed: false, attribution: null, reason: 'duplicate' };
  }

  // Store attribution record
  await contactRef.collection('barry_attributions').add({
    ...attribution,
    dedup_key: dedupKey,
    created_at: new Date().toISOString()
  });

  // Update memory and stats in parallel
  const [memoryUpdated] = await Promise.all([
    updateContactMemory(userId, contactId, attribution),
    updateUserStats(userId, attribution)
  ]);

  return {
    attributed: true,
    attribution,
    memory_updated: memoryUpdated
  };
}

// ── Netlify Function Handler ─────────────────────────────────────────────────

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const startTime = Date.now();

  try {
    const { userId, authToken, contactId, outcome } = JSON.parse(event.body);

    if (!userId || !authToken || !contactId || !outcome) {
      throw new Error('Missing required parameters: userId, authToken, contactId, outcome');
    }

    // Verify Firebase Auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyRes.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyRes.json();
    if (!verifyData.users || verifyData.users[0].localId !== userId) {
      throw new Error('Token does not match userId');
    }

    // Run attribution
    const result = await runAttribution(userId, contactId, outcome);

    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'barryOutcomeAttribution', 'success', {
      responseTime,
      metadata: {
        contactId,
        outcome,
        attributed: result.attributed,
        followed_advice: result.attribution?.followed_advice,
        memory_updated: result.memory_updated
      }
    });

    console.log(`[barryOutcomeAttribution] ${result.attributed ? 'Attributed' : 'Skipped'} outcome=${outcome} for contact=${contactId} (${responseTime}ms)`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        attributed: result.attributed,
        attribution: result.attribution,
        memory_updated: result.memory_updated
      })
    };

  } catch (error) {
    console.error('[barryOutcomeAttribution] Error:', error.message);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        await logApiUsage(userId, 'barryOutcomeAttribution', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: error.message,
          metadata: {}
        });
      }
    } catch (_) {}

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
