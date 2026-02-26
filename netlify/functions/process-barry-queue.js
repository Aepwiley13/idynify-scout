/**
 * PROCESS BARRY QUEUE
 *
 * Scheduled function — runs weekday mornings at 9am UTC alongside
 * daily-leads-refresh. Reads unprocessed barryQueue docs for each user,
 * updates contact status, and writes follow_up_due notifications.
 *
 * barryQueue doc shape: { contactId, reason: 're_engage', createdAt }
 * Notification doc shape: {
 *   type: 'follow_up_due', contactId, contactName, companyName,
 *   reason, createdAt, read: false
 * }
 */

import { schedule } from '@netlify/functions';
import admin from 'firebase-admin';

// Initialize Firebase Admin (singleton guard)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

// Contact statuses that mean the user is already actively engaged —
// no need to create a follow-up notification.
const ALREADY_ENGAGED_STATUSES = new Set(['Engaged', 'In Conversation', 'Active Mission']);

const handler = async () => {
  const startTime = Date.now();
  console.log('📬 Starting process-barry-queue job');

  const results = { processed: 0, notified: 0, skipped: 0, failed: 0 };

  try {
    // Enumerate all users
    const usersSnap = await db.collection('users').get();

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      try {
        await processUserQueue(userId, results);
      } catch (userErr) {
        results.failed++;
        console.error(`❌ process-barry-queue: user ${userId} failed:`, userErr.message);
        // Continue with next user — do not abort the whole job
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `✅ process-barry-queue complete: ${results.notified} notified, ` +
      `${results.skipped} skipped, ${results.failed} failed in ${duration}s`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, results, duration })
    };
  } catch (fatalErr) {
    console.error('💥 process-barry-queue fatal error:', fatalErr);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: fatalErr.message })
    };
  }
};

/**
 * Process all unprocessed barryQueue docs for a single user.
 */
async function processUserQueue(userId, results) {
  const queueRef = db.collection('users').doc(userId).collection('barryQueue');
  // where('processed', '!=', true) matches docs where the field is missing,
  // null, false, or any value other than true — correctly handles all write sites.
  const unprocessedSnap = await queueRef
    .where('processed', '!=', true)
    .get();
  const docs = unprocessedSnap.docs;

  if (docs.length === 0) return;

  for (const queueDoc of docs) {
    results.processed++;
    const { contactId, reason } = queueDoc.data();

    try {
      if (!contactId) {
        await markProcessed(queueDoc.ref);
        results.skipped++;
        continue;
      }

      // Load the contact
      const contactSnap = await db
        .collection('users').doc(userId)
        .collection('contacts').doc(contactId)
        .get();

      if (!contactSnap.exists) {
        await markProcessed(queueDoc.ref);
        results.skipped++;
        continue;
      }

      const contact = contactSnap.data();
      const contactStatus = contact.contact_status || 'New';

      // If contact is already actively engaged, skip — no notification needed
      if (ALREADY_ENGAGED_STATUSES.has(contactStatus)) {
        await markProcessed(queueDoc.ref);
        results.skipped++;
        continue;
      }

      // Contact is stale — update status and write notification
      const contactName =
        contact.name ||
        `${contact.firstName || contact.first_name || ''} ${contact.lastName || contact.last_name || ''}`.trim() ||
        'Unknown';
      const companyName = contact.company_name || contact.current_company_name || contact.company || null;

      // Update contact status to Awaiting Reply if not already there
      if (contactStatus !== 'Awaiting Reply') {
        await db.collection('users').doc(userId).collection('contacts').doc(contactId).update({
          contact_status: 'Awaiting Reply',
          contact_status_updated_at: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Write follow_up_due notification
      await db.collection('users').doc(userId).collection('notifications').add({
        type: 'follow_up_due',
        contactId,
        contactName,
        companyName,
        reason: reason || 're_engage',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false
      });

      await markProcessed(queueDoc.ref);
      results.notified++;
    } catch (docErr) {
      console.error(`❌ process-barry-queue: queue doc ${queueDoc.id} for user ${userId} failed:`, docErr.message);
      results.failed++;
      // Do not mark processed — will retry on next run
    }
  }
}

/**
 * Mark a barryQueue document as processed.
 */
async function markProcessed(docRef) {
  await docRef.update({
    processed: true,
    processedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Schedule: 9am UTC Monday–Friday
export default schedule('0 9 * * 1-5', handler);
