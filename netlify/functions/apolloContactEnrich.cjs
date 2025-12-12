// Module 11: Accept Contact → Enrich → Learn
// Enriches contact, creates lead, updates quotas, and triggers learning

const axios = require('axios');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin (only once)
let adminApp;
let db;

function getFirebaseAdmin() {
  if (!adminApp) {
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
    const { apollo_person_id, user_id, company_id, contact_data } = JSON.parse(event.body);

    // Validate input
    if (!apollo_person_id || !user_id || !company_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Check for Apollo API key
    if (!process.env.APOLLO_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Apollo API key not configured' })
      };
    }

    const firestore = getFirebaseAdmin();
    const today = new Date().toISOString().split('T')[0];
    const weekStart = getWeekStart(new Date());

    // Check Daily Quota (5 per company per day)
    const dailyQuotaRef = firestore.doc(`users/${user_id}/quotas/daily_enrichments`);
    const dailyQuotaDoc = await dailyQuotaRef.get();

    let dailyCount = 0;
    if (dailyQuotaDoc.exists()) {
      const data = dailyQuotaDoc.data();
      if (data[company_id] && data[company_id][today]) {
        dailyCount = data[company_id][today];
      }
    }

    if (dailyCount >= 5) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          error: 'quota_exceeded',
          message: 'Daily enrichment quota exceeded for this company (5/day)'
        })
      };
    }

    // Check Weekly Quota (50 per week total)
    const weeklyQuotaRef = firestore.doc(`users/${user_id}/quotas/weekly_enrichments`);
    const weeklyQuotaDoc = await weeklyQuotaRef.get();

    let weeklyCount = 0;
    if (weeklyQuotaDoc.exists()) {
      const data = weeklyQuotaDoc.data();
      if (data[weekStart]) {
        weeklyCount = data[weekStart];
      }
    }

    if (weeklyCount >= 50) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: false,
          error: 'quota_exceeded',
          message: 'Weekly enrichment quota exceeded (50/week)'
        })
      };
    }

    // Call Apollo API for full contact enrichment
    const apiUrl = `https://api.apollo.io/v1/people/match`;

    const requestBody = {
      api_key: process.env.APOLLO_API_KEY,
      id: apollo_person_id
    };

    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      timeout: 30000
    });

    if (!response.data || !response.data.person) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to enrich contact from Apollo' })
      };
    }

    const enrichedPerson = response.data.person;

    // Create Lead in Firestore
    const leadId = `lead_${Date.now()}_${apollo_person_id}`;
    const leadRef = firestore.doc(`users/${user_id}/leads/${leadId}`);

    const leadData = {
      lead_id: leadId,
      apollo_person_id: apollo_person_id,
      name: enrichedPerson.name || contact_data?.name || 'Unknown',
      first_name: enrichedPerson.first_name || '',
      last_name: enrichedPerson.last_name || '',
      title: enrichedPerson.title || contact_data?.title || '',
      email: enrichedPerson.email || '',
      phone: enrichedPerson.phone_numbers?.[0]?.sanitized_number || '',
      linkedin_url: enrichedPerson.linkedin_url || '',
      company_name: enrichedPerson.organization?.name || contact_data?.company_name || '',
      company_id: company_id,
      industry: enrichedPerson.organization?.industry || '',
      company_size: enrichedPerson.organization?.estimated_num_employees || '',
      location: enrichedPerson.city && enrichedPerson.state
        ? `${enrichedPerson.city}, ${enrichedPerson.state}`
        : enrichedPerson.country || '',
      enriched_at: new Date().toISOString(),
      status: 'pending_review',
      source: 'scout_accept'
    };

    await leadRef.set(leadData);

    // Log Event
    const eventId = `event_${Date.now()}_accept`;
    const eventRef = firestore.doc(`users/${user_id}/events/${eventId}`);

    await eventRef.set({
      event_id: eventId,
      action_type: 'accept_contact',
      apollo_person_id: apollo_person_id,
      lead_id: leadId,
      title: leadData.title,
      company_name: leadData.company_name,
      company_id: company_id,
      timestamp: new Date().toISOString()
    });

    // Update Daily Quota
    const dailyUpdate = {};
    dailyUpdate[`${company_id}.${today}`] = (dailyCount + 1);
    await dailyQuotaRef.set(dailyUpdate, { merge: true });

    // Update Weekly Quota
    const weeklyUpdate = {};
    weeklyUpdate[weekStart] = (weeklyCount + 1);
    await weeklyQuotaRef.set(weeklyUpdate, { merge: true });

    // Call Learning Engine
    const learningUrl = `${event.headers.origin || 'http://localhost:8888'}/.netlify/functions/learningEngine`;

    let learningResult = null;
    try {
      const learningResponse = await axios.post(learningUrl, {
        user_id: user_id,
        action_type: 'accept_contact',
        lead_data: {
          lead_id: leadId,
          contact_id: apollo_person_id
        }
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      learningResult = learningResponse.data;
    } catch (learningError) {
      console.error('Learning engine error:', learningError);
      // Continue even if learning fails
    }

    // Return success
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        lead_id: leadId,
        new_weights: learningResult?.new_weights || null,
        daily_quota: { used: dailyCount + 1, limit: 5 },
        weekly_quota: { used: weeklyCount + 1, limit: 50 }
      })
    };

  } catch (error) {
    console.error('Error enriching contact:', error);

    // Handle Apollo API errors
    if (error.response) {
      return {
        statusCode: error.response.status,
        body: JSON.stringify({
          error: 'Apollo API error',
          message: error.response.data?.message || error.message
        })
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to enrich contact',
        message: error.message
      })
    };
  }
};

// Helper function to get week start date (Monday)
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}
