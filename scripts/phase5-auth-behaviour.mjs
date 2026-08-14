/**
 * Phase 5 — M4, M5, M8 against the live project.
 *
 * MANUAL, ONE-SHOT. Same posture as phase5-verification.mjs: outside the
 * test-file pattern so CI never runs it, because it creates real accounts.
 *
 *   node --import ./scripts/phase5-loader-register.mjs scripts/phase5-auth-behaviour.mjs
 *
 * These three checks need a real auth backend, and Chromium cannot reach
 * Firebase from the QA environment, so they run headless against the real
 * project with the real `Signup.jsx` mounted — same method as the tier
 * verification.
 *
 * M5 is the substantive one. The review asks two questions that only a live
 * run can answer, and is explicit that neither answer is automatically a
 * defect:
 *
 *   (a) does the CLIENT prevent submitting a non-compliant password?
 *   (b) does FIREBASE accept one under Notify mode?
 *
 * The password used for the non-compliant case is 8 characters, so it clears
 * Firebase's own hard 6-character floor and isolates the *policy* question.
 * Anything shorter would be rejected for a reason unrelated to the policy and
 * would answer nothing.
 *
 * M8 then reuses that account: it is, by construction, an account whose
 * password does not satisfy the policy — exactly what check 7 needs, without
 * touching anyone real.
 */

import { readFileSync, appendFileSync } from 'node:fs';

/**
 * Append-on-creation ledger.
 *
 * The first version of this script crashed between creating an account and
 * cleaning it up, and because the address was only ever held in memory the
 * account could not be identified afterwards — only its uid, recovered from
 * stdout. Writing the identity to disk the moment it exists means a crash
 * costs a cleanup step, not a mystery.
 */
const LEDGER = new URL('../.phase5-accounts.log', import.meta.url);
const recordAccount = (email, uid) => {
  try {
    appendFileSync(LEDGER, `${new Date().toISOString()}\t${email}\t${uid}\n`);
  } catch { /* the run matters more than the ledger */ }
};

const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/', pretendToBeVisual: true,
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
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { auth, db } = await import('../src/firebase/config.js');
const { signOut, signInWithEmailAndPassword, deleteUser, validatePassword } = await import('firebase/auth');
const { doc, deleteDoc, collection, getDocs } = await import('firebase/firestore');
const Signup = (await import('../src/pages/Signup.jsx')).default;

const STAMP = Date.now();
const WEAK = 'abcdefgh';            // 8 chars: no uppercase, no digit → policy-non-compliant
const ADDR = `phase5+notify-${STAMP}@idynify.com`;

const line = (l, v) => console.log(`   ${String(l).padEnd(46)} ${v}`);

function mount() {
  return render(React.createElement(
    MemoryRouter, { initialEntries: ['/signup?tier=starter'] },
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/signup', element: React.createElement(Signup) }),
      React.createElement(Route, { path: '/checkout', element: React.createElement('div', null, 'CHECKOUT') }),
      React.createElement(Route, { path: '/login', element: React.createElement('div', null, 'LOGIN') }),
    )));
}

async function fillAndSubmit(email, password) {
  await act(async () => { mount(); });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  });
  const cta = screen.getByRole('button', { name: /create account/i });
  const disabledBeforeSubmit = cta.disabled;
  await act(async () => { fireEvent.click(cta); });
  return { disabledBeforeSubmit };
}

console.log('\n════ PHASE 5 — M5 / M4 / M8 against the live project ════\n');

// ── M5 ──────────────────────────────────────────────────────────────────────
console.log('──── M5 · password policy under Notify mode ────');

const status = await validatePassword(auth, WEAK);
line('live policy min length', status.passwordPolicy.customStrengthOptions.minPasswordLength);
line('live policy requires uppercase', !!status.passwordPolicy.customStrengthOptions.containsUppercaseLetter);
line('live policy requires lowercase', !!status.passwordPolicy.customStrengthOptions.containsLowercaseLetter);
line('live policy requires a number', !!status.passwordPolicy.customStrengthOptions.containsNumericCharacter);
line(`"${WEAK}" satisfies the policy?`, status.isValid);
line('  · meets min length', status.meetsMinPasswordLength);
line('  · contains uppercase', status.containsUppercaseLetter);
line('  · contains a number', status.containsNumericCharacter);

const { disabledBeforeSubmit } = await fillAndSubmit(ADDR, WEAK);
line('(a) CLIENT blocks submission?', disabledBeforeSubmit ? 'YES — CTA disabled' : 'NO — CTA enabled, submit allowed');

let accepted = false, uid = null, uiError = null;
try {
  await waitFor(() => { if (!auth.currentUser) throw new Error('waiting'); }, { timeout: 30000 });
  accepted = true;
  uid = auth.currentUser.uid;
  recordAccount(ADDR, uid);
} catch {
  uiError = document.querySelector('.auth-alert')?.textContent.replace(/\s+/g, ' ').trim() || '(none)';
}
line('(b) FIREBASE accepts it under Notify?', accepted ? 'YES — account created' : `NO — ${uiError}`);
if (uid) line('    uid', uid);
cleanup();

// ── M4 ──────────────────────────────────────────────────────────────────────
console.log('\n──── M4 · duplicate email ────');
if (!accepted) {
  console.log('   SKIPPED — no account was created in M5');
} else {
  await signOut(auth);
  await fillAndSubmit(ADDR, WEAK);           // same address, second time
  await waitFor(() => {
    if (!document.querySelector('.auth-alert')) throw new Error('waiting for alert');
  }, { timeout: 30000 });

  const alert = document.querySelector('.auth-alert');
  const link = alert.querySelector('a');
  line('message', `"${alert.textContent.replace(/\s+/g, ' ').trim()}"`);
  line('role="alert"', alert.getAttribute('role'));
  line('raw Firebase code leaked?', /auth\//.test(alert.textContent) ? 'YES (FAIL)' : 'NO');
  line('"Sign in instead" is a real link', link ? `YES → ${link.getAttribute('href')}` : 'NO (FAIL)');
  line('email preserved', `"${screen.getByLabelText('Email').value}"`);
  line('password preserved', screen.getByLabelText('Password').value ? 'YES' : 'NO');
  line('CTA re-enabled', !screen.getByRole('button', { name: /create account/i }).disabled);
  cleanup();
}

// ── M8 ──────────────────────────────────────────────────────────────────────
console.log('\n──── M8 · existing non-compliant password still authenticates (check 7) ────');
if (!accepted) {
  console.log('   SKIPPED — no non-compliant account exists to test with');
} else {
  await signOut(auth);
  let signedIn = false, err = null;
  try {
    const cred = await signInWithEmailAndPassword(auth, ADDR, WEAK);
    signedIn = !!cred.user;
  } catch (e) { err = e?.code || e?.message; }
  line('signs in with the non-compliant password', signedIn ? 'YES' : `NO — ${err}`);
  line('forced into a password change?', err === 'auth/password-does-not-meet-requirements' ? 'YES (FAIL)' : 'NO');
  const live = await (await fetch(`https://identitytoolkit.googleapis.com/v2/passwordPolicy?key=${JSON.parse(JSON.stringify(readFileSync(new URL('../src/firebase/config.js', import.meta.url), 'utf8').match(/apiKey:\s*"([^"]+)"/)[1]))}`)).json();
  line('live enforcementState', live.enforcementState);
  line('live forceUpgradeOnSignin', `${live.forceUpgradeOnSignin}   ← see #546`);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
console.log('\n──── cleanup ────');
try {
  if (!auth.currentUser) await signInWithEmailAndPassword(auth, ADDR, WEAK);
  const u = auth.currentUser.uid;
  const events = await getDocs(collection(db, 'users', u, 'analytics_events'));
  for (const e of events.docs) await deleteDoc(e.ref);
  await deleteDoc(doc(db, 'users', u));
  await deleteUser(auth.currentUser);
  console.log(`   deleted  ${ADDR}  (uid ${u}) — ${events.size} analytics event(s), user doc, auth user`);
} catch (e) {
  console.log(`   MANUAL CLEANUP NEEDED  ${ADDR} — ${e?.code || e?.message}`);
}

console.log('');
process.exit(0);
