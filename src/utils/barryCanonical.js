import {
  collection, addDoc, doc, getDoc, setDoc,
  query, orderBy, limit, getDocs, serverTimestamp,
} from 'firebase/firestore';

function turnsRef(db, uid) {
  return collection(db, 'users', uid, 'barryConversations', 'canonical', 'turns');
}

export async function appendTurn(db, uid, { role, content, surface }) {
  if (role !== 'user' && role !== 'assistant') return null;
  if (!content) return null;
  return addDoc(turnsRef(db, uid), {
    role,
    content,
    surface,
    createdAt: serverTimestamp(),
  });
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

export async function seedFromLegacy(db, uid) {
  const metaRef = doc(db, 'users', uid, 'barryConversations', 'canonical');
  const metaSnap = await getDoc(metaRef);
  if (metaSnap.exists() && metaSnap.data().seeded) return false;

  await setDoc(metaRef, { seeded: true, seededAt: serverTimestamp() }, { merge: true });

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
      return true;
    } catch (err) {
      console.warn(`[barryCanonical] legacy seed from ${docId} failed:`, err.message);
    }
  }
  return false;
}

export async function loadOrSeedRecentTurns(db, uid, count = 30) {
  let turns = await loadRecentTurns(db, uid, count);
  if (turns.length > 0) return turns;

  const seeded = await seedFromLegacy(db, uid);
  if (seeded) return loadRecentTurns(db, uid, count);
  return [];
}
