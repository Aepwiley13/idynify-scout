/**
 * Pure unit tests — no emulator, no Stripe mock needed. Runs under plain `npm test`.
 *
 * knownPriceIds()/isKnownIdynifyPrice() answer "is this a recognized Idynify product" (gates
 * reconciliation — should this subscription's lifecycle events be applied at all). That is
 * deliberately a BROADER question than creditGrantingPriceIds()/isCreditGrantingPrice() — "does
 * this price grant paid credits." A live $0/month "Scout Starter" subscriber
 * (price_1T3UsqJEdYAFEzC36VCvIZ90 in production; STRIPE_PRICE_SCOUT_STARTER_FREE here) is the
 * concrete case these tests pin down: recognized for reconciliation, never credit-granting,
 * regardless of the product being named "Starter."
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  knownPriceIds, creditGrantingPriceIds, isKnownIdynifyPrice, isCreditGrantingPrice,
} from '../../netlify/functions/utils/billingPrices.js';

describe('billingPrices — recognized vs credit-granting are independent sets', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_STARTER = 'price_starter_unit';
    process.env.STRIPE_PRICE_PRO = 'price_pro_unit';
    process.env.STRIPE_PRICE_SCOUT_STARTER_FREE = 'price_scout_starter_free_unit';
  });

  it('knownPriceIds includes all three configured prices', () => {
    const ids = knownPriceIds();
    expect(ids.has('price_starter_unit')).toBe(true);
    expect(ids.has('price_pro_unit')).toBe(true);
    expect(ids.has('price_scout_starter_free_unit')).toBe(true);
  });

  it('creditGrantingPriceIds includes only the two paid prices — the free price is deliberately excluded', () => {
    const ids = creditGrantingPriceIds();
    expect(ids.has('price_starter_unit')).toBe(true);
    expect(ids.has('price_pro_unit')).toBe(true);
    expect(ids.has('price_scout_starter_free_unit')).toBe(false);
  });

  it('the $0 Scout Starter price is a known Idynify price but not a credit-granting one', () => {
    expect(isKnownIdynifyPrice('price_scout_starter_free_unit')).toBe(true);
    expect(isCreditGrantingPrice('price_scout_starter_free_unit')).toBe(false);
  });

  it('the two paid prices are both known and credit-granting', () => {
    for (const id of ['price_starter_unit', 'price_pro_unit']) {
      expect(isKnownIdynifyPrice(id)).toBe(true);
      expect(isCreditGrantingPrice(id)).toBe(true);
    }
  });

  it('a genuinely unrecognized price is neither known nor credit-granting', () => {
    expect(isKnownIdynifyPrice('price_totally_unrelated')).toBe(false);
    expect(isCreditGrantingPrice('price_totally_unrelated')).toBe(false);
  });

  it('isCreditGrantingPrice never treats a subscription as credit-granting by product name — only by price id', () => {
    // A subscription object whose only item is the free price, even though nothing about this
    // function looks at (or could look at) a product/price nickname like "Scout Starter".
    const subscription = { items: { data: [{ price: { id: 'price_scout_starter_free_unit' } }] } };
    expect(isKnownIdynifyPrice(subscription)).toBe(true);
    expect(isCreditGrantingPrice(subscription)).toBe(false);
  });

  it('with STRIPE_PRICE_SCOUT_STARTER_FREE unset, knownPriceIds falls back to just the two paid prices', () => {
    delete process.env.STRIPE_PRICE_SCOUT_STARTER_FREE;
    const ids = knownPriceIds();
    expect(ids.size).toBe(2);
    expect(ids.has('price_starter_unit')).toBe(true);
    expect(ids.has('price_pro_unit')).toBe(true);
  });
});
