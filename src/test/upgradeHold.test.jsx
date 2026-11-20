/* global process */
/**
 * Billing launch fallback (constants/upgradeHold.js): if Free Contact Hub launches before
 * authenticated checkout, no existing account is offered a Payment Link. /checkout serves only
 * today's live signup flow, a paid plan chosen at signup and not paid yet with no Stripe
 * history. With the free plan switched off nothing changes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ACCOUNT } from '../utils/accountVerification';

vi.mock('../constants/freePlan', async (importOriginal) => ({
  ...(await importOriginal()),
  FREE_PLAN: Object.freeze({ mode: 'on', enabled: true, signups: true }),
}));

import { UPGRADES_OPEN, isPendingPaidSignup, checkoutHoldRedirect, CHECKOUT_HOLD_DESTINATION } from '../constants/upgradeHold';
import { CheckoutHold } from '../components/billing/freePlanRouting';

const verified = (data) => ({ status: ACCOUNT.VERIFIED, data });
const PENDING_SIGNUP = { email: 'new@example.test', selectedTier: 'starter', subscriptionTier: 'starter', status: 'pending_payment', hasCompletedPayment: false };
const FREE_CREATED = { email: 'free@example.test', createdAt: 1 };
const LAPSED = { ...PENDING_SIGNUP, status: 'canceled', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'canceled' };
const PAID = { ...PENDING_SIGNUP, hasCompletedPayment: true, subscriptionStatus: 'active', stripeCustomerId: 'cus_2', stripeSubscriptionId: 'sub_2' };
const PAID_WEBHOOK_PENDING_IDS = { ...PENDING_SIGNUP, hasCompletedPayment: true };

describe('the hold', () => {
  it('is on in this release', () => {
    expect(UPGRADES_OPEN).toBe(false);
  });

  it('isPendingPaidSignup: only a paid plan chosen at signup, unpaid, with no Stripe history', () => {
    expect(isPendingPaidSignup(PENDING_SIGNUP)).toBe(true);
    expect(isPendingPaidSignup({ ...PENDING_SIGNUP, selectedTier: 'pro' })).toBe(true);
    expect(isPendingPaidSignup(FREE_CREATED)).toBe(false);
    expect(isPendingPaidSignup(LAPSED)).toBe(false);
    expect(isPendingPaidSignup(PAID)).toBe(false);
    expect(isPendingPaidSignup(PAID_WEBHOOK_PENDING_IDS)).toBe(false);
    expect(isPendingPaidSignup({ ...PENDING_SIGNUP, stripeCustomerId: 'cus_3' })).toBe(false);
    expect(isPendingPaidSignup({ ...PENDING_SIGNUP, selectedTier: 'free' })).toBe(false);
    expect(isPendingPaidSignup(null)).toBe(false);
  });

  it('checkoutHoldRedirect: every existing account goes to Settings → Billing', () => {
    for (const data of [FREE_CREATED, LAPSED, PAID, PAID_WEBHOOK_PENDING_IDS, { role: 'admin' }]) {
      expect(checkoutHoldRedirect(verified(data)), JSON.stringify(data)).toBe(CHECKOUT_HOLD_DESTINATION);
    }
    expect(CHECKOUT_HOLD_DESTINATION).toBe('/settings?tab=billing');
  });

  it("checkoutHoldRedirect: today's live signup flow still checks out", () => {
    expect(checkoutHoldRedirect(verified(PENDING_SIGNUP))).toBeNull();
  });

  it('nothing changes when the hold is lifted or the free plan is off', () => {
    expect(checkoutHoldRedirect(verified(FREE_CREATED), { open: true })).toBeNull();
    expect(checkoutHoldRedirect(verified(PAID), { freePlan: false })).toBeNull();
  });
});

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

const renderCheckout = (data) => render(
  <MemoryRouter initialEntries={['/checkout?tier=pro']}>
    <Routes>
      <Route path="/checkout" element={<CheckoutHold account={verified(data)}><div data-testid="checkout">Stripe checkout</div></CheckoutHold>} />
      <Route path="/settings" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

describe('CheckoutHold around /checkout', () => {
  it('a Free account opening /checkout?tier=pro lands on Settings → Billing, never a Payment Link', () => {
    renderCheckout(FREE_CREATED);
    expect(screen.queryByTestId('checkout')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/settings?tab=billing');
  });

  it('a lapsed customer and a current subscriber land there too', () => {
    const { unmount } = renderCheckout(LAPSED);
    expect(screen.queryByTestId('checkout')).toBeNull();
    unmount();
    renderCheckout(PAID);
    expect(screen.queryByTestId('checkout')).toBeNull();
  });

  it('a new paid signup that has not paid yet sees checkout as today', () => {
    renderCheckout(PENDING_SIGNUP);
    expect(screen.getByTestId('checkout')).toBeInTheDocument();
  });
});

describe('App.jsx wiring', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

  it('/checkout is wrapped inside its purchase gate; success and cancel are not', () => {
    expect(app).toMatch(/<Route path="\/checkout" element=\{<ProtectedRoute requirePayment=\{false\} purchase><CheckoutHold account=\{account\}><CheckoutPage \/><\/CheckoutHold><\/ProtectedRoute>\} \/>/);
    expect(app.match(/<CheckoutHold\b/g)).toHaveLength(1);
  });
});
