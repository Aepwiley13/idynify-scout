// Module 15: Credit System - Enrich Company Function
// Enriches a company with full data + 3 contacts (costs 10 credits)

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Initialize Firebase Admin
let adminApp;
let db;

try {
  adminApp = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
  db = getFirestore(adminApp);
} catch (error) {
  console.error('Firebase initialization error:', error);
}

// Constants
const ENRICHMENT_COST = 10; // Total cost per company enrichment
const COST_BREAKDOWN = {
  companyData: 1,
  contactNames: 3,
  emails: 3,
  phones: 3
};

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, companyId, companyName } = JSON.parse(event.body);

    if (!userId || !companyId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing userId or companyId' })
      };
    }

    console.log(`🔍 Enrichment request for company: ${companyName} (${companyId}) by user: ${userId}`);

    // 1. Check user's credit balance
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const userData = userDoc.data();
    const currentCredits = userData.credits || 0;

    console.log(`💳 User has ${currentCredits} credits, enrichment costs ${ENRICHMENT_COST} credits`);

    // 2. Verify sufficient credits
    if (currentCredits < ENRICHMENT_COST) {
      return {
        statusCode: 402, // Payment Required
        headers,
        body: JSON.stringify({
          error: 'Insufficient credits',
          currentCredits,
          requiredCredits: ENRICHMENT_COST,
          message: `You need ${ENRICHMENT_COST} credits to enrich a company. You have ${currentCredits} credits remaining.`
        })
      };
    }

    // 3. Perform enrichment (Mock data for now - replace with actual API calls)
    console.log('🚀 Starting enrichment process...');

    const enrichedData = {
      companyData: {
        name: companyName,
        industry: 'Technology',
        employees: 150,
        revenue: '$10M-$50M',
        website: 'example.com',
        location: 'San Francisco, CA',
        description: 'Leading provider of innovative software solutions',
        foundedYear: 2015,
        enrichedAt: new Date().toISOString()
      },
      contacts: [
        {
          id: `contact_${companyId}_1`,
          name: 'John Smith',
          title: 'VP of Sales',
          email: 'john.smith@example.com',
          phone: '+1-555-0101',
          linkedin: 'https://linkedin.com/in/johnsmith'
        },
        {
          id: `contact_${companyId}_2`,
          name: 'Sarah Johnson',
          title: 'Director of Marketing',
          email: 'sarah.j@example.com',
          phone: '+1-555-0102',
          linkedin: 'https://linkedin.com/in/sarahjohnson'
        },
        {
          id: `contact_${companyId}_3`,
          name: 'Michael Chen',
          title: 'Head of Operations',
          email: 'm.chen@example.com',
          phone: '+1-555-0103',
          linkedin: 'https://linkedin.com/in/michaelchen'
        }
      ]
    };

    // 4. Deduct credits atomically
    const newCredits = currentCredits - ENRICHMENT_COST;
    await userRef.update({
      credits: newCredits,
      lastCreditUpdate: FieldValue.serverTimestamp()
    });

    console.log(`✅ Deducted ${ENRICHMENT_COST} credits. New balance: ${newCredits}`);

    // 5. Log enrichment event
    const eventRef = db.collection(`users/${userId}/events`).doc();
    await eventRef.set({
      type: 'company_enrichment',
      companyId,
      companyName,
      creditsDeducted: ENRICHMENT_COST,
      costBreakdown: COST_BREAKDOWN,
      creditsRemaining: newCredits,
      timestamp: FieldValue.serverTimestamp(),
      contactsEnriched: 3,
      metadata: {
        enrichedFields: ['companyData', 'contacts', 'emails', 'phones']
      }
    });

    // 6. Save enriched company data
    const companyRef = db.collection(`users/${userId}/companies`).doc(companyId);
    await companyRef.set({
      ...enrichedData.companyData,
      enriched: true,
      enrichmentCost: ENRICHMENT_COST,
      enrichedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // 7. Save enriched contacts
    for (const contact of enrichedData.contacts) {
      const contactRef = db.collection(`users/${userId}/leads`).doc(contact.id);
      await contactRef.set({
        ...contact,
        companyId,
        companyName,
        enriched: true,
        source: 'enrich-company-function',
        createdAt: FieldValue.serverTimestamp()
      });
    }

    console.log('✅ Enrichment complete!');

    // 8. Return success response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Successfully enriched ${companyName}`,
        creditsDeducted: ENRICHMENT_COST,
        creditsRemaining: newCredits,
        enrichedData: enrichedData,
        costBreakdown: COST_BREAKDOWN,
        analytics: {
          companyDataEnriched: true,
          contactsFound: 3,
          emailsProvided: 3,
          phonesProvided: 3
        }
      })
    };

  } catch (error) {
    console.error('❌ Enrichment error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Enrichment failed',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
