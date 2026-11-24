import process from 'node:process';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { admin, db } from './firebase-admin.js';
import { createContactPhotoWriter } from './utils/contactPhotoWriter.js';

export const handler = createContactPhotoWriter({
  db,
  verifyToken: (token) => admin.auth().verifyIdToken(token, true),
  now: Date.now,
  timestampAfter: (previous) => Timestamp.fromMillis(Math.max(Date.now(), previous ? Math.floor(previous.toMillis()) + 1 : 0)),
  deleteField: () => FieldValue.delete(),
  enabled: () => process.env.CONTACT_PHOTO_WRITES === 'on',
});
