export const db = { fixture: true };
const currentUser = { uid: 'u1', getIdToken: async () => 'fixture-only' };
export const auth = {
  currentUser,
  onAuthStateChanged(listener) {
    listener(currentUser);
    return () => {};
  },
};
export default {};
