// A stand-in for firebase/firestore: writes are logged, take a moment, and can be made to fail once. Reads find nothing.
import { fixture, wait, log } from './fixture.js';
export const doc = (_db, ...segments) => ({ path: segments.join('/') });
export const updateDoc = async (ref, data) => {
  log({ kind: 'contact', path: ref.path, fields: Object.keys(data).filter((k) => k !== 'updated_at').join(', '), data });
  await wait();
  if (fixture.failNext) {
    fixture.failNext = false;
    const error = new Error('fixture failure');
    error.code = 'unavailable';
    throw error;
  }
};
export const setDoc = async () => {};
export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
export const getDocs = async () => ({ docs: [], forEach() {} });
export const collection = (_db, ...segments) => ({ path: segments.join('/') });
export const query = (ref) => ref;
export const where = () => ({});
export const orderBy = () => ({});
export const limit = () => ({});
export const onSnapshot = () => () => {};
export const addDoc = async () => ({ id: 'x' });
export const deleteDoc = async () => {};
export const serverTimestamp = () => new Date().toISOString();
export const arrayUnion = (...v) => v;
export const arrayRemove = (...v) => v;
