/**
 * Admin Ping - Simple test endpoint
 * Returns { ok: true } to verify CORS and connectivity
 */

export const handler = async (event) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': 'https://idynify.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers
    };
  }

  // Return success
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true })
  };
};
