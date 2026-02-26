/**
 * loadIntoHunter.js — Mission Control → Hunter bridge.
 *
 * When a user generates a message in Mission Control and taps
 * "Load into Hunter", this writes the draft directly to the contact's
 * active mission's current step as a `draft_override`.
 *
 * The MissionCard in Hunter will show this override prominently,
 * letting the user edit and send from Hunter's interface.
 *
 * Returns:
 *   { success: true, missionId, stepIdx, contactName } on success
 *   { success: false, error, contactName? }             on failure
 *
 * Error 'no_active_mission': contact exists but has no active mission.
 *   → Surface this to the user: "Engage [name] from the deck first."
 */

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export async function loadIntoHunter({ contactId, subject, message, angleId, userId }) {
  if (!contactId || !userId) {
    return { success: false, error: 'Missing contactId or userId' };
  }

  try {
    // 1. Load contact to get active_mission_id
    const contactDoc = await getDoc(doc(db, 'users', userId, 'contacts', contactId));
    if (!contactDoc.exists()) return { success: false, error: 'Contact not found' };

    const contact = contactDoc.data();
    const contactName = contact.name || contact.first_name || 'Contact';
    const missionId = contact.active_mission_id;

    if (!missionId) {
      return { success: false, error: 'no_active_mission', contactName };
    }

    // 2. Load mission to find the current step index
    const missionDoc = await getDoc(doc(db, 'users', userId, 'missions', missionId));
    if (!missionDoc.exists()) return { success: false, error: 'Mission not found', contactName };

    const mission = missionDoc.data();
    const stepIdx = (mission.steps || []).findIndex(s => s.status === 'current');
    const activeStepIdx = stepIdx >= 0 ? stepIdx : 0;

    // 3. Write the draft override to the current mission step
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
