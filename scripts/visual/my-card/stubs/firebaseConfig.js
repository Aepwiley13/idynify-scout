/**
 * A stand-in for src/firebase/config.js, for looking at the My Card page with
 * sample data. There is no Firebase here: a signed-in user object and the one
 * method the page uses. (vite.config.mjs aliases the real module to this.)
 */
export const db = {};
export const auth = {
  currentUser: { uid: 'fixture-user' },
  onAuthStateChanged(callback) {
    callback(this.currentUser);
    return () => {};
  },
};
