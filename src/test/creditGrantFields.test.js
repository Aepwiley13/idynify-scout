/**
 * Pure unit tests — no emulator. Runs under plain `npm test`.
 *
 * creditGrantFields.js was extracted out of stripe-webhook.js so scripts/manualCreditRecovery.mjs
 * can reuse the exact same grant logic the automated webhook path uses, rather than a hand-rolled
 * approximation that could drift from it. These tests pin the extracted behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { tierForPrice, creditGrantFields, TIER_CREDITS } from '../../netlify/functions/utils/creditGrantFields.js';

describe('creditGrantFields — shared between the automated webhook path and manual recovery', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter_unit';
    process.env.STRIPE_PRICE_PRO = 'price_pro_unit';
  });

  it('tierForPrice maps the pro price to pro and everything else to starter', () => {
    expect(tierForPrice('price_pro_unit')).toBe('pro');
    expect(tierForPrice('price_starter_unit')).toBe('starter');
    expect(tierForPrice('price_unrelated')).toBe('starter');
  });

  it('grants starter credits for the starter price', () => {
    const { tier, fields } = creditGrantFields('price_starter_unit');
    expect(tier).toBe('starter');
    expect(fields.hasCompletedPayment).toBe(true);
    expect(fields.credits).toEqual({ total: TIER_CREDITS.starter.credits, used: 0, remaining: TIER_CREDITS.starter.credits, resetDate: expect.any(String) });
    expect(fields.features.mobilePhone).toBe(false);
  });

  it('grants pro credits for the pro price, including mobile phone reveal', () => {
    const { tier, fields } = creditGrantFields('price_pro_unit');
    expect(tier).toBe('pro');
    expect(fields.credits.total).toBe(TIER_CREDITS.pro.credits);
    expect(fields.features.mobilePhone).toBe(true);
  });

  it('sets paymentCompletedAt to a fresh ISO timestamp on every call', () => {
    const before = Date.now();
    const { fields } = creditGrantFields('price_starter_unit');
    const paymentCompletedAt = Date.parse(fields.paymentCompletedAt);
    expect(paymentCompletedAt).toBeGreaterThanOrEqual(before);
    expect(paymentCompletedAt).toBeLessThanOrEqual(Date.now());
  });
});
