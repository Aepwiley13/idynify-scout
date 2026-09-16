/**
 * Stage 1 — the reconciler runner.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  READ-ONLY. REPORTS, NEVER REPAIRS.                                      ║
 * ║  A repair path is a write path that can rewrite history, which is the    ║
 * ║  thing this programme exists to remove.                                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * All classification lives in src/utils/icpReconcile.js. This file is I/O: it
 * walks production, hands documents to the engine, and prints what comes back.
 * If you find yourself adding a rule here, it belongs there.
 *
 * ─── IT REPORTS WRITES SEEN, NOT ONLY DIVERGENCES FOUND ────────────────────
 * Sprint 1A shipped the classifier with no runner, so "run it for a week" had
 * never actually happened. When it was finally measured, production held ZERO
 * shadow documents — meaning a divergence-only report would have said "0
 * divergences", looked clean, and proven nothing at all.
 *
 * So volume and composition are first-class output, and the verdict is computed
 * by stageOneGate() rather than narrated here, so it cannot be reported more
 * generously than the numbers support.
 *
 * USAGE
 *   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json \
 *     node scripts/reconcile/run.mjs --cutover=2026-09-16T00:00:00Z [--json] [--user=<uid>]
 *
 * --cutover is REQUIRED, and it is the DEPLOY time — the moment the shadow-write
 * code began running in production — NOT the merge time and not midnight.
 *
 * The first real run proved how sensitive the gate is to getting that wrong. A
 * cutover of 2026-09-16T00:00Z produced one "divergence": a rejection swiped at
 * 04:32 UTC, which turned out to predate the shadow-write merge at 06:25 UTC by
 * two hours. Nothing was broken. The timestamp manufactured the failure.
 *
 * So the runner warns when the cutover is earlier than the earliest shadow write
 * it can see, because every legacy write in that gap is guaranteed to look like
 * a divergence and none of them are.
 */

import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';
import {
  RECONCILE, classifyCompany, summarize, summarizeActivity, stageOneGate,
} from '../../src/utils/icpReconcile.js';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=') || true]; }),
);

if (!args.cutover) {
  console.error('\n  --cutover=<ISO timestamp> is required.');
  console.error('  Without it every company written before shadow writes began reads as a');
  console.error('  divergence, and the report is worthless.\n');
  process.exit(2);
}

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!keyPath) {
  console.error('\n  FIREBASE_SERVICE_ACCOUNT_PATH is required (read-only key).\n');
  process.exit(2);
}

const sa = JSON.parse(readFileSync(keyPath, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
const db = admin.firestore();

const cutoverAt = Date.parse(args.cutover);
if (Number.isNaN(cutoverAt)) {
  console.error(`\n  --cutover is not a parseable timestamp: ${args.cutover}\n`);
  process.exit(2);
}

// ── walk ────────────────────────────────────────────────────────────────────

const users = args.user
  ? [await db.collection('users').doc(String(args.user)).get()]
  : (await db.collection('users').get()).docs;

const allEvents = [];
const results = [];
const perUser = [];
let relationships = 0, versions = 0, exclusions = 0, companies = 0, profiles = 0, pointers = 0;
const byState = {}, bySubjectType = {};

for (const u of users) {
  if (!u.exists) continue;

  const [comps, rels, evts, excl, icps] = await Promise.all([
    u.ref.collection('companies').get().catch(() => null),
    u.ref.collection('icpRelationships').get().catch(() => null),
    u.ref.collection('lineageEvents').get().catch(() => null),
    u.ref.collection('exclusions').get().catch(() => null),
    u.ref.collection('icpProfiles').get().catch(() => null),
  ]);
  if (!comps) continue;

  companies += comps.size;
  relationships += rels?.size ?? 0;
  exclusions += excl?.size ?? 0;

  for (const d of rels?.docs ?? []) {
    const f = d.data();
    byState[f.state ?? '?'] = (byState[f.state ?? '?'] ?? 0) + 1;
    bySubjectType[f.subjectType ?? '?'] = (bySubjectType[f.subjectType ?? '?'] ?? 0) + 1;
  }
  for (const d of evts?.docs ?? []) allEvents.push(d.data());

  for (const p of icps?.docs ?? []) {
    profiles++;
    if (p.data().currentCriteriaVersionId) pointers++;
    const v = await p.ref.collection('criteriaVersions').get().catch(() => null);
    versions += v?.size ?? 0;
  }

  // Relationships for one company, indexed so classification is O(1) per doc.
  const relsBySubject = new Map();
  for (const d of rels?.docs ?? []) {
    const f = d.data();
    if ((f.subjectType ?? 'company') !== 'company') continue;
    const list = relsBySubject.get(f.subjectId) ?? [];
    list.push(f);
    relsBySubject.set(f.subjectId, list);
  }

  let userDivergences = 0;
  for (const c of comps.docs) {
    const r = classifyCompany({
      company: c.data(),
      relationships: relsBySubject.get(c.id) ?? [],
      cutoverAt,
    });
    results.push({ ...r, uid: u.id, companyId: c.id });
    if (r.status === RECONCILE.DIVERGENCE) userDivergences++;
  }

  perUser.push({ uid: u.id.slice(0, 8), companies: comps.size, relationships: rels?.size ?? 0,
    events: evts?.size ?? 0, divergences: userDivergences });
}

// ── report ──────────────────────────────────────────────────────────────────

const activity = summarizeActivity(allEvents);
const reconciliation = summarize(results);
const gate = stageOneGate({ activity, reconciliation });

// A cutover earlier than the first shadow write cannot be right: every legacy
// write in the gap predates the code and will read as a divergence. Surfaced
// rather than silently corrected — the operator owns the timestamp.
const cutoverWarning = (activity.earliest && Date.parse(activity.earliest) < cutoverAt)
  ? null
  : (activity.earliest
      ? `--cutover (${args.cutover}) is EARLIER than the first shadow write `
        + `(${activity.earliest}). Legacy writes in that gap will read as divergences `
        + `and are not. Set --cutover to the deploy time.`
      : null);

if (args.json) {
  console.log(JSON.stringify({ cutover: args.cutover, cutoverWarning, activity, reconciliation, gate, perUser }, null, 2));
  process.exit(gate.pass ? 0 : 1);
}

const n = (v) => String(v).padStart(6);

console.log(`\n  RECONCILER — project ${sa.project_id}`);
console.log(`  cutover ${args.cutover}   workspaces ${perUser.length}   companies ${companies}\n`);

console.log('  ── WRITES SEEN ──────────────────────────────────────────────');
console.log(`  ${n(relationships)}  icpRelationships     ${JSON.stringify(bySubjectType)}`);
console.log(`  ${n(activity.events)}  lineageEvents`);
console.log(`  ${n(versions)}  criteriaVersions     (${pointers}/${profiles} profiles carry a pointer)`);
console.log(`  ${n(exclusions)}  exclusions`);
if (Object.keys(byState).length) console.log(`          relationship states  ${JSON.stringify(byState)}`);

console.log('\n  ── TRAFFIC COMPOSITION ──────────────────────────────────────');
console.log(`  ${n(activity.eventTypes)}  event types          ${JSON.stringify(activity.byType)}`);
console.log(`  ${n(activity.daysWithActivity)}  days with activity   ${activity.days.join(', ') || '—'}`);
console.log(`          window               ${activity.earliest ?? '—'} → ${activity.latest ?? '—'}`);
console.log(`          varied enough?       ${activity.varied ? 'yes' : 'NO'}`);

console.log('\n  ── RECONCILIATION ───────────────────────────────────────────');
console.log(`  ${n(reconciliation.counts[RECONCILE.AGREED])}  agreed`);
console.log(`  ${n(reconciliation.counts[RECONCILE.EXPECTED_GAP])}  expected-gap    (pre-cutover corpus — by design, not a fault)`);
console.log(`  ${n(reconciliation.counts[RECONCILE.UNDO_GAP])}  undo-gap        (undo unmodelled — reported, does not block)`);
console.log(`  ${n(reconciliation.counts[RECONCILE.DIVERGENCE])}  DIVERGENCE      (the only count that should be zero)`);

if (reconciliation.divergences.length) {
  console.log('\n  ── DIVERGENCES ──────────────────────────────────────────────');
  for (const d of reconciliation.divergences.slice(0, 40)) {
    console.log(`    ${d.uid.slice(0, 8)}…/${String(d.companyId).slice(0, 26)}  icp=${d.icpId ?? '-'}  ${d.reason}`);
  }
  if (reconciliation.divergences.length > 40) {
    console.log(`    … and ${reconciliation.divergences.length - 40} more`);
  }
}

if (reconciliation.undoGaps?.length) {
  console.log(`\n  undo gaps: ${reconciliation.undoGaps.length} (expected until undo has a vocabulary)`);
}

if (cutoverWarning) {
  console.log('\n  ⚠  CUTOVER TIMESTAMP');
  console.log(`     ${cutoverWarning}`);
}

console.log(`\n  ── STAGE 1 GATE ─────────────────────────────────────────────`);
console.log(`  ${gate.pass ? '✓ PASS' : '✗ NOT MET'}`);
for (const r of gate.reasons) console.log(`    · ${r}`);
console.log('');

process.exit(gate.pass ? 0 : 1);
