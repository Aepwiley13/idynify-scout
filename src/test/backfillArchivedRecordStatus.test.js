/**
 * The backfill decides which archived rows get rewritten. It is unit-tested
 * rather than trusted to a dry run, because a dry run only shows what the rule
 * DID match — never what it should have matched and didn't.
 *
 * The rules are imported from the script itself, so these cannot drift from
 * what a live run would actually do.
 */

import { describe, it, expect } from 'vitest';
import {
  needsArchivedStamp,
  archivedWithoutBooleanFlag,
  stuckAfterRestore,
  archivedWithNoRecordStatus,
} from '../../scripts/backfillArchivedRecordStatus.mjs';
import { RECORD_STATUS, readRecordStatus } from '../constants/statusModel';

/**
 * The 7 rows in peqhaq8Cw1UUPeaYhaSLwZ0iCRk2 this migration exists for:
 * archived, but stamped 'suggested' at creation and never updated.
 */
const AUDITED_STALE = Object.freeze({
  status: 'people_mode_archived',
  is_archived: true,
  record_status: 'suggested',
});

describe('rows the backfill repairs', () => {
  it('repairs the audited shape', () => {
    expect(needsArchivedStamp(AUDITED_STALE)).toBe(true);
    // And this is why it matters: the row currently lies to every reader.
    expect(readRecordStatus(AUDITED_STALE)).toBe(RECORD_STATUS.SUGGESTED);
  });

  it.each([
    ['is_archived boolean', { is_archived: true, record_status: 'suggested' }],
    ['legacy people_mode_archived', { status: 'people_mode_archived', record_status: 'active' }],
    ['legacy archived', { status: 'archived', record_status: 'suggested' }],
  ])('repairs a row archived via %s', (_label, row) => {
    expect(needsArchivedStamp(row)).toBe(true);
  });

  it.each(['suggested', 'active', 'rejected'])(
    'repairs whatever wrong value record_status holds (%s)',
    (record_status) => {
      expect(needsArchivedStamp({ is_archived: true, record_status })).toBe(true);
    }
  );
});

describe('rows the backfill leaves alone', () => {
  it('skips a row that is already correct', () => {
    expect(needsArchivedStamp({ is_archived: true, record_status: 'archived' })).toBe(false);
  });

  it('skips a row with no archive signal at all', () => {
    // The critical negative: a live, engaged contact must never be archived
    // by this migration.
    const live = { status: 'active', record_status: 'active', contact_status: 'In Conversation' };
    expect(needsArchivedStamp(live)).toBe(false);
  });

  it('skips an archived row that has no record_status field', () => {
    // Nothing to repair: the fallback chain already reads this as archived,
    // so a write would be churn rather than a fix.
    const noField = { status: 'people_mode_archived', is_archived: true };
    expect(needsArchivedStamp(noField)).toBe(false);
    expect(archivedWithNoRecordStatus(noField)).toBe(true);
    expect(readRecordStatus(noField)).toBe(RECORD_STATUS.ARCHIVED);
  });

  it.each([undefined, null])('treats record_status %s as nothing to repair', (record_status) => {
    expect(needsArchivedStamp({ is_archived: true, record_status })).toBe(false);
  });

  it('survives an empty document', () => {
    expect(needsArchivedStamp({})).toBe(false);
    expect(needsArchivedStamp()).toBe(false);
    expect(archivedWithNoRecordStatus({})).toBe(false);
  });
});

describe('the backfill only ever moves a row toward archived', () => {
  // The invariant that makes this safe to run unattended: no input can cause
  // a write that un-archives someone. A migration that could undo a user's
  // archive is one no dry run makes safe.
  const EVERY_SHAPE = [
    {},
    { is_archived: true },
    { is_archived: false },
    { is_archived: true, record_status: 'suggested' },
    { is_archived: false, record_status: 'archived' },
    { status: 'people_mode_archived', record_status: 'active' },
    { status: 'pending_enrichment', record_status: 'suggested' },
    { status: 'active', record_status: 'active' },
    { record_status: 'archived' },
    { record_status: 'rejected', is_archived: true },
  ];

  it.each(EVERY_SHAPE)('never repairs a row lacking an archive signal: %j', (row) => {
    // If it matches, it had an archive signal — so the write can only confirm
    // an archive, never create one out of nothing.
    if (needsArchivedStamp(row)) {
      expect(row.is_archived === true || ['archived', 'people_mode_archived'].includes(row.status)).toBe(true);
    }
  });

  it('never repairs and reports the same row', () => {
    // The two classes must be disjoint, or a row could be both written and
    // flagged for a human — contradictory instructions about the same record.
    for (const row of EVERY_SHAPE) {
      expect(needsArchivedStamp(row) && archivedWithoutBooleanFlag(row)).toBe(false);
      expect(needsArchivedStamp(row) && stuckAfterRestore(row)).toBe(false);
    }
  });
});

describe('the two reported-only classes are told apart', () => {
  // Measured fleet-wide: 134 rows read as archived without `is_archived: true`,
  // and ALL of them have the boolean ABSENT, none set to false, none with
  // restored_at. They are legacy rows from before any path wrote the flag —
  // not contacts stuck after a restore, which is what an earlier version of
  // this script called them. They read correctly and belong to
  // backfillContactIsArchived.mjs.
  const LEGACY_NO_FLAG = Object.freeze({
    status: 'people_mode_archived',
    // is_archived absent entirely
  });

  // The shape that WOULD be a stuck restore. Zero found fleet-wide; kept so
  // that if one ever appears it is not lost among the 134 benign rows.
  const STUCK_RESTORED = Object.freeze({
    status: 'people_mode_archived',
    is_archived: false,
    restored_at: '2026-09-01T00:00:00.000Z',
  });

  it('a legacy row with no flag reads as archived and is benign', () => {
    expect(archivedWithoutBooleanFlag(LEGACY_NO_FLAG)).toBe(true);
    expect(readRecordStatus(LEGACY_NO_FLAG)).toBe(RECORD_STATUS.ARCHIVED);
    // Correct, not contradictory — so not this migration's problem.
    expect(needsArchivedStamp(LEGACY_NO_FLAG)).toBe(false);
  });

  it('a legacy row is NOT reported as stuck after a restore', () => {
    // The distinction the first version of this script got wrong.
    expect(stuckAfterRestore(LEGACY_NO_FLAG)).toBe(false);
  });

  it('an explicit is_archived:false that still reads archived IS flagged', () => {
    expect(stuckAfterRestore(STUCK_RESTORED)).toBe(true);
    expect(readRecordStatus(STUCK_RESTORED)).toBe(RECORD_STATUS.ARCHIVED);
  });

  it('neither class is ever repaired', () => {
    expect(needsArchivedStamp(LEGACY_NO_FLAG)).toBe(false);
    expect(needsArchivedStamp(STUCK_RESTORED)).toBe(false);
  });

  it('does not flag a genuinely active contact', () => {
    const live = { status: 'active', record_status: 'active' };
    expect(archivedWithoutBooleanFlag(live)).toBe(false);
    expect(stuckAfterRestore(live)).toBe(false);
  });

  it('does not flag a straightforwardly archived contact', () => {
    const ok = { is_archived: true, record_status: 'archived' };
    expect(archivedWithoutBooleanFlag(ok)).toBe(false);
    expect(stuckAfterRestore(ok)).toBe(false);
  });
});
