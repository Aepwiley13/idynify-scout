/**
 * The only two Stripe Prices this server recognizes as Idynify products. Used to gate every
 * billing write (checkout, allocation, replacement authorization) against "is this actually one
 * of our products" rather than trusting amount_total or metadata.tier alone.
 */
export function knownPriceIds() {
  return new Set([process.env.STRIPE_PRICE_STARTER, process.env.STRIPE_PRICE_PRO].filter(Boolean));
}

export function isKnownIdynifyPrice(subscriptionOrPriceId) {
  const ids = knownPriceIds();
  if (ids.size === 0) return false; // not configured — never silently treat anything as known
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
