/**
 * usePendingReplies — Sprint 3 Team Alpha
 *
 * Finds every contact with a Barry draft waiting on the user, and pairs each
 * draft with the analysis that produced it.
 *
 * There is no top-level index of pending drafts, so this walks contacts whose
 * conversationState is "user_action_required" and reads each one's
 * barry_drafts subcollection. That is two reads per contact — fine at the scale
 * this runs at (a user rarely has more than 5-10 replies waiting at once).
 *
 * Team B writes barry_drafts and barry_analysis. Team Alpha only reads them,
 * plus the approvalStatus transitions driven by the reply card.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { getEffectiveUser } from '../context/ImpersonationContext';

/** approvalStatus values on a barry_drafts document. */
export const DRAFT_APPROVAL = {
  AWAITING: 'awaiting_user',
  SNOOZED: 'snoozed',
  DISMISSED: 'dismissed',
  SENT: 'sent',
};

/**
 * Statuses that still represent work for the user.
 *
 * "Snoozed" deliberately stays actionable in the contact drawer — snoozing
 * means "not from the list right now", not "never again". The pending-replies
 * list (and the morning brief count) only counts AWAITING, so a snoozed draft
 * drops out of the roll-up but is still there when you open that contact.
 */
export const OPEN_APPROVAL_STATUSES = [DRAFT_APPROVAL.AWAITING, DRAFT_APPROVAL.SNOOZED];

const URGENCY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Firestore Timestamps sort by `seconds`; ISO strings and Dates are handled too
 * so a draft written by a test or a migration never sorts unpredictably.
 * @param {*} value
 * @returns {number} epoch milliseconds, 0 when unparseable
 */
export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Pick the draft the user should act on: the most recent one still open.
 *
 * @param {Array<object>} drafts — raw barry_drafts documents
 * @param {string[]} [statuses] — approvalStatus values considered still open
 * @returns {object|null}
 */
export function pickPendingDraft(drafts, statuses = [DRAFT_APPROVAL.AWAITING]) {
  const open = (drafts || [])
    .filter((d) => statuses.includes(d.approvalStatus))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  return open[0] || null;
}

/** Sort pending replies high → medium → low urgency, newest first within a tier. */
export function sortByUrgency(results) {
  return [...results].sort((a, b) => {
    const aRank = URGENCY_ORDER[a.analysis?.urgency] ?? 1;
    const bRank = URGENCY_ORDER[b.analysis?.urgency] ?? 1;
    if (aRank !== bRank) return aRank - bRank;
    return toMillis(b.draft?.createdAt) - toMillis(a.draft?.createdAt);
  });
}

/**
 * Load the pending draft (and its analysis) for one contact.
 *
 * Used by HunterContactDrawer so opening a drawer costs two reads instead of
 * running the whole pending-replies sweep.
 *
 * @param {string} userId
 * @param {string} contactId
 * @param {{ statuses?: string[] }} [options]
 * @returns {Promise<{ draft: object, analysis: object|null }|null>}
 */
export async function fetchPendingDraftForContact(userId, contactId, options = {}) {
  const { statuses = OPEN_APPROVAL_STATUSES } = options;
  if (!userId || !contactId) return null;

  const draftsSnap = await getDocs(
    collection(db, 'users', userId, 'contacts', contactId, 'barry_drafts')
  );
  if (draftsSnap.empty) return null;

  const draft = pickPendingDraft(
    draftsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    statuses
  );
  if (!draft) return null;

  // The analysis shares the draft's document ID (both are keyed by
  // messageRecordId). A missing analysis is not fatal — the card renders
  // without Barry's read rather than failing.
  let analysis = null;
  try {
    const analysisDoc = await getDoc(
      doc(db, 'users', userId, 'contacts', contactId, 'barry_analysis', draft.messageRecordId || draft.id)
    );
    if (analysisDoc.exists()) analysis = analysisDoc.data();
  } catch (err) {
    console.warn('[usePendingReplies] analysis fetch failed:', err.message);
  }

  return { draft, analysis };
}

/**
 * All contacts with a Barry reply waiting on the user, most urgent first.
 *
 * @returns {{ pendingReplies: Array<{contact: object, draft: object, analysis: object|null}>,
 *             loading: boolean, error: string|null, refresh: () => void }}
 */
export function usePendingReplies() {
  const [pendingReplies, setPendingReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Guards setState after unmount when a slow Firestore read resolves late.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const user = getEffectiveUser();
    if (!user) {
      setPendingReplies([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchPendingReplies() {
      try {
        const contactsSnap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'contacts'),
            where('conversationState', '==', 'user_action_required')
          )
        );

        const results = [];
        await Promise.all(
          contactsSnap.docs.map(async (contactDoc) => {
            const contact = { id: contactDoc.id, ...contactDoc.data() };
            // The roll-up counts only drafts genuinely awaiting the user —
            // snoozed drafts stay visible in the drawer but not in the list.
            const pending = await fetchPendingDraftForContact(user.uid, contact.id, {
              statuses: [DRAFT_APPROVAL.AWAITING],
            });
            if (pending) results.push({ contact, ...pending });
          })
        );

        if (cancelled || !mounted.current) return;
        setPendingReplies(sortByUrgency(results));
      } catch (err) {
        if (cancelled || !mounted.current) return;
        console.error('[usePendingReplies] load failed:', err);
        setError(err.message);
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    }

    fetchPendingReplies();
    return () => { cancelled = true; };
  }, [reloadToken]);

  return { pendingReplies, loading, error, refresh };
}
