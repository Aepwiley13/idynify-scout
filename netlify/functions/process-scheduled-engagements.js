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
 *   scheduledFor (ISO), status ('pending'|'sent'|'notified'|'cancelled'),
 *   createdAt
 * }
 */

import { schedule } from '@netlify/functions';
import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getGmailSignature, appendSignature } from './utils/gmailSignature.js';

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

const handler = async () => {
  const startTime = Date.now();
  console.log('⏰ Starting process-scheduled-engagements job');

  const results = { processed: 0, sent: 0, notified: 0, skipped: 0, failed: 0, wavesSent: 0, wavesProcessed: 0 };
  const now = new Date().toISOString();

  try {
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      try {
        await processUserScheduled(userId, now, results);
      } catch (userErr) {
        results.failed++;
        console.error(`❌ process-scheduled-engagements: user ${userId} failed:`, userErr.message);
      }
      try {
        await processUserScheduledWaves(userId, now, results);
      } catch (waveErr) {
        results.failed++;
        console.error(`❌ process-scheduled-waves: user ${userId} failed:`, waveErr.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `✅ process-scheduled-engagements complete: ${results.sent} sent, ` +
      `${results.notified} notified, ${results.wavesSent} wave emails, ${results.failed} failed in ${duration}s`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, results, duration })
    };
  } catch (fatalErr) {
    console.error('💥 process-scheduled-engagements fatal error:', fatalErr);
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
  const emailLines = [
    `To: ${toName} <${contact.email}>`,
    `Subject: ${subject || '(no subject)'}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body || ''
  ];
  const emailRaw = emailLines.join('\n');
  const encodedEmail = Buffer.from(emailRaw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const existingThreadId = contact.gmail_thread_id || null;

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
    const contactUpdate = {
      gmail_last_message_id: gmailMessageId,
      hunter_status: 'awaiting_reply',
      last_sent_at: sentAt,
      updated_at: sentAt
    };
    if (!existingThreadId && gmailThreadId) {
      contactUpdate.gmail_thread_id = gmailThreadId;
    }
    await db.collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .update(contactUpdate).catch(() => {});
  }

  // Log timeline event
  if (contactId) {
    await db.collection('users').doc(userId)
      .collection('contacts').doc(contactId)
      .collection('timeline')
      .add({
        type: 'message_sent',
        actor: 'user',
        timestamp: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
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
      }).catch(() => {});
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
  const waveSubject = subject || WAVE_SUBJECTS[type] || wave.name || 'Checking in';

  for (const contactId of recipientIds) {
    try {
      const contactDoc = await db.collection('users').doc(userId)
        .collection('contacts').doc(contactId).get();

      if (!contactDoc.exists) continue;
      const contact = contactDoc.data();
      if (!contact.email) continue;

      // Personalize message
      const firstName = contact.first_name || contact.name?.split(' ')[0] || 'there';
      const personalizedBody = messageTemplate.replace(/\{\{first_name\}\}/gi, firstName);
      const bodyWithSignature = appendSignature(personalizedBody, signature);

      const displayName = contact.name ||
        `${contact.first_name || ''} ${contact.last_name || ''}`.trim() ||
        contact.email;

      // Build RFC 2822 email
      const emailLines = [
        `To: ${displayName} <${contact.email}>`,
        `Subject: ${waveSubject}`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        bodyWithSignature
      ];
      const encodedEmail = Buffer.from(emailLines.join('\n'))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const existingThreadId = contact.gmail_thread_id || null;

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
      const contactUpdate = {
        gmail_last_message_id: gmailMessageId,
        hunter_status: 'awaiting_reply',
        last_sent_at: sentAt,
        updated_at: sentAt
      };
      if (!existingThreadId && gmailThreadId) {
        contactUpdate.gmail_thread_id = gmailThreadId;
      }
      await contactDoc.ref.update(contactUpdate).catch(() => {});

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
      await contactDoc.ref.collection('timeline').add({
        type: 'message_sent',
        actor: 'user',
        timestamp: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
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
      }).catch(() => {});

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
    sentAt: FieldValue.serverTimestamp(),
    processedAt: FieldValue.serverTimestamp(),
  });

  console.log(`✅ Scheduled wave processed: ${sentCount}/${recipientIds.length} sent`);
}

const WAVE_SUBJECTS = {
  checkin: 'Checking in',
  product_update: 'What we just shipped',
  book_meeting: 'Worth 20 minutes?',
};

// Schedule: every 15 minutes
export default schedule('*/15 * * * *', handler);
