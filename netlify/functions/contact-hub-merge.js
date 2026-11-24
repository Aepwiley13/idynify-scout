import process from 'node:process';
import { Timestamp } from 'firebase-admin/firestore';
import { admin, db } from './firebase-admin.js';
import { createContactMerge } from './utils/contactMerge.js';

export const handler = createContactMerge({
  db, verifyToken: (token) => admin.auth().verifyIdToken(token, true),
  secret: () => process.env.CONTACT_HUB_MERGE_SECRET,
  enabled: () => process.env.CONTACT_HUB_MERGE === 'on',
  executionEnabled: () => process.env.CONTACT_HUB_MERGE_EXECUTION === 'on',
  inspectCollections: async (ref) => (await ref.listCollections()).map((collection) => collection.id),
  timestamp: () => Timestamp.now(),
});
