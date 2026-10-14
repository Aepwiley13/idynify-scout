#!/usr/bin/env node
/**
 * APOLLO ISOLATION DIAGNOSTIC — read-only, changes nothing.
 *
 * Calls Apollo directly with the SAME key + auth method production
 * search-companies uses (getApolloHeaders() → X-Api-Key from APOLLO_API_KEY),
 * and prints the raw response metadata BEFORE any of our transforms.
 *
 * Run with the production env injected (key is never printed):
 *   npx netlify dev:exec node scripts/apollo-diagnostic.mjs
 * or
 *   APOLLO_API_KEY=... node scripts/apollo-diagnostic.mjs
 *
 * Each search costs Apollo credits (~10 small calls total).
 */
import { APOLLO_ENDPOINTS, getApolloHeaders } from '../netlify/functions/utils/apolloConstants.js';

const DOC_URL = 'https://api.apollo.io/api/v1/mixed_companies/search';
const PROD_URL = APOLLO_ENDPOINTS.COMPANIES_SEARCH; // what search-companies actually calls
const BASE = 'https://api.apollo.io/api/v1';

// Keys Apollo uses to signal trouble inside a 2xx body.
const SUSPECT_KEYS = ['error', 'errors', 'error_code', 'message', 'messages', 'warning', 'warnings', 'status', 'detail', 'notice'];
const INTERESTING_HEADER = /rate|limit|usage|credit|quota|request-id|x-.*id|content-type/i;

function redactKey(headers) {
  const key = headers['X-Api-Key'] || '';
  return key ? `present (${key.length} chars, value not logged)` : "MISSING";
}

async function call(label, url, { method = 'POST', body } = {}) {
  const headers = getApolloHeaders();
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    console.log(`\n=== ${label} ===\n  NETWORK ERROR: ${err.message}`);
    return null;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  const hdrs = {};
  res.headers.forEach((v, k) => { if (INTERESTING_HEADER.test(k)) hdrs[k] = v; });

  console.log(`\n=== ${label} ===`);
  console.log(`  ${method} ${url}`);
  if (body) console.log(`  body: ${JSON.stringify(body)}`);
  console.log(`  HTTP ${res.status} ${res.statusText} (${Date.now() - started}ms)`);
  console.log(`  headers: ${JSON.stringify(hdrs)}`);

  if (!json || typeof json !== 'object') {
    console.log(`  NON-JSON BODY (first 500 chars): ${text.slice(0, 500)}`);
    return { status: res.status, json: null };
  }

  console.log(`  top-level keys: ${JSON.stringify(Object.keys(json))}`);
  const suspects = Object.fromEntries(SUSPECT_KEYS.filter(k => k in json).map(k => [k, json[k]]));
  if (Object.keys(suspects).length) console.log(`  ⚠️ error/message fields in body: ${JSON.stringify(suspects)}`);

  if ('pagination' in json || 'organizations' in json || 'accounts' in json) {
    const orgs = Array.isArray(json.organizations) ? json.organizations : null;
    const accts = Array.isArray(json.accounts) ? json.accounts : null;
    console.log(`  pagination: ${JSON.stringify(json.pagination ?? null)}`);
    console.log(`  total_entries (top-level, if any): ${json.total_entries ?? 'n/a'}`);
    console.log(`  organizations: ${orgs ? orgs.length : `MISSING (${typeof json.organizations})`}`);
    console.log(`  accounts: ${accts ? accts.length : `MISSING (${typeof json.accounts})`}`);
    const first = orgs?.[0] || accts?.[0];
    if (first) console.log(`  first: id=${first.id} name=${JSON.stringify(first.name)} industry=${JSON.stringify(first.industry)} hq=${JSON.stringify([first.city, first.state, first.country].filter(Boolean).join(', '))}`);
    if (json.breadcrumbs) console.log(`  breadcrumbs (how Apollo interpreted filters): ${JSON.stringify(json.breadcrumbs)}`);
  } else {
    console.log(`  body (first 800 chars): ${JSON.stringify(json).slice(0, 800)}`);
  }
  return { status: res.status, json };
}

const total = r => r?.json?.pagination?.total_entries ?? r?.json?.total_entries ?? null;

async function main() {
  console.log(`Apollo key in use: ${redactKey(getApolloHeaders())}`);

  // ── Test 4 (first, cheap): is the key alive at all? ──────────────────────
  await call('TEST 4a — auth/health', `${BASE}/auth/health`, { method: 'GET' });
  await call('TEST 4b — api usage stats (needs master key)', `${BASE}/usage_stats/api_usage_stats`, { body: {} });

  // ── Test 1 — bare minimum ────────────────────────────────────────────────
  const bare = { page: 1, per_page: 10 };
  const t1 = await call('TEST 1 — bare (documented /api/v1 URL)', DOC_URL, { body: bare });
  const t1p = await call('TEST 1p — bare (production /v1 URL)', PROD_URL, { body: bare });

  // ── Test 2 — Utah only ───────────────────────────────────────────────────
  const t2 = await call('TEST 2 — organization_locations ["utah"]', DOC_URL, { body: { ...bare, organization_locations: ['utah'] } });
  const t2p = await call('TEST 2p — production format ["Utah, United States"]', DOC_URL, { body: { ...bare, organization_locations: ['Utah, United States'] } });

  // ── Test 3 — industry only ───────────────────────────────────────────────
  // A: the tag ID our APOLLO_INDUSTRIES map sends for "Computer Software".
  const t3a = await call('TEST 3A — organization_industry_tag_ids (our "Computer Software" ID)', DOC_URL,
    { body: { ...bare, organization_industry_tag_ids: ['5567cd4773696439b10b0018'] } });
  // B: industry by name. If total == Test 1 total, Apollo IGNORED the param.
  const t3b = await call('TEST 3B — organization_industries ["computer software"]', DOC_URL,
    { body: { ...bare, organization_industries: ['computer software'] } });
  const t3c = await call('TEST 3C — q_organization_keyword_tags ["computer software"] (pre-Sep-15 production behaviour)', DOC_URL,
    { body: { ...bare, q_organization_keyword_tags: ['computer software'] } });

  // ── Production replay — the exact shape search-companies sends ───────────
  const prodQuery = {
    page: 1,
    per_page: 50,
    organization_industry_tag_ids: ['5567cd4773696439b10b0018'],
    organization_num_employees_ranges: ['1,10', '11,20', '21,50', '51,100', '101,200', '201,500', '501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,999999'],
    organization_locations: ['Utah, United States'],
  };
  const t5 = await call('REPLAY — production-shaped Utah + Computer Software query (production URL)', PROD_URL, { body: prodQuery });
  const t5b = await call('REPLAY minus industry tag ID', PROD_URL, { body: { ...prodQuery, organization_industry_tag_ids: undefined } });

  console.log('\n=== SUMMARY (total_entries / organizations returned) ===');
  for (const [label, r] of [
    ['1  bare /api/v1', t1], ['1p bare /v1', t1p], ['2  utah', t2], ['2p Utah, United States', t2p],
    ['3A tag id', t3a], ['3B organization_industries', t3b], ['3C keyword tags', t3c],
    ['R  prod replay', t5], ['R- replay w/o tag id', t5b],
  ]) {
    console.log(`  ${label.padEnd(28)} HTTP ${r?.status ?? 'ERR'}  total=${total(r)}  orgs=${r?.json?.organizations?.length ?? 'n/a'}`);
  }
  if (total(t1) != null && total(t3b) === total(t1)) {
    console.log('  NOTE: 3B total equals bare total → Apollo ignored organization_industries.');
  }
}

main().catch(err => { console.error('Diagnostic crashed:', err.message); process.exit(1); });
