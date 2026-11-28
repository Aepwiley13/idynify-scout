/**
 * myCardService — the browser's access to a person's own My Card.
 *
 * A thin binding of src/services/myCard/myCardCore.js to the web SDK and the
 * app's Firestore instance; every rule is in the core, so the code the
 * emulator suite tests against the real rules is the code the app runs.
 *
 * The card belongs to the REAL signed-in account (auth.currentUser), never an
 * impersonated one: this deliberately does not use getEffectiveUser or
 * getActiveUserId.
 *
 * The card is private to its owner. Publishing (publishMyCard, unpublishMyCard, resetMyCardLink) writes
 * the private card, the public copy and the ID registry in one transaction; firestore.rules checks it.
 */
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { createMyCardService } from './myCard/myCardCore';

export const myCardService = createMyCardService({
  db,
  fs: { doc, getDoc, runTransaction },
  getSignedInUid: () => auth.currentUser?.uid || null,
});

export const {
  loadMyCard, saveMyCard, publishMyCard, unpublishMyCard, resetMyCardLink, loadCardSuggestions,
} = myCardService;

export { MY_CARD_STATUS, MY_CARD_ERRORS } from './myCard/myCardCore';
