/**
 * A small in-memory stand-in for the Firestore Admin API surface the billing webhook, the
 * manual-recovery transaction and the billing rehearsal use. It exists so the rehearsal's
 * step sequence can be executed by plain `npm test`, on a machine with no emulator.
 *
 * It is NOT evidence about Firestore: transactions here run one at a time with no contention,
 * and there are no security rules. What it proves is that the rehearsal driver's own logic
 * (fixtures, signing, ordering, checks, clean-up) is sound. The emulator job and the staging
 * run are what exercise real Firestore.
 *
 * Supported: collection().doc(id?), ref.get/set(merge)/update(dotted paths)/delete,
 * ref.collection(), collection.get(), where(field, '==', value), limit(), runTransaction with
 * tx.get/set/update/delete. Reads-before-writes inside a transaction is enforced, as the
 * Admin SDK enforces it.
 */
export function createMemoryFirestore() {
  const docs = new Map(); // path -> data
  let autoId = 0;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function applyUpdate(target, data) {
    for (const [key, value] of Object.entries(data)) {
      const parts = key.split('.');
      let node = target;
      for (const part of parts.slice(0, -1)) {
        if (node[part] === null || typeof node[part] !== 'object') node[part] = {};
        node = node[part];
      }
      node[parts.at(-1)] = clone(value);
    }
  }

  const write = {
    set(path, data, options) {
      const merged = options?.merge && docs.has(path) ? { ...docs.get(path), ...clone(data) } : clone(data);
      docs.set(path, merged);
    },
    update(path, data) {
      if (!docs.has(path)) throw new Error(`NOT_FOUND: no document to update: ${path}`);
      const next = clone(docs.get(path));
      applyUpdate(next, data);
      docs.set(path, next);
    },
    delete(path) {
      docs.delete(path);
    },
  };

  const snapshot = (ref) => {
    const data = clone(docs.get(ref.path));
    return { exists: data !== undefined, id: ref.id, ref, data: () => data };
  };

  function docRef(path) {
    const ref = {
      path,
      id: path.split('/').at(-1),
      get: async () => snapshot(ref),
      set: async (data, options) => write.set(path, data, options),
      update: async (data) => write.update(path, data),
      delete: async () => write.delete(path),
      collection: (name) => collectionRef(`${path}/${name}`),
    };
    return ref;
  }

  function query(collectionPath, filters = [], max = Infinity) {
    const depth = collectionPath.split('/').length + 1;
    return {
      where(field, op, value) {
        if (op !== '==') throw new Error(`memoryFirestore: unsupported operator ${op}`);
        return query(collectionPath, [...filters, [field, value]], max);
      },
      limit: (n) => query(collectionPath, filters, n),
      async get() {
        const matches = [...docs.keys()]
          .filter((p) => p.startsWith(`${collectionPath}/`) && p.split('/').length === depth)
          .filter((p) => filters.every(([field, value]) => docs.get(p)?.[field] === value))
          .sort()
          .slice(0, max)
          .map((p) => snapshot(docRef(p)));
        return { empty: matches.length === 0, size: matches.length, docs: matches };
      },
    };
  }

  function collectionRef(path) {
    return { ...query(path), doc: (id) => docRef(`${path}/${id ?? `auto${String(++autoId).padStart(6, '0')}`}`) };
  }

  const db = {
    collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      const pending = [];
      let wrote = false;
      const tx = {
        async get(ref) {
          if (wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return ref.get();
        },
        set(ref, data, options) { wrote = true; pending.push(() => write.set(ref.path, data, options)); },
        update(ref, data) { wrote = true; pending.push(() => write.update(ref.path, data)); },
        delete(ref) { wrote = true; pending.push(() => write.delete(ref.path)); },
      };
      const result = await fn(tx);
      // All or nothing: validate updates against current state before applying any write.
      const before = new Map(docs);
      try {
        for (const apply of pending) apply();
      } catch (err) {
        docs.clear();
        for (const [k, v] of before) docs.set(k, v);
        throw err;
      }
      return result;
    },
    /** Test-only: every stored path, sorted. */
    __paths: () => [...docs.keys()].sort(),
  };
  return db;
}
