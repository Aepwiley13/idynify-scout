/**
 * loadIntoHunter.js — Save a Barry-generated outreach draft to a contact's profile.
 *
 * Replaces the previous mission-creation flow. The draft is written directly to the
 * contact document so it's immediately visible in Command Center / contact profiles.
 * No mission or Hunter navigation required — everything stays in the chat.
 *
 * Fields written to contact:
 *   outreach_queued        — true (flag for contact list views)
 *   queued_subject         — email subject line
 *   queued_message         — email body
 *   queued_angle           — angle id (value_add / direct_ask / etc.)
 *   queued_at              — ISO timestamp
 *   outreach_source        — 'mission_control'
 *   updated_at             — ISO timestamp
 *
 * Returns:
 *   { success: true, contactName }   — saved successfully
 *   { success: false, error }        — failure
 */

import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export async function loadIntoHunter({ contactId, subject, message, angleId, userId }) {
  if (!contactId || !userId) {
    return { success: false, error: 'Missing contactId or userId' };
  }

  try {
    const contactDoc = await getDoc(doc(db, 'users', userId, 'contacts', contactId));
    if (!contactDoc.exists()) return { success: false, error: 'Contact not found' };

    const contact = contactDoc.data();
    const contactName = contact.name || contact.first_name || 'Contact';

    await updateDoc(doc(db, 'users', userId, 'contacts', contactId), {
      outreach_queued: true,
      queued_subject: subject || '',
      queued_message: message || '',
      queued_angle: angleId || null,
      queued_at: new Date().toISOString(),
      outreach_source: 'mission_control',
      updated_at: new Date().toISOString()
    });

    return { success: true, contactName };

  } catch (err) {
    console.error('[loadIntoHunter] Error:', err);
    return { success: false, error: err.message };
  }
}
