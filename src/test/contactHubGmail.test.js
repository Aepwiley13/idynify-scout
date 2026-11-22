import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createContactHubGmail } from '../../netlify/functions/utils/contactHubGmail';

function fixture({ sendingEnabled = true, now = () => 1_000 } = {}) {
  const records = new Map([
    ['users/owner', { plan: 'free' }],
    ['users/owner/contacts/alex', { email: 'alex@example.com', status: 'saved' }],
    ['users/owner/contacts/sam', { email: 'sam@example.com' }],
    ['users/owner/integrations/gmail', { status: 'connected', email: 'me@example.com', refreshToken: 'private' }],
  ]);
  records.set('contact_hub_gmail/owner', {
    status: 'connected', source: 'contact_hub_manual', email: 'me@example.com', refreshToken: 'dedicated',
  });
  const sessions = [];
  const timestamp = (ms = 1_000) => ({ toMillis: () => ms });
  const doc = (path) => ({
    path, id: path.split('/').at(-1), collection: (name) => ({ doc: (id) => doc(`${path}/${name}/${id}`) }),
    update: async (data) => records.set(path, { ...records.get(path), ...data }),
  });
  const snapshot = (path) => ({ exists: records.has(path), data: () => records.get(path) });
  const query = { where: () => query };
  const tx = {
    get: async (ref) => ref === query ? { docs: sessions.map((value) => ({ data: () => value })) } : snapshot(ref.path),
    set: (ref, data) => records.set(ref.path, data),
    delete: (ref) => records.delete(ref.path),
    update: (ref, data) => ref.update(data),
  };
  let prior = Promise.resolve();
  const db = {
    doc, collection: () => query,
    runTransaction(fn) {
      const result = prior.then(() => fn(tx));
      prior = result.catch(() => {});
      return result;
    },
  };
  const gmail = {
    revoke: vi.fn(async () => {}),
    send: vi.fn(async () => 'gmail-id'),
    connectUrl: vi.fn((state) => `https://accounts.google.com/?state=${state}`),
    exchange: vi.fn(async () => ({ email: 'mine@example.com', refreshToken: 'new-private' })),
  };
  const { api, callback } = createContactHubGmail({
    db, gmail, timestamp, now, enabled: () => true, sendingEnabled: () => sendingEnabled,
    verifyToken: async (token) => token === 'custom'
      ? { uid: 'owner', firebase: { sign_in_provider: 'custom' } }
      : { uid: token },
  });
  const call = (body, token = 'owner') => api({
    httpMethod: 'POST', headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ uid: 'owner', contactId: 'alex', ...body }),
  }).then((result) => ({ ...result, data: JSON.parse(result.body) }));
  const message = () => ({ action: 'send', requestId: randomUUID(), recipient: 'alex@example.com', sender: 'me@example.com', subject: 'Hello', message: 'Great to meet you' });
  return { records, sessions, gmail, call, callback, message };
}

describe('Contact Hub manual Gmail', () => {
  it.each(['free', 'scout'])('sends for %s and records one activity without changing the contact or integration', async (plan) => {
    const { records, gmail, call, message } = fixture();
    records.set('users/owner', { plan });
    const original = records.get('users/owner/contacts/alex');
    const integration = records.get('users/owner/integrations/gmail');
    expect((await call({ action: 'status' })).data).toEqual({
      recipient: 'alex@example.com', connected: true, sender: 'me@example.com',
    });
    const draft = message();
    await Promise.all([call(draft), call(draft)]);
    expect((await call(draft)).data).toEqual({ status: 'sent' });
    expect(records.get(`contact_hub_gmail_limits/owner/attempts/${draft.requestId}`).contactId).toBe('alex');
    expect(gmail.send).toHaveBeenCalledTimes(1);
    expect(gmail.send).toHaveBeenCalledWith(records.get('contact_hub_gmail/owner'), { toEmail: 'alex@example.com', subject: 'Hello', body: 'Great to meet you' });
    expect(records.get(`users/owner/contacts/alex/timeline/contact-hub-gmail-${draft.requestId}`)).toMatchObject({
      type: 'message_sent', actor: 'user', preview: 'Hello',
      metadata: { channel: 'email', source: 'contact_hub_manual', gmail_message_id: 'gmail-id' },
    });
    expect(records.get('users/owner/contacts/alex')).toEqual(original);
    expect(records.get('users/owner/integrations/gmail')).toEqual(integration);
    expect((await call({ ...draft, message: 'Different message' })).data.error).toBe('intent_changed');
  });

  it('can verify connection status with live sends disabled', async () => {
    const { records, gmail, call, message } = fixture({ sendingEnabled: false });
    expect((await call({ action: 'status' })).data.connected).toBe(true);
    expect((await call(message())).data.error).toBe('sending_disabled');
    expect(gmail.send).not.toHaveBeenCalled();
    expect([...records.keys()].some((key) => key.startsWith('contact_hub_gmail_limits/'))).toBe(false);
  });

  it('rejects another account, impersonation, missing contacts, and recipient substitution', async () => {
    const { sessions, gmail, call, message } = fixture();
    expect((await call(message(), 'other')).statusCode).toBe(403);
    expect((await call(message(), 'custom')).statusCode).toBe(403);
    expect((await call({ ...message(), contactId: 'missing' })).statusCode).toBe(404);
    expect((await call({ ...message(), recipient: 'stranger@example.com' })).data.error).toBe('recipient_changed');
    expect((await call({ ...message(), sender: 'someone@example.com' })).data.error).toBe('sender_changed');
    sessions.push({});
    expect((await call(message())).data.error).toBe('read_only');
    expect(gmail.send).not.toHaveBeenCalled();
  });

  it('blocks a retired contact before reservation and leaves the send ledger untouched', async () => {
    const { records, gmail, call, message } = fixture();
    const path = 'users/owner/contacts/alex';
    records.set(path, { ...records.get(path), contact_hub_lifecycle: { status: 'retired' } });
    const draft = message();
    expect((await call(draft)).data.error).toBe('contact_unavailable');
    expect(gmail.send).not.toHaveBeenCalled();
    expect(records.has(`contact_hub_gmail_limits/owner/attempts/${draft.requestId}`)).toBe(false);
  });

  it('enforces normalized authoritative suppression without changing an existing receipt', async () => {
    const { records, gmail, call, message } = fixture();
    const sent = message();
    expect((await call(sent)).data.status).toBe('sent');
    records.set('emailSuppressionList/alex@example.com', { reason: 'unsubscribe' });
    expect((await call(sent)).data.status).toBe('sent');
    expect((await call(message())).data.error).toBe('email_suppressed');
    expect(gmail.send).toHaveBeenCalledTimes(1);
  });

  it('never replays an unconfirmed send and gives quota feedback', async () => {
    const { gmail, call, message } = fixture();
    gmail.send.mockRejectedValueOnce(new Error('timeout'));
    const draft = message();
    const expected = { status: 'unknown', reason: 'send_unconfirmed' };
    expect((await call(draft)).data).toEqual(expected);
    expect((await call(draft)).data).toEqual(expected);
    gmail.send.mockRejectedValueOnce(Object.assign(new Error(), { code: 'gmail_quota' }));
    expect((await call(message())).data).toEqual({ status: 'rejected', reason: 'gmail_quota' });
    for (let i = 0; i < 3; i += 1) await call(message());
    expect((await call(message())).data.error).toBe('app_limit');
    expect(gmail.send).toHaveBeenCalledTimes(5);
  });

  it('enforces the daily limit across minute windows and resets at the next UTC day', async () => {
    let ms = 1_000;
    const { call, gmail, message } = fixture({ now: () => ms });
    for (let i = 0; i < 30; i += 1) {
      expect((await call(message())).data.status).toBe('sent');
      ms += 60_000;
    }
    expect((await call(message())).data.error).toBe('app_limit');
    ms = 86_400_000;
    expect((await call(message())).data.status).toBe('sent');
    expect(gmail.send).toHaveBeenCalledTimes(31);
  });

  it('disconnects only the dedicated grant, retries revocation, and keeps sent activity', async () => {
    const { records, sessions, gmail, call, message } = fixture();
    const scout = records.get('users/owner/integrations/gmail');
    expect((await call(message())).data.status).toBe('sent');
    sessions.push({});
    expect((await call({ action: 'disconnect' })).data.error).toBe('read_only');
    sessions.pop();
    gmail.revoke.mockRejectedValueOnce(new Error('temporary'));
    expect((await call({ action: 'disconnect' })).statusCode).toBe(503);
    expect((await call({ action: 'status' })).data).toMatchObject({ connected: false, disconnectPending: true });
    expect((await call(message())).data.error).toBe('connect_gmail');
    expect((await call({ action: 'connect' })).data.error).toBe('disconnect_first');
    expect((await call({ action: 'disconnect', contactId: null })).data.status).toBe('disconnected');
    expect(gmail.revoke.mock.calls).toEqual([['dedicated'], ['dedicated']]);
    expect(records.get('contact_hub_gmail/owner')).toEqual({ generation: expect.any(String), status: 'disconnected' });
    expect(records.get('users/owner/integrations/gmail')).toEqual(scout);
    expect((await call({ action: 'status' })).data.connected).toBe(false);
    expect([...records.keys()].some((key) => key.includes('/timeline/'))).toBe(true);
  });

  it('invalidates an OAuth attempt started before disconnect', async () => {
    const { records, gmail, call, callback } = fixture();
    records.delete('contact_hub_gmail/owner');
    const started = await call({ action: 'connect' });
    await call({ action: 'disconnect' });
    const state = new URL(started.data.url).searchParams.get('state');
    await callback({ httpMethod: 'GET', queryStringParameters: { state, code: 'oauth-code' },
      headers: { cookie: started.headers['Set-Cookie'].split(';')[0] } });
    expect(gmail.exchange).not.toHaveBeenCalled();
  });

  it('finishes OAuth only in the originating browser, account, and contact', async () => {
    const { records, gmail, call, callback } = fixture();
    records.delete('contact_hub_gmail/owner');
    expect((await call({ action: 'status' })).data.connected).toBe(false);
    const started = await call({ action: 'connect' });
    const state = new URL(started.data.url).searchParams.get('state');
    const cookie = started.headers['Set-Cookie'].split(';')[0];
    const event = { httpMethod: 'GET', queryStringParameters: { state, code: 'oauth-code' } };
    await callback(event);
    expect(gmail.exchange).not.toHaveBeenCalled();
    const returned = await callback({ ...event, headers: { cookie } });
    const location = new URL(returned.headers.Location, 'https://contact.example');
    expect(location.pathname).toBe('/contact-hub/person/alex');
    expect(location.searchParams.get('compose')).toBe('email');
    const completion = location.searchParams.get('gmail_connection');
    expect(records.has('contact_hub_gmail/owner')).toBe(false);
    expect((await call({ action: 'finish_connect', completion, contactId: 'sam' })).statusCode).toBe(403);
    expect((await call({ action: 'finish_connect', completion }, 'other')).statusCode).toBe(403);
    expect((await call({ action: 'finish_connect', completion })).data.status).toBe('connected');
    expect((await call({ action: 'finish_connect', completion })).statusCode).toBe(403);
    expect((await call({ action: 'status' })).data.sender).toBe('mine@example.com');
    await callback({ ...event, headers: { cookie } });
    expect(gmail.exchange).toHaveBeenCalledTimes(1);
  });
});
