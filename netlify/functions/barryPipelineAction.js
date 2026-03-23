/**
 * barryPipelineAction.js — Barry's pipeline mutation layer.
 *
 * Gives Barry the ability to take real actions on contacts and missions
 * directly from Mission Control chat:
 *
 *   engage_contact      — Create a mission + move to Hunter
 *   move_stage          — Move contact to any stage (scout/hunter/sniper/basecamp/fallback)
 *   complete_step       — Mark a mission step done and advance to next
 *   log_outcome         — Record what happened in a call / meeting / interaction
 *   update_status       — Update contact_status field only
 *   add_note            — Append a sticky note to a contact's profile
 *   archive_contact     — Archive a contact
 *
 * Auth: same Firebase Identity Toolkit verify pattern as barryActions.js
 * Writes: Firebase Admin SDK (same as barryMissionChat.js)
 *
 * POST /.netlify/functions/barryPipelineAction
 */

import { db } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logApiUsage } from './utils/logApiUsage.js';

// ── Auth verification (mirrors barryActions.js) ───────────────────────────────

async function verifyAuth(userId, authToken) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!firebaseApiKey) throw new Error('Firebase API key not configured');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: authToken })
    }
  );
  if (!res.ok) throw new Error('Invalid authentication token');
  const data = await res.json();
  if (!data.users || data.users[0].localId !== userId) throw new Error('Token/userId mismatch');
}

// ── Outcome goal defaults by relationship state (mirrors barryHunterProcessEngage.js) ──

const DEFAULT_OUTCOME_GOALS = {
  unaware:           'enter_conversation',
  aware:             'build_rapport',
  engaged:           'schedule_meeting',
  warm:              'schedule_meeting',
  trusted:           'get_introduction',
  advocate:          'ask_for_referral',
  dormant:           'reconnect',
  strained:          'rebuild_relationship',
  strategic_partner: 'expand_relationship'
};

// ── Stage → contact_status coercion ──────────────────────────────────────────

const STAGE_STATUS_MAP = {
  hunter:   'Engaged',
  sniper:   'In Conversation',
  basecamp: 'Active Customer',
  fallback: 'Dormant',
  scout:    null  // no forced status change when moving back to scout
};

// ── Action: engage_contact ────────────────────────────────────────────────────

async function engageContact(userId, contactId) {
  const userRef = db.collection('users').doc(userId);
  const contactRef = userRef.collection('contacts').doc(contactId);

  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) throw new Error('contact_not_found');

  const contact = contactSnap.data();
  const now = new Date().toISOString();
  const outcomeGoal = DEFAULT_OUTCOME_GOALS[contact.relationship_state] || 'enter_conversation';
  const fromStage = contact.stage || 'scout';

  // Create a minimal mission (mirrors createMissionFromChat in loadIntoHunter.js)
  const mission = {
    contactId,
    outcome_goal: outcomeGoal,
    engagement_style: 'moderate',
    source: 'mission_control_chat',
    status: 'active',
    created_at: now,
    updated_at: now,
    steps: [
      {
        step_number: 1,
        label: 'Send intro message',
        status: 'current',
        draft: null,
        sent_at: null,
        outcome: null,
        completed_at: null
      }
    ]
  };

  const missionRef = await userRef.collection('missions').add(mission);

  const contactUpdate = {
    hunter_status: 'active_mission',
    active_mission_id: missionRef.id,
    stage: 'hunter',
    contact_status: 'Engaged',
    contact_status_updated_at: FieldValue.serverTimestamp(),
    engaged_at: now,
    last_interaction_at: FieldValue.serverTimestamp(),
    updated_at: now
  };

  await contactRef.update(contactUpdate);

  return {
    missionId: missionRef.id,
    updated_fields: {
      hunter_status: 'active_mission',
      active_mission_id: missionRef.id,
      stage: 'hunter',
      contact_status: 'Engaged'
    },
    context: { from_stage: fromStage, outcome_goal: outcomeGoal }
  };
}

// ── Action: move_stage ────────────────────────────────────────────────────────

async function moveStage(userId, contactId, params) {
  const { to_stage, reason } = params;
  if (!to_stage) throw new Error('to_stage is required');

  const validStages = ['scout', 'hunter', 'sniper', 'basecamp', 'fallback'];
  if (!validStages.includes(to_stage)) throw new Error(`Invalid stage: ${to_stage}`);

  const userRef = db.collection('users').doc(userId);
  const contactRef = userRef.collection('contacts').doc(contactId);

  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) throw new Error('contact_not_found');

  const contact = contactSnap.data();
  const fromStage = contact.stage || 'scout';

  const contactUpdate = {
    stage: to_stage,
    stage_updated_at: FieldValue.serverTimestamp(),
    updated_at: new Date().toISOString()
  };

  // Apply stage-specific status coercion
  const newStatus = STAGE_STATUS_MAP[to_stage];
  if (newStatus) {
    contactUpdate.contact_status = newStatus;
    contactUpdate.contact_status_updated_at = FieldValue.serverTimestamp();
  }

  await contactRef.update(contactUpdate);

  // Write stage history record
  await contactRef.collection('stageHistory').add({
    from_stage: fromStage,
    to_stage,
    reason: reason || 'barry_chat',
    changed_at: FieldValue.serverTimestamp(),
    changed_by: 'barry'
  });

  const updatedFields = { stage: to_stage };
  if (newStatus) updatedFields.contact_status = newStatus;

  return { updated_fields: updatedFields, context: { from_stage: fromStage } };
}

// ── Action: complete_mission_step ─────────────────────────────────────────────

async function completeMissionStep(userId, contactId, params) {
  const { missionId, step_number, outcome, note } = params;

  const userRef = db.collection('users').doc(userId);
  const contactRef = userRef.collection('contacts').doc(contactId);

  // Resolve mission: use provided missionId or look up active_mission_id from contact
  let resolvedMissionId = missionId;
  if (!resolvedMissionId) {
    const contactSnap = await contactRef.get();
    if (!contactSnap.exists) throw new Error('contact_not_found');
    resolvedMissionId = contactSnap.data().active_mission_id;
  }
  if (!resolvedMissionId) throw new Error('no_active_mission');

  const missionRef = userRef.collection('missions').doc(resolvedMissionId);
  const missionSnap = await missionRef.get();
  if (!missionSnap.exists) throw new Error('mission_not_found');

  const mission = missionSnap.data();
  const steps = Array.isArray(mission.steps) ? [...mission.steps] : [];

  // Find the step to complete (by step_number, or the current one)
  const targetStepNum = step_number || steps.findIndex(s => s.status === 'current') + 1 || 1;
  const stepIdx = steps.findIndex(s => s.step_number === targetStepNum || (steps.indexOf(s) + 1) === targetStepNum);

  if (stepIdx === -1) throw new Error('step_not_found');

  const now = new Date().toISOString();
  steps[stepIdx] = {
    ...steps[stepIdx],
    status: 'completed',
    outcome: outcome || 'sent',
    barry_note: note || null,
    completed_at: now
  };

  // Advance next step to 'current' if it exists
  const nextIdx = stepIdx + 1;
  let missionStatus = mission.status;
  if (nextIdx < steps.length) {
    steps[nextIdx] = { ...steps[nextIdx], status: 'current' };
  } else {
    missionStatus = 'completed';
  }

  await missionRef.update({
    steps,
    status: missionStatus,
    updated_at: now
  });

  // Update contact
  const contactUpdate = {
    last_outcome: outcome || 'sent',
    last_interaction_at: FieldValue.serverTimestamp(),
    updated_at: now
  };
  if (missionStatus === 'completed') {
    contactUpdate.hunter_status = 'none';
  }

  await contactRef.update(contactUpdate);

  return {
    updated_fields: { last_outcome: outcome || 'sent' },
    context: {
      mission_status: missionStatus,
      step_completed: targetStepNum,
      next_step: nextIdx < steps.length ? nextIdx + 1 : null
    }
  };
}

// ── Action: log_outcome ───────────────────────────────────────────────────────

async function logOutcome(userId, contactId, params) {
  const { outcome, notes, status_update } = params;
  if (!outcome) throw new Error('outcome is required');

  const userRef = db.collection('users').doc(userId);
  const contactRef = userRef.collection('contacts').doc(contactId);

  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) throw new Error('contact_not_found');

  const now = new Date().toISOString();
  const contactUpdate = {
    last_outcome: outcome,
    last_outcome_at: FieldValue.serverTimestamp(),
    last_interaction_at: FieldValue.serverTimestamp(),
    updated_at: now
  };

  if (status_update) {
    contactUpdate.contact_status = status_update;
    contactUpdate.contact_status_updated_at = FieldValue.serverTimestamp();
  }

  await contactRef.update(contactUpdate);

  // Write to outcome log subcollection
  await contactRef.collection('outcomeLog').add({
    outcome,
    notes: notes || null,
    logged_at: FieldValue.serverTimestamp(),
    logged_by: 'barry'
  });

  const updatedFields = { last_outcome: outcome };
  if (status_update) updatedFields.contact_status = status_update;

  return { updated_fields: updatedFields };
}

// ── Action: update_status ─────────────────────────────────────────────────────

async function updateStatus(userId, contactId, params) {
  const { contact_status } = params;
  if (!contact_status) throw new Error('contact_status is required');

  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);
  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) throw new Error('contact_not_found');

  await contactRef.update({
    contact_status,
    contact_status_updated_at: FieldValue.serverTimestamp(),
    updated_at: new Date().toISOString()
  });

  return { updated_fields: { contact_status } };
}

// ── Action: add_note ──────────────────────────────────────────────────────────

async function addNote(userId, contactId, params) {
  const { note } = params;
  if (!note) throw new Error('note text is required');

  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);
  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) throw new Error('contact_not_found');

  const newNote = {
    text: note,
    created_at: new Date().toISOString(),
    source: 'barry_chat'
  };

  await contactRef.update({
    sticky_notes: FieldValue.arrayUnion(newNote),
    updated_at: new Date().toISOString()
  });

  return { updated_fields: { sticky_notes: 'appended' } };
}

// ── Action: archive_contact ───────────────────────────────────────────────────

async function archiveContact(userId, contactId) {
  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contactId);
  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) throw new Error('contact_not_found');

  await contactRef.update({
    is_archived: true,
    archived_at: FieldValue.serverTimestamp(),
    archived_reason: 'barry_chat',
    updated_at: new Date().toISOString()
  });

  return { updated_fields: { is_archived: true } };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
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
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const startTime = Date.now();
  let userId;

  try {
    const body = JSON.parse(event.body);
    userId = body.userId;
    const { authToken, action_type, contactId, params = {} } = body;

    if (!userId || !authToken) throw new Error('Missing userId or authToken');
    if (!action_type) throw new Error('Missing action_type');
    if (!contactId && action_type !== 'organize_pipeline') throw new Error('Missing contactId');

    await verifyAuth(userId, authToken);

    let result;

    switch (action_type) {
      case 'engage_contact':
        result = await engageContact(userId, contactId);
        break;
      case 'move_stage':
        result = await moveStage(userId, contactId, params);
        break;
      case 'complete_step':
        result = await completeMissionStep(userId, contactId, params);
        break;
      case 'log_outcome':
        result = await logOutcome(userId, contactId, params);
        break;
      case 'update_status':
        result = await updateStatus(userId, contactId, params);
        break;
      case 'add_note':
        result = await addNote(userId, contactId, params);
        break;
      case 'archive_contact':
        result = await archiveContact(userId, contactId);
        break;
      default:
        throw new Error(`Unknown action_type: ${action_type}`);
    }

    await logApiUsage(userId, 'barryPipelineAction', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { action_type, contactId }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        contactId,
        action_type,
        ...result
      })
    };

  } catch (err) {
    console.error('[barryPipelineAction] Error:', err.message);

    const isNotFound = err.message === 'contact_not_found' || err.message === 'mission_not_found';

    try {
      if (userId) {
        await logApiUsage(userId, 'barryPipelineAction', 'error', {
          responseTime: Date.now() - startTime,
          errorCode: err.message
        });
      }
    } catch (_) {}

    return {
      statusCode: isNotFound ? 404 : 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
