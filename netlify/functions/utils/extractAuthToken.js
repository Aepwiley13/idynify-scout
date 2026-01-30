/**
 * Extract Auth Token Utility
 *
 * Extracts the Firebase auth token from the request.
 * Primary: Authorization: Bearer <token> header
 * Fallback: authToken field in the JSON request body (for backward compatibility)
 *
 * @param {object} event - Netlify function event object
 * @returns {string|null} The extracted auth token or null
 */
export function extractAuthToken(event) {
  // Primary: Check Authorization header
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Fallback: Check request body (backward compatibility during migration)
  try {
    if (event.body) {
      const body = JSON.parse(event.body);
      if (body.authToken) {
        return body.authToken;
      }
    }
  } catch {
    // Body parsing failed — no token available from body
  }

  return null;
}
