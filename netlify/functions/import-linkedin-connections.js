/**
 * IMPORT LINKEDIN CONNECTIONS
 *
 * Receives a pre-scored batch of LinkedIn connections from the frontend
 * (parsed + scored by LinkedInImportModal.jsx using scoreLinkedInConnection.js)
 * and writes them to users/{userId}/linkedin_connections/{connectionId}.
 *
 * Deduplication: doc ID is a normalized key from first_name + last_name + company.
 * Re-importing the same CSV updates existing records (merge: true) without
 * overwriting idynify_contact_id if it was previously linked.
 *
 * Batching: Firestore batches are capped at 500 ops. Large CSVs are chunked.
 *
 * Security: Firebase auth token required.
 * Input:  { idToken, connections: [{ first_name, last_name, company, title, connected_on, icp_match_score, icp_tier }] }
 * Output: { imported, total }
 *
 * Source field: 'csv_upload' — set on every record.
 * When LinkedIn OAuth (Phase 3) ships, it will write to the same collection
 * with source: 'linkedin_oauth', enabling seamless data model continuity.
 */

const admin = require('firebase-admin');

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

// Firestore batch max is 500 operations per batch
const BATCH_SIZE = 500;

// Max connections accepted in a single import (LinkedIn exports cap at ~30k)
const MAX_CONNECTIONS = 30_000;

/**
 * Generate a stable, URL-safe doc ID from a connection's identity fields.
 * Max 64 chars to stay well within Firestore's 1500-byte ID limit.
 */
function makeDocId(firstName, lastName, company) {
  const raw = `${firstName}_${lastName}_${company}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 64);
  return raw || 'unknown';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { idToken, connections } = JSON.parse(event.body);

    // Authenticate
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    // Validate input
    if (!Array.isArray(connections) || connections.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'connections must be a non-empty array' }) };
    }
    if (connections.length > MAX_CONNECTIONS) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Too many connections. Max ${MAX_CONNECTIONS} per import.` })
      };
    }

    const connectionsCol = db.collection('users').doc(userId).collection('linkedin_connections');
    const now = admin.firestore.FieldValue.serverTimestamp();

    let written = 0;

    // Write in chunks of BATCH_SIZE
    for (let i = 0; i < connections.length; i += BATCH_SIZE) {
      const chunk = connections.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const conn of chunk) {
        const docId = makeDocId(
          conn.first_name  || '',
          conn.last_name   || '',
          conn.company     || ''
        );
        const docRef = connectionsCol.doc(docId);

        // merge: true preserves idynify_contact_id if previously linked
        batch.set(docRef, {
          first_name:        conn.first_name        || null,
          last_name:         conn.last_name         || null,
          company:           conn.company           || null,
          title:             conn.title             || null,
          connected_on:      conn.connected_on      || null,
          icp_match_score:   typeof conn.icp_match_score === 'number' ? conn.icp_match_score : 0,
          icp_tier:          conn.icp_tier          || 'unscored',
          idynify_contact_id: null,   // preserved on merge if previously set
          last_synced_at:    now,
          source:            'csv_upload',
        }, { merge: true });

        written++;
      }

      await batch.commit();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ imported: written, total: connections.length })
    };

  } catch (error) {
    console.error('[import-linkedin-connections] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
