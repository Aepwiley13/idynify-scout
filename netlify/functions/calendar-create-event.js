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
      title,
      description,
      startDateTime,  // ISO 8601 string e.g. "2026-03-10T14:00:00"
      endDateTime,    // ISO 8601 string
      timeZone,       // e.g. "America/New_York"
      attendeeEmail,
      attendeeName,
      contactId,
      location
    } = JSON.parse(event.body);

    if (!userId || !authToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or authToken' }) };
    }

    if (!startDateTime || !endDateTime) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing startDateTime or endDateTime' }) };
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

    // Load calendar tokens from Firestore
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

    // Auto-refresh token if needed
    oauth2Client.on('tokens', async (tokens) => {
      const update = { updatedAt: new Date().toISOString() };
      if (tokens.access_token) update.accessToken = tokens.access_token;
      if (tokens.expiry_date) update.expiresAt = tokens.expiry_date;
      await db.doc(`users/${userId}/integrations/googleCalendar`).update(update);
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Build event payload
    const eventPayload = {
      summary: title || 'Meeting',
      description: description || '',
      location: location || '',
      start: {
        dateTime: startDateTime,
        timeZone: timeZone || 'UTC'
      },
      end: {
        dateTime: endDateTime,
        timeZone: timeZone || 'UTC'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 },
          { method: 'popup', minutes: 15 }
        ]
      }
    };

    // Add attendee if email is provided
    if (attendeeEmail) {
      eventPayload.attendees = [
        { email: attendeeEmail, displayName: attendeeName || attendeeEmail }
      ];
      // Send invite to attendee
      eventPayload.guestsCanModify = false;
      eventPayload.guestsCanInviteOthers = false;
    }

    console.log('📅 Creating calendar event:', title, 'for user:', userId);

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: eventPayload,
      sendUpdates: attendeeEmail ? 'externalOnly' : 'none' // Send invite if attendee present
    });

    const createdEvent = response.data;
    console.log('✅ Calendar event created:', createdEvent.id);

    // Log to contact timeline if contactId provided
    if (contactId) {
      await db
        .collection('users')
        .doc(userId)
        .collection('contacts')
        .doc(contactId)
        .collection('timeline')
        .add({
          timestamp: new Date().toISOString(),
          actor: 'user',
          activityType: 'meeting_scheduled',
          channel: 'calendar',
          outcome: 'meeting_booked',
          metadata: {
            eventId: createdEvent.id,
            eventLink: createdEvent.htmlLink,
            title: title,
            startDateTime,
            endDateTime,
            attendeeEmail: attendeeEmail || null
          }
        });

      // Update contact's next_step fields
      await db
        .collection('users')
        .doc(userId)
        .collection('contacts')
        .doc(contactId)
        .update({
          contact_status: 'In Conversation',
          next_step_type: 'follow_up',
          next_step_due: endDateTime,
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        eventId: createdEvent.id,
        eventLink: createdEvent.htmlLink,
        title: createdEvent.summary,
        startDateTime: createdEvent.start.dateTime,
        endDateTime: createdEvent.end.dateTime
      })
    };

  } catch (error) {
    console.error('❌ calendar-create-event error:', error);

    const isAuthError = error.code === 401 || error.message?.includes('invalid_grant');
    if (isAuthError) {
      // Mark token as needing reconnect
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
        body: JSON.stringify({ error: 'Calendar session expired. Please reconnect Google Calendar.', code: 'NEEDS_RECONNECT' })
      };
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
