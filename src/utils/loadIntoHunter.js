/**
 * loadIntoHunter.js — Mission Control → Hunter bridge.
 *
 * Two paths:
 *   A. Contact has an active mission  → write draft_override to current step
 *   B. Contact has no active mission  → createMissionFromChat (creates mission + updates contact)
 *
 * Returns:
 *   { success: true, missionId, stepIdx, contactName }           — path A (updated existing)
 *   { success: true, created: true, missionId, contactName }     — path B (new mission created)
 *   { success: false, error, contactName? }                       — failure
 */

import { doc, getDoc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '../firebase/config';

// Map relationship_state → first-contact outcome_goal (mirrors PROGRESSION in nextOutcomeGoal.js)
const DEFAULT_OUTCOME_GOALS = {
  unaware:           'enter_conversation',
  aware:             'build_rapport',
  engaged:           'deepen_conversation',
  warm:              'schedule_meeting',
  trusted:           'get_introduction',
  advocate:          'ask_for_referral',
  dormant:           'reconnect',
  strained:          'rebuild_relationship',
  strategic_partner: 'strategic_alignment'
};

// ── Path B: create a minimal mission from a Mission Control draft ─────────────

async function createMissionFromChat({ contactId, contactData, subject, message, angleId, userId }) {
  const contactName = contactData.name || contactData.first_name || 'Contact';
  const outcome_goal = DEFAULT_OUTCOME_GOALS[contactData.relationship_state] || 'enter_conversation';
  const now = new Date().toISOString();

  const mission = {
    contactId,
    outcome_goal,
    engagement_style: 'moderate',
    source: 'mission_control',
    status: 'active',
    created_at: now,
    updated_at: now,
    steps: [
      {
        step_number: 1,
        label: 'Send intro message',
        status: 'current',
        draft: {
          subject: subject || '',
          message: message || '',
          selected_angle: angleId || null,
          source: 'mission_control',
          generated_at: now
        }
      }
    ]
  };

  const missionRef = await addDoc(
    collection(db, 'users', userId, 'missions'),
    mission
  );

  await updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
    hunter_status: 'active_mission',
    active_mission_id: missionRef.id,
    engaged_at: now,
    updated_at: now
  });

  return { success: true, created: true, missionId: missionRef.id, contactName };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function loadIntoHunter({ contactId, subject, message, angleId, userId }) {
  if (!contactId || !userId) {
    return { success: false, error: 'Missing contactId or userId' };
  }

  try {
    // 1. Load contact to get active_mission_id + relationship state
    const contactDoc = await getDoc(doc(db, 'users', userId, 'contacts', contactId));
    if (!contactDoc.exists()) return { success: false, error: 'Contact not found' };

    const contact = contactDoc.data();
    const contactName = contact.name || contact.first_name || 'Contact';
    const missionId = contact.active_mission_id;

    // Path B — no active mission, create one from this chat draft
    if (!missionId) {
      return createMissionFromChat({
        contactId,
        contactData: contact,
        subject,
        message,
        angleId,
        userId
      });
    }

    // Path A — write draft_override to the current mission step
    const missionDoc = await getDoc(doc(db, 'users', userId, 'missions', missionId));
    if (!missionDoc.exists()) return { success: false, error: 'Mission not found', contactName };

    const mission = missionDoc.data();
    const stepIdx = (mission.steps || []).findIndex(s => s.status === 'current');
    const activeStepIdx = stepIdx >= 0 ? stepIdx : 0;

    const updatePath = {};
    updatePath[`steps.${activeStepIdx}.draft_override`] = {
      subject: subject || '',
      message: message || '',
      angle_id: angleId || null,
      source: 'mission_control',
      loaded_at: new Date().toISOString()
    };
    updatePath['updated_at'] = new Date().toISOString();

    await updateDoc(doc(db, 'users', userId, 'missions', missionId), updatePath);

    return { success: true, missionId, stepIdx: activeStepIdx, contactName };

  } catch (err) {
    console.error('[loadIntoHunter] Error:', err);
    return { success: false, error: err.message };
  }
}
