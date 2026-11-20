/**
 * My Card — clearing every kept draft when the account goes away.
 *
 * The app signs people out from seven places (the top bar, the mobile menu,
 * checkout, the onboarding screens, the old dashboard...), and a session can
 * also end on its own or in another tab. They all end the same way: Firebase's
 * auth listener is told there is no user. So this wraps that one listener,
 * instead of every place that signs out:
 *
 *   const watchSignIn = withMyCardDraftClear((callback) => onAuthStateChanged(auth, callback));
 *
 * It clears the tab's My Card drafts (clearAllMyCardDrafts) when
 *   - there is no user (signed out, or never signed in), or
 *   - the user is a DIFFERENT account from the one before (a sign-in that
 *     replaced the account without passing through a sign-out),
 * and never otherwise: a page refresh, a token refresh or a second event for
 * the same account leaves drafts alone. It runs whether or not My Card is on
 * screen, because the draft is in the tab, not in the page.
 *
 * It changes nothing about the listener: the callback is called with every
 * event, in order, exactly as before, and whatever the watcher returns (the
 * unsubscribe) is returned. Clearing can never stop that: if storage refuses,
 * the sign-out carries on.
 */
import { clearAllMyCardDrafts } from './myCardDraftStorage';

/**
 * @param {(callback: (user: object|null) => void) => any} watch  subscribes to auth changes
 * @param {{ clear?: () => any }} [options]  for tests
 * @returns {(callback: (user: object|null) => void) => any}  the same shape as `watch`
 */
export function withMyCardDraftClear(watch, { clear = clearAllMyCardDrafts } = {}) {
  return (callback) => {
    // undefined: no event yet. A signed-in account's uid, or null for none.
    let previous;
    return watch((user) => {
      const uid = user && typeof user.uid === 'string' && user.uid !== '' ? user.uid : null;
      if (uid === null || (typeof previous === 'string' && previous !== uid)) {
        try {
          clear();
        } catch {
          // Whatever storage does, authentication goes on.
        }
      }
      previous = uid;
      callback(user);
    });
  };
}

export default withMyCardDraftClear;
