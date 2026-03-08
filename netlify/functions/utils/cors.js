/**
 * CORS Utility
 *
 * Provides consistent, restrictive CORS headers for all Netlify functions.
 * Restricts cross-origin requests to the production domain.
 */

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://idynify.com';

export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function handleCors(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }
  return null;
}
