/**
 * FIND CONTACT BY EMAIL — Sprint 3
 *
 * Looks up a person via Apollo's People Match API using email address.
 * Used when importing contacts from Gmail threads into Scout.
 *
 * POST body: { userId, authToken, email }
 * Response: { success, contact: { name, title, email, ... } }
 */

import { APOLLO_ENDPOINTS, getApolloApiKey, getApolloHeaders } from './utils/apolloConstants.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { userId, authToken, email } = JSON.parse(event.body);

    if (!userId || !authToken || !email) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing required parameters' }) };
    }

    // Verify Firebase Auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    if (!firebaseApiKey) throw new Error('Firebase API key not configured');

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: authToken }) }
    );
    if (!verifyRes.ok) throw new Error('Invalid authentication token');
    const verifyData = await verifyRes.json();
    if (verifyData.users[0]?.localId !== userId) throw new Error('Token does not match user ID');

    console.log(`[find-contact-by-email] Looking up: ${email}`);

    // Call Apollo People Match with email
    const apolloRes = await fetch(APOLLO_ENDPOINTS.PEOPLE_MATCH, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify({
        email,
        reveal_personal_emails: false,
        reveal_phone_number: false
      })
    });

    if (!apolloRes.ok) {
      const errBody = await apolloRes.text();
      console.error('[find-contact-by-email] Apollo error:', apolloRes.status, errBody);
      // Return success with null contact — email not found in Apollo is not an error
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, contact: null, source: 'email_only', emailProvided: email })
      };
    }

    const data = await apolloRes.json();
    const person = data.person;

    if (!person) {
      // No Apollo match — return minimal contact from email alone
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          contact: null,
          source: 'email_only',
          emailProvided: email
        })
      };
    }

    // Return enriched contact data
    const contact = {
      id: person.id,
      name: person.name || [person.first_name, person.last_name].filter(Boolean).join(' '),
      first_name: person.first_name || null,
      last_name: person.last_name || null,
      title: person.title || null,
      email: person.email || email,
      phone_numbers: person.phone_numbers || [],
      linkedin_url: person.linkedin_url || null,
      photo_url: person.photo_url || null,
      location: [person.city, person.state, person.country].filter(Boolean).join(', ') || null,
      organization_name: person.organization?.name || null,
      organization_id: person.organization_id || null,
      organization: person.organization || null,
      departments: person.departments || [],
      seniority: person.seniority || null,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: true, contact, source: 'apollo' })
    };

  } catch (error) {
    console.error('[find-contact-by-email] Error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message })
    };
  }
};
