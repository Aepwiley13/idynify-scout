/**
 * /barry/test-message — Sprint 2 Team B Test Endpoint
 *
 * Accepts a mocked NormalizedMessage and runs the full processNormalizedMessage()
 * pipeline. Primary development and QA tool until Team A delivers real Gmail ingestion.
 *
 * POST body (two modes):
 *   Mode 1: { "message": { ...NormalizedMessage } }
 *   Mode 2: { "mockKey": "reply_with_questions" }
 *
 * Auth: Requires Authorization: Bearer {idynifyUserToken}
 * Response: ProcessingResult JSON
 */

import { db } from './firebase-admin.js';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { extractAuthToken } from './utils/extractAuthToken.js';
import { processNormalizedMessage } from './utils/messageProcessor.js';
import { getMockMessage } from '../../src/mocks/normalizedMessage.mock.js';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const authToken = extractAuthToken(event);
    if (!authToken) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Missing authorization token' }),
      };
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Invalid JSON body' }),
      };
    }

    const userId = body.message?.idynifyUserId || body.userId;
    if (!userId) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Missing userId. Provide it in message.idynifyUserId or body.userId',
        }),
      };
    }

    await verifyAuthToken(authToken, userId);

    // ── Resolve message ──────────────────────────────────────────────────
    let message;

    if (body.mockKey) {
      try {
        message = getMockMessage(body.mockKey);
      } catch (mockErr) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: mockErr.message }),
        };
      }
      // Override the userId in the mock to match the authenticated user
      message.idynifyUserId = userId;
    } else if (body.message) {
      message = body.message;
    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'Provide either "message" (NormalizedMessage) or "mockKey" (string)',
          availableMocks: [
            'reply_with_questions',
            'reply_positive',
            'reply_objection',
            'reply_scheduling',
            'out_of_office',
            'unmatched_sender',
            'new_contact_inbound',
            'reply_no_response_needed',
          ],
        }),
      };
    }

    // ── Process ──────────────────────────────────────────────────────────
    console.log(`[barry-test-message] Processing ${body.mockKey || 'custom message'} for user ${userId}`);
    const result = await processNormalizedMessage(db, message);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(result),
    };

  } catch (error) {
    console.error('[barry-test-message] Error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
