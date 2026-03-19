/**
 * INFER RELATIONSHIP WARMTH — Sprint 1: Barry Intelligence Upgrade
 *
 * Auto-infers relationship warmth from behavioral signals in Firestore.
 * Called after timeline writes (not on every contact load) to avoid frontend cost.
 *
 * Signals used (internal only — no Gmail scope expansion):
 *   1. Contact source: manually added contacts are flagged as known_contact
 *   2. Engagement outcomes: replies → elevate relationship_state; positive replies → warmth
 *   3. Timeline/session history: consecutive no-replies → suggest dormant
 *   4. Mission outcomes: prior positive outcomes → advance relationship_state
 *
 * Rules:
 *   - User-set values always take priority over inferred values
 *   - Inferred values written with source: "barry_inferred" flag
 *   - Barry defers silently but surfaces a notice via barry_warmth_suggestion
 *     for the UI to render in the engage panel
 *   - Angle selection does NOT inform warmth (per design decision — stylistic, not relational)
 */

import { db } from './firebase-admin.js';
import { logApiUsage } from './utils/logApiUsage.js';

// ── Inference Rules ──────────────────────────────────────────────────────────

/**
 * Determine if a contact was manually added (known to the user personally).
 * Uses addedFrom field and enrichment_provenance as signals.
 */
function inferKnownContact(contact) {
  // Direct signal: addedFrom === 'manual' or 'business_card'
  if (contact.addedFrom === 'manual' || contact.addedFrom === 'business_card') {
    return true;
  }

  // Provenance signal: if all key identity fields were manually entered
  const prov = contact.enrichment_provenance;
  if (prov) {
    const manualFields = ['email', 'phone', 'linkedin_url', 'name'].filter(
      f => prov[f] === 'manual'
    );
    // If 3+ identity fields were manually entered, likely a known contact
    if (manualFields.length >= 3) {
      return true;
    }
  }

  return false;
}

/**
 * Infer relationship_state from engagement history.
 * Returns the minimum relationship_state Barry believes this contact should be at.
 */
function inferRelationshipState(contact, recentSessions) {
  const summary = contact.engagement_summary || {};
  const currentState = contact.relationship_state;

  // Positive replies → at least 'engaged'
  if (summary.positive_replies > 0) {
    const minState = summary.positive_replies >= 3 ? 'warm' : 'engaged';
    return { state: minState, reason: `${summary.positive_replies} positive reply(s) recorded` };
  }

  // Any reply → at least 'aware'
  if (summary.replies_received > 0) {
    return { state: 'engaged', reason: `${summary.replies_received} reply(s) received` };
  }

  // Messages sent but consecutive no-replies → suggest dormant if was previously engaged
  if (summary.consecutive_no_replies >= 3 && isAtLeast(currentState, 'engaged')) {
    return { state: 'dormant', reason: `${summary.consecutive_no_replies} consecutive messages with no reply` };
  }

  // Messages sent → at least 'aware'
  if (summary.total_messages_sent > 0) {
    return { state: 'aware', reason: `${summary.total_messages_sent} message(s) sent` };
  }

  // Check session history for outcomes
  const positiveSessionCount = recentSessions.filter(
    s => s.outcome === 'message_sent'
  ).length;

  if (positiveSessionCount > 0) {
    return { state: 'aware', reason: `${positiveSessionCount} engagement session(s) completed` };
  }

  return null; // No signal strong enough to infer
}

/**
 * Infer warmth_level from engagement patterns.
 * Returns the minimum warmth_level Barry believes this contact should be at.
 */
function inferWarmthLevel(contact, isKnown) {
  const summary = contact.engagement_summary || {};
  const currentWarmth = contact.warmth_level;

  // Known contacts start at 'warm' minimum
  if (isKnown && (!currentWarmth || currentWarmth === 'cold')) {
    return { level: 'warm', reason: 'Contact was added manually — likely a known relationship' };
  }

  // Multiple positive replies → hot
  if (summary.positive_replies >= 3) {
    return { level: 'hot', reason: `${summary.positive_replies} positive replies — active, responsive relationship` };
  }

  // Any positive reply → at least warm
  if (summary.positive_replies > 0) {
    return { level: 'warm', reason: 'Positive reply received — relationship has traction' };
  }

  // Active conversation status → at least warm
  if (contact.contact_status === 'In Conversation') {
    return { level: 'warm', reason: 'Currently in active conversation' };
  }

  return null; // No signal strong enough to infer
}

// ── Relationship State Ordering ──────────────────────────────────────────────

const STATE_ORDER = [
  'unaware', 'aware', 'engaged', 'warm', 'trusted', 'advocate', 'strategic_partner'
];
// Special states not in the linear order
const SPECIAL_STATES = ['dormant', 'strained'];

function isAtLeast(currentState, targetState) {
  if (!currentState) return false;
  const currentIdx = STATE_ORDER.indexOf(currentState);
  const targetIdx = STATE_ORDER.indexOf(targetState);
  if (currentIdx === -1 || targetIdx === -1) return false;
  return currentIdx >= targetIdx;
}

function isHigherState(proposed, current) {
  if (!current) return true;
  if (SPECIAL_STATES.includes(proposed)) return false; // Never auto-advance to special states via comparison
  const proposedIdx = STATE_ORDER.indexOf(proposed);
  const currentIdx = STATE_ORDER.indexOf(current);
  if (proposedIdx === -1) return false;
  if (currentIdx === -1) return true; // Current is special state, proposed is linear — allow
  return proposedIdx > currentIdx;
}

const WARMTH_ORDER = ['cold', 'warm', 'hot'];

function isHigherWarmth(proposed, current) {
  if (!current) return true;
  return WARMTH_ORDER.indexOf(proposed) > WARMTH_ORDER.indexOf(current);
}

// ── Main Inference Engine ────────────────────────────────────────────────────

/**
 * Run relationship warmth inference for a single contact.
 * Reads behavioral signals, computes inferred values, and writes back
 * only when inferred values would advance the relationship (never regress).
 *
 * @param {string} userId
 * @param {string} contactId
 * @returns {Promise<Object>} { updated: boolean, changes: Object, suggestion: Object|null }
 */
async function runInference(userId, contactId) {
  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);
  const contactSnap = await contactRef.get();

  if (!contactSnap.exists) {
    return { updated: false, changes: {}, suggestion: null };
  }

  const contact = { id: contactSnap.id, ...contactSnap.data() };

  // Load recent Barry sessions for history context
  let recentSessions = [];
  try {
    const sessionsSnap = await contactRef
      .collection('barry_sessions')
      .orderBy('started_at', 'desc')
      .limit(5)
      .get();
    recentSessions = sessionsSnap.docs.map(d => d.data());
  } catch (_) {
    // Non-fatal — proceed with empty sessions
  }

  const changes = {};
  let suggestion = null;

  // 1. Infer known_contact
  const isKnown = inferKnownContact(contact);
  if (isKnown && !contact.known_contact) {
    changes.known_contact = true;
    changes.known_contact_source = 'barry_inferred';
  }

  // 2. Infer relationship_state
  const stateInference = inferRelationshipState(contact, recentSessions);
  if (stateInference) {
    const userSetState = contact.relationship_state_source === 'user_set';

    if (userSetState) {
      // User has explicitly set this — Barry defers but may suggest
      if (isHigherState(stateInference.state, contact.relationship_state)) {
        suggestion = {
          field: 'relationship_state',
          current: contact.relationship_state,
          suggested: stateInference.state,
          reason: stateInference.reason,
          message: `I think this relationship may be further along than marked — ${stateInference.reason}. Want to update it?`
        };
      }
    } else {
      // No user-set value or previously inferred — safe to update
      if (isHigherState(stateInference.state, contact.relationship_state)) {
        changes.relationship_state = stateInference.state;
        changes.relationship_state_source = 'barry_inferred';
        changes.relationship_state_inferred_at = new Date().toISOString();
        changes.relationship_state_inference_reason = stateInference.reason;
      }

      // Special case: dormant (regression) — only apply if not user-set
      if (stateInference.state === 'dormant' && !userSetState &&
          contact.relationship_state !== 'dormant') {
        changes.relationship_state = 'dormant';
        changes.relationship_state_source = 'barry_inferred';
        changes.relationship_state_inferred_at = new Date().toISOString();
        changes.relationship_state_inference_reason = stateInference.reason;
      }
    }
  }

  // 3. Infer warmth_level
  const warmthInference = inferWarmthLevel(contact, isKnown);
  if (warmthInference) {
    const userSetWarmth = contact.warmth_level_source === 'user_set';

    if (userSetWarmth) {
      // User has explicitly set this — Barry defers but may suggest
      if (isHigherWarmth(warmthInference.level, contact.warmth_level)) {
        // Only create suggestion if we don't already have one (prefer relationship_state suggestion)
        if (!suggestion) {
          suggestion = {
            field: 'warmth_level',
            current: contact.warmth_level,
            suggested: warmthInference.level,
            reason: warmthInference.reason,
            message: `I think this relationship may be warmer than marked — ${warmthInference.reason}. Want to update it?`
          };
        }
      }
    } else {
      if (isHigherWarmth(warmthInference.level, contact.warmth_level)) {
        changes.warmth_level = warmthInference.level;
        changes.warmth_level_source = 'barry_inferred';
        changes.warmth_level_inferred_at = new Date().toISOString();
        changes.warmth_level_inference_reason = warmthInference.reason;
      }
    }
  }

  // 4. Infer engagementIntent from relationship signals (if not set)
  if (!contact.engagement_intent && !contact.engagementIntent) {
    if (isKnown) {
      changes.engagement_intent = 'warm';
      changes.engagement_intent_source = 'barry_inferred';
    } else if (contact.person_type === 'customer') {
      changes.engagement_intent = 'customer';
      changes.engagement_intent_source = 'barry_inferred';
    } else if (contact.person_type === 'partner') {
      changes.engagement_intent = 'partner';
      changes.engagement_intent_source = 'barry_inferred';
    }
  }

  // Write changes if any
  if (Object.keys(changes).length > 0) {
    changes.updatedAt = new Date().toISOString();

    // Write suggestion to contact doc so UI can render it in engage panel
    if (suggestion) {
      changes.barry_warmth_suggestion = suggestion;
    }

    await contactRef.update(changes);
    return { updated: true, changes, suggestion };
  }

  // Even if no field changes, write suggestion if present
  if (suggestion) {
    await contactRef.update({
      barry_warmth_suggestion: suggestion,
      updatedAt: new Date().toISOString()
    });
    return { updated: true, changes: { barry_warmth_suggestion: suggestion }, suggestion };
  }

  return { updated: false, changes: {}, suggestion: null };
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
    const { userId, authToken, contactId } = JSON.parse(event.body);

    if (!userId || !authToken || !contactId) {
      throw new Error('Missing required parameters: userId, authToken, contactId');
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

    // Run inference
    const result = await runInference(userId, contactId);

    const responseTime = Date.now() - startTime;
    await logApiUsage(userId, 'inferRelationshipWarmth', 'success', {
      responseTime,
      metadata: {
        contactId,
        updated: result.updated,
        changedFields: Object.keys(result.changes),
        hasSuggestion: !!result.suggestion
      }
    });

    console.log(`[inferRelationshipWarmth] ${result.updated ? 'Updated' : 'No changes'} for contact=${contactId} (${responseTime}ms)`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        updated: result.updated,
        changes: result.changes,
        suggestion: result.suggestion
      })
    };

  } catch (error) {
    console.error('[inferRelationshipWarmth] Error:', error.message);

    try {
      const { userId } = JSON.parse(event.body);
      if (userId) {
        await logApiUsage(userId, 'inferRelationshipWarmth', 'error', {
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
