import process from 'node:process';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, db } from './firebase-admin.js';
import { createContactAffiliationWriter } from './utils/contactAffiliationWriter.js';

export const handler = createContactAffiliationWriter({
  db,
  verifyToken: (token) => admin.auth().verifyIdToken(token, true),
  enabled: () => process.env.CONTACT_HUB_AFFILIATIONS === 'on',
  timestamp: () => Timestamp.now(),
});
