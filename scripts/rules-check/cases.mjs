/**
 * The rules suite, run against a REAL Firestore emulator on a throwaway
 * `demo-` project.
 *
 * It reads ../../firestore.rules — THE LIVE FILE, not a copy — so any future
 * change to the deployed ruleset is checked by this suite before it is
 * reviewable. That is the point: the two faults this caught the first time
 * both read as correct and behaved as neither.
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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, getDocs } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-icp-rules',
  firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
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
    ['ops_alerts/daily-leads-refresh', { lastAlertAtMs: 1, job: 'daily-leads-refresh' }],
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
  // ── ops_alerts — the cron alert cooldown, written only by the Admin SDK.
  // A client that could write here could push lastAlertAtMs into the future
  // and silence every scheduled-job alert. Signed-in is not privileged here:
  // no client is. Read is denied too — the collection reveals which jobs are
  // failing and how often.
  ['20  ops_alerts read', 'DENY', () => getDoc(doc(me, 'ops_alerts/daily-leads-refresh'))],
  ['21  ops_alerts update (silence the alert)', 'DENY',
      () => updateDoc(doc(me, 'ops_alerts/daily-leads-refresh'), { lastAlertAtMs: 9e15 })],
  ['22  ops_alerts create a new job doc', 'DENY',
      () => setDoc(doc(me, 'ops_alerts/gmail-sync-worker'), { lastAlertAtMs: 9e15 })],
  ['23  ops_alerts delete', 'DENY', () => deleteDoc(doc(me, 'ops_alerts/daily-leads-refresh'))],
];

// ── users/{uid}: server-controlled fields ──────────────────────────────────
// The owner keeps every profile write the app makes today, but cannot add,
// change or remove a field the server trusts for authorization or that
// records billing. The list below is this suite's own copy, taken from the
// code that writes and reads these fields, so a field dropped from the rules
// fails here instead of passing quietly.
const SERVER_CONTROLLED = {
  // authorization: utils/adminAuth.js, utils/superAdminAuth.js
  role: 'admin', permissions: ['*'], permissionsOverride: true, permissions_reset_at: 'x',
  // suspension: adminSuspendAccount.js, adminReactivateAccount.js
  accountStatus: 'suspended', suspendedAt: 'x', suspendedBy: 'x', suspensionReason: 'x',
  reactivatedAt: 'x', reactivatedBy: 'x', reactivationReason: 'x',
  // billing: stripe-webhook.js, Signup.jsx
  hasCompletedPayment: true, paymentCompletedAt: 'x', subscriptionTier: 'pro',
  subscriptionStatus: 'active', selectedTier: 'pro', status: 'active', credits: 99999,
  monthlyCredits: 99999, tierLimits: { teamSeats: 99 }, features: { mobilePhone: true },
  billingCycleDate: 1, stripeCustomerId: 'cus_someone_else', stripeSubscriptionId: 'sub_x',
};

// Exactly what Signup.jsx writes when it creates the document.
const signup = (tier) => ({
  email: 'new@example.test', createdAt: new Date(0), selectedTier: tier, subscriptionTier: tier,
  status: 'pending_payment', hasCompletedPayment: false,
  credits: tier === 'pro' ? 1250 : 400, monthlyCredits: tier === 'pro' ? 1250 : 400,
});

// P: a signed-up, unpaid user. A: an admin. SA: a super admin.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/P'), { ...signup('starter'), preferences: { theme: 'light' }, reconProgress: { currentSection: 1 } });
  await setDoc(doc(db, 'users/A'), { email: 'a@example.test', role: 'admin' });
  await setDoc(doc(db, 'users/SA'), { email: 'sa@example.test', role: 'super_admin', permissions: ['tenants.read'] });
});
const p = env.authenticatedContext('P').firestore();
const a = env.authenticatedContext('A').firestore();
const sa = env.authenticatedContext('SA').firestore();
let fresh = 0;
const newUser = () => { const uid = `NEW${++fresh}`; return [uid, env.authenticatedContext(uid).firestore()]; };
const create = (data, opts) => { const [uid, db] = newUser(); return () => setDoc(doc(db, `users/${uid}`), data, opts); };
const asAdminSdk = (write) => () => env.withSecurityRulesDisabled(ctx => write(ctx.firestore()));

const USER_DOC_CASES = [
  // Every profile write the app makes today (shapes copied from the call sites).
  ['P  displayName            UserSettings.jsx:527', 'ALLOW', () => updateDoc(doc(p, 'users/P'), { displayName: 'Pat' })],
  ['P  bookingLink            UserSettings.jsx:545', 'ALLOW', () => updateDoc(doc(p, 'users/P'), { bookingLink: 'https://cal.example.test/p' })],
  ['P  preferences.theme      ThemeContext.jsx:102', 'ALLOW', () => setDoc(doc(p, 'users/P'), { preferences: { theme: 'dark' } }, { merge: true })],
  ['P  preferences.<key>      useUserPreference.js:74', 'ALLOW', () => updateDoc(doc(p, 'users/P'), { 'preferences.missionSounds': false })],
  ['P  onboarding             useOnboardingState.js:198', 'ALLOW', () => setDoc(doc(p, 'users/P'), { onboarding: { started: true } }, { merge: true })],
  ['P  onboarding + barry     BarryOnboarding.jsx:536', 'ALLOW', () => setDoc(doc(p, 'users/P'), {
      onboardingComplete: true, onboardingCompletedAt: new Date(0), onboardingSource: 'barry',
      barryState: 'SEARCHING', companiesFoundCount: 0, hasSeenMCWelcome: false }, { merge: true })],
  ['P  onboardingComplete     ReconOnboardingWizard.jsx:132', 'ALLOW', () => setDoc(doc(p, 'users/P'), { onboardingComplete: true }, { merge: true })],
  ['P  hasSeenMCWelcome       MissionControlDashboardV2.jsx:335', 'ALLOW', () => setDoc(doc(p, 'users/P'), { hasSeenMCWelcome: true }, { merge: true })],
  ['P  barryState + count     ICPSettings.jsx:297, search-companies.js', 'ALLOW', () => setDoc(doc(p, 'users/P'), { barryState: 'READY', companiesFoundCount: 12 }, { merge: true })],
  ['P  firstName              resolveWho.js:125', 'ALLOW', () => setDoc(doc(p, 'users/P'), { firstName: 'Pat' }, { merge: true })],
  ['P  section1Output         Section1Foundation.jsx:301', 'ALLOW', () => updateDoc(doc(p, 'users/P'), {
      section1Output: { summary: 'x' }, 'reconProgress.currentSection': 2, 'reconProgress.section1Completed': true, 'reconProgress.lastUpdated': new Date(0) })],
  ['P  sectionNAnswers        Section2..10 *.jsx', 'ALLOW', () => updateDoc(doc(p, 'users/P'), { section5Answers: { q1: 'x' }, 'reconProgress.section5LastSaved': new Date(0) })],
  ['P  scoutData autosave     ImprovedScoutQuestionnaire.jsx:219', 'ALLOW', () => updateDoc(doc(p, 'users/P'), { scoutData: { goal: 'x' }, lastModified: new Date(0) })],
  ['P  scoutData submit       ImprovedScoutQuestionnaire.jsx:346', 'ALLOW', () => updateDoc(doc(p, 'users/P'), { scoutData: { goal: 'y' }, scoutCompleted: true, scoutCompletedAt: new Date(0) })],
  ['P  reads own document', 'ALLOW', () => getDoc(doc(p, 'users/P'))],

  // Signup creates the document with its billing fields, exactly as Signup.jsx writes them.
  ['new  signup, starter (400 credits)', 'ALLOW', create(signup('starter'))],
  ['new  signup, pro (1250 credits)', 'ALLOW', create(signup('pro'))],
  ['new  first write is a profile merge', 'ALLOW', create({ preferences: { theme: 'dark' } }, { merge: true })],
  // Only the tiers the app sells: starter and pro (Homepage.jsx, CheckoutPage.jsx, stripe-webhook.js).
  ['new  signup, unknown tier team', 'DENY', create(signup('team'))],
  ['new  signup, unknown tier enterprise', 'DENY', create(signup('enterprise'))],
  ['new  signup, tier hunter (never sold)', 'DENY', create(signup('hunter'))],
  ['new  signup, tier admin', 'DENY', create(signup('admin'))],
  ['new  signup, empty tier', 'DENY', create(signup(''))],
  ['new  signup, tier Pro (wrong case)', 'DENY', create({ ...signup('pro'), selectedTier: 'Pro', subscriptionTier: 'Pro' })],
  ['new  signup, tier "pro " (trailing space)', 'DENY', create({ ...signup('pro'), selectedTier: 'pro ', subscriptionTier: 'pro ' })],
  ['new  signup, tier not a string', 'DENY', create({ ...signup('starter'), selectedTier: 1, subscriptionTier: 1 })],
  ['new  signup, selected pro but tier starter', 'DENY', create({ ...signup('pro'), subscriptionTier: 'starter' })],
  ['new  signup claiming pro credits on starter', 'DENY', create({ ...signup('starter'), credits: 1250, monthlyCredits: 1250 })],
  ['new  signup with 99999 credits', 'DENY', create({ ...signup('starter'), credits: 99999, monthlyCredits: 99999 })],
  ['new  signup already paid', 'DENY', create({ ...signup('starter'), hasCompletedPayment: true })],
  ['new  signup with status active', 'DENY', create({ ...signup('starter'), status: 'active' })],
  ['new  signup tier differs from selected tier', 'DENY', create({ ...signup('starter'), subscriptionTier: 'pro' })],
  ['new  only some signup billing fields', 'DENY', create({ email: 'x@example.test', credits: 400 })],
  ['new  signup plus role admin', 'DENY', create({ ...signup('starter'), role: 'admin' })],
  ['new  signup plus role super_admin', 'DENY', create({ ...signup('starter'), role: 'super_admin' })],
  ['new  role user, nothing else', 'DENY', create({ role: 'user' })],
  ['new  merge-create with role admin', 'DENY', create({ role: 'admin' }, { merge: true })],

  // Role: cannot be added, changed or removed, and no one can elevate themselves.
  ['P  add role admin', 'DENY', () => updateDoc(doc(p, 'users/P'), { role: 'admin' })],
  ['P  add role super_admin', 'DENY', () => updateDoc(doc(p, 'users/P'), { role: 'super_admin' })],
  ['P  merge role admin with a profile field', 'DENY', () => setDoc(doc(p, 'users/P'), { displayName: 'Pat', role: 'admin' }, { merge: true })],
  ['A  change role admin → super_admin', 'DENY', () => updateDoc(doc(a, 'users/A'), { role: 'super_admin' })],
  ['A  remove role', 'DENY', () => updateDoc(doc(a, 'users/A'), { role: deleteField() })],
  ['A  overwrite the document without role', 'DENY', () => setDoc(doc(a, 'users/A'), { email: 'a@example.test' })],
  ['SA change own permissions', 'DENY', () => updateDoc(doc(sa, 'users/SA'), { permissions: ['*'] })],
  ['SA remove own permissions (falls back to all)', 'DENY', () => updateDoc(doc(sa, 'users/SA'), { permissions: deleteField() })],

  // Billing: the simulated-checkout write (CheckoutPage.jsx:93) is a client
  // granting itself a paid plan, so it is refused like any other.
  ['P  simulated checkout write', 'DENY', () => updateDoc(doc(p, 'users/P'), {
      hasCompletedPayment: true, paymentCompletedAt: 'x', subscriptionTier: 'pro', subscriptionStatus: 'active',
      credits: { total: 1250, used: 0, remaining: 1250, resetDate: 'x' },
      tierLimits: { creditsPerMonth: 1250, companiesPerMonth: 50, contactsPerMonth: 250, teamSeats: 1, support: '24-hour email' },
      features: { mobilePhone: true }, billingCycleDate: 1 })],
  ['P  credits via dotted path', 'DENY', () => updateDoc(doc(p, 'users/P'), { 'credits.remaining': 99999 })],
  ['P  features.mobilePhone via dotted path', 'DENY', () => updateDoc(doc(p, 'users/P'), { 'features.mobilePhone': true })],
  ['P  delete own user document', 'DENY', () => deleteDoc(doc(p, 'users/P'))],
  ['OTHER updates P', 'DENY', () => updateDoc(doc(other, 'users/P'), { displayName: 'x' })],
  ['OTHER reads P', 'DENY', () => getDoc(doc(other, 'users/P'))],

  // Every server-controlled field, one at a time: add or change, and create with it.
  ...Object.entries(SERVER_CONTROLLED).map(([field, value]) =>
    [`P  set ${field}`, 'DENY', () => updateDoc(doc(p, 'users/P'), { [field]: value })]),
  ...Object.entries(SERVER_CONTROLLED).map(([field, value]) =>
    [`new  create with ${field}`, 'DENY', create({ email: 'x@example.test', [field]: value })]),
  // ...and remove each one P holds.
  ...['selectedTier', 'subscriptionTier', 'status', 'hasCompletedPayment', 'credits', 'monthlyCredits'].map(field =>
    [`P  remove ${field}`, 'DENY', () => updateDoc(doc(p, 'users/P'), { [field]: deleteField() })]),

  // Server writes go through the Admin SDK, which these rules do not apply to.
  ['admin sdk  stripe-webhook checkout write', 'ALLOW', asAdminSdk(db => updateDoc(doc(db, 'users/P'), {
      hasCompletedPayment: true, subscriptionTier: 'pro', subscriptionStatus: 'active', stripeCustomerId: 'cus_P',
      credits: { total: 1250, used: 0, remaining: 1250, resetDate: 'x' }, tierLimits: { teamSeats: 1 }, features: { mobilePhone: true } }))],
  ['admin sdk  suspend account', 'ALLOW', asAdminSdk(db => setDoc(doc(db, 'users/P'), { accountStatus: 'suspended', suspendedBy: 'A' }, { merge: true }))],
  ['admin sdk  grant role', 'ALLOW', asAdminSdk(db => updateDoc(doc(db, 'users/P'), { role: 'admin' }))],
];
CASES.push(...USER_DOC_CASES.map(([name, expect, run], i) => [`${String(24 + i).padStart(2, '0')}  ${name}`, expect, run]));

// ── Relationship Capture: server-only collections ──────────────────────────
// capture_operations (per user), capture_reports and capture_enrollment are
// read and written only by the capture endpoints through the Admin SDK. No
// client, the owner included, may read or write them; a user who could write
// capture_enrollment could enroll themselves into the beta.
const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `users/${U}/capture_operations/${OP}`), { operationId: OP, state: 'previewed', previewVersion: 1 });
  await setDoc(doc(db, 'capture_reports/rpt_1'), { operationId: OP, userId: U, status: 'new' });
  await setDoc(doc(db, `capture_enrollment/${U}`), { stage: 'beta' });
});

const CAPTURE_CASES = [
  ['capture_operations  owner reads one', 'DENY', () => getDoc(doc(me, `users/${U}/capture_operations/${OP}`))],
  ['capture_operations  owner lists them', 'DENY', () => getDocs(collection(me, `users/${U}/capture_operations`))],
  ['capture_operations  owner creates one', 'DENY', () => setDoc(doc(me, `users/${U}/capture_operations/cap_new`), { state: 'created' })],
  ['capture_operations  owner marks one committed', 'DENY', () => updateDoc(doc(me, `users/${U}/capture_operations/${OP}`), { state: 'committed' })],
  ['capture_operations  owner deletes one', 'DENY', () => deleteDoc(doc(me, `users/${U}/capture_operations/${OP}`))],
  ['capture_operations  owner writes beneath one', 'DENY', () => setDoc(doc(me, `users/${U}/capture_operations/${OP}/notes/n1`), { note: 'x' })],
  ['capture_operations  owner reads beneath one', 'DENY', () => getDoc(doc(me, `users/${U}/capture_operations/${OP}/notes/n1`))],
  ['capture_operations  OTHER reads one', 'DENY', () => getDoc(doc(other, `users/${U}/capture_operations/${OP}`))],
  ['capture_reports     reads one', 'DENY', () => getDoc(doc(me, 'capture_reports/rpt_1'))],
  ['capture_reports     creates one', 'DENY', () => setDoc(doc(me, 'capture_reports/rpt_2'), { userId: U, status: 'new' })],
  ['capture_reports     updates one', 'DENY', () => updateDoc(doc(me, 'capture_reports/rpt_1'), { status: 'resolved' })],
  ['capture_enrollment  reads own', 'DENY', () => getDoc(doc(me, `capture_enrollment/${U}`))],
  ['capture_enrollment  enrolls itself', 'DENY', () => setDoc(doc(p, 'capture_enrollment/P'), { stage: 'beta' })],
  ['capture_enrollment  changes own stage', 'DENY', () => updateDoc(doc(me, `capture_enrollment/${U}`), { stage: 'on' })],
  ['capture_enrollment  removes own entry', 'DENY', () => deleteDoc(doc(me, `capture_enrollment/${U}`))],
  ['capture_enrollment  OTHER reads U', 'DENY', () => getDoc(doc(other, `capture_enrollment/${U}`))],
  // Ordinary data next to them is untouched.
  ['capture neighbours  update companies/c1 still allowed', 'ALLOW', () => updateDoc(doc(me, `users/${U}/companies/c1`), { status: 'saved' })],
  ['capture neighbours  read contacts/k1 still allowed', 'ALLOW', () => getDoc(doc(me, `users/${U}/contacts/k1`))],
  // The capture endpoints write through the Admin SDK, which rules do not apply to.
  ['admin sdk  creates an operation', 'ALLOW', asAdminSdk(db => setDoc(doc(db, `users/${U}/capture_operations/cap_admin`), { state: 'created' }))],
  ['admin sdk  enrolls a user', 'ALLOW', asAdminSdk(db => setDoc(doc(db, 'capture_enrollment/P'), { stage: 'beta' }))],
  ['admin sdk  writes a report', 'ALLOW', asAdminSdk(db => setDoc(doc(db, 'capture_reports/rpt_3'), { status: 'new' }))],
];
const firstCaptureCase = CASES.length + 1;
CASES.push(...CAPTURE_CASES.map(([name, expect, run], i) => [`${firstCaptureCase + i}  ${name}`, expect, run]));

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
