/**
 * CH-GMAIL-001 — the client half of Connect Gmail: every entry point sends the
 * ID token as a Bearer header, names the account it acts for, and asks to come
 * back to the page it started from; failures surface a message instead of a
 * silent redirect to nowhere.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../firebase/config', () => ({ auth: { currentUser: null }, db: {} }));

const { startGmailConnect, gmailOutcomeMessage, GMAIL_OUTCOME_MESSAGES } = await import('../utils/gmailConnect.js');

const user = { uid: 'A', getIdToken: async () => 'id-token-A' };

describe('startGmailConnect', () => {
  it('posts the token as a Bearer header with userId and returnTo, then goes to Google', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }) }));
    const navigate = vi.fn();
    await startGmailConnect({ user, returnTo: '/settings?tab=integrations', fetchImpl, navigate });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/.netlify/functions/gmail-oauth-init');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token-A');
    expect(JSON.parse(init.body)).toEqual({ userId: 'A', returnTo: '/settings?tab=integrations' });
    expect(init.body).not.toContain('id-token-A');
    expect(navigate).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });

  it('throws the server’s message and does not navigate when refused', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({ error: 'Unauthorized' }) }));
    const navigate = vi.fn();
    await expect(startGmailConnect({ user, returnTo: '/x', fetchImpl, navigate })).rejects.toThrow('Unauthorized');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('requires a signed-in user', async () => {
    await expect(startGmailConnect({ user: null, returnTo: '/x', fetchImpl: vi.fn() })).rejects.toThrow(/sign in/i);
  });
});

describe('gmailOutcomeMessage', () => {
  it('is silent on success or no outcome, and has a message for every failure', () => {
    expect(gmailOutcomeMessage(null)).toBeNull();
    expect(gmailOutcomeMessage('connected')).toBeNull();
    for (const [outcome, message] of Object.entries(GMAIL_OUTCOME_MESSAGES)) {
      if (outcome !== 'connected') expect(gmailOutcomeMessage(outcome)).toBe(message);
    }
  });

  it('matches every outcome the callback can send', async () => {
    const { OUTCOMES } = await import('../../netlify/functions/utils/gmailOAuth.js');
    expect(Object.keys(GMAIL_OUTCOME_MESSAGES).sort()).toEqual(Object.values(OUTCOMES).sort());
  });

  it('falls back to a generic message for an unknown outcome', () => {
    expect(gmailOutcomeMessage('<script>')).toBe(GMAIL_OUTCOME_MESSAGES.error);
  });
});
