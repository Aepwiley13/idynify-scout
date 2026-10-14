#!/usr/bin/env node
/**
 * APOLLO AUTH CHECK — read-only, changes nothing.
 *
 * Calls GET /api/v1/auth/health twice:
 *   A. DIRECT  — headers built by hand here, bypassing getApolloHeaders()
 *   B. HELPER  — headers from getApolloHeaders(), exactly as production sends
 * and prints both results side by side. The key value is never printed.
 *
 *   npx netlify dev:exec --context production node scripts/apollo-auth-check.mjs
 * (dev:exec defaults to the "Local development" context, whose APOLLO_API_KEY
 * can differ from Production's.)
 *   APOLLO_API_KEY=... node scripts/apollo-auth-check.mjs
 *
 * Healthy: {"healthy":true,"is_logged_in":true}
 */
import { getApolloHeaders } from '../netlify/functions/utils/apolloConstants.js';

const URL = 'https://api.apollo.io/api/v1/auth/health';
const KEY = process.env.APOLLO_API_KEY;

function describeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) =>
    [k, v === KEY ? `<APOLLO_API_KEY redacted, ${v.length} chars>` : v]));
}

async function probe(label, headers) {
  console.log(`\n=== ${label} ===`);
  console.log(`  GET ${URL}`);
  console.log(`  headers sent: ${JSON.stringify(describeHeaders(headers))}`);
  try {
    const res = await fetch(URL, { method: 'GET', headers });
    const text = await res.text();
    console.log(`  HTTP ${res.status} ${res.statusText}`);
    console.log(`  body: ${text.slice(0, 500)}`);
    return { status: res.status, body: text };
  } catch (err) {
    console.log(`  NETWORK ERROR: ${err.message}`);
    return { status: null, body: null };
  }
}

if (!KEY) {
  console.error('APOLLO_API_KEY is not set — nothing to test.');
  process.exit(1);
}
console.log(`APOLLO_API_KEY present: ${KEY.length} chars` +
  `${KEY !== KEY.trim() ? ' — ⚠️ HAS LEADING/TRAILING WHITESPACE' : ''}` +
  `${/^["']|["']$/.test(KEY) ? ' — ⚠️ WRAPPED IN QUOTES' : ''}`);

const direct = await probe('A. DIRECT (bypasses getApolloHeaders)', {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  'x-api-key': KEY,
});
const helper = await probe('B. HELPER (getApolloHeaders(), production path)', getApolloHeaders());

console.log('\n=== COMPARISON ===');
console.log(`  direct: HTTP ${direct.status}  ${direct.body}`);
console.log(`  helper: HTTP ${helper.status}  ${helper.body}`);
if (direct.status === null || helper.status === null) {
  console.log('  INCONCLUSIVE → at least one request never reached Apollo (network error above).');
} else if (direct.status === helper.status && direct.body === helper.body) {
  console.log('  Identical → the helper is not the problem; the key itself (or the account) is.');
} else {
  console.log('  DIFFERENT → the helper changes how Apollo authenticates us.');
}
