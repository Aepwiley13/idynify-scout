export const db = { fixture: true };
export const auth = { currentUser: { uid: 'u1', getIdToken: async () => 'fixture-only' } };
export default {};
