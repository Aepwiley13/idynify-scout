/**
 * TEMPORARY DIAGNOSTIC — remove once the Apollo credential question is closed.
 *
 * Reports which APOLLO_API_KEY this deployed runtime holds, without exposing
 * it, so it can be compared with the key `netlify dev:exec --context
 * production` loads (scripts/apollo-auth-check.mjs prints the same
 * fingerprint):
 *   - key length
 *   - SHA-256 fingerprint (first 16 hex chars of the hash of the raw value,
 *     exactly as getApolloApiKey() reads it — no trimming)
 *   - auth/health HTTP status and is_logged_in, using getApolloHeaders()
 *   - a bare mixed_companies/search {page:1, per_page:1} with the same
 *     headers: HTTP status, organization count, total_entries, and Apollo's
 *     error_code on a non-2xx. This is the authoritative auth test.
 *   - the six-arm industry A/B (industryAB): for each arm only the HTTP
 *     status, total_entries, organization count, Apollo's breadcrumbs (its
 *     read-back of the filters) and error_code on a non-2xx.
 *
 * Endpoint: /.netlify/functions/apollo-key-fingerprint
 * Method: POST
 * Auth: Firebase ID token (Authorization: Bearer) + super admin
 */

import { createHash } from 'crypto';
import { admin } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { checkSuperAdminAccess } from './utils/superAdminAuth.js';
import { APOLLO_ENDPOINTS, getApolloHeaders } from './utils/apolloConstants.js';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

const DOC_URL = 'https://api.apollo.io/api/v1/mixed_companies/search';
const COMPUTER_SOFTWARE_TAG_ID = '5567cd4773696439b10b0018'; // APOLLO_INDUSTRIES["Computer Software"] in search-companies.js
// The query search-companies builds for Utah + every company size + Computer Software.
const PRODUCTION_QUERY_NO_TAG = {
  page: 1,
  per_page: 50,
  organization_num_employees_ranges: ['1,10', '11,20', '21,50', '51,100', '101,200', '201,500', '501,1000', '1001,2000', '2001,5000', '5001,10000', '10001,999999'],
  organization_locations: ['Utah, United States'],
};
const BARE = { page: 1, per_page: 10 };
const PRODUCTION_QUERY = { ...PRODUCTION_QUERY_NO_TAG, organization_industry_tag_ids: [COMPUTER_SOFTWARE_TAG_ID] };
const AB_ARMS = [
  ['2p', DOC_URL, { ...BARE, organization_locations: ['Utah, United States'] }],
  ['3A', DOC_URL, { ...BARE, organization_industry_tag_ids: [COMPUTER_SOFTWARE_TAG_ID] }],
  ['3C', DOC_URL, { ...BARE, q_organization_keyword_tags: ['computer software'] }],
  ['R', APOLLO_ENDPOINTS.COMPANIES_SEARCH, PRODUCTION_QUERY],
  ['R-', APOLLO_ENDPOINTS.COMPANIES_SEARCH, PRODUCTION_QUERY_NO_TAG],
  ['RK', APOLLO_ENDPOINTS.COMPANIES_SEARCH, { ...PRODUCTION_QUERY_NO_TAG, q_organization_keyword_tags: ['computer software'] }],
];

// One search; only status, counts, breadcrumbs and error code come back.
async function probeSearch(url, query) {
  const out = { status: null, totalEntries: null, organizations: null, breadcrumbs: null, errorCode: null };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(8000),
    });
    out.status = res.status;
    const body = await res.json().catch(() => null);
    if (res.ok) {
      out.organizations = Array.isArray(body?.organizations) ? body.organizations.length : null;
      out.totalEntries = body?.pagination?.total_entries ?? null;
      out.breadcrumbs = body?.breadcrumbs ?? null;
    } else {
      out.errorCode = body?.error_code ?? null;
    }
  } catch {
    // Network failure or timeout: status stays null.
  }
  return out;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });

  const authToken = extractAuthToken(event);
  if (!authToken) return reply(401, { error: 'Authentication required' });

  let uid;
  try {
    uid = (await admin.auth().verifyIdToken(authToken)).uid;
  } catch {
    return reply(401, { error: 'Invalid authentication token' });
  }
  if (!(await checkSuperAdminAccess(uid))) return reply(403, { error: 'Super admin access required' });

  const key = process.env.APOLLO_API_KEY;
  if (!key) return reply(200, { keyPresent: false });

  let healthStatus = null;
  let isLoggedIn = null;
  try {
    const res = await fetch('https://api.apollo.io/api/v1/auth/health', { method: 'GET', headers: getApolloHeaders() });
    healthStatus = res.status;
    const body = await res.json().catch(() => null);
    isLoggedIn = body?.is_logged_in ?? null;
  } catch {
    // Network failure: healthStatus stays null.
  }

  // Authoritative auth test: a bare search. Only counts and codes leave this
  // function — never organization details.
  let searchStatus = null;
  let searchReturnedOrganizations = null;
  let searchTotalEntries = null;
  let searchErrorCode = null;
  try {
    const res = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
      method: 'POST',
      headers: getApolloHeaders(),
      body: JSON.stringify({ page: 1, per_page: 1 }),
    });
    searchStatus = res.status;
    const body = await res.json().catch(() => null);
    if (res.ok) {
      searchReturnedOrganizations = Array.isArray(body?.organizations) ? body.organizations.length : null;
      searchTotalEntries = body?.pagination?.total_entries ?? null;
    } else {
      searchErrorCode = body?.error_code ?? null;
    }
  } catch {
    // Network failure: searchStatus stays null.
  }

  // Arms run in parallel to stay inside the function timeout.
  const armResults = await Promise.all(AB_ARMS.map(([, url, query]) => probeSearch(url, query)));
  const industryAB = Object.fromEntries(AB_ARMS.map(([name], i) => [name, armResults[i]]));

  return reply(200, {
    keyPresent: true,
    keyLength: key.length,
    keySha256Prefix: createHash('sha256').update(key).digest('hex').slice(0, 16),
    authHealthStatus: healthStatus,
    isLoggedIn,
    searchStatus,
    searchReturnedOrganizations,
    searchTotalEntries,
    searchErrorCode,
    industryAB,
  });
};
