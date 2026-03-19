import { google } from 'googleapis';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey
    })
  });
}

const db = getFirestore();

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      userId,
      authToken,
      contactEmail,   // optional — filter events by this attendee email
      timeMin,        // optional ISO 8601, defaults to now
      timeMax,        // optional ISO 8601, defaults to 30 days from now
      maxResults      // optional, defaults to 20
    } = JSON.parse(event.body);

    if (!userId || !authToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or authToken' }) };
    }

    // Verify Firebase auth token
    const firebaseApiKey = process.env.FIREBASE_API_KEY;
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: authToken })
      }
    );

    if (!verifyResponse.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid authentication token' }) };
    }

    const verifyData = await verifyResponse.json();
    if (verifyData.users[0].localId !== userId) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // Load calendar tokens
    const calSnap = await db.doc(`users/${userId}/integrations/googleCalendar`).get();
    if (!calSnap.exists || calSnap.data().status !== 'connected') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Google Calendar not connected', code: 'CALENDAR_NOT_CONNECTED' })
      };
    }

    const calData = calSnap.data();

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const calendarRedirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI?.replace('gmail-oauth-callback', 'calendar-oauth-callback');

    const oauth2Client = new google.auth.OAuth2(googleClientId, googleClientSecret, calendarRedirectUri);
    oauth2Client.setCredentials({
      access_token: calData.accessToken,
      refresh_token: calData.refreshToken,
      expiry_date: calData.expiresAt
    });

    oauth2Client.on('tokens', async (tokens) => {
      const update = { updatedAt: new Date().toISOString() };
      if (tokens.access_token) update.accessToken = tokens.access_token;
      if (tokens.expiry_date) update.expiresAt = tokens.expiry_date;
      await db.doc(`users/${userId}/integrations/googleCalendar`).update(update);
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const listParams = {
      calendarId: 'primary',
      timeMin: timeMin || now.toISOString(),
      timeMax: timeMax || thirtyDaysLater.toISOString(),
      maxResults: maxResults || 20,
      singleEvents: true,
      orderBy: 'startTime'
    };

    // If filtering by contact email, use the q param (searches title, description, attendees)
    if (contactEmail) {
      listParams.q = contactEmail;
    }

    console.log('📅 Listing calendar events for user:', userId, contactEmail ? `— filtering by: ${contactEmail}` : '');

    const response = await calendar.events.list(listParams);

    let events = response.data.items || [];

    // If filtering by contact email, also filter by attendees (q param is fuzzy)
    if (contactEmail) {
      events = events.filter(event => {
        const attendees = event.attendees || [];
        return attendees.some(a => a.email?.toLowerCase() === contactEmail.toLowerCase());
      });
    }

    const formattedEvents = events.map(event => ({
      id: event.id,
      title: event.summary || '(No title)',
      description: event.description || '',
      location: event.location || '',
      startDateTime: event.start?.dateTime || event.start?.date,
      endDateTime: event.end?.dateTime || event.end?.date,
      isAllDay: !event.start?.dateTime,
      attendees: (event.attendees || []).map(a => ({
        email: a.email,
        name: a.displayName || a.email,
        status: a.responseStatus // accepted, declined, tentative, needsAction
      })),
      organizer: event.organizer?.email || null,
      htmlLink: event.htmlLink,
      status: event.status, // confirmed, tentative, cancelled
      created: event.created,
      updated: event.updated
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        events: formattedEvents,
        count: formattedEvents.length,
        filteredByContact: !!contactEmail
      })
    };

  } catch (error) {
    console.error('❌ calendar-list-events error:', error);

    const isAuthError = error.code === 401 || error.message?.includes('invalid_grant');
    if (isAuthError) {
      try {
        const { userId } = JSON.parse(event.body);
        if (userId) {
          await db.doc(`users/${userId}/integrations/googleCalendar`).update({
            status: 'expired',
            updatedAt: new Date().toISOString()
          });
        }
      } catch (_) {}

      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Calendar session expired. Please reconnect.', code: 'NEEDS_RECONNECT' })
      };
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
