import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ appCheck: null, auth: { currentUser: null } }));
vi.mock('firebase/app-check', () => ({ getToken: vi.fn() }));
import { ensureBillingCustomer } from '../services/billingCustomer.js';

afterEach(() => vi.unstubAllGlobals());

describe('ensureBillingCustomer client service', () => {
  it('sends only the signed-in Firebase token and handles success without exposing the customer id', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'linked' }) });
    vi.stubGlobal('fetch', fetch);
    const result = await ensureBillingCustomer({ getIdToken: vi.fn().mockResolvedValue('firebase-token') });
    expect(result).toEqual({ status: 'linked' });
    expect(fetch).toHaveBeenCalledWith('/.netlify/functions/ensure-billing-customer', expect.objectContaining({
      method: 'POST', cache: 'no-store',
      headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json' },
    }));
    expect(fetch.mock.calls[0][1].body).toBe('{}');
  });

  it('does not retry or suppress a server refusal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'billing_identity_needs_review' }) }));
    await expect(ensureBillingCustomer({ getIdToken: async () => 'token' })).rejects.toThrow('billing_identity_needs_review');
  });
});
