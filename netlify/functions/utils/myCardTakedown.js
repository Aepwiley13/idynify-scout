/**
 * Takes a user's public My Card down (MY-CARD-SHARE-001, S8). Admin SDK only: it bypasses rules.
 *
 * In ONE batch: deletes publicCards/{publicId} and switches the private card off
 * (sharingEnabled:false, revision + 1, updatedAt now). publicId, publishedAt and schemaVersion are
 * kept, and the registry publicIds/{id} is NEVER touched: an ID stays bound to its owner forever.
 * A user with no card, or a card with no publicId, is not an error.
 *
 * @returns {Promise<{ takenDown: boolean, error?: string }>} never throws.
 */
import { db } from '../firebase-admin.js';

export async function takeDownMyCard(uid) {
  try {
    const cardRef = db.collection('users').doc(uid).collection('card').doc('main');
    const snap = await cardRef.get();
    if (!snap.exists) return { takenDown: false };
    const card = snap.data() || {};
    const publicId = typeof card.publicId === 'string' && card.publicId ? card.publicId : null;
    if (!publicId && card.sharingEnabled !== true) return { takenDown: false };

    const batch = db.batch();
    if (publicId) batch.delete(db.collection('publicCards').doc(publicId));
    if (card.sharingEnabled === true) {
      const revision = Number.isInteger(card.revision) && card.revision >= 0 ? card.revision : 0;
      batch.update(cardRef, { sharingEnabled: false, revision: revision + 1, updatedAt: new Date().toISOString() });
    }
    await batch.commit();
    return { takenDown: true };
  } catch (error) {
    console.error('❌ My Card takedown failed:', error);
    return { takenDown: false, error: error.message };
  }
}
