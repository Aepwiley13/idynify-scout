/**
 * Every Stripe Price this server recognizes as belonging to an Idynify product — used to gate
 * identity/reconciliation: is this subscription even one of ours, so its lifecycle events
 * (status sync, cancellation, period dates) should be reconciled at all, rather than flagged
 * unknown_price. This is deliberately NOT the same question as "does this price grant paid
 * credits" — see creditGrantingPriceIds() below. STRIPE_PRICE_SCOUT_STARTER_FREE is a live $0/mo
 * price (an existing subscriber was found on it, outside the original two-price allowlist): it
 * belongs here so that subscriber's events reconcile normally, but it must never appear in
 * creditGrantingPriceIds() — a $0 price, however it's named, is not a paid product.
 */
export function knownPriceIds() {
  return new Set([
    process.env.STRIPE_PRICE_STARTER,
    process.env.STRIPE_PRICE_PRO,
    process.env.STRIPE_PRICE_SCOUT_STARTER_FREE,
  ].filter(Boolean));
}

/**
 * The Stripe Prices that grant paid credits on allocation. Strictly narrower than
 * knownPriceIds(): a price can be a recognized Idynify product (reconciled normally) without
 * ever being credit-granting. Never infer this from a price's product name — "Scout Starter"
 * reads like the paid Starter tier, but this specific price is $0/month and must never trigger
 * an allocation, regardless of what it's called in Stripe.
 */
export function creditGrantingPriceIds() {
  return new Set([process.env.STRIPE_PRICE_STARTER, process.env.STRIPE_PRICE_PRO].filter(Boolean));
}

export function isKnownIdynifyPrice(subscriptionOrPriceId) {
  const ids = knownPriceIds();
  if (ids.size === 0) return false; // not configured — never silently treat anything as known
  if (typeof subscriptionOrPriceId === 'string') return ids.has(subscriptionOrPriceId);
  const priceId = priceIdOfSubscription(subscriptionOrPriceId);
  return priceId != null && ids.has(priceId);
}

export function isCreditGrantingPrice(subscriptionOrPriceId) {
  const ids = creditGrantingPriceIds();
  if (ids.size === 0) return false;
  if (typeof subscriptionOrPriceId === 'string') return ids.has(subscriptionOrPriceId);
  const priceId = priceIdOfSubscription(subscriptionOrPriceId);
  return priceId != null && ids.has(priceId);
}

/**
 * Selects the single, unambiguous subscription item's price id. Never blindly indexes item[0]
 * when there's more than one item — if there's exactly one item, use it; otherwise, only trust an
 * item whose price is already one of our known prices. Anything else is explicitly ambiguous.
 */
export function priceIdOfSubscription(subscription) {
  const items = subscription?.items?.data ?? [];
  if (items.length === 1) return items[0]?.price?.id ?? null;
  const known = knownPriceIds();
  const candidates = items.filter((i) => known.has(i?.price?.id));
  if (candidates.length !== 1) return null; // ambiguous — explicit, not guessed
  return candidates[0].price.id;
}

/**
 * The webhook event payload for checkout.session.completed does not include line items unless
 * expanded at subscription-creation time, which we don't control for legacy Payment Link
 * sessions — so this always asks Stripe directly rather than trusting amount_total (the
 * fragile heuristic the pre-existing code used) or any client-suppliable field. Works for both
 * the new flow and legacy Payment Links identically.
 */
export async function priceIdOfSession(stripe, session) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
  const items = lineItems?.data ?? [];
  if (items.length === 1) return items[0]?.price?.id ?? null;
  const known = knownPriceIds();
  const candidates = items.filter((i) => known.has(i?.price?.id));
  if (candidates.length !== 1) return null; // ambiguous — explicit, not guessed
  return candidates[0].price.id;
}
