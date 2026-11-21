import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testTransport, mocks } = vi.hoisted(() => ({
  testTransport: { current: null },
  mocks: { identity: vi.fn(), deliver: vi.fn() },
}));
vi.mock('../../netlify/functions/firebase-admin.js', () => ({ admin: {}, db: {} }));
vi.mock('../../netlify/functions/utils/contactHubGmail.js', () => ({
  createContactHubGmail: ({ gmail }) => {
    testTransport.current = gmail;
    return {};
  },
}));
vi.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    oauth2: () => ({ userinfo: { get: mocks.identity } }),
    gmail: () => ({ users: { messages: { send: mocks.deliver } } }),
  },
}));
import '../../netlify/functions/utils/contactHubGmailRuntime.js';

const connection = {
  email: 'sender@example.org', accessToken: 'fixture-only', expiresAt: Number.MAX_SAFE_INTEGER,
};
const message = { toEmail: 'saved@example.org', subject: 'Hello', body: 'Fixture body' };

beforeEach(() => {
  mocks.identity.mockResolvedValue({ data: { email: 'SENDER@example.org', verified_email: true } });
  mocks.deliver.mockResolvedValue({ data: { id: 'fixture-id' } });
});
afterEach(() => vi.resetAllMocks());

describe('Contact Hub Gmail transport', () => {
  it.each([
    { email: 'other@example.org', verified_email: true },
    { email: 'sender@example.org', verified_email: false },
  ])('stops a legacy send when Google identity is not verified for the selected sender', async (identity) => {
    mocks.identity.mockResolvedValueOnce({ data: identity });
    await expect(testTransport.current.send({ ...connection, legacy: true }, message)).rejects.toMatchObject({ code: 'connect_gmail' });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it('uses a verified legacy sender with transport retry disabled', async () => {
    await expect(testTransport.current.send({ ...connection, legacy: true }, message)).resolves.toBe('fixture-id');
    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(mocks.deliver).toHaveBeenCalledWith({ userId: 'me', requestBody: { raw: expect.any(String) } }, { retry: false, timeout: 12_000 });
  });

  it('uses the dedicated connection whose sender was verified during OAuth', async () => {
    await expect(testTransport.current.send({ ...connection, legacy: false }, message)).resolves.toBe('fixture-id');
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.deliver).toHaveBeenCalledOnce();
  });
});
