// In-memory persistence for the isolated profile and Action Center.
import { fixture, wait, log } from './fixture.js';

const dataByPath = new Map();
const versions = new Map();
const listeners = new Map();
const union = Symbol('arrayUnion');
const remove = Symbol('arrayRemove');
let pending = Promise.resolve();

export const clearFixtureDocs = () => { dataByPath.clear(); versions.clear(); };
export const seedFixtureDoc = (path, data) => { dataByPath.set(path, data); versions.set(path, (versions.get(path) ?? 0) + 1); };
export const getFixtureDoc = (path) => dataByPath.get(path) ?? null;
export const getFixtureVersion = (path) => `${versions.get(path) ?? 1}:0`;
export const listFixtureDocs = (prefix) => [...dataByPath.entries()].filter(([path]) => path.startsWith(prefix + '/'));
export const deleteFixtureDoc = (path) => dataByPath.delete(path);
export const doc = (parent, ...segments) => ({ path: [parent?.path, ...segments].filter(Boolean).join('/') });
export const collection = doc;
export const query = (ref) => ref;
export const where = () => ({});
export const orderBy = () => ({});
export const limit = () => ({});
export const serverTimestamp = () => new Date().toISOString();
export const arrayUnion = (...values) => ({ [union]: values });
export const arrayRemove = (...values) => ({ [remove]: values });
export const Timestamp = { now: () => {
  const time = new Date();
  return { toDate: () => time, toMillis: () => time.getTime() };
} };

const snapshot = (path) => ({ id: path.split('/').at(-1), exists: () => dataByPath.has(path), data: () => dataByPath.get(path), updateTime: { seconds: versions.get(path) ?? 1, nanoseconds: 0 } });
export const getDoc = async (ref) => snapshot(ref.path);
const list = (path) => [...dataByPath.keys()]
  .filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
  .map(snapshot);
export const getDocFromServer = getDoc;
export const getDocs = async (ref) => ({ docs: list(ref.path) });
export const onSnapshot = (ref, next) => {
  const notify = () => next({ docs: list(ref.path) });
  if (!listeners.has(ref.path)) listeners.set(ref.path, new Set());
  listeners.get(ref.path).add(notify);
  notify();
  return () => listeners.get(ref.path).delete(notify);
};

function commit(ref, updates, merge) {
  const current = dataByPath.get(ref.path) ?? {};
  const entries = Object.entries(updates).map(([field, value]) => {
    const old = current[field] ?? [];
    if (value?.[union]) return [field, [...old, ...value[union].filter((entry) => !old.some((item) => JSON.stringify(item) === JSON.stringify(entry)))]];
    if (value?.[remove]) return [field, old.filter((item) => !value[remove].some((entry) => JSON.stringify(entry) === JSON.stringify(item)))];
    return [field, value];
  });
  dataByPath.set(ref.path, { ...(merge ? current : {}), ...Object.fromEntries(entries) });
  versions.set(ref.path, (versions.get(ref.path) ?? 0) + 1);
}

const record = (ref, data) => log({
  kind: 'contact', path: ref.path, fields: Object.keys(data).filter((key) => key !== 'updated_at').join(', '), data,
});

function notifyCollections(refs) {
  const paths = new Set(refs.map((ref) => ref.path.split('/').slice(0, -1).join('/')));
  for (const path of paths) for (const notify of listeners.get(path) ?? []) notify();
}

async function checkWrite() {
  await wait();
  if (fixture.failNext) {
    fixture.failNext = false;
    throw Object.assign(new Error('fixture failure'), { code: 'unavailable' });
  }
}

export const updateDoc = async (ref, data) => {
  record(ref, data);
  await checkWrite();
  commit(ref, data, true);
  notifyCollections([ref]);
};

export const setDoc = async (ref, data) => {
  record(ref, data);
  await checkWrite();
  commit(ref, data, false);
  notifyCollections([ref]);
};
export const addDoc = async (ref, data) => {
  const child = doc(ref, crypto.randomUUID());
  await setDoc(child, data);
  return { id: child.path.split('/').at(-1) };
};
export const deleteDoc = async (ref) => { dataByPath.delete(ref.path); versions.delete(ref.path); notifyCollections([ref]); };

export function runTransaction(_db, apply) {
  const result = pending.then(async () => {
    const writes = [];
    const value = await apply({
      get: getDoc,
      update: (ref, data) => writes.push({ ref, data, merge: true }),
      set: (ref, data) => writes.push({ ref, data, merge: false }),
    });
    await checkWrite();
    for (const { ref, data, merge } of writes) {
      commit(ref, data, merge);
      record(ref, data);
    }
    notifyCollections(writes.map(({ ref }) => ref));
    return value;
  });
  pending = result.catch(() => {});
  return result;
}

export function writeBatch(db) {
  const writes = [];
  return {
    set: (...args) => writes.push((tx) => tx.set(...args)),
    update: (...args) => writes.push((tx) => tx.update(...args)),
    commit: () => runTransaction(db, (tx) => { for (const write of writes) write(tx); }),
  };
}
