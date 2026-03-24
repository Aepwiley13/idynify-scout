/**
 * moveToReinforcements.js — Basecamp → Reinforcements stage transition utility.
 *
 * Moves a contact from Basecamp to Reinforcements stage (activating referral network).
 * Can be triggered by:
 *   - User action in the contact profile (BasecampEngagementPanel)
 *   - User telling Barry to activate referrals for this contact
 *
 * Writes to Firestore and logs a stage_moved timeline event.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

export const REINFORCEMENTS_MOVE_REASONS = {
  referral_requested: 'Referral requested',
  advocacy_ready:     'Ready to advocate',
  barry_suggested:    'Barry recommended',
  manual:             'Manually moved',
};

/**
 * Move a contact from Basecamp to Reinforcements stage.
 *
 * @param {Object} params
 * @param {string} params.userId      - Authenticated user ID
 * @param {string} params.contactId   - Contact document ID
 * @param {string} [params.reason]    - Key from REINFORCEMENTS_MOVE_REASONS
 * @param {string} [params.actor]     - 'user' | 'barry' | 'system'
 * @param {string} [params.note]      - Optional free-text note
 * @returns {Promise<void>}
 */
export async function moveContactToReinforcements({
  userId,
  contactId,
  reason = 'manual',
  actor = ACTORS.USER,
  note = null,
}) {
  if (!userId || !contactId) throw new Error('[moveToReinforcements] Missing userId or contactId');

  const contactRef = doc(db, 'users', userId, 'contacts', contactId);
  await updateDoc(contactRef, {
    stage: 'reinforcements',
    stage_source: 'manual_override',
    reinforcements_activated_at: new Date().toISOString(),
    reinforcements_move_reason: reason,
  });

  const reasonLabel = REINFORCEMENTS_MOVE_REASONS[reason] || reason;
  await logTimelineEvent({
    userId,
    contactId,
    type: 'stage_moved',
    actor,
    preview: `Basecamp → Reinforcements${note ? ` — ${note}` : ` (${reasonLabel})`}`,
    metadata: {
      stageFrom: 'basecamp',
      stageTo: 'reinforcements',
      reason,
      reasonLabel,
      note: note || null,
    },
  });
}
