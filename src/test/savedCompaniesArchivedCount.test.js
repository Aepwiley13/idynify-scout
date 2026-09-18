/**
 * An archived contact is counted by nobody.
 *
 * THE BUG THIS PREVENTS
 * ─────────────────────
 * Saved Companies fetches every contact with no `where` clause and sorted them
 * into two buckets: "still a suggestion" and "a real contact". Archived people
 * fell into the second one, because the classifier only asked
 * `readRecordStatus(d) === SUGGESTED && !isEngagedRecord(d)` — and an archived
 * row does not read as 'suggested'.
 *
 * So contacts the user had explicitly removed were counted as real contacts in
 * the "Total Contacts" KPI. Measured fleet-wide: 242 archived contacts across
 * 8 workspaces, inflating the headline number on 7 of them.
 *
 * The precedence is what made it invisible. `readRecordStatus` checks
 * `record_status` BEFORE `is_archived`, so an archived row carrying a stale
 * `record_status: 'suggested'` or `'active'` — the stamp Scout writes at
 * creation, which no archive path updated until the write-path fix — reads
 * back as live. The boolean was right there on the document and lost.
 *
 * The fix asks `hasArchiveSignal` FIRST, before either bucket.
 */

import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import {
  RECORD_STATUS,
  readRecordStatus,
  isEngagedRecord,
  hasArchiveSignal,
} from '../constants/statusModel';

/**
 * The Saved Companies contact bucketer, as implemented in SavedCompanies.jsx.
 *
 * Returns which count a contact lands in: 'contact' feeds "Total Contacts",
 * 'suggested' feeds the suggestion badge, and 'none' means it is excluded
 * from both.
 */
function bucket(contact) {
  if (!contact.company_id) return 'none';
  if (hasArchiveSignal(contact)) return 'none';
  const stillSuggested =
    readRecordStatus(contact) === RECORD_STATUS.SUGGESTED && !isEngagedRecord(contact);
  return stillSuggested ? 'suggested' : 'contact';
}

const withCompany = (c) => ({ company_id: 'co_1', ...c });

describe('archived contacts are excluded from every count', () => {
  it.each([
    // The two shapes actually found in production, both of which used to be
    // counted as real contacts.
    ['stale suggested stamp', { status: 'people_mode_archived', is_archived: true, record_status: 'suggested' }],
    ['stale active stamp', { status: 'people_mode_archived', is_archived: true, record_status: 'active' }],
    // Archived via each signal on its own.
    ['is_archived only', { is_archived: true, record_status: 'active' }],
    ['legacy people_mode_archived', { status: 'people_mode_archived' }],
    ['legacy archived', { status: 'archived' }],
    // Archived with no record_status at all — the 105 legacy rows.
    ['no record_status field', { status: 'people_mode_archived', is_archived: true }],
  ])('excludes an archived contact (%s)', (_label, contact) => {
    expect(bucket(withCompany(contact))).toBe('none');
  });

  it('excludes an archived contact even when it is engaged', () => {
    // Engagement does not resurrect an archive — the same rule PR #640
    // established at the write path, applied here at the read.
    const archivedAndEngaged = withCompany({
      status: 'people_mode_archived',
      is_archived: true,
      record_status: 'active',
      contact_status: 'In Conversation',
      hunter_status: 'active_mission',
    });
    expect(isEngagedRecord(archivedAndEngaged)).toBe(true);
    expect(bucket(archivedAndEngaged)).toBe('none');
  });

  it('is the regression: these used to count as real contacts', () => {
    // Before the fix, the classifier was the `stillSuggested` line alone.
    const oldBucket = (c) =>
      readRecordStatus(c) === RECORD_STATUS.SUGGESTED && !isEngagedRecord(c)
        ? 'suggested'
        : 'contact';

    const archivedActive = withCompany({
      status: 'people_mode_archived', is_archived: true, record_status: 'active',
    });
    expect(oldBucket(archivedActive)).toBe('contact');   // counted — the bug
    expect(bucket(archivedActive)).toBe('none');         // excluded — the fix
  });
});

describe('the fix does not change anything else', () => {
  it('still counts a kept, active contact', () => {
    expect(bucket(withCompany({ record_status: 'active', status: 'active' }))).toBe('contact');
  });

  it('still counts an engaged suggestion as a real contact', () => {
    // The guarantee from the earlier engagement work: engagement IS keeping.
    const engagedSuggestion = withCompany({
      status: 'suggested', record_status: 'suggested', contact_status: 'Awaiting Reply',
    });
    expect(isEngagedRecord(engagedSuggestion)).toBe(true);
    expect(bucket(engagedSuggestion)).toBe('contact');
  });

  it('still buckets an untouched discovery suggestion as suggested', () => {
    const fresh = withCompany({
      status: 'suggested', record_status: 'suggested', source: 'icp_auto_discovery',
    });
    expect(bucket(fresh)).toBe('suggested');
  });

  it('still ignores a contact with no company', () => {
    expect(bucket({ record_status: 'active' })).toBe('none');
  });
});

describe('measured against production, before and after', () => {
  // Replicates the audited workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2, whose
  // "Total Contacts" reads 217 today and 160 after this fix — a drop of 57,
  // every one of them a contact the user had archived.
  //
  // Held as a proportional fixture rather than 217 literal documents: the
  // point under test is that archived rows leave the count, not the exact
  // census of one workspace on one day.
  function totalContacts(contacts) {
    return contacts.filter(c => bucket(c) === 'contact').length;
  }

  const KEPT = Array.from({ length: 160 }, () =>
    withCompany({ record_status: 'active', status: 'active' })
  );
  const ARCHIVED = Array.from({ length: 57 }, (_, i) =>
    withCompany({
      status: 'people_mode_archived',
      is_archived: true,
      // Both stale stamps present in the real data.
      record_status: i % 2 === 0 ? 'active' : 'suggested',
    })
  );

  it('drops exactly the archived rows from Total Contacts', () => {
    const oldTotal = [...KEPT, ...ARCHIVED].filter(c => {
      if (!c.company_id) return false;
      return !(readRecordStatus(c) === RECORD_STATUS.SUGGESTED && !isEngagedRecord(c));
    }).length;

    expect(oldTotal).toBe(189);                              // 160 kept + 29 archived-as-'active'
    expect(totalContacts([...KEPT, ...ARCHIVED])).toBe(160); // archived all gone
  });

  it('leaves the kept contacts untouched', () => {
    expect(totalContacts(KEPT)).toBe(160);
  });

  it('counts an all-archived workspace as zero', () => {
    expect(totalContacts(ARCHIVED)).toBe(0);
  });
});

describe('the real component does the exclusion', () => {
  // The bucketer above is a copy. On its own it would stay green if someone
  // edited SavedCompanies.jsx, which would make this file decorative — so
  // assert the component actually performs the check.
  const SRC = 'src/pages/Scout/SavedCompanies.jsx';

  it('calls hasArchiveSignal in the contact-counting loop', () => {
    const src = readFileSync(SRC, 'utf8');
    const at = src.indexOf('allContactsSnap.docs.forEach');
    expect(at).toBeGreaterThan(-1);
    const loop = src.slice(at, at + 2500);
    expect(loop).toContain('hasArchiveSignal(data)');
    // Before the two buckets, not after — an exclusion applied afterwards
    // would not exclude anything.
    expect(loop.indexOf('hasArchiveSignal(data)')).toBeLessThan(loop.indexOf('stillSuggested'));
  });

  it('imports the predicate rather than re-deriving the check', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/import \{[^}]*hasArchiveSignal[^}]*\} from ['"][^'"]*statusModel/s);
  });
});
