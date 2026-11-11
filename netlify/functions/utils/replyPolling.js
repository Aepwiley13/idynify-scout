/**
 * REPLY POLLING — shared core for Gmail reply detection.
 *
 * Extracted so the exact same logic serves two callers: the manual
 * "Sync Replies" HTTP handler (gmail-poll-replies.js) and the scheduled
 * worker (gmail-reply-sync-worker.js). One implementation, two entry
 * points — not a second (or third) inbound pipeline.
 *
 * Deliberately independent of GMAIL_IDENTITY_MODE and everything it gates
 * (messageProcessor.js, relationshipEventWriter.js, identityResolution.js —
 * not imported here, not referenced here). This pipeline doesn't resolve
 * anyone's identity: the contact is already known (we sent them the first
 * message in the thread), and "not from me" is all the correlation a reply
 * on OUR OWN tracked thread needs.
 *
 * Classification reuses gmailMessageService.js's existing, already-tested
 * classifyMessage() to tell a genuine human reply apart from an automated
 * one (out-of-office, bounce, mailing-list automation, calendar
 * notifications) — see its own AUTOMATED_SUBJECTS/looksAutomated rules.
 * This is reuse, not a new classifier: no sentiment analysis, no opt-out
 * detection from free text. A human reply that happens to say "please stop
 * emailing me" is still a genuine (non-automated) reply by this measure —
 * that is an explicit, named non-goal, not an oversight.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { ACTORS } from './timelineWrite.js';
import { classifyMessage } from './gmailMessageService.js';
import { MESSAGE_CATEGORIES } from '../../../src/types/normalizedMessage.js';
// Pure, dependency-free — NOT contactStateMachine.js, which imports the
// browser Firebase client SDK and crashes under Netlify's esbuild-bundled
// Functions runtime (no import.meta.env there). See
// src/constants/contactStatuses.js's own header for the full story.
import { CONTACT_STATUSES } from '../../../src/constants/contactStatuses.js';

/** Per-user cap on threads checked in one pass — unchanged from the original manual handler. */
export const MAX_CONTACTS = 50;

/**
 * Headers requested from Gmail for each thread. Expanded beyond the
 * original From/Subject so classifyMessage can actually tell an automated
 * message apart from a human one (List-Unsubscribe, Auto-Submitted,
 * Precedence, X-Mailer, etc. — see gmailMessageService.js's looksAutomated).
 */
export const REPLY_METADATA_HEADERS = [
  'From', 'Subject', 'List-Unsubscribe', 'List-Id',
  'X-Automated-Response', 'X-Auto-Response-Suppress',
  'Auto-Submitted', 'Precedence', 'X-Mailer',
];

/**
 * contact_status values a genuine reply must never advance INTO Awaiting
 * Reply's successor from — these are relationship statuses (set by an
 * explicit person-type reclassification, a dimension hunter_status knows
 * nothing about) or a terminal lead status. hunter_status and contact_status
 * are independently writable fields: a contact can sit at
 * hunter_status:'awaiting_reply' (stale, from Hunter's last outreach) while
 * contact_status has long since moved to 'Active Customer' through a
 * completely different path. Writing the transition unconditionally would
 * regress that contact back to a lead stage on literally any reply in the
 * old thread, including an out-of-office. This set is the guard.
 */
const STATUS_INELIGIBLE_FOR_REPLY_TRANSITION = new Set([
  CONTACT_STATUSES.ACTIVE_CUSTOMER,
  CONTACT_STATUSES.PAST_CUSTOMER,
  CONTACT_STATUSES.PARTNER,
  CONTACT_STATUSES.NETWORK,
  CONTACT_STATUSES.MISSION_COMPLETE,
]);

function headerValue(message, name) {
  return message.payload?.headers?.find(h => h.name === name)?.value || '';
}

/** Lowercased, trimmed — the normal form every identity comparison here uses. */
function normalizeEmail(addr) {
  return (addr || '').toLowerCase().trim();
}

/** "Jane Doe <jane@acme.com>" -> "jane@acme.com"; a bare address is returned as-is. */
function extractEmailAddress(fromHeaderValue) {
  const match = (fromHeaderValue || '').match(/<([^>]+)>/);
  return normalizeEmail(match ? match[1] : fromHeaderValue);
}

/**
 * True when a message is NOT from the connected account — a candidate reply.
 * @param {object} message — a Gmail API message resource (metadata format)
 * @param {string} myEmail — the connected Gmail address, lowercased
 */
function isFromContact(message, myEmail) {
  const from = headerValue(message, 'From').toLowerCase();
  return myEmail ? !from.includes(myEmail) : true;
}

/**
 * Every address this contact is known to send from: the primary email field
 * plus whatever alias fields the rest of the codebase already recognizes
 * for the same contact (isKnownContact in gmailMessageService.js checks the
 * same three fields when resolving a NEW inbound sender) — reused here, not
 * invented, for consistency with how identity is checked everywhere else.
 */
function knownContactIdentities(contact) {
  const identities = new Set();
  if (contact.email) identities.add(normalizeEmail(contact.email));
  if (contact.primaryEmail) identities.add(normalizeEmail(contact.primaryEmail));
  if (Array.isArray(contact.secondaryEmails)) {
    for (const addr of contact.secondaryEmails) identities.add(normalizeEmail(addr));
  }
  return identities;
}

/**
 * Is this message actually FROM the tracked contact, not merely "not from
 * me"? A tracked thread can carry a reply from someone else entirely — a
 * colleague replying instead of the original contact, a reply-all picking
 * up a third party — and treating that as the contact's own answer would
 * attribute it to the wrong person.
 *
 * When the contact has no known email identity on file at all (should not
 * happen in practice — gmail_thread_id implies we sent them mail — but
 * nothing here assumes it can't), this returns false: there is nothing on
 * file to verify against, so a non-self sender is treated the same as any
 * other unmatched address, not specially trusted for lack of a record to
 * check it against. The message is not dropped either way — see
 * classifyReply, whose 'unverified' outcome still records it (timelined,
 * senderVerified:false) without crediting it as the contact's own reply or
 * driving a relationship-stage transition. "Handling legitimate aliases
 * safely" means a known alias (contact.email/primaryEmail/secondaryEmails)
 * always verifies; a contact with none of those on file simply has nothing
 * that can.
 */
function isVerifiedContactSender(message, contact) {
  const identities = knownContactIdentities(contact);
  if (identities.size === 0) return false;
  return identities.has(extractEmailAddress(headerValue(message, 'From')));
}

/**
 * Classify one reply-candidate message into exactly one of three
 * outcomes, each with its own, deliberately different treatment below:
 *
 * - 'automated': classifyMessage (gmailMessageService.js's existing,
 *   tested classifier — bounce, out-of-office, mailing-list, calendar
 *   notification) says so. Never the contact answering. No timeline
 *   event, no status change — the marker still advances past it so it is
 *   never re-classified on a later run.
 * - 'unverified': not automated, but the From address matches none of the
 *   contact's known identities (email/primaryEmail/secondaryEmails) — an
 *   unexpected third party in a thread Idynify is tracking for a specific
 *   person. Still timelined, for visibility — nothing about this message
 *   is dropped — but it must never drive a relationship-stage transition,
 *   since it cannot be attributed to the tracked contact with confidence.
 * - 'genuine': a verified, non-automated reply from the contact. The only
 *   outcome eligible to advance hunter_status/contact_status.
 *
 * classifyMessage's REPLY vs NEW_INBOUND vs UNKNOWN outcomes are
 * irrelevant here and deliberately not consulted — this message is
 * already on a thread Idynify started and is tracking by
 * gmail_thread_id, so only automated-vs-not and sender identity matter.
 */
function classifyReply(message, contact, myEmail) {
  const headers = message.payload?.headers || [];
  const from = headerValue(message, 'From');
  if (classifyMessage(headers, '', from, myEmail, {}) === MESSAGE_CATEGORIES.AUTOMATED) {
    return 'automated';
  }
  if (!isVerifiedContactSender(message, contact)) {
    return 'unverified';
  }
  return 'genuine';
}

/**
 * Poll one user's tracked threads for replies and apply any genuine ones.
 *
 * Durable, message-level idempotency: each contact stores
 * `gmail_last_processed_reply_id`, the id of the last reply-candidate
 * message (genuine or automated) already handled on its thread. Every
 * message strictly after that one in Gmail's own thread order (which does
 * not reorder) is processed in order, oldest first, each in its own
 * Firestore transaction that re-reads the marker fresh before deciding
 * whether to act — so two overlapping invocations (the manual button and a
 * scheduled run, or two scheduled runs racing) can only ever advance the
 * marker once per message, never apply it twice. A late-arriving message
 * (discovered in a later run than its position in the thread would suggest)
 * is still caught: the scan always starts from the stored marker's current
 * position, never from an assumption about what "should" be new.
 *
 * Within one contact's transaction, the contact-doc update (hunter_status,
 * contact_status when eligible, the marker, last_reply_at) and the new
 * timeline-event document are written together, atomically — if either
 * half would fail, neither lands, so a partial failure can never leave the
 * two inconsistent with each other.
 *
 * CANDIDATE SCOPE: includes 'in_conversation', not just 'active_mission'/
 * 'awaiting_reply'. Excluding it once a contact had its first genuine
 * reply would mean a SECOND reply on the same thread is never checked
 * again — the contact is permanently out of the candidate pool the
 * moment it most needs continued tracking. (hunter_status values outside
 * this set — 'archived', 'none', etc. — are still excluded; a contact
 * moved there has left the lifecycle this worker tracks.)
 *
 * FAIRNESS: a user with more than MAX_CONTACTS tracked threads would
 * otherwise have the SAME arbitrary first 50 (Firestore's default
 * ordering) checked every single run, starving every thread past #50
 * forever. Candidates are sorted by `last_reply_check_at` ascending
 * (never-checked first) before slicing, the same least-recently-checked
 * rotation findConnectedGmailUsers already uses for account enumeration —
 * so coverage rotates across runs instead of permanently favoring one
 * subset. last_reply_check_at is stamped on every candidate actually
 * examined, including ones with nothing new to report, by
 * pollRepliesForContact below.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} gmail — authenticated gmail_v1 client
 * @param {string} userId
 * @param {string} myEmail — the connected Gmail address, lowercased
 * @returns {Promise<{ transitioned: Array<object>, checkedCount: number, needsReconnect: boolean }>}
 */
export async function pollRepliesForUser(db, gmail, userId, myEmail) {
  const contactsSnap = await db
    .collection('users').doc(userId)
    .collection('contacts')
    .where('hunter_status', 'in', ['active_mission', 'awaiting_reply', 'in_conversation'])
    .get();

  const candidates = contactsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => !!c.gmail_thread_id)
    .sort((a, b) => {
      const aAt = a.last_reply_check_at || '';
      const bAt = b.last_reply_check_at || '';
      return aAt < bAt ? -1 : aAt > bAt ? 1 : 0;
    })
    .slice(0, MAX_CONTACTS);

  if (candidates.length === 0) {
    return { transitioned: [], checkedCount: 0, needsReconnect: false };
  }

  const transitioned = [];
  let needsReconnect = false;

  await Promise.all(candidates.map(async (contact) => {
    try {
      const result = await pollRepliesForContact(db, gmail, userId, contact, myEmail);
      if (result) transitioned.push(result);
    } catch (err) {
      if (err.status === 403 || err.code === 403) {
        needsReconnect = true;
      } else {
        console.warn(`[replyPolling] Skipping contact ${contact.id}:`, err.message);
      }
    }
  }));

  return { transitioned, checkedCount: candidates.length, needsReconnect };
}

/**
 * Check and process one contact's thread. Returns a transition summary if
 * at least one genuine reply advanced the contact, else null.
 *
 * last_reply_check_at is stamped unconditionally before returning, on
 * every path including "nothing new" — it is the fairness-rotation field
 * pollRepliesForUser sorts candidates by, not a reply-specific marker, so
 * it must advance on every examination, not just a productive one.
 * Best-effort: a failure to stamp it is logged, never thrown — it would
 * otherwise turn a cheap bookkeeping write into a reason to report this
 * contact as failed.
 */
async function pollRepliesForContact(db, gmail, userId, contact, myEmail) {
  try {
    return await checkContactThread(db, gmail, userId, contact, myEmail);
  } finally {
    const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contact.id);
    await contactRef.update({ last_reply_check_at: new Date().toISOString() }).catch((err) => {
      console.warn(`[replyPolling] Could not stamp last_reply_check_at for ${contact.id} (non-blocking):`, err.message);
    });
  }
}

async function checkContactThread(db, gmail, userId, contact, myEmail) {
  const threadRes = await gmail.users.threads.get({
    userId: 'me',
    id: contact.gmail_thread_id,
    format: 'metadata',
    metadataHeaders: REPLY_METADATA_HEADERS,
  });

  const messages = threadRes.data.messages || [];
  if (messages.length < 2) return null; // Only our outbound message — no reply yet

  const contactReplies = messages.filter(m => isFromContact(m, myEmail));
  if (contactReplies.length === 0) return null;

  const lastProcessedId = contact.gmail_last_processed_reply_id || null;
  let startIdx;
  if (!lastProcessedId) {
    startIdx = 0; // never checked before — process the whole history once
  } else {
    const lastIdx = contactReplies.findIndex(m => m.id === lastProcessedId);
    if (lastIdx === -1) {
      // The marker is SET but not found in the current reply list — stale
      // or ambiguous (the list's shape can change between runs, e.g. a
      // message that used to count is now excluded as an unverified
      // sender). Reprocessing from position 0 here would silently replay
      // already-handled history as new timeline events. Fail closed:
      // nothing from this thread this run; the next run tries again with
      // whatever the marker and the thread look like then.
      console.warn(
        `[replyPolling] gmail_last_processed_reply_id ${lastProcessedId} not found in thread ` +
        `${contact.gmail_thread_id} for contact ${contact.id} — skipping this run rather than risk replaying history`
      );
      return null;
    }
    startIdx = lastIdx + 1;
  }

  const newReplies = contactReplies.slice(startIdx);
  if (newReplies.length === 0) return null; // Nothing past the marker

  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contact.id);
  let lastGenuine = null;

  for (const message of newReplies) {
    const genuine = await applyOneReply(
      db, contactRef, contactReplies, message, contact, myEmail, userId, contact.id, contact.gmail_thread_id
    );
    if (genuine) lastGenuine = genuine;
  }

  if (!lastGenuine) return null;

  // Task 2.1: mission update — best-effort, non-fatal, unchanged from the
  // original manual handler. Done once per contact per invocation, after
  // the transaction(s) above, using the freshest known mission id.
  await updateMissionOnReply(db, userId, contact, lastGenuine).catch((missionErr) => {
    console.warn(`[replyPolling] Mission update skipped for ${contact.id}:`, missionErr.message);
  });

  return {
    contactId: contact.id,
    name: contact.name || 'Contact',
    threadId: contact.gmail_thread_id,
    fromEmail: lastGenuine.fromHeader,
  };
}

/**
 * Apply a single reply-candidate message, atomically, idempotently.
 * Returns { fromHeader } when it was a GENUINE, verified reply that this
 * call actually applied (the only outcome that counts toward the
 * contact's transition/mission-update), else null — already processed by
 * a concurrent run, automated, or from an unverified sender.
 */
async function applyOneReply(db, contactRef, contactReplies, message, contact, myEmail, userId, contactId, gmailThreadId) {
  const fromHeader = headerValue(message, 'From');
  const subjectHeader = headerValue(message, 'Subject');
  const category = classifyReply(message, contact, myEmail); // 'automated' | 'unverified' | 'genuine'
  const receivedAt = new Date().toISOString();
  const thisIdx = contactReplies.findIndex(m => m.id === message.id);

  // `applied` is this ATTEMPT's own outcome, returned from the callback —
  // never a variable closed over across retries. A transaction callback
  // can run more than once (Firestore re-invokes it whole on contention),
  // and an outer `let` would carry a stale `true` from a doomed first
  // attempt into a retry that correctly decides to no-op, making the
  // no-op attempt's early `return` fail to undo it. Returning the
  // decision fresh from each invocation is what makes retried attempts
  // independent of each other.
  const applied = await db.runTransaction(async (tx) => {
    const snap = await tx.get(contactRef);
    if (!snap.exists) return false; // Contact deleted since the outer query — nothing to do

    const fresh = snap.data();
    const freshMarker = fresh.gmail_last_processed_reply_id || null;
    const freshMarkerIdx = freshMarker ? contactReplies.findIndex(m => m.id === freshMarker) : -1;

    // Already processed (by this same loop's earlier iteration having
    // committed, or by a concurrent run) — the authoritative check, not
    // just the outer candidate query.
    if (freshMarkerIdx >= thisIdx) return false;

    const patch = {
      gmail_last_processed_reply_id: message.id,
      updated_at: receivedAt,
    };

    // Only a GENUINE, verified reply may advance the relationship —
    // never an automated message, and never an unverified sender (item 2:
    // "a non-self sender in a tracked thread is not automatically the
    // intended contact"). An unverified sender still gets its activity
    // recorded below, just not attributed as the contact's own answer.
    if (category === 'genuine') {
      patch.last_reply_at = receivedAt;
      patch.last_reply_from = fromHeader;
      patch.last_interaction_at = receivedAt;

      if (!STATUS_INELIGIBLE_FOR_REPLY_TRANSITION.has(fresh.contact_status)) {
        patch.hunter_status = 'in_conversation';
        patch.contact_status = CONTACT_STATUSES.IN_CONVERSATION;
        patch.contact_status_updated_at = receivedAt;
      }
    }

    tx.update(contactRef, patch);

    // Timelined for both 'genuine' and 'unverified' — only 'automated' is
    // silent. An unverified sender's message is real activity on this
    // thread; it just cannot be credited to the tracked contact with
    // confidence, which senderVerified:false makes explicit for anyone
    // reading the history back.
    if (category !== 'automated') {
      // Written directly via tx.set, not through timelineWrite.js's
      // writeTimelineEvent — that helper only exposes a non-transactional
      // .add(), which would reopen exactly the inconsistency this function
      // exists to prevent (contact updated, timeline event lost, or vice
      // versa, on a partial failure). `type` is a hardcoded literal here,
      // never a dynamic value, so the type-allowlist check that helper
      // provides has nothing to protect against in this call site — see
      // replyPollingTimelineEventType.test.js, which pins this literal
      // against the same TIMELINE_EVENT_TYPES allowlist instead.
      const timelineRef = db
        .collection('users').doc(userId)
        .collection('contacts').doc(contactId)
        .collection('timeline').doc();
      tx.set(timelineRef, {
        type: 'message_received',
        actor: ACTORS.CONTACT,
        timestamp: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        preview: subjectHeader || 'Reply received',
        metadata: {
          gmailMessageId: message.id,
          gmailThreadId,
          fromAddress: fromHeader,
          autoDetected: true,
          senderVerified: category === 'genuine',
          receivedAt,
        },
      });
    }

    return true;
  });

  return applied && category === 'genuine' ? { fromHeader } : null;
}

async function updateMissionOnReply(db, userId, contact, lastGenuine) {
  const contactRef = db.collection('users').doc(userId).collection('contacts').doc(contact.id);
  const freshContactSnap = await contactRef.get();
  const freshContact = freshContactSnap.data() || {};
  const activeMissionId = freshContact.active_mission_id || contact.active_mission_id;
  if (!activeMissionId) return;

  const missionRef = db.collection('users').doc(userId).collection('missions').doc(activeMissionId);
  const missionSnap = await missionRef.get();
  if (!missionSnap.exists) return;

  const missionData = missionSnap.data();
  const updatedContacts = (missionData.contacts || []).map(c =>
    c.contactId === contact.id
      ? { ...c, replyStatus: 'replied', repliedAt: new Date().toISOString(), repliedFrom: lastGenuine.fromHeader }
      : c
  );
  await missionRef.update({ contacts: updatedContacts, updatedAt: new Date().toISOString() });
}
