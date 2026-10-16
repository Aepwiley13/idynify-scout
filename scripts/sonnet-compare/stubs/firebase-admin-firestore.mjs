import { db, FieldValue, Timestamp } from './firestore.mjs';
export const getFirestore = () => db;
export { FieldValue, Timestamp };
