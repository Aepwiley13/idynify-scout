/**
 * moveToSniper.js — Hunter → Sniper stage transition utility.
 *
 * Moves a contact from Hunter to Sniper stage.
 * Can be triggered by:
 *   - User action in the contact profile (HunterActionPanel)
 *   - Barry detecting a booked calendar meeting
 *   - User telling Barry to move someone
 *
 * Writes to Firestore and logs a stage_moved timeline event.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

export const SNIPER_MOVE_REASONS = {
  meeting_booked:      'Meeting booked',
  demo_completed:      'Demo completed',
  positive_discussion: 'Positive discussion',
  calendar_detected:   'Calendar event detected',
  barry_suggested:     'Barry recommended',
  manual:              'Manually moved',
};

/**
 * Move a contact from Hunter to Sniper stage.
 *
 * @param {Object} params
 * @param {string} params.userId      - Authenticated user ID
 * @param {string} params.contactId   - Contact document ID
 * @param {string} [params.reason]    - Key from SNIPER_MOVE_REASONS
 * @param {string} [params.actor]     - 'user' | 'barry' | 'system'
 * @param {string} [params.note]      - Optional free-text note
 * @returns {Promise<void>}
 */
export async function moveContactToSniper({
  userId,
  contactId,
  reason = 'manual',
  actor = ACTORS.USER,
  note = null,
}) {
  if (!userId || !contactId) throw new Error('[moveToSniper] Missing userId or contactId');

  const contactRef = doc(db, 'users', userId, 'contacts', contactId);
  await updateDoc(contactRef, {
    stage: 'sniper',
    stage_source: 'manual_override',
    sniper_moved_at: new Date().toISOString(),
    sniper_moved_reason: reason,
  });

  const reasonLabel = SNIPER_MOVE_REASONS[reason] || reason;
  await logTimelineEvent({
    userId,
    contactId,
    type: 'stage_moved',
    actor,
    preview: `Hunter → Sniper${note ? ` — ${note}` : ` (${reasonLabel})`}`,
    metadata: {
      stageFrom: 'hunter',
      stageTo: 'sniper',
      reason,
      reasonLabel,
      note: note || null,
    },
  });
}
