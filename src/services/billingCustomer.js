import { billingRequestHeaders } from './billingSecurity';

/** Create or recover the signed-in account's Stripe Customer binding. */
export async function ensureBillingCustomer(user) {
  const response = await fetch('/.netlify/functions/ensure-billing-customer', {
    method: 'POST',
    headers: await billingRequestHeaders(user),
    body: '{}',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'billing_unavailable');
  return data;
}
