/* Stand-in for netlify/functions/firebase-admin.js. */
import { db } from './firestore.mjs';
export { db };
export const admin = {};
export default { db, admin };
