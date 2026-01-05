/**
 * Firebase Functions for Idynify Scout
 *
 * Main entry point for all Firebase Functions
 */

import { onRequest } from 'firebase-functions/v2/https';
import { adminGetUsers } from './admin-get-users.js';

// Export all functions
export { adminGetUsers };
