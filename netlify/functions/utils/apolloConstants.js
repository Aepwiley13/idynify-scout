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
export const APOLLO_ENDPOINTS = {
  // Organizations
  ORGANIZATIONS_ENRICH: 'https://api.apollo.io/v1/organizations/enrich',

  // People - Search (current endpoint, replaced /mixed_people/search in Phase 1)
  PEOPLE_SEARCH: 'https://api.apollo.io/v1/mixed_people/api_search',

  // People - Enrichment (get full profile by ID)
  PEOPLE_MATCH: 'https://api.apollo.io/v1/people/match',

  // Companies - Search
  COMPANIES_SEARCH: 'https://api.apollo.io/v1/mixed_companies/search'
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
