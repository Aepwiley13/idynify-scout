/**
 * In-memory Firestore for capture. Reads return the synthetic fixtures by
 * document path; queries return nothing; writes are discarded.
 */
import { captureState } from './state.mjs';

function docRef(path) {
  return {
    id: path.split('/').pop(),
    path,
    async get() {
      const data = captureState().docs.get(path);
      return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
    },
    collection: (name) => collectionRef(`${path}/${name}`),
    async set() {}, async update() {}, async delete() {},
  };
}

function collectionRef(path) {
  const query = {
    where: () => query, orderBy: () => query, limit: () => query, startAfter: () => query, select: () => query,
    async get() { return { empty: true, size: 0, docs: [], forEach() {} }; },
  };
  return { ...query, doc: (id = 'generated') => docRef(`${path}/${id}`), async add() { return docRef(`${path}/added`); } };
}

export const db = {
  collection: (name) => collectionRef(name),
  doc: (path) => docRef(path),
  batch: () => ({ set() {}, update() {}, delete() {}, async commit() {} }),
  async runTransaction(fn) { return fn({ get: (ref) => ref.get(), set() {}, update() {}, delete() {} }); },
  async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); },
};

export const FieldValue = {
  serverTimestamp: () => ({ __field: 'serverTimestamp' }),
  increment: (n) => ({ __field: 'increment', n }),
  arrayUnion: (...v) => ({ __field: 'arrayUnion', v }),
  arrayRemove: (...v) => ({ __field: 'arrayRemove', v }),
  delete: () => ({ __field: 'delete' }),
};

export const Timestamp = { now: () => ({ toDate: () => new Date(0), toMillis: () => 0 }), fromDate: (d) => ({ toDate: () => d }) };
