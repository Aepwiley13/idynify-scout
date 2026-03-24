/**
 * moveToBasecamp.js — Sniper → Basecamp stage transition utility.
 *
 * Moves a contact from Sniper to Basecamp stage (deal won, customer onboarded).
 * Can be triggered by:
 *   - User action in the contact profile (SniperEngagementPanel)
 *   - Barry detecting a deal closure signal
 *   - User telling Barry to move someone
 *
 * Writes to Firestore and logs a stage_moved timeline event.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

export const BASECAMP_MOVE_REASONS = {
  deal_won:            'Deal won',
  contract_signed:     'Contract signed',
  customer_onboarded:  'Customer onboarded',
  barry_suggested:     'Barry recommended',
  manual:              'Manually moved',
};

/**
 * Move a contact from Sniper to Basecamp stage.
 *
 * @param {Object} params
 * @param {string} params.userId      - Authenticated user ID
 * @param {string} params.contactId   - Contact document ID
 * @param {string} [params.reason]    - Key from BASECAMP_MOVE_REASONS
 * @param {string} [params.actor]     - 'user' | 'barry' | 'system'
 * @param {string} [params.note]      - Optional free-text note
 * @returns {Promise<void>}
 */
export async function moveContactToBasecamp({
  userId,
  contactId,
  reason = 'manual',
  actor = ACTORS.USER,
  note = null,
}) {
  if (!userId || !contactId) throw new Error('[moveToBasecamp] Missing userId or contactId');

  const contactRef = doc(db, 'users', userId, 'contacts', contactId);
  await updateDoc(contactRef, {
    stage: 'basecamp',
    stage_source: 'manual_override',
    stage_entered_at: new Date().toISOString(),
    basecamp_moved_at: new Date().toISOString(),
    basecamp_moved_reason: reason,
  });

  const reasonLabel = BASECAMP_MOVE_REASONS[reason] || reason;
  await logTimelineEvent({
    userId,
    contactId,
    type: 'stage_moved',
    actor,
    preview: `Sniper → Basecamp${note ? ` — ${note}` : ` (${reasonLabel})`}`,
    metadata: {
      stageFrom: 'sniper',
      stageTo: 'basecamp',
      reason,
      reasonLabel,
      note: note || null,
    },
  });
}
