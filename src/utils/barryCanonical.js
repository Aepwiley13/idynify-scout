import {
  collection, addDoc, doc, getDoc, setDoc,
  query, orderBy, limit, getDocs, serverTimestamp,
  runTransaction,
} from 'firebase/firestore';

function turnsRef(db, uid) {
  return collection(db, 'users', uid, 'barryConversations', 'canonical', 'turns');
}

export async function appendTurn(db, uid, { role, content, surface, kind }) {
  if (role !== 'user' && role !== 'assistant') return null;
  if (!content) return null;
  const turnDoc = {
    role,
    content,
    surface,
    createdAt: serverTimestamp(),
  };
  if (kind && kind !== 'message') turnDoc.kind = kind;
  return addDoc(turnsRef(db, uid), turnDoc);
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
