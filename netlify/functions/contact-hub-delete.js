import process from 'node:process';
import { admin, db } from './firebase-admin.js';
import { createContactHubDelete } from './utils/contactHubDelete.js';

export const handler = createContactHubDelete({
  db,
  enabled: () => process.env.CONTACT_HUB_DELETE === 'on',
  verifyToken: (token) => admin.auth().verifyIdToken(token, true),
});
