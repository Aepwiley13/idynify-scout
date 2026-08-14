/**
 * Phase 5 — tier persistence and routing verification.
 *
 * MANUAL, ONE-SHOT. Not part of the test suite: the filename deliberately does
 * not match vitest's `*.test.*` pattern, because running this on every CI build
 * would create real Firebase accounts on every build.
 *
 *   node --experimental-vm-modules scripts/phase5-verification.mjs
 *
 * WHAT THIS IS, AND WHY IT IS NOT A UNIT TEST
 * ───────────────────────────────────────────
 * The signup suite mocks Firebase, which is right for testing the component but
 * cannot answer Phase 5's question: does a real account, created through the
 * real page, end up with the right fields in Firestore?
 *
 * So this mounts the ACTUAL `Signup.jsx` — no mocks — against the REAL project,
 * fills the real form, presses the real button, and then reads the resulting
 * document back with the SDK. Everything the page does is the page's own code:
 * the `?tier=` read, the payload construction, the redirect.
 *
 * A browser would be the other way to do this, but Chromium cannot reach
 * Firebase from the QA environment (Node and curl can), which is why this runs
 * headless in jsdom. The interaction checks a browser is genuinely needed for —
 * keyboard-only flow, the sticky CTA against a real virtual keyboard, show/hide,
 * error presentation — are Aaron's half of Phase 5 and are not attempted here.
 *
 * TEST ACCOUNTS
 * ─────────────
 * Creates the minimum needed: one per tier path, three total. Plus-addressed and
 * timestamped so they are unmistakably test data and trivially filterable. No
 * existing account is touched, read, or modified.
 *
 * Cleanup runs at the end and deletes both the Firestore document and the auth
 * user, after the evidence has been captured — the document contents are printed
 * before anything is removed, so deletion never destroys the record.
 */

import { readFileSync } from 'node:fs';

// ── jsdom, before anything imports React or Firebase ────────────────────────
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
                 'getComputedStyle', 'localStorage', 'sessionStorage', 'location',
                 'CustomEvent', 'Event', 'MutationObserver', 'requestAnimationFrame',
                 'cancelAnimationFrame']) {
  if (globalThis[k] === undefined) globalThis[k] = dom.window[k];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { render, screen, fireEvent, waitFor, act, cleanup } = await import('@testing-library/react');
const { MemoryRouter, Routes, Route, useLocation } = await import('react-router-dom');

const { auth, db } = await import('../src/firebase/config.js');
const { signOut, deleteUser } = await import('firebase/auth');
const { doc, getDoc, deleteDoc } = await import('firebase/firestore');
const Signup = (await import('../src/pages/Signup.jsx')).default;

// ── Fixtures ────────────────────────────────────────────────────────────────
const STAMP = Date.now();
const PASSWORD = 'Phase5Verify1';          // satisfies the live policy
const email = (tag) => `phase5+${tag}-${STAMP}@idynify.com`;

const CASES = [
  { tag: 'pro',     search: '?tier=pro',     tier: 'pro',     credits: 1250 },
  { tag: 'starter', search: '?tier=starter', tier: 'starter', credits: 400  },
  { tag: 'notier',  search: '',              tier: 'starter', credits: 400  },
];

const created = [];
let failures = 0;

const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures++;
  console.log(`      ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} ${JSON.stringify(actual)}${ok ? '' : `  (expected ${JSON.stringify(expected)})`}`);
};

/** Renders the real page and reports where it navigated to. */
function Harness({ search, onNavigate }) {
  const Probe = () => {
    const loc = useLocation();
    onNavigate(loc.pathname + loc.search);
    return React.createElement('div', null, 'CHECKOUT');
  };
  return React.createElement(
    MemoryRouter, { initialEntries: [`/signup${search}`] },
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/signup', element: React.createElement(Signup) }),
      React.createElement(Route, { path: '/checkout', element: React.createElement(Probe) }),
      React.createElement(Route, { path: '/login', element: React.createElement('div', null, 'LOGIN') }),
    )
  );
}

const configSrc = readFileSync(new URL('../src/firebase/config.js', import.meta.url), 'utf8');
const projectId = configSrc.match(/projectId:\s*"([^"]+)"/)?.[1] ?? 'unknown';

console.log('\n════ PHASE 5 — tier persistence and routing ════');
console.log(`project: ${projectId}`);
console.log(`password used: ${PASSWORD} (8+, upper, lower, number — satisfies the live policy)\n`);

for (const c of CASES) {
  const addr = email(c.tag);
  const label = c.search || '(no tier parameter)';
  console.log(`──── ${label} ────`);
  console.log(`   account: ${addr}`);

  let navigatedTo = null;
  await act(async () => {
    render(React.createElement(Harness, { search: c.search, onNavigate: p => { navigatedTo = p; } }));
  });

  const emailInput = screen.getByLabelText('Email');
  const pwInput = screen.getByLabelText('Password');
  await act(async () => {
    fireEvent.change(emailInput, { target: { value: addr } });
    fireEvent.change(pwInput, { target: { value: PASSWORD } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  });

  await waitFor(() => {
    if (!auth.currentUser) throw new Error('no user yet');
  }, { timeout: 30000 });

  const uid = auth.currentUser.uid;
  created.push({ uid, email: addr, tier: c.tier });

  // Give the component's setDoc time to land before reading it back.
  await waitFor(async () => {
    const s = await getDoc(doc(db, 'users', uid));
    if (!s.exists()) throw new Error('doc not written yet');
  }, { timeout: 30000 });

  const snap = await getDoc(doc(db, 'users', uid));
  const d = snap.data();

  console.log(`   users/${uid}:`);
  console.log('  ', JSON.stringify({
    ...d,
    createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : String(d.createdAt),
  }, null, 1).split('\n').join('\n   '));

  console.log('   assertions:');
  check('selectedTier', d.selectedTier, c.tier);
  check('subscriptionTier', d.subscriptionTier, c.tier);
  check('status', d.status, 'pending_payment');
  check('hasCompletedPayment', d.hasCompletedPayment, false);
  check('credits', d.credits, c.credits);
  check('monthlyCredits', d.monthlyCredits, c.credits);
  check('credits is a number (shape debt)', typeof d.credits, 'number');
  check('email', d.email, addr);
  check('createdAt present', d.createdAt != null, true);
  check('field count', Object.keys(d).length, 8);

  await waitFor(() => { if (navigatedTo === null) throw new Error('no navigation yet'); }, { timeout: 15000 });
  check('redirect', navigatedTo, `/checkout?tier=${c.tier}`);

  cleanup();
  await signOut(auth);
  console.log('');
}

// ── Cleanup — after the evidence above is on the record ─────────────────────
console.log('──── cleanup ────');
const { signInWithEmailAndPassword } = await import('firebase/auth');
const { collection, getDocs } = await import('firebase/firestore');

for (const acct of created) {
  try {
    await signInWithEmailAndPassword(auth, acct.email, PASSWORD);

    // Subcollections FIRST, and while still authenticated as this user.
    //
    // deleteDoc does not cascade — deleting users/{uid} leaves anything beneath
    // it orphaned. The signup flow writes users/{uid}/analytics_events on
    // success, so skipping this strands those documents under a uid that no
    // longer has an owner, and the rules then make them unreachable to
    // everything except the Admin SDK. Learned the hard way on the first run.
    const events = await getDocs(collection(db, 'users', acct.uid, 'analytics_events'));
    for (const e of events.docs) await deleteDoc(e.ref);

    await deleteDoc(doc(db, 'users', acct.uid));
    await deleteUser(auth.currentUser);
    console.log(`   deleted  ${acct.email}  (uid ${acct.uid}) — ${events.size} analytics event(s), user doc, auth user`);
  } catch (e) {
    console.log(`   MANUAL CLEANUP NEEDED  ${acct.email}  (uid ${acct.uid}) — ${e?.code || e?.message}`);
  }
}

console.log(`\n════ ${failures === 0 ? 'ALL ASSERTIONS PASSED' : `${failures} ASSERTION(S) FAILED`} ════\n`);
process.exit(failures === 0 ? 0 : 1);
