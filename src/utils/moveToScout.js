/**
 * moveToScout.js — Fallback → Scout re-activation utility.
 *
 * Re-activates a contact from Fallback back to Scout stage.
 * Can be triggered by:
 *   - User action in the contact profile (FallbackEngagementPanel)
 *   - Barry detecting a trigger event (job change, news mention, etc.)
 *   - User telling Barry to re-activate someone
 *
 * Writes to Firestore and logs a stage_moved timeline event.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';

export const SCOUT_REACTIVATE_REASONS = {
  re_engaged:      'Re-engaged',
  new_angle:       'New angle or opportunity',
  trigger_event:   'Trigger event detected',
  barry_suggested: 'Barry recommended',
  manual:          'Manually re-activated',
};

/**
 * Re-activate a contact from Fallback to Scout stage.
 *
 * @param {Object} params
 * @param {string} params.userId      - Authenticated user ID
 * @param {string} params.contactId   - Contact document ID
 * @param {string} [params.reason]    - Key from SCOUT_REACTIVATE_REASONS
 * @param {string} [params.actor]     - 'user' | 'barry' | 'system'
 * @param {string} [params.note]      - Optional free-text note
 * @returns {Promise<void>}
 */
export async function moveContactToScout({
  userId,
  contactId,
  reason = 'manual',
  actor = ACTORS.USER,
  note = null,
}) {
  if (!userId || !contactId) throw new Error('[moveToScout] Missing userId or contactId');

  const contactRef = doc(db, 'users', userId, 'contacts', contactId);
  await updateDoc(contactRef, {
    stage: 'scout',
    stage_source: 'manual_override',
    scout_reactivated_at: new Date().toISOString(),
    scout_reactivate_reason: reason,
  });

  const reasonLabel = SCOUT_REACTIVATE_REASONS[reason] || reason;
  await logTimelineEvent({
    userId,
    contactId,
    type: 'stage_moved',
    actor,
    preview: `Fallback → Scout${note ? ` — ${note}` : ` (${reasonLabel})`}`,
    metadata: {
      stageFrom: 'fallback',
      stageTo: 'scout',
      reason,
      reasonLabel,
      note: note || null,
    },
  });
}
