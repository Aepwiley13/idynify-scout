/**
 * The backfill's classification rule.
 *
 * `inferIsArchived` decides which existing contacts get hidden from search
 * when the migration runs. Getting it wrong in one direction leaves rejected
 * leads showing up as live prospects; getting it wrong in the other quietly
 * removes real contacts from every search and every people lens, across every
 * user, in a single pass that nobody reviews line by line.
 *
 * So the rule is exported from the script and tested here rather than being
 * buried in a loop whose only proof is running the migration in production.
 */

import { describe, it, expect } from 'vitest';
import { inferIsArchived } from '../../scripts/backfillContactIsArchived.mjs';

describe('inferIsArchived', () => {
  it('archives a left-swiped people-mode contact', () => {
    // DailyLeads wrote status and archived_at on reject but never the boolean.
    expect(inferIsArchived({
      name: 'Rejected Lead',
      status: 'people_mode_archived',
      archived_at: '2026-01-04T10:00:00.000Z',
    })).toBe(true);
  });

  it('archives on a truthy archived_at from any other path', () => {
    expect(inferIsArchived({ name: 'Someone', archived_at: '2026-01-04T10:00:00.000Z' })).toBe(true);
  });

  it('does NOT archive when archived_at is null', () => {
    // createPersonRecord initialises archived_at to null on live records.
    // Treating that as evidence would hide every schema-created contact.
    expect(inferIsArchived({ name: 'Live Contact', archived_at: null })).toBe(false);
  });

  it('does NOT archive a skipped contact', () => {
    // A skip defers someone to a later day. It is not a rejection, and the
    // write path deliberately leaves is_archived alone.
    expect(inferIsArchived({
      name: 'Skipped Today',
      status: 'people_mode_skipped',
      skipped_date: '2026-01-04',
    })).toBe(false);
  });

  it('does not archive ordinary contacts, whatever their pipeline status', () => {
    for (const status of ['suggested', 'active', 'saved', 'pending_enrichment', undefined]) {
      expect(inferIsArchived({ name: 'Gentry Moyes', status })).toBe(false);
    }
  });

  it('does not archive a contact document with nothing on it', () => {
    expect(inferIsArchived({})).toBe(false);
    expect(inferIsArchived()).toBe(false);
  });
});
