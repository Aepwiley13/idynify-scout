/**
 * stickerService — the browser's sticker registry (ADR-007).
 *
 * A thin binding of src/services/stickers/stickerCore.js to the web SDK and
 * the app's Firestore instance. Every rule lives in the core; this file only
 * supplies data access, so the code the emulator suite tests against the real
 * rules is the code the app runs.
 *
 * Membership (adding a sticker to a contact) is in contactStickers.js.
 */
import {
  doc, collection, setDoc, updateDoc, runTransaction, serverTimestamp, deleteField, onSnapshot, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { createStickerStore } from './stickers/stickerCore';

export const stickerStore = createStickerStore({
  db,
  fs: { doc, collection, setDoc, updateDoc, runTransaction, serverTimestamp, deleteField, onSnapshot, arrayUnion, arrayRemove },
});

export const { createSticker, updateSticker, archiveSticker, restoreSticker, subscribeStickers } = stickerStore;

export {
  StickerError,
  STICKER_ERRORS,
  STICKER_COLORS,
  STICKER_LIMIT,
  STICKER_NAME_MAX,
  cleanStickerName,
  stickerNameKey,
  sortStickers,
  visibleStickers,
} from './stickers/stickerCore';
