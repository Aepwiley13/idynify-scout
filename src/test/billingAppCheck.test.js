import { describe, expect, it, vi } from 'vitest';
import { verifyBillingAppCheck } from '../../netlify/functions/utils/billingAppCheck.js';

describe('billing App Check enforcement', () => {
  it('does not change existing requests before enforcement is enabled', async () => {
    await expect(verifyBillingAppCheck({ headers: {} }, { required: false })).resolves.toBe(true);
  });

  it('requires a valid attestation only when explicitly enabled', async () => {
    const verifyToken = vi.fn().mockResolvedValue({ appId: 'staging-web-app' });
    await expect(verifyBillingAppCheck({ headers: { 'X-Firebase-AppCheck': 'attestation' } }, { required: true, verifyToken })).resolves.toBe(true);
    await expect(verifyBillingAppCheck({ headers: {} }, { required: true, verifyToken })).resolves.toBe(false);
    await expect(verifyBillingAppCheck({ headers: { 'x-firebase-appcheck': 'bad' } }, { required: true, verifyToken: async () => { throw new Error(); } })).resolves.toBe(false);
  });
});
