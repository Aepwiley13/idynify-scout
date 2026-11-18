/* global process */
/**
 * APOLLO API CONSTANTS
 *
 * Centralized Apollo.io API endpoint configuration.
 *
 * WHY THIS EXISTS:
 * - Apollo has deprecated endpoints in the past (mixed_people/search -> api_search)
 * - Hardcoded URLs across 5 functions made updates difficult
 * - Single source of truth prevents inconsistencies
 *
 * USAGE:
 * import { APOLLO_ENDPOINTS, getApolloApiKey } from './utils/apolloConstants.js';
 * const response = await fetch(APOLLO_ENDPOINTS.PEOPLE_SEARCH, { ... });
 *
 * Last updated: Phase 2 - January 2026
 */

/**
 * Apollo API Endpoints
 * These are the CURRENT (non-deprecated) endpoints as of January 2026
 */
export const APOLLO_LIVE_BASE = 'https://api.apollo.io';

/**
 * STAGING ONLY: the local Apollo stand-in for the end-to-end test (scripts/staging/apolloMock.mjs,
 * started by `stagingDev.mjs --apollo-mock`). APOLLO_MOCK_URL is honoured only for a plain-http
 * loopback address (127.0.0.1 or localhost), so Apollo traffic and its key can never be sent to
 * any other host. Unset, or anything else: the live Apollo API, exactly as before.
 */
export function apolloBaseUrl(env = process.env) {
  const raw = env.APOLLO_MOCK_URL;
  if (!raw) return APOLLO_LIVE_BASE;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname === '/') {
      return `${url.protocol}//${url.host}`;
    }
  } catch {
    // fall through
  }
  console.warn('apollo_mock_url.ignored: only a loopback http URL is accepted');
  return APOLLO_LIVE_BASE;
}

const APOLLO_BASE = apolloBaseUrl();

export const APOLLO_ENDPOINTS = {
  // Organizations
  ORGANIZATIONS_ENRICH: `${APOLLO_BASE}/v1/organizations/enrich`,

  // People - Search (current endpoint, replaced /mixed_people/search in Phase 1)
  PEOPLE_SEARCH: `${APOLLO_BASE}/v1/mixed_people/api_search`,

  // People - Enrichment (get full profile by ID)
  PEOPLE_MATCH: `${APOLLO_BASE}/v1/people/match`,

  // Companies - Search
  COMPANIES_SEARCH: `${APOLLO_BASE}/v1/mixed_companies/search`
};

/**
 * Get Apollo API Key from environment
 * @returns {string} Apollo API key
 * @throws {Error} If APOLLO_API_KEY not configured
 */
export function getApolloApiKey() {
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    console.error('❌ APOLLO_API_KEY environment variable not set');
    throw new Error('Apollo API key not configured');
  }

  return apiKey;
}

/**
 * Create standard Apollo API headers
 * @returns {object} Headers object for fetch
 */
export function getApolloHeaders() {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Api-Key': getApolloApiKey()
  };
}
