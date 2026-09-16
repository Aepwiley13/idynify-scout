/**
 * C-3 — no unmasked company PATCH may come back.
 *
 * A REST PATCH with no `updateMask` REPLACES the document: every field absent
 * from the request is deleted. Measured against a real Firestore, a company
 * carrying 32 fields came back with 15.
 *
 * Rediscovery reached that write for any company outside
 * DEDUP_BLOCKING_STATUSES — `replaced`, `archived`, `deferred` — which across
 * production was 182 companies and 520 pending field deletions. Among them
 * `apollo_id` on 11 records: one of the TWO field names findCompanyByApolloId
 * checks, so the overwrite would not merely lose provenance, it would make the
 * record harder to match and could create the next duplicate.
 *
 * The behavioural proof lives in scripts/rules-check/write-semantics.mjs, which
 * runs against a real emulator because the thing under test IS Firestore's PATCH
 * semantics — a mock could only assert that I believe what I already believed.
 * THIS file guards the shape of the call, so a new write site cannot quietly
 * reintroduce the bug between emulator runs.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(here, '../../netlify/functions/search-companies.js'), 'utf8');
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every `fetch(... { method: 'PATCH' ...})` with the URL expression that feeds it. */
function patchCalls(s) {
  const calls = [];
  for (const m of s.matchAll(/fetch\(\s*([A-Za-z_$][\w$]*)\s*,\s*\{[\s\S]{0,120}?method:\s*'PATCH'/g)) {
    calls.push({ urlVar: m[1], at: m.index });
  }
  return calls;
}

/** The expression a url variable was assigned from. */
function assignmentOf(s, name) {
  const m = s.match(new RegExp(`const ${name}\\s*=\\s*\`([^\`]*)\``));
  return m?.[1] ?? null;
}

describe('C-3 — every company PATCH carries an updateMask', () => {
  it('the discovery write masks exactly the fields it sends', () => {
    // Derived from the payload rather than hardcoded, so the mask cannot drift
    // from what is written: add a field to companyData and the mask follows.
    expect(src).toMatch(/const maskedFields = Object\.keys\(companyData\.fields\)/);
    expect(src).toMatch(/updateMask\.fieldPaths=\$\{f\}/);
    expect(src).toMatch(/companies\/\$\{companyId\}\?\$\{updateMask\}/);
  });

  it('no PATCH anywhere in the file writes to an unmasked url', () => {
    const offenders = [];
    for (const call of patchCalls(src)) {
      const url = assignmentOf(src, call.urlVar);
      if (url === null) continue;                 // not a template literal we can read
      if (!/updateMask/.test(url)) offenders.push(`${call.urlVar} = \`${url}\``);
    }
    expect(offenders, 'an unmasked PATCH would delete every field it does not send').toEqual([]);
  });

  it('the batched retirement write still uses a field-scoped mask', () => {
    // reconcilePendingQueue got this right long before the discovery write did.
    expect(src).toMatch(/updateMask:\s*\{\s*fieldPaths:\s*\['status',\s*'replacedAt'\]\s*\}/);
  });

  it('the mask is built from the payload, never a second hardcoded list', () => {
    // A hardcoded list is how the mask and the payload drift apart, and the
    // drift is silent: fields written but unmasked are simply never saved.
    const hardcoded = src.match(/updateMask\.fieldPaths=(?!\$\{)[a-z_]+/gi) ?? [];
    const outsideUserDoc = hardcoded.filter(h => !/barryState|companiesFoundCount|currentCriteria/.test(h));
    expect(outsideUserDoc, `hardcoded company mask fields: ${outsideUserDoc.join(', ')}`).toEqual([]);
  });
});

describe('C-3 — queue behaviour is unchanged by the fix', () => {
  it('status and icpId remain in what discovery writes', () => {
    // Deliberate: this is a bug fix, not the place to redesign what a
    // rediscovering ICP is allowed to claim. Per-ICP truth moves to the shadow
    // relationship at the Sprint 3 cutover.
    const payload = src.slice(src.indexOf('const companyData = {'), src.indexOf('const maskedFields'));
    for (const field of ['status', 'icpId', 'icpCriteriaFingerprint']) {
      expect(payload, `${field} left the discovery payload`).toContain(`${field}:`);
    }
  });

  it('nothing outside the payload was added to the mask', () => {
    const payload = src.slice(src.indexOf('const companyData = {'), src.indexOf('const maskedFields'));
    for (const field of ['swipedAt', 'swipedForICPId', 'barryFeedback', 'apollo_id', 'selected_titles']) {
      expect(payload, `${field} must NOT be written by discovery`).not.toContain(`${field}:`);
    }
  });
});
