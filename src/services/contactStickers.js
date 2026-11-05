/**
 * contactStickers — adding and removing stickers on contacts (ADR-007).
 *
 * The only browser entry point for sticker membership. Each change runs in a
 * Firestore transaction against the contact and the sticker as stored now
 * (src/services/stickers/stickerCore.js), and firestore.rules refuses any
 * membership write that does not have exactly that shape.
 */
import { stickerStore } from './stickerService';

export const { addSticker, removeSticker, addStickerToContacts } = stickerStore;

export { storedStickerIds, STICKER_LIMIT } from './stickers/stickerCore';
