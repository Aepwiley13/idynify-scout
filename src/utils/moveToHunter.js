/**
 * moveToHunter.js — Scout → Hunter stage transition utility.
 *
 * Moves a contact from Scout to Hunter stage.
 * Can be triggered by:
 *   - User action in the contact profile (ScoutEngagementPanel)
 *   - Barry detecting an engaged conversation
 *   - User telling Barry to move someone
 *
 * Writes to Firestore and logs a stage_moved timeline event.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

export const HUNTER_MOVE_REASONS = {
  initial_engagement:       'Initial engagement made',
  relationship_established: 'Relationship established',
  barry_suggested:          'Barry recommended',
  manual:                   'Manually moved',
};

/**
 * Move a contact from Scout to Hunter stage.
 *
 * @param {Object} params
 * @param {string} params.userId      - Authenticated user ID
 * @param {string} params.contactId   - Contact document ID
 * @param {string} [params.reason]    - Key from HUNTER_MOVE_REASONS
 * @param {string} [params.actor]     - 'user' | 'barry' | 'system'
 * @param {string} [params.note]      - Optional free-text note
 * @returns {Promise<void>}
 */
export async function moveContactToHunter({
  userId,
  contactId,
  reason = 'manual',
  actor = ACTORS.USER,
  note = null,
}) {
  if (!userId || !contactId) throw new Error('[moveToHunter] Missing userId or contactId');

  const contactRef = doc(db, 'users', userId, 'contacts', contactId);
  await updateDoc(contactRef, {
    stage: 'hunter',
    stage_source: 'manual_override',
    hunter_moved_at: new Date().toISOString(),
    hunter_moved_reason: reason,
  });

  const reasonLabel = HUNTER_MOVE_REASONS[reason] || reason;
  await logTimelineEvent({
    userId,
    contactId,
    type: 'stage_moved',
    actor,
    preview: `Scout → Hunter${note ? ` — ${note}` : ` (${reasonLabel})`}`,
    metadata: {
      stageFrom: 'scout',
      stageTo: 'hunter',
      reason,
      reasonLabel,
      note: note || null,
    },
  });
}
