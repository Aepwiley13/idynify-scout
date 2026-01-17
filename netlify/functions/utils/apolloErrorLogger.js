/**
 * APOLLO API ERROR LOGGER
 *
 * Standardized error logging for all Apollo API failures.
 *
 * WHY THIS EXISTS:
 * - Consistent error messages across all Scout functions
 * - Categorizes errors (auth, rate limit, validation, server)
 * - Logs request details for debugging
 * - Makes production debugging faster
 *
 * USAGE:
 * import { logApolloError } from './utils/apolloErrorLogger.js';
 *
 * if (!response.ok) {
 *   await logApolloError(response, requestBody, 'searchPeople');
 *   throw new Error('Apollo API failed');
 * }
 *
 * Last updated: Phase 2 - January 2026
 */

/**
 * Log a standardized Apollo API error
 * @param {Response} response - Fetch response object
 * @param {object} requestBody - The request body sent to Apollo
 * @param {string} functionName - Name of the calling function
 * @returns {Promise<string>} - Error text from response
 */
export async function logApolloError(response, requestBody, functionName) {
  let errorText = '';

  try {
    errorText = await response.text();
  } catch (e) {
    errorText = '(Could not read error response)';
  }

  console.error('┌─────────────────────────────────────────────────');
  console.error(`│ ❌ Apollo API Error in ${functionName}`);
  console.error('├─────────────────────────────────────────────────');
  console.error(`│ Status: ${response.status} ${response.statusText}`);
  console.error(`│ Endpoint: ${response.url}`);
  console.error('├─────────────────────────────────────────────────');

  // Categorize error for faster debugging
  if (response.status >= 500) {
    console.error('│ 🚨 SERVER ERROR - Apollo service issue');
    console.error('│ Action: Retry later or contact Apollo support');
  } else if (response.status === 429) {
    console.error('│ ⏱️  RATE LIMIT EXCEEDED');
    console.error('│ Action: Implement backoff or upgrade Apollo plan');
  } else if (response.status === 422) {
    console.error('│ ⚠️  VALIDATION ERROR - Invalid request parameters');
    console.error('│ Action: Check request body format below');
  } else if (response.status === 401 || response.status === 403) {
    console.error('│ 🔒 AUTH ERROR - Invalid or expired API key');
    console.error('│ Action: Verify APOLLO_API_KEY environment variable');
  } else if (response.status === 404) {
    console.error('│ 🔍 NOT FOUND - Resource does not exist');
    console.error('│ Action: Verify ID or search parameters');
  } else {
    console.error('│ ❌ CLIENT ERROR - Check request format');
  }

  console.error('├─────────────────────────────────────────────────');
  console.error('│ Request Body:');
  console.error(JSON.stringify(requestBody, null, 2).split('\n').map(line => `│   ${line}`).join('\n'));
  console.error('├─────────────────────────────────────────────────');
  console.error('│ Response Body:');
  console.error(`│   ${errorText}`);
  console.error('└─────────────────────────────────────────────────');

  return errorText;
}

/**
 * Log a warning for non-critical Apollo issues
 * @param {string} message - Warning message
 * @param {string} functionName - Name of the calling function
 * @param {object} context - Additional context for debugging
 */
export function logApolloWarning(message, functionName, context = {}) {
  console.warn(`⚠️  [${functionName}] ${message}`);
  if (Object.keys(context).length > 0) {
    console.warn('   Context:', JSON.stringify(context, null, 2));
  }
}
