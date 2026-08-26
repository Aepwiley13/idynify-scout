import {
  collection, addDoc, doc, getDoc, setDoc,
  query, orderBy, limit, getDocs, serverTimestamp,
  runTransaction,
} from 'firebase/firestore';

function turnsRef(db, uid) {
  return collection(db, 'users', uid, 'barryConversations', 'canonical', 'turns');
}

/**
 * @param {Object} params
 * @param {string} [params.kind]  'message' (default) | 'result_set' | 'resolution_preview' | ...
 * @param {Object} [params.meta]  NON-IDENTIFYING turn metadata only.
 *
 * `meta` exists so a structured turn can point at the transient data it rendered
 * (a sessionRef) and record counts, WITHOUT persisting the data itself.
 *
 * It must never carry candidate identity. Search results are proposals; writing
 * names, emails, LinkedIn URLs or Apollo ids into a turn document would be
 * candidate persistence whatever collection it lives in. The identity data for a
 * structured turn lives in src/utils/barryTransientCandidates.js, in memory, and
 * is deliberately lost on reload — see that file for why that is the honest
 * behaviour rather than a limitation.
 */
export async function appendTurn(db, uid, { role, content, surface, kind, meta }) {
  if (role !== 'user' && role !== 'assistant') return null;
  if (!content) return null;
  const turnDoc = {
    role,
    content,
    surface,
    createdAt: serverTimestamp(),
  };
  if (kind && kind !== 'message') turnDoc.kind = kind;
  if (meta && Object.keys(meta).length) turnDoc.meta = stripIdentity(meta);
  return addDoc(turnsRef(db, uid), turnDoc);
}

/**
 * Defence in depth for the rule above: even if a caller passes identity by
 * mistake, it does not reach Firestore. Cheap, and the failure it prevents
 * (a durable copy of unresolved candidate identity) is expensive to undo.
 */
const FORBIDDEN_IN_META = new Set([
  'email', 'phone', 'linkedin_url', 'apollo_person_id', 'apollo_organization_id',
  'name', 'company_name', 'title', 'results', 'candidates', 'payloads',
]);

export function stripIdentity(meta) {
  const clean = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_IN_META.has(k)) {
      console.warn(`[barryCanonical] refused to persist "${k}" in turn meta — candidate identity stays transient`);
      continue;
    }
    clean[k] = v;
  }
  return clean;
}

export async function loadRecentTurns(db, uid, count = 30) {
  const q = query(turnsRef(db, uid), orderBy('createdAt', 'desc'), limit(count));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
}

export async function loadAllTurns(db, uid) {
  const q = query(turnsRef(db, uid), orderBy('createdAt', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * G2-D1 + G2-C3: Atomically claim the seed lock, import legacy turns,
 * then mark completion.
 *
 * Lifecycle:
 *   1. Transaction claims the lock (seeding: true). A concurrent caller
 *      seeing an active lock bails. A stale lock (>2 min) is reclaimed.
 *   2. Legacy turns are imported.
 *   3. On success: seedComplete: true, seeding cleared.
 *      On failure: seeding cleared so the next caller can retry.
 *
 * seedComplete is the authoritative completion marker — it means the
 * import finished, not merely that a caller claimed the lock.
 */
export async function seedFromLegacy(db, uid) {
  const metaRef = doc(db, 'users', uid, 'barryConversations', 'canonical');

  const shouldSeed = await runTransaction(db, async (txn) => {
    const metaSnap = await txn.get(metaRef);
    const data = metaSnap.exists() ? metaSnap.data() : {};
    if (data.seedComplete) return false;
    if (data.seeding) {
      const age = data.seedingAt?.toMillis
        ? Date.now() - data.seedingAt.toMillis()
        : Infinity;
      if (age < 120_000) return false;
    }
    txn.set(metaRef, { seeding: true, seedingAt: serverTimestamp() }, { merge: true });
    return true;
  });

  if (!shouldSeed) return false;

  let imported = false;
  let hadError = false;

  for (const docId of ['missionControl', 'icpChat', 'icp']) {
    try {
      const legacyRef = doc(db, 'users', uid, 'barryConversations', docId);
      const snap = await getDoc(legacyRef);
      if (!snap.exists()) continue;
      const msgs = snap.data().messages || [];
      if (msgs.length === 0) continue;

      const coll = turnsRef(db, uid);
      for (const m of msgs) {
        if (!m.content) continue;
        const role = m.role === 'barry' ? 'assistant' : m.role;
        if (role !== 'user' && role !== 'assistant') continue;
        await addDoc(coll, {
          role,
          content: m.content,
          surface: 'legacy',
          createdAt: serverTimestamp(),
        });
      }
      imported = true;
      break;
    } catch (err) {
      hadError = true;
      console.warn(`[barryCanonical] legacy seed from ${docId} failed:`, err.message);
    }
  }

  const complete = imported || !hadError;
  await setDoc(metaRef,
    complete
      ? { seedComplete: true, seeding: false, seededAt: serverTimestamp() }
      : { seeding: false },
    { merge: true }
  );

  return imported;
}

export async function loadOrSeedRecentTurns(db, uid, count = 30) {
  let turns = await loadRecentTurns(db, uid, count);
  if (turns.length > 0) return turns;

  const seeded = await seedFromLegacy(db, uid);
  if (seeded) return loadRecentTurns(db, uid, count);
  return [];
}
