/**
 * Extract Auth Token Utility
 *
 * Extracts the Firebase auth token from the Authorization: Bearer <token> header.
 * Tokens must be sent in the header only — never in the request body.
 *
 * @param {object} event - Netlify function event object
 * @returns {string|null} The extracted auth token or null
 */
export function extractAuthToken(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}
