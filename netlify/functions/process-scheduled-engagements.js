/**
 * PROCESS SCHEDULED ENGAGEMENTS
 *
 * Scheduled function — runs every 15 minutes.
 * Finds pending scheduled engagements whose scheduledFor time has passed and
 * executes them:
 *   - email channel: sends via Gmail API (same logic as gmail-send-quick)
 *   - other channels: writes a reminder notification so the user can send manually
 *
 * Firestore path: users/{userId}/scheduledEngagements/{docId}
 * Doc shape: {
 *   contactId, contact, channel, subject, body,
 *   userIntent, engagementIntent, strategy,
 *   scheduledFor (ISO), status ('pending'|'sent'|'notified'|'skipped'|'failed'|'cancelled'),
 *   createdAt
 * }
 *
 * Before any email send (here, and in the per-recipient loop inside a
 * scheduled wave) the contact's CURRENT state is re-read and checked —
 * see isSendSuppressed/checkSendSuppressed below, which reuse the
 * canonical src/utils/relationshipRead.js accessors (isInConversation,
 * hasReplied) rather than hunter_status alone, plus an explicit
 * relationship-status/Mission-Complete exclusion set. `contact`/`contactId`
 * above is only the snapshot captured when the engagement was queued; it
 * is never trusted for the suppression decision. A missing contactId is
 * its own suppression reason (no_contact_reference), not a silent bypass.
 * A suppressed engagement is marked status:'skipped' with a skippedReason,
 * never deleted or rewritten — it stays as a permanent, inspectable
 * record of why it didn't send. A suppression CHECK that itself fails
 * (e.g. a transient Firestore error) leaves the doc 'pending' for the
 * next run rather than guessing either way.
 *
 * A second, independent safeguard (hasLiveUnprocessedReply) checks the
 * live Gmail thread immediately before the send itself, closing the
 * residual race between the Firestore read above and the Gmail API call
 * down to roughly one API round-trip — see its own docstring for why that
 * residual window cannot be closed further.
 */

import { schedule } from '@netlify/functions';

/** Cron for this worker, exported so tests can assert it. */
export const ENGAGEMENTS_SCHEDULE = '*/15 * * * *';
import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getGmailSignature, appendSignature } from './utils/gmailSignature.js';
import { writeTimelineEvent, ACTORS } from './utils/timelineWrite.js';
import { alertOps } from './utils/alertOps.js';
import { applySendContactUpdate } from './utils/applySendContactUpdate.js';
import { buildPlainTextEmail } from './utils/emailHeaders.js';
import { isInConversation, hasReplied } from '../../src/utils/relationshipRead.js';
// Pure, dependency-free — NOT contactStateMachine.js, which imports the
// browser Firebase client SDK and crashes under Netlify's esbuild-bundled
// Functions runtime (no import.meta.env there). See
// src/constants/contactStatuses.js's own header for the full story.
import { CONTACT_STATUSES } from '../../src/constants/contactStatuses.js';

// Initialize Firebase Admin (singleton guard)
if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

const db = getFirestore();

/**
 * contact_status values a queued automated send must never fire into —
 * relationship statuses (set by an explicit person-type reclassification,
 * a dimension this scheduler's own workflow fields know nothing about) or
 * a terminal lead status. Mirrors the identical set in replyPolling.js
 * (PR A) — kept duplicated rather than cross-imported, since these are two
 * independent PRs/branches; the two sets must be kept in sync by hand if
 * CONTACT_STATUSES ever grows a new relationship/terminal value.
 */
const STATUS_BLOCKS_AUTOMATED_SEND = new Set([
  CONTACT_STATUSES.ACTIVE_CUSTOMER,
  CONTACT_STATUSES.PAST_CUSTOMER,
  CONTACT_STATUSES.PARTNER,
  CONTACT_STATUSES.NETWORK,
  CONTACT_STATUSES.MISSION_COMPLETE,
]);

/**
 * Pure decision: should a queued automated send be suppressed for this
 * contact, given its CURRENT data (not the snapshot captured when the
 * engagement or wave was queued)? Returns null when the send should
 * proceed, else { reason } for the caller to record.
 *
 * Audited every existing authoritative signal before adding this, rather
 * than inventing a new one:
 * - isInConversation (src/utils/relationshipRead.js) — THE canonical
 *   guardrail answer to "did they reply," already checking
 *   contact.relationship.state (canonical, live-mode only),
 *   contact_status, AND hunter_status in one place. Reusing it here (not
 *   hunter_status alone, as the previous version of this guard did) is
 *   what makes this the smallest CONSISTENT predicate — the same question
 *   answered the same way everywhere else in the codebase that asks it.
 * - hasReplied (same file) — true once contact.relationship.reply_count
 *   (canonical) or the legacy replies_received mirror is > 0. A contact
 *   can have answered before and since cycled out of the in_conversation
 *   workflow state for an unrelated reason; a stale queued "just checking
 *   in" send to a known responder is still inappropriate.
 * - STATUS_BLOCKS_AUTOMATED_SEND — a relationship status or Mission
 *   Complete. Checked independently of the above two: a contact who
 *   became a customer through a path that never touched hunter_status
 *   should not receive a cold-outreach-shaped automated follow-up either.
 * - contact_bounced: email_delivery_status is read defensively for
 *   forward compatibility with the planned bounce-detection work (PR 2).
 *   That field does not exist yet, so this arm is a no-op today and
 *   starts working the moment PR 2 ships, with no second change needed
 *   to this file.
 *
 * Opt-outs: no opt-out/do-not-contact/unsubscribe field exists anywhere in
 * this codebase today (confirmed by search, not assumed) — there is
 * nothing for this predicate to check. Covered only to the extent an
 * opt-out arrives as a reply, via isInConversation/hasReplied above. No
 * sentiment or free-text detection is added here.
 */
export function isSendSuppressed(contact) {
  if (!contact) return { reason: 'contact_deleted' };
  if (isInConversation(contact)) return { reason: 'contact_replied' };
  if (hasReplied(contact)) return { reason: 'contact_replied' };
  if (STATUS_BLOCKS_AUTOMATED_SEND.has(contact.contact_status)) return { reason: 'relationship_status_advanced' };
  if (contact.email_delivery_status?.state === 'bounced') return { reason: 'contact_bounced' };
  return null;
}

/**
 * Fresh contact read, for callers (sendScheduledEmail) that only hold the
 * snapshot captured when the engagement was queued. Returns
 * { suppression, contact } — `contact` is the fresh doc data (or null),
 * reused by the caller for the live Gmail check too, so that check reads
 * the CURRENT gmail_thread_id rather than the queued-time snapshot's,
 * which may be stale or absent.
 *
 * A missing contactId is NOT treated as "nothing to check" — that used to
 * return null (proceed), which silently bypassed recipient verification
 * entirely for any engagement that somehow lacked a contact reference.
 * There is no way to verify current state for an address with no
 * canonical contact doc behind it, so this fails closed: suppressed, with
 * its own distinct reason, same as every other suppression case — logged
 * and preserved, never silently sent.
 */
async function checkSendSuppressed(userId, contactId) {
  if (!contactId) return { suppression: { reason: 'no_contact_reference' }, contact: null };
  const snap = await db.collection('users').doc(userId).collection('contacts').doc(contactId).get();
  if (!snap.exists) return { suppression: { reason: 'contact_deleted' }, contact: null };
  const contact = snap.data();
  return { suppression: isSendSuppressed(contact), contact };
}

/**
 * Residual race, documented rather than hidden: checkSendSuppressed reads
 * Firestore as the LAST step before the Gmail API call, which closes the
 * original gap (a reply landing any time between queuing and this run) to
 * the width of one function call — but a reply could still land in the
 * literal window between that Firestore read and the Gmail send
 * completing. Firestore and the Gmail API cannot be made atomic with each
 * other; no amount of additional Firestore-side checking removes this
 * specific window.
 *
 * The smallest practical safeguard available, consistent with what this
 * scheduler already has a Gmail client open for: a LIVE check of the
 * tracked Gmail thread itself, immediately before sending, reusing the
 * exact "message not from me" logic replyPolling.js (PR A) already
 * established — not a new detector. This catches a reply that has already
 * arrived in Gmail but has not yet been written to Firestore by either
 * the manual "Sync Replies" button or the scheduled reply-sync worker,
 * shrinking the residual window to genuinely concurrent arrival (on the
 * order of the single Gmail API round-trip this function makes), which is
 * accepted as a remaining, bounded limitation rather than engineered away
 * further. A contact with no gmail_thread_id yet (the common case for a
 * first-touch wave recipient) has nothing to check live, so this is a
 * no-op for most wave sends and only costs an extra API call for contacts
 * with an established thread.
 *
 * CONSERVATIVE SUPPRESSION POLICY (deliberate, not a gap): this check does
 * NOT distinguish a genuine reply from an automated notification (bounce,
 * out-of-office, mailing-list) or an unrelated third party replying on the
 * same thread — it suppresses the send on ANY message in the thread not
 * from `myEmail`, full stop. That is intentional. The two possible wrong
 * outcomes here are not symmetric: suppressing a send that would actually
 * have been fine just delays or skips an automated follow-up — cheap,
 * recoverable, and already visible as a 'contact_replied_live' skip the
 * next run or a human can revisit. Sending an automated follow-up into a
 * thread the recipient already responded to — even with a bounce, an
 * out-of-office, or someone else entirely — is the outcome this safeguard
 * exists to prevent, and is not something a missed send can later undo.
 * So this function always resolves any ambiguity toward suppression, not
 * toward sending. It does not reuse replyPolling.js's classifyReply
 * (automated/unverified/genuine) specifically because that finer-grained
 * distinction is for deciding whether to CREDIT a reply to the contact —
 * a decision this function never makes; it only ever decides whether to
 * hold back a send, where being over-cautious is the safe direction.
 */
async function hasLiveUnprocessedReply(gmail, contact, myEmail) {
  if (!contact?.gmail_thread_id) return false;
  try {
    const threadRes = await gmail.users.threads.get({
      userId: 'me',
      id: contact.gmail_thread_id,
      format: 'metadata',
      metadataHeaders: ['From'],
    });
    const messages = threadRes.data.messages || [];
    const emailLower = (myEmail || '').toLowerCase();
    return messages.some((m) => {
      const from = (m.payload?.headers?.find((h) => h.name === 'From')?.value || '').toLowerCase();
      return emailLower ? !from.includes(emailLower) : false;
    });
  } catch (err) {
    // Non-fatal — this is a best-effort extra safeguard on top of the
    // authoritative Firestore check, not a replacement for it. A failure
    // here must not block an otherwise-eligible send.
    console.warn('⚠️ Live Gmail thread check failed (non-blocking):', err.message);
    return false;
  }
}

export const processScheduledEngagements = async () => {
  const startTime = Date.now();
  console.log('⏰ Starting process-scheduled-engagements job');

  // firstError is carried so the alert email can name a cause, not just a count.
  const results = { processed: 0, sent: 0, notified: 0, skipped: 0, failed: 0, wavesSent: 0, wavesProcessed: 0, firstError: null };
  const now = new Date().toISOString();

  try {
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      try {
        await processUserScheduled(userId, now, results);
      } catch (userErr) {
        results.failed++;
        results.firstError = results.firstError || userErr.message;
        console.error(`❌ process-scheduled-engagements: user ${userId} failed:`, userErr.message);
      }
      try {
        await processUserScheduledWaves(userId, now, results);
      } catch (waveErr) {
        results.failed++;
        results.firstError = results.firstError || waveErr.message;
        console.error(`❌ process-scheduled-waves: user ${userId} failed:`, waveErr.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `✅ process-scheduled-engagements complete: ${results.sent} sent, ` +
      `${results.notified} notified, ${results.wavesSent} wave emails, ${results.skipped} skipped, ${results.failed} failed in ${duration}s`
    );

    // 207 on partial failure, matching daily-leads-refresh: a 200 must mean
    // every scheduled engagement and wave was handled. An honest zero — nothing
    // was due this quarter-hour — still returns 200. Skipped is not a failure:
    // it means the suppression check worked as intended.
    const allOk = results.failed === 0;
    console.log(allOk ? 'engagements.scheduled.ok' : 'engagements.scheduled.partial_failure', {
      sent: results.sent, notified: results.notified,
      wavesSent: results.wavesSent, skipped: results.skipped, usersFailed: results.failed,
      durationMs: Date.now() - startTime,
    });

    if (!allOk) {
      await alertOps({
        db, job: 'process-scheduled-engagements', severity: 'partial_failure',
        summary: `${results.failed} scheduled engagement(s) or wave(s) failed to send.`,
        detail: { sent: results.sent, notified: results.notified,
                  wavesSent: results.wavesSent, skipped: results.skipped, failed: results.failed,
                  firstError: results.firstError || 'n/a' },
      });
    }

    return {
      statusCode: allOk ? 200 : 207,
      body: JSON.stringify({ success: allOk, results, duration })
    };
  } catch (fatalErr) {
    console.error('💥 process-scheduled-engagements fatal error:', fatalErr);
    console.error('engagements.scheduled.failed', { error: fatalErr.message });
    await alertOps({
      db, job: 'process-scheduled-engagements', severity: 'failed',
      summary: 'The scheduled engagement sender crashed before finishing.',
      detail: { error: fatalErr.message },
    });
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: fatalErr.message })
    };
  }
};

async function processUserScheduled(userId, now, results) {
  const scheduledRef = db.collection('users').doc(userId).collection('scheduledEngagements');

  // Find pending engagements whose scheduled time has passed
  const dueSnap = await scheduledRef
    .where('status', '==', 'pending')
    .where('scheduledFor', '<=', now)
    .get();

  if (dueSnap.empty) return;

  for (const engDoc of dueSnap.docs) {
    results.processed++;
    const eng = engDoc.data();

    try {
      if (eng.channel === 'email') {
        await sendScheduledEmail(userId, engDoc.ref, eng, results);
      } else {
        // For native channels (text, call, linkedin, calendar), write a reminder notification
        await writeReminderNotification(userId, engDoc.ref, eng);
        results.notified++;
      }
    } catch (docErr) {
      console.error(
        `❌ process-scheduled-engagements: doc ${engDoc.id} for user ${userId} failed:`,
        docErr.message
      );
      results.failed++;
      // Mark as failed so it won't be retried indefinitely
      await engDoc.ref.update({
        status: 'failed',
        errorMessage: docErr.message,
        processedAt: FieldValue.serverTimestamp()
      }).catch(() => {});
    }
  }
}

async function sendScheduledEmail(userId, docRef, eng, results) {
  const { contact, subject, body, contactId } = eng;

  if (!contact?.email) {
    // No email address — fall back to reminder notification
    await writeReminderNotification(userId, docRef, eng);
    results.notified++;
    return;
  }

  // Load Gmail OAuth tokens from Firestore
  const gmailDoc = await db
    .collection('users').doc(userId)
    .collection('integrations').doc('gmail')
    .get();

  if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
    // Gmail not connected — fall back to reminder notification
    await writeReminderNotification(userId, docRef, eng);
    results.notified++;
    return;
  }

  const gmailData = gmailDoc.data();
  let accessToken = gmailData.accessToken;
  const refreshToken = gmailData.refreshToken;
  const expiresAt = gmailData.expiresAt;

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
    throw new Error('Google OAuth not configured');
  }

  const oauth2Client = new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri);
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  // Refresh token if expired
  if (expiresAt && Date.now() >= expiresAt - 60000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    accessToken = credentials.access_token;
    await db.collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .update({
        accessToken,
        expiresAt: credentials.expiry_date,
        updatedAt: new Date().toISOString()
      });
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Build email RFC 2822
  const toName = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email;
  const emailRaw = buildPlainTextEmail({
    toName, toEmail: contact.email, subject: subject || '(no subject)', body: body || '',
  });
  const encodedEmail = Buffer.from(emailRaw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const existingThreadId = contact.gmail_thread_id || null;

  // Fresh, send-time check: the reply or bounce may have landed any time
  // between this engagement being queued and this run — re-reading right
  // before the Gmail call closes that window as tightly as this job can.
  // The fresh contact (not the queued-time snapshot) is reused below for
  // the live Gmail check too, so that check reads the CURRENT
  // gmail_thread_id rather than one that may be stale or was never on the
  // original snapshot at all.
  let suppression, freshContact;
  try {
    ({ suppression, contact: freshContact } = await checkSendSuppressed(userId, contactId));
  } catch (checkErr) {
    // Could not verify current state — fail closed (do not send), but
    // leave status 'pending' rather than 'skipped' or 'failed', so the
    // next scheduled run retries rather than losing a possibly-still-valid
    // reminder outright.
    console.warn(`⚠️ Suppression check failed for contact ${contactId}, leaving pending for retry:`, checkErr.message);
    return;
  }
  if (suppression) {
    await docRef.update({
      status: 'skipped',
      skippedReason: suppression.reason,
      skippedAt: FieldValue.serverTimestamp(),
    });
    results.skipped++;
    console.log(`⏭️  Scheduled email to contact ${contactId} skipped (${suppression.reason})`);
    return;
  }

  // Smallest practical safeguard on the residual Firestore/Gmail race —
  // see hasLiveUnprocessedReply's own docstring.
  if (await hasLiveUnprocessedReply(gmail, freshContact, gmailData.email)) {
    await docRef.update({
      status: 'skipped',
      skippedReason: 'contact_replied_live',
      skippedAt: FieldValue.serverTimestamp(),
    });
    results.skipped++;
    console.log(`⏭️  Scheduled email to contact ${contactId} skipped (contact_replied_live)`);
    return;
  }

  const gmailResult = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
      ...(existingThreadId ? { threadId: existingThreadId } : {})
    }
  });

  const gmailMessageId = gmailResult.data.id;
  const gmailThreadId = gmailResult.data.threadId;
  const sentAt = new Date().toISOString();

  // Update contact status
  if (contactId) {
    const baseUpdate = {
      gmail_last_message_id: gmailMessageId,
      last_sent_at: sentAt,
      updated_at: sentAt
    };
    if (!existingThreadId && gmailThreadId) {
      baseUpdate.gmail_thread_id = gmailThreadId;
    }
    const contactRef = db.collection('users').doc(userId)
      .collection('contacts').doc(contactId);
    // Transactional read-decide-write, re-reading fresh rather than reusing
    // freshContact (which predates the Gmail send call above, itself real
    // network time) — see applySendContactUpdate's docstring for why a
    // plain get()-then-update() leaves a window for replyPolling.js's own
    // transaction to land in between and have its result overwritten.
    await applySendContactUpdate(contactRef, baseUpdate, 'scheduled_engagement').catch(() => {});
  }

  // Log timeline event
  if (contactId) {
    await writeTimelineEvent(db, {
      userId,
      contactId,
      type: 'message_sent',
      actor: ACTORS.USER,
      preview: subject || (body ? body.substring(0, 120) : null),
      metadata: {
        channel: 'email',
        method: 'real',
        sendResult: 'sent',
        scheduledSend: true,
        gmailMessageId,
        subject: subject || null,
        engagementIntent: eng.engagementIntent || null,
        strategy: eng.strategy || null
      }
    });
  }

  // Mark scheduled doc as sent
  await docRef.update({
    status: 'sent',
    gmailMessageId,
    sentAt,
    processedAt: FieldValue.serverTimestamp()
  });

  console.log(`✅ Scheduled email sent to ${contact.email} for user ${userId}`);
  results.sent++;
}

async function writeReminderNotification(userId, docRef, eng) {
  const { contact, channel, subject, body, contactId } = eng;

  const contactName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ')
    || contact?.email
    || 'Unknown';

  await db.collection('users').doc(userId).collection('notifications').add({
    type: 'scheduled_engagement_due',
    contactId: contactId || null,
    contactName,
    channel,
    subject: subject || null,
    bodyPreview: body ? body.substring(0, 200) : null,
    reason: 'scheduled_send_due',
    createdAt: FieldValue.serverTimestamp(),
    read: false
  });

  await docRef.update({
    status: 'notified',
    processedAt: FieldValue.serverTimestamp()
  });

  console.log(`📬 Reminder notification created for user ${userId} contact ${contactId}`);
}

// ─── Scheduled Wave Processing ───────────────────────────────────────────────

async function processUserScheduledWaves(userId, now, results) {
  const wavesRef = db.collection('users').doc(userId).collection('waves');

  // Find scheduled waves whose time has passed
  const dueSnap = await wavesRef
    .where('status', '==', 'scheduled')
    .where('scheduledFor', '<=', now)
    .get();

  if (dueSnap.empty) return;

  for (const waveDoc of dueSnap.docs) {
    results.wavesProcessed++;
    const wave = waveDoc.data();

    try {
      await sendScheduledWave(userId, waveDoc.ref, wave, results);
    } catch (waveErr) {
      console.error(
        `❌ process-scheduled-waves: wave ${waveDoc.id} for user ${userId} failed:`,
        waveErr.message
      );
      results.failed++;
      await waveDoc.ref.update({
        status: 'failed',
        errorMessage: waveErr.message,
        processedAt: FieldValue.serverTimestamp()
      }).catch(() => {});
    }
  }
}

async function sendScheduledWave(userId, waveRef, wave, results) {
  const { recipientIds, message: messageTemplate, subject, channel, type } = wave;

  if (!recipientIds?.length) {
    await waveRef.update({ status: 'processed', processedAt: FieldValue.serverTimestamp() });
    return;
  }

  // Only send email waves via Gmail — other channels get reminder notifications
  if (channel && channel !== 'via Email') {
    await db.collection('users').doc(userId).collection('notifications').add({
      type: 'scheduled_wave_due',
      waveName: wave.name || 'Scheduled wave',
      channel,
      recipientCount: recipientIds.length,
      reason: 'scheduled_wave_due',
      createdAt: FieldValue.serverTimestamp(),
      read: false
    });
    await waveRef.update({ status: 'notified', processedAt: FieldValue.serverTimestamp() });
    results.notified++;
    return;
  }

  // Load Gmail OAuth tokens
  const gmailDoc = await db
    .collection('users').doc(userId)
    .collection('integrations').doc('gmail')
    .get();

  if (!gmailDoc.exists || gmailDoc.data().status !== 'connected') {
    // Gmail not connected — create reminder
    await db.collection('users').doc(userId).collection('notifications').add({
      type: 'scheduled_wave_due',
      waveName: wave.name || 'Scheduled wave',
      channel: 'email',
      recipientCount: recipientIds.length,
      reason: 'gmail_not_connected',
      createdAt: FieldValue.serverTimestamp(),
      read: false
    });
    await waveRef.update({ status: 'notified', processedAt: FieldValue.serverTimestamp() });
    results.notified++;
    return;
  }

  const gmailData = gmailDoc.data();
  let accessToken = gmailData.accessToken;
  const refreshToken = gmailData.refreshToken;

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!googleClientId || !googleClientSecret || !googleRedirectUri) {
    throw new Error('Google OAuth not configured');
  }

  const oauth2Client = new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri);
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  // Refresh token if expired
  if (gmailData.expiresAt && Date.now() >= gmailData.expiresAt - 60000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    accessToken = credentials.access_token;
    await db.collection('users').doc(userId)
      .collection('integrations').doc('gmail')
      .update({
        accessToken,
        expiresAt: credentials.expiry_date,
        updatedAt: new Date().toISOString()
      });
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  }

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const signature = await getGmailSignature(gmail);

  // Load recipient contacts from Firestore
  let sentCount = 0;
  let skippedCount = 0;
  const waveSubject = subject || WAVE_SUBJECTS[type] || wave.name || 'Checking in';

  for (const contactId of recipientIds) {
    try {
      // A malformed recipientIds entry has no contact to verify against —
      // same "fail closed, don't guess" rule as a missing engagement
      // contactId, just with no persisted item here to mark skipped.
      if (!contactId) continue;

      const contactDoc = await db.collection('users').doc(userId)
        .collection('contacts').doc(contactId).get();

      if (!contactDoc.exists) continue;
      const contact = contactDoc.data();
      if (!contact.email) continue;

      // Same fresh, send-time suppression check as the single-engagement
      // path — this contact read is already as fresh as it gets (fetched
      // right in this loop, not a queued-time snapshot), so no second
      // read is needed here.
      const suppression = isSendSuppressed(contact);
      if (suppression) {
        skippedCount++;
        console.log(`⏭️  Wave email to contact ${contactId} skipped (${suppression.reason})`);
        continue;
      }

      // Personalize message
      const firstName = contact.first_name || contact.name?.split(' ')[0] || 'there';
      const personalizedBody = messageTemplate.replace(/\{\{first_name\}\}/gi, firstName);
      const bodyWithSignature = appendSignature(personalizedBody, signature);

      const displayName = contact.name ||
        `${contact.first_name || ''} ${contact.last_name || ''}`.trim() ||
        contact.email;

      // Build RFC 2822 email
      const emailRaw = buildPlainTextEmail({
        toName: displayName, toEmail: contact.email, subject: waveSubject, body: bodyWithSignature,
      });
      const encodedEmail = Buffer.from(emailRaw)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const existingThreadId = contact.gmail_thread_id || null;

      // Same smallest-practical-safeguard live check as the single-engagement
      // path — see hasLiveUnprocessedReply's docstring. A no-op for most wave
      // recipients, who have no gmail_thread_id yet (first-touch outreach).
      if (await hasLiveUnprocessedReply(gmail, contact, gmailData.email)) {
        skippedCount++;
        console.log(`⏭️  Wave email to contact ${contactId} skipped (contact_replied_live)`);
        continue;
      }

      const gmailResult = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
          ...(existingThreadId ? { threadId: existingThreadId } : {})
        }
      });

      const gmailMessageId = gmailResult.data.id;
      const gmailThreadId = gmailResult.data.threadId;
      const sentAt = new Date().toISOString();
      sentCount++;

      // Update contact
      const baseUpdate = {
        gmail_last_message_id: gmailMessageId,
        last_sent_at: sentAt,
        updated_at: sentAt
      };
      if (!existingThreadId && gmailThreadId) {
        baseUpdate.gmail_thread_id = gmailThreadId;
      }
      // Transactional read-decide-write, re-reading fresh rather than
      // reusing `contact` (which predates the Gmail send call above,
      // itself real network time) — see applySendContactUpdate's docstring
      // for why a plain get()-then-update() leaves a window for
      // replyPolling.js's own transaction to land in between and have its
      // result overwritten.
      await applySendContactUpdate(contactDoc.ref, baseUpdate, 'scheduled_wave').catch(() => {});

      // Log to email_logs
      await db.collection('email_logs').add({
        userId,
        contactId,
        toEmail: contact.email,
        toName: displayName,
        subject: waveSubject,
        bodyPreview: personalizedBody.substring(0, 200),
        gmailMessageId,
        gmailThreadId: gmailThreadId || null,
        status: 'sent',
        sentAt,
        source: 'scheduled_wave',
        waveId: waveRef.id,
      }).catch(() => {});

      // Log timeline event
      await writeTimelineEvent(db, {
        userId,
        contactId: contactDoc.id,
        type: 'message_sent',
        actor: ACTORS.USER,
        preview: waveSubject,
        metadata: {
          channel: 'email',
          method: 'real',
          sendResult: 'sent',
          scheduledSend: true,
          waveName: wave.name,
          gmailMessageId,
          subject: waveSubject,
        }
      });

      console.log(`✅ Wave email sent to ${contact.email} for user ${userId}`);
      results.wavesSent++;

      // Small delay between sends
      await new Promise(r => setTimeout(r, 500));

    } catch (sendErr) {
      console.error(`❌ Failed wave email to contact ${contactId}:`, sendErr.message);
    }
  }

  // Update wave doc
  await waveRef.update({
    status: 'processed',
    'stats.sent': sentCount,
    'stats.skipped': skippedCount,
    sentAt: FieldValue.serverTimestamp(),
    processedAt: FieldValue.serverTimestamp(),
  });

  results.skipped += skippedCount;
  console.log(`✅ Scheduled wave processed: ${sentCount}/${recipientIds.length} sent, ${skippedCount} skipped`);
}

const WAVE_SUBJECTS = {
  checkin: 'Checking in',
  product_update: 'What we just shipped',
  book_meeting: 'Worth 20 minutes?',
};

// Schedule: every 15 minutes
// The export form is load-bearing. `export default schedule(CRON, fn)` builds,
// deploys and reports healthy — and never fires. Netlify looks up the scheduled
// function by its NAMED `handler` export, so a default export registers nothing
// and the cron silently does not exist. This file shipped that way and never ran
// once. Keep the `export const handler = schedule(...)` form.
export const handler = schedule(ENGAGEMENTS_SCHEDULE, processScheduledEngagements);
