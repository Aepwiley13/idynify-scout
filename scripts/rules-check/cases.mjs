/**
 * The 12 simulator cases from firestore.rules.proposed, run against a REAL
 * Firestore emulator on a throwaway `demo-` project.
 *
 * Case 9 is the one that matters: if Path indexing on the recursive wildcard
 * does not behave as reasoned, the likely failure is that isAppendOnly() errors
 * and the whole `allow update, delete` denies — which would break ordinary
 * product writes, not just the two protected collections.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-icp-rules',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

const U = 'U';
const me = env.authenticatedContext(U).firestore();
const other = env.authenticatedContext('OTHER').firestore();

// Seed the documents an update/delete case needs, with rules bypassed.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const p of [
    [`users/${U}/lineageEvents/e1`, { eventType: 'accepted' }],
    [`users/${U}/icpProfiles/i1`, { name: 'ICP One' }],
    [`users/${U}/icpProfiles/i1/criteriaVersions/v1`, { fingerprint: 'fp1' }],
    [`users/${U}/icpRelationships/r1`, { state: 'pending' }],
    [`users/${U}/companies/c1`, { status: 'pending' }],
    [`users/${U}/contacts/k1`, { name: 'x' }],
    [`users/${U}/exclusions/company__c1`, { active: true }],
    [`users/${U}/companies/c1/timeline/t1`, { note: 'x' }],
    [`users/${U}/icpProfiles/i1/messagingDrafts/d1`, { body: 'x' }],
    [`users/${U}/notifications/n1`, { seen: false }],
    [`users/${U}/companies/c2`, { status: 'pending' }],
  ]) await setDoc(doc(db, p[0]), p[1]);
});

const CASES = [
  ['01  create lineageEvents/e2', 'ALLOW', () => setDoc(doc(me, `users/${U}/lineageEvents/e2`), { eventType: 'skipped' })],
  ['02  update lineageEvents/e1', 'DENY', () => updateDoc(doc(me, `users/${U}/lineageEvents/e1`), { eventType: 'tampered' })],
  ['03  delete lineageEvents/e1', 'DENY', () => deleteDoc(doc(me, `users/${U}/lineageEvents/e1`))],
  ['04  get    lineageEvents/e1', 'ALLOW', () => getDoc(doc(me, `users/${U}/lineageEvents/e1`))],
  ['05  create criteriaVersions/v2', 'ALLOW', () => setDoc(doc(me, `users/${U}/icpProfiles/i1/criteriaVersions/v2`), { fingerprint: 'fp2' })],
  ['06  update criteriaVersions/v1', 'DENY', () => updateDoc(doc(me, `users/${U}/icpProfiles/i1/criteriaVersions/v1`), { fingerprint: 'tampered' })],
  ['07  update icpProfiles/i1  (version pointer)', 'ALLOW', () => updateDoc(doc(me, `users/${U}/icpProfiles/i1`), { currentCriteriaVersionId: 'v2' })],
  ['08  update icpRelationships/r1', 'ALLOW', () => updateDoc(doc(me, `users/${U}/icpRelationships/r1`), { state: 'accepted' })],
  ['09  update companies/c1  ← THE REGRESSION CASE', 'ALLOW', () => updateDoc(doc(me, `users/${U}/companies/c1`), { status: 'accepted' })],
  ['10  update contacts/k1', 'ALLOW', () => updateDoc(doc(me, `users/${U}/contacts/k1`), { name: 'y' })],
  ['11  update exclusions/company__c1', 'ALLOW', () => updateDoc(doc(me, `users/${U}/exclusions/company__c1`), { active: false })],
  ['12  OTHER reads users/U/companies/c1', 'DENY', () => getDoc(doc(other, `users/${U}/companies/c1`))],
  // ── hardening beyond the original 12 — the near-miss showed how easily a
  // recursive-wildcard rule re-grants what a narrower rule just withheld.
  ['13  update companies/c1/timeline/t1  (3-deep)', 'ALLOW', () => updateDoc(doc(me, `users/${U}/companies/c1/timeline/t1`), { note: 'y' })],
  ['14  update icpProfiles/i1/messagingDrafts/d1', 'ALLOW', () => updateDoc(doc(me, `users/${U}/icpProfiles/i1/messagingDrafts/d1`), { body: 'y' })],
  ['15  delete companies/c2  (own data stays deletable)', 'ALLOW', () => deleteDoc(doc(me, `users/${U}/companies/c2`))],
  ['16  update notifications/n1', 'ALLOW', () => updateDoc(doc(me, `users/${U}/notifications/n1`), { seen: true })],
  ['17  update users/U itself', 'ALLOW', () => setDoc(doc(me, `users/${U}`), { displayName: 'x' }, { merge: true })],
  ['18  OTHER creates users/U/lineageEvents/e9', 'DENY', () => setDoc(doc(other, `users/${U}/lineageEvents/e9`), { eventType: 'x' })],
  ['19  create criteriaVersions then update it', 'DENY', async () => {
      await setDoc(doc(me, `users/${U}/icpProfiles/i1/criteriaVersions/v9`), { fingerprint: 'a' });
      return updateDoc(doc(me, `users/${U}/icpProfiles/i1/criteriaVersions/v9`), { fingerprint: 'b' });
    }],
];

let pass = 0, fail = 0;
const failures = [];
for (const [name, expect, run] of CASES) {
  try {
    await (expect === 'ALLOW' ? assertSucceeds(run()) : assertFails(run()));
    console.log(`  ✓ ${name.padEnd(46)} ${expect}`);
    pass++;
  } catch (err) {
    console.log(`  ✗ ${name.padEnd(46)} ${expect}  — ${String(err.message).split('\n')[0].slice(0, 110)}`);
    failures.push(name);
    fail++;
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
if (fail) console.log('  FAILED:', failures.join(' | '));
await env.cleanup();
process.exit(fail ? 1 : 0);
