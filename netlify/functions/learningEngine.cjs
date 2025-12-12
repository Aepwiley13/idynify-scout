// Module 10: Learning Engine - Core Logic
// Adjusts user weights based on actions and creates version history

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin (only once)
let adminApp;
let db;

function getFirebaseAdmin() {
  if (!adminApp) {
    // Initialize with default credentials (uses GOOGLE_APPLICATION_CREDENTIALS env var)
    // Or initialize with the same project as client-side Firebase
    adminApp = initializeApp();
    db = getFirestore(adminApp);
  }
  return db;
}

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { user_id, action_type, lead_data } = JSON.parse(event.body);

    // Validate input
    if (!user_id || !action_type) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing user_id or action_type' })
      };
    }

    // Get Firestore instance
    const firestore = getFirebaseAdmin();

    // Fetch current weights
    const weightsRef = firestore.doc(`users/${user_id}/weights/current`);
    const weightsDoc = await weightsRef.get();

    let currentWeights;
    if (weightsDoc.exists) {
      currentWeights = weightsDoc.data();
    } else {
      // Initialize with defaults if not exists
      currentWeights = {
        title_match_weight: 30,
        industry_match_weight: 20,
        company_size_weight: 10
      };
    }

    // Apply adjustment rules based on action_type
    let adjustment = 0;
    let actionSource = action_type;

    switch (action_type) {
      case 'accept_contact':
        adjustment = 2;
        break;
      case 'reject_contact':
        adjustment = -1;
        break;
      case 'lead_accuracy_accurate':
        adjustment = 1;
        break;
      case 'lead_accuracy_inaccurate':
        adjustment = -3;
        break;
      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Unknown action_type: ${action_type}` })
        };
    }

    // Calculate new weights (apply adjustment to all weights)
    const newWeights = {
      title_match_weight: currentWeights.title_match_weight + adjustment,
      industry_match_weight: currentWeights.industry_match_weight + adjustment,
      company_size_weight: currentWeights.company_size_weight + adjustment
    };

    // Clamp weights to min=0, max=50
    const clampedWeights = {
      title_match_weight: Math.max(0, Math.min(50, newWeights.title_match_weight)),
      industry_match_weight: Math.max(0, Math.min(50, newWeights.industry_match_weight)),
      company_size_weight: Math.max(0, Math.min(50, newWeights.company_size_weight))
    };

    // Get version number (count existing versions + 1)
    const historyRef = firestore.collection(`users/${user_id}/weights/history`);
    const historySnapshot = await historyRef.get();
    const versionNumber = historySnapshot.size + 1;

    const timestamp = new Date().toISOString();

    // Create version document
    const versionId = `v${versionNumber}_${Date.now()}`;
    const versionData = {
      version_number: versionNumber,
      timestamp: timestamp,
      weights: {
        title_match_weight: clampedWeights.title_match_weight,
        industry_match_weight: clampedWeights.industry_match_weight,
        company_size_weight: clampedWeights.company_size_weight
      },
      action_source: actionSource,
      lead_id: lead_data?.lead_id || null,
      contact_id: lead_data?.contact_id || null,
      adjustment: adjustment
    };

    // Update current weights
    await weightsRef.set({
      ...clampedWeights,
      updated_at: timestamp,
      version: versionNumber
    });

    // Create version history document
    await historyRef.doc(versionId).set(versionData);

    // Return new weights and version number
    return {
      statusCode: 200,
      body: JSON.stringify({
        new_weights: clampedWeights,
        version_number: versionNumber,
        adjustment: adjustment,
        action_type: actionSource
      })
    };

  } catch (error) {
    console.error('Error in learning engine:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to update weights',
        message: error.message
      })
    };
  }
};
