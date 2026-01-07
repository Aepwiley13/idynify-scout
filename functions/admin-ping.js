/**
 * Admin Ping - Simple test function
 * Verifies Firebase Functions v2 and CORS configuration
 */

import { onRequest } from 'firebase-functions/v2/https';

export const adminPing = onRequest(
  {
    region: 'us-central1',
    cors: ['https://idynify.com', 'http://localhost:5173']
  },
  async (req, res) => {
    return res.status(200).json({ ok: true });
  }
);
