/**
 * Barry Actions — Unified action execution layer for Gmail and Calendar.
 *
 * Barry understands intent from the user's message and executes actions
 * using the existing Gmail and Calendar scaffolds without the user leaving
 * the platform.
 *
 * Supported actions:
 *   gmail_send        — Send an email on behalf of the user
 *   gmail_draft       — Stage a draft (returns draft for user confirmation)
 *   gmail_read        — Read recent inbox threads
 *   calendar_book     — Book a meeting (creates Google Calendar event)
 *   calendar_check    — Check availability / list upcoming events
 *
 * Flow:
 *   1. Barry parses intent from the user's message + context
 *   2. Returns action_type + parameters for user confirmation (if destructive)
 *   3. On confirm=true, executes the action against the existing scaffold
 *
 * POST /.netlify/functions/barryActions
 */

import Anthropic from '@anthropic-ai/sdk';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { logApiUsage } from './utils/logApiUsage.js';

if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'idynify-scout-dev',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const db = getFirestore();

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function verifyAuth(userId, authToken) {
  const firebaseApiKey = process.env.FIREBASE_API_KEY;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: authToken }) }
  );
  if (!res.ok) throw new Error('Invalid authentication token');
  const data = await res.json();
  if (data.users[0].localId !== userId) throw new Error('Token mismatch');
}

// ─── Google OAuth client ──────────────────────────────────────────────────────

async function getOAuthClient(userId, service) {
  const tokenDoc = await db.collection('users').doc(userId).collection('integrations').doc(service).get();
  if (!tokenDoc.exists) throw new Error(`${service}_not_connected`);
  const tokens = tokenDoc.data();
  if (!tokens.access_token) throw new Error(`${service}_not_connected`);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });

  // Persist refreshed tokens if they change
  oauth2Client.on('tokens', async (newTokens) => {
    if (newTokens.access_token) {
      await db.collection('users').doc(userId).collection('integrations').doc(service).set(
        { access_token: newTokens.access_token, updatedAt: new Date() },
        { merge: true }
      );
    }
  });

  return oauth2Client;
}

// ─── Action intent parser ─────────────────────────────────────────────────────

const INTENT_SYSTEM = `You are Barry, an AI assistant parsing the user's intent into a structured action.

Given a user message and context, determine what action Barry should take.

Respond with ONLY a JSON object (no markdown):
{
  "action_type": "gmail_send" | "gmail_draft" | "gmail_read" | "calendar_book" | "calendar_check" | "none",
  "confidence": 0.0-1.0,
  "parameters": {
    // For gmail_send / gmail_draft:
    "to_email": string,
    "to_name": string,
    "subject": string,
    "body": string,

    // For calendar_book:
    "title": string,
    "attendee_email": string,
    "start_time": "ISO8601",
    "end_time": "ISO8601",
    "description": string,

    // For calendar_check:
    "days_ahead": number,

    // For gmail_read:
    "max_results": number
  },
  "confirmation_required": true | false,
  "summary": "One sentence describing what Barry will do"
}

Rules:
- confirmation_required=true for gmail_send and calendar_book (these are irreversible)
- confidence below 0.7 → action_type="none", ask user to clarify
- If parameters are missing (e.g. no email address for send), action_type="none" and explain in summary`;

async function parseIntent(message, context, anthropic) {
  const contextStr = context ? `\nContext: ${JSON.stringify(context)}` : '';
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Parse this user message into a Barry action.${contextStr}\n\nUser message: "${message}"`
    }],
    system: INTENT_SYSTEM,
  });

  const raw = response.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    return { action_type: 'none', confidence: 0, parameters: {}, confirmation_required: false, summary: 'Could not parse intent' };
  }
}

// ─── Action executors ─────────────────────────────────────────────────────────

async function executeGmailSend(userId, params) {
  const auth = await getOAuthClient(userId, 'gmail');
  const gmail = google.gmail({ version: 'v1', auth });

  // Fetch user's signature if available
  let signature = '';
  try {
    const sigDoc = await db.collection('users').doc(userId).collection('integrations').doc('gmail').get();
    signature = sigDoc.data()?.signature || '';
  } catch (_) {}

  const body = params.body + (signature ? `\n\n${signature}` : '');
  const raw = Buffer.from(
    `To: ${params.to_name ? `${params.to_name} <${params.to_email}>` : params.to_email}\r\n` +
    `Subject: ${params.subject}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
    body
  ).toString('base64url');

  const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { messageId: sent.data.id, threadId: sent.data.threadId };
}

async function executeGmailRead(userId, params) {
  const auth = await getOAuthClient(userId, 'gmail');
  const gmail = google.gmail({ version: 'v1', auth });

  const list = await gmail.users.messages.list({
    userId: 'me',
    maxResults: params.max_results || 5,
    labelIds: ['INBOX'],
  });

  const threads = await Promise.all(
    (list.data.messages || []).slice(0, 5).map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
      const headers = msg.data.payload?.headers || [];
      const get = (name) => headers.find(h => h.name === name)?.value || '';
      return { id: m.id, subject: get('Subject'), from: get('From'), date: get('Date'), snippet: msg.data.snippet };
    })
  );
  return { threads };
}

async function executeCalendarBook(userId, params) {
  const auth = await getOAuthClient(userId, 'calendar');
  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary: params.title,
    description: params.description || '',
    start: { dateTime: params.start_time, timeZone: 'UTC' },
    end:   { dateTime: params.end_time,   timeZone: 'UTC' },
    attendees: params.attendee_email ? [{ email: params.attendee_email }] : [],
  };

  const created = await calendar.events.insert({ calendarId: 'primary', requestBody: event, sendUpdates: 'all' });
  return { eventId: created.data.id, htmlLink: created.data.htmlLink };
}

async function executeCalendarCheck(userId, params) {
  const auth = await getOAuthClient(userId, 'calendar');
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const future = new Date(now.getTime() + (params.days_ahead || 7) * 24 * 60 * 60 * 1000);

  const events = await calendar.events.list({
    calendarId: 'primary',
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 10,
  });

  return { events: (events.data.items || []).map(e => ({
    id: e.id,
    title: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end:   e.end?.dateTime   || e.end?.date,
    attendees: (e.attendees || []).map(a => a.email),
  })) };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let userId, authToken, message, context, confirm, pendingAction;
  try {
    ({ userId, authToken, message, context = {}, confirm = false, pendingAction = null } = JSON.parse(event.body));
    if (!userId || !authToken) throw new Error('Missing userId or authToken');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: err.message }) };
  }

  try {
    await verifyAuth(userId, authToken);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // ── Confirmed execution path ────────────────────────────────────────────
    if (confirm && pendingAction) {
      let result;
      let actionText = '';

      if (pendingAction.action_type === 'gmail_send') {
        result = await executeGmailSend(userId, pendingAction.parameters);
        actionText = `Email sent to ${pendingAction.parameters.to_name || pendingAction.parameters.to_email}.`;
      } else if (pendingAction.action_type === 'calendar_book') {
        result = await executeCalendarBook(userId, pendingAction.parameters);
        actionText = `Meeting booked: "${pendingAction.parameters.title}". ${result.htmlLink ? `View: ${result.htmlLink}` : ''}`;
      } else {
        return { statusCode: 400, body: JSON.stringify({ error: 'Action type not executable via confirm' }) };
      }

      await logApiUsage(userId, 'barryActions', 'success', { responseTime: Date.now() - startTime, metadata: { action: pendingAction.action_type } });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, executed: true, message: actionText, result }),
      };
    }

    // ── Parse intent + execute non-destructive actions immediately ──────────
    if (!message?.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'message is required' }) };
    }

    const intent = await parseIntent(message, context, anthropic);

    // Non-destructive actions execute immediately
    if (!intent.confirmation_required && intent.action_type !== 'none' && intent.confidence >= 0.7) {
      let result;
      if (intent.action_type === 'gmail_read') {
        result = await executeGmailRead(userId, intent.parameters);
      } else if (intent.action_type === 'calendar_check') {
        result = await executeCalendarCheck(userId, intent.parameters);
      } else if (intent.action_type === 'gmail_draft') {
        // Return draft for user review — no send
        result = { draft: intent.parameters };
      }

      await logApiUsage(userId, 'barryActions', 'success', { responseTime: Date.now() - startTime, metadata: { action: intent.action_type } });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, executed: true, action: intent, result }),
      };
    }

    // Destructive actions need confirmation — return intent for UI to confirm
    if (intent.confirmation_required && intent.confidence >= 0.7) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, executed: false, requires_confirmation: true, action: intent }),
      };
    }

    // Low confidence or no action — return clarification message
    await logApiUsage(userId, 'barryActions', 'success', { responseTime: Date.now() - startTime, metadata: { action: 'none' } });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, executed: false, requires_confirmation: false, action: intent }),
    };

  } catch (err) {
    console.error('[barryActions] error:', err);
    // Surface integration-not-connected errors cleanly
    if (err.message?.includes('_not_connected')) {
      const service = err.message.replace('_not_connected', '');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'not_connected', service, message: `${service} is not connected. Go to Settings > Integrations to connect it.` }),
      };
    }
    await logApiUsage(userId || 'unknown', 'barryActions', 'error', { responseTime: Date.now() - startTime, errorCode: err.message }).catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
