/**
 * C-1 / C-2 — rediscovery must never drop a field.
 *
 * Runs against a REAL Firestore emulator, because this is precisely the class
 * of thing a mock cannot tell you: the behaviour under test IS Firestore's
 * PATCH semantics. Mocking it would only assert that I believe what I already
 * believed.
 *
 * The bug: a REST PATCH with no updateMask REPLACES the document. Every field
 * absent from the request is deleted. Across production that was 182 companies
 * and 520 pending field deletions — including `apollo_id`, one of the two field
 * names identity resolution checks, so the overwrite could create the next
 * duplicate rather than merely losing provenance.
 */

const BASE = 'http://127.0.0.1:8080/v1/projects/demo-icp-rules/databases/(default)/documents';
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };
const S = (v) => ({ stringValue: String(v) });
const I = (v) => ({ integerValue: String(v) });

/** Exactly the payload saveCompaniesToFirestore builds. */
const discoveryFields = (status, icpId) => ({
  apollo_organization_id: S('54a116d1'),
  name: S('Acme'),
  industry: S('Hospital & Health Care'),
  revenue: S('1.8B'),
  founded_year: I(1979),
  phone: S('555'),
  linkedin_url: S('https://li/acme'),
  website_url: S('https://acme.com'),
  logo_url: S('https://logo'),
  status: S(status),
  found_at: S('2026-09-16T00:00:00.000Z'),
  source: S('apollo_api'),
  barry_intel: S('intel'),
  icpId: S(icpId),
  icpCriteriaFingerprint: S('fp_new'),
});

/** A company with a full lifecycle behind it — the thing at risk. */
const lived = (status) => ({
  ...discoveryFields(status, 'icp_A'),
  // none of these are written by discovery, so an unmasked PATCH deletes them
  apollo_id: S('54a116d1'),
  swipedForICPId: S('icp_A'),
  swipedAt: S('2026-07-10'),
  swipeDirection: S('right'),
  swipe_gesture: S('keyboard'),
  barryFeedback: S('good fit'),
  feedbackAt: S('2026-07-10'),
  selected_titles: S('[10 items]'),
  titles_source: S('icp_auto'),
  contact_count: I(7),
  activity_log: S('[3 entries]'),
  fit_score: I(22),
  apolloEnrichment: S('{...}'),
  replacedAt: S('2026-08-01'),
  archived_at: S('2026-08-02'),
  deferredAt: S('2026-08-03'),
  saved_at: S('2026-07-01'),
});

const put = (path, fields) =>
  fetch(`${BASE}/${path}`, { method: 'PATCH', headers: H, body: JSON.stringify({ fields }) });

const read = async (path) => {
  const res = await fetch(`${BASE}/${path}`, { headers: H });
  return res.ok ? (await res.json()).fields ?? {} : null;
};

/** The write as search-companies now issues it: mask derived from the payload. */
const rediscover = (path, fields) => {
  const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  return fetch(`${BASE}/${path}?${mask}`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ fields }),
  });
};

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// ── C-1: every status a rediscovery can reach ───────────────────────────────
console.log('\n  C-1  rediscovery preserves every field, on every status transition');

for (const status of ['replaced', 'archived', 'deferred', 'pending']) {
  const path = `users/U/companies/c_${status}`;
  const before = lived(status);
  await put(path, before);
  const keysBefore = Object.keys(await read(path));

  await rediscover(path, discoveryFields('pending', 'icp_B'));
  const after = await read(path);
  const keysAfter = Object.keys(after);
  const lost = keysBefore.filter(k => !keysAfter.includes(k));

  check(`from "${status}": no field lost`, lost.length === 0,
    lost.length ? `LOST ${lost.join(', ')}` : `${keysAfter.length} fields intact`);

  // The queue state still moves exactly as before — this is a bug fix, not a
  // redesign of what a rediscovering ICP may claim.
  check(`from "${status}": queue state still moves`,
    after.status?.stringValue === 'pending' && after.icpId?.stringValue === 'icp_B');

  // And the decision history is what survives.
  check(`from "${status}": decision history survives`,
    after.swipedAt?.stringValue === '2026-07-10'
    && after.swipedForICPId?.stringValue === 'icp_A'
    && after.barryFeedback?.stringValue === 'good fit');

  // The alias identity resolution depends on.
  check(`from "${status}": apollo_id alias survives`,
    after.apollo_id?.stringValue === '54a116d1');
}

// ── C-2: a brand-new company needs no separate path ─────────────────────────
console.log('\n  C-2  the masked write is correct for a company that does not exist yet');

const fresh = 'users/U/companies/c_brand_new';
await rediscover(fresh, discoveryFields('pending', 'icp_A'));
const created = await read(fresh);
check('creates the document', created !== null);
check('creates exactly the masked fields, no more',
  created && Object.keys(created).length === Object.keys(discoveryFields('pending', 'icp_A')).length,
  created ? `${Object.keys(created).length} fields` : '');
check('no branch on existence is needed', created?.status?.stringValue === 'pending');

// ── the regression this replaces, kept as the contrast ──────────────────────
console.log('\n  control  an UNMASKED write still destroys fields (the old behaviour)');

const ctl = 'users/U/companies/c_control';
await put(ctl, lived('replaced'));
const ctlBefore = Object.keys(await read(ctl));
await put(ctl, discoveryFields('pending', 'icp_B'));      // no mask — the bug
const ctlAfter = Object.keys(await read(ctl));
check('unmasked PATCH deletes fields, confirming the test can detect the bug',
  ctlAfter.length < ctlBefore.length,
  `${ctlBefore.length} → ${ctlAfter.length} fields`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
