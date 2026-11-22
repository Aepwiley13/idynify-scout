import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { google } from 'googleapis';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, db } from '../firebase-admin.js';
import { buildPlainTextEmail } from './emailHeaders.js';
import { createContactHubGmail } from './contactHubGmail.js';

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const failed = (code) => Object.assign(new Error(code), { code });

function oauth() {
  const id = process.env.CONTACT_HUB_GMAIL_CLIENT_ID;
  const secret = process.env.CONTACT_HUB_GMAIL_CLIENT_SECRET;
  const redirect = process.env.CONTACT_HUB_GMAIL_REDIRECT_URI;
  if (!id || !secret || !redirect || id === process.env.GOOGLE_CLIENT_ID) throw new Error('Gmail OAuth unavailable');
  return new google.auth.OAuth2(id, secret, redirect);
}

const gmail = {
  connectUrl(state, verifier) {
    return oauth().generateAuthUrl({
      access_type: 'offline', prompt: 'consent', include_granted_scopes: false,
      scope: [SEND_SCOPE, EMAIL_SCOPE], state, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
  },
  async exchange(code, verifier) {
    const client = oauth();
    const { tokens } = await client.getToken({ code, codeVerifier: verifier });
    if (!tokens.access_token || !tokens.refresh_token || !tokens.scope?.split(' ').includes(SEND_SCOPE)) throw new Error('Gmail send permission missing');
    client.setCredentials(tokens);
    const { data } = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    if (!data.email || !data.verified_email) throw new Error('Gmail address unavailable');
    return {
      refreshToken: tokens.refresh_token, email: data.email,
    };
  },
  async revoke(refreshToken) {
    try {
      await oauth().revokeToken(refreshToken);
    } catch (error) {
      if (error.response?.status !== 400 || error.response?.data?.error !== 'invalid_token') throw error;
    }
  },
  async send(connection, message) {
    if (connection.source !== 'contact_hub_manual') throw failed('connect_gmail');
    let token = connection.accessToken;
    if (!token || Date.now() >= (connection.expiresAt ?? 0) - 60_000) {
      try {
        const refresh = oauth();
        refresh.setCredentials({ refresh_token: connection.refreshToken });
        const { credentials } = await refresh.refreshAccessToken();
        token = credentials.access_token;
        if (!token) throw new Error('No access token');
      } catch { throw failed('connect_gmail'); }
    }

    // Only give the transport an access token. The OAuth client cannot refresh and replay a send.
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    const raw = Buffer.from(buildPlainTextEmail(message), 'utf8').toString('base64url');
    try {
      const { data } = await google.gmail({ version: 'v1', auth }).users.messages.send(
        { userId: 'me', requestBody: { raw } }, { retry: false, timeout: 12_000 },
      );
      if (!data.id) throw new Error('Gmail response without message ID');
      return data.id;
    } catch (error) {
      const status = error.response?.status;
      const reasons = error.response?.data?.error?.errors ?? [];
      if (status === 429 || reasons.some(({ reason }) => /quota|ratelimit/i.test(reason ?? ''))) throw failed('gmail_quota');
      if (status === 401 || status === 403) throw failed('connect_gmail');
      if (status === 400) throw failed('gmail_rejected');
      throw failed('send_unconfirmed');
    }
  },
};

export const contactHubGmail = createContactHubGmail({
  db, verifyToken: (token) => admin.auth().verifyIdToken(token, true), gmail,
  enabled: () => process.env.CONTACT_HUB_GMAIL === 'on',
  sendingEnabled: () => process.env.CONTACT_HUB_GMAIL_SEND === 'on',
  timestamp: (ms) => ms === undefined ? Timestamp.now() : Timestamp.fromMillis(ms),
});
