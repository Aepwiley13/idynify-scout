/**
 * A people-mode skip means "not today". It does not mean "no".
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * `people_mode_skipped` was handled three different ways at once: AllLeads and
 * the FallBack People section listed it beside `people_mode_archived` as a
 * lost lead, the engaged-company backfill's rule agreed with them, and
 * `statusModel` mapped it nowhere at all so it fell through to the `active`
 * default. Three readings, none of them the one the write path implements.
 *
 * The write path settles it, and it is not ambiguous:
 *
 *   DailyLeads.fetchMorePeople re-queues a person when
 *     `existing.status === 'people_mode_skipped' && existing.skipped_date !== today`
 *
 * A skipped person comes back tomorrow. An archived one never does — nothing
 * anywhere re-queues `people_mode_archived`. The relationship layer says the
 * same thing twice over: skip writes its own SKIPPED event carrying
 * `skippedInCycle` rather than REJECTED, and `recordResurface` exists
 * specifically for "a skipped subject returned". So does the sibling backfill,
 * whose `inferIsArchived` already refuses to set is_archived for a skip.
 *
 * The danger this file guards is one-directional and permanent. Widening the
 * archive test to include the skip value looks like a tidy-up — the two values
 * sit next to each other and read alike — but it converts every deferral into
 * a rejection in a single edit, with no write path that can ever undo it,
 * because `engagementPromotionFields` consults `hasArchiveSignal` precisely in
 * order to refuse to resurrect archived rows. "Not today" would silently
 * become "never" for every skipped person at once.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  RECORD_STATUS,
  readRecordStatus,
  hasArchiveSignal,
  isDeferredRecord,
  isActiveRecord,
  isEngagedRecord,
  engagementPromotionFields,
} from '../constants/statusModel';

/**
 * Exactly what DailyLeads' skip branch writes — five fields, merged onto a
 * document that did not exist. No name, no title, no email, no is_archived,
 * no record_status. Anything that renders this row renders a blank one.
 */
const SKIPPED = Object.freeze({
  apollo_person_id: '54a7b51074686965d95f854d',
  company_id: 'co_54a116d169702d3ec0b70700',
  status: 'people_mode_skipped',
  source: 'people_mode',
  skipped_date: '2026-09-17',
});

/** What the left swipe writes, for contrast. This one really is terminal. */
const ARCHIVED = Object.freeze({
  apollo_person_id: 'p_2',
  company_id: 'co_1',
  status: 'people_mode_archived',
  source: 'people_mode',
  is_archived: true,
  archived_at: '2026-09-17T10:00:00.000Z',
});

describe('the status model reads a skip as deferred, not archived', () => {
  it('never resolves a skip to archived', () => {
    expect(readRecordStatus(SKIPPED)).not.toBe(RECORD_STATUS.ARCHIVED);
    expect(hasArchiveSignal(SKIPPED)).toBe(false);
  });

  it('resolves a skip to suggested — surfaced by discovery, not kept', () => {
    // Not `active`, which is what the missing mapping used to produce. `active`
    // is documented as "the user kept it", and a skip is the user declining to.
    expect(readRecordStatus(SKIPPED)).toBe(RECORD_STATUS.SUGGESTED);
  });

  it('still counts the row as one active views may show', () => {
    // isActiveRecord admits suggested. The row counts; it is just not a lead.
    expect(isActiveRecord(SKIPPED)).toBe(true);
  });

  it('marks it deferred, and marks a real archive as not deferred', () => {
    expect(isDeferredRecord(SKIPPED)).toBe(true);
    expect(isDeferredRecord(ARCHIVED)).toBe(false);
  });

  it('keeps the archive path terminal — the contrast the fix rests on', () => {
    expect(readRecordStatus(ARCHIVED)).toBe(RECORD_STATUS.ARCHIVED);
    expect(hasArchiveSignal(ARCHIVED)).toBe(true);
  });

  it('leaves a skip promotable, which an archive is not', () => {
    // This is the asymmetry that makes the distinction load-bearing rather
    // than cosmetic. Engaging a skipped person promotes them to a kept record;
    // engaging an archived one is refused, because the user already said no.
    expect(engagementPromotionFields(SKIPPED)).toHaveProperty(
      'record_status', RECORD_STATUS.ACTIVE,
    );
    expect(engagementPromotionFields({ ...ARCHIVED, status: 'suggested' })).toEqual({});
  });

  it('does not let a stale skip marker hide an engaged contact', () => {
    // No write path clears `people_mode_skipped` when something else promotes
    // the row. Since the lead lists drop deferred records from every lens, a
    // stale marker on an engaged contact would hide them everywhere at once.
    const engaged = { ...SKIPPED, hunter_status: 'awaiting_reply' };
    expect(isEngagedRecord(engaged)).toBe(true);
    expect(isDeferredRecord(engaged)).toBe(false);
  });

  it('treats a missing or empty document as neither deferred nor archived', () => {
    for (const doc of [undefined, null, {}]) {
      expect(isDeferredRecord(doc)).toBe(false);
      expect(hasArchiveSignal(doc)).toBe(false);
    }
  });
});

describe('the lead lists agree with the write path', () => {
  /** AllLeads.loadAllContacts, as implemented, for each mode. */
  function visibleIn(mode, contact) {
    if (isDeferredRecord(contact)) return false;
    const archived = hasArchiveSignal(contact);
    if (mode === 'fallback') return archived;
    if (archived) return false;
    return true;
  }

  it('does not list a skipped person in FallBack — they are not lost', () => {
    // The regression. FallBack is "archived/lost people"; a person the queue
    // will re-offer tomorrow belongs in neither word of that.
    expect(visibleIn('fallback', SKIPPED)).toBe(false);
    expect(visibleIn('fallback', ARCHIVED)).toBe(true);
  });

  it('does not render the nameless stub as a lead in any other lens', () => {
    for (const mode of ['scout', 'hunter', 'people', 'sniper', 'basecamp']) {
      expect(visibleIn(mode, SKIPPED), `${mode} listed a skip stub`).toBe(false);
    }
  });
});

describe('the source still says what these tests assume', () => {
  const daily = readFileSync('src/pages/Scout/DailyLeads.jsx', 'utf8');
  const allLeads = readFileSync('src/pages/Scout/AllLeads.jsx', 'utf8');
  const fallback = readFileSync('src/pages/Fallback/sections/PeopleSection.jsx', 'utf8');

  it('DailyLeads still re-queues a skip on a later day', () => {
    // The entire product decision rests on this one line. If it goes, a skip
    // becomes terminal in fact and everything above is wrong.
    expect(
      daily,
      'the skipped_date re-queue is gone — a skip no longer comes back, so it IS an archive now',
    ).toMatch(/status === 'people_mode_skipped' && \w+\.skipped_date !== today/);
  });

  it('the skip write still sets neither is_archived nor record_status', () => {
    const write = daily.slice(daily.indexOf("status: 'people_mode_skipped'"));
    const stmt = write.slice(0, write.indexOf('\n'));
    expect(stmt).not.toMatch(/is_archived/);
    expect(stmt).not.toMatch(/record_status/);
  });

  it('no lead list pairs the skip value with the archive value again', () => {
    for (const [name, src] of [['AllLeads', allLeads], ['PeopleSection', fallback]]) {
      expect(
        src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''),
        `${name} lists people_mode_skipped as an archive value again`,
      ).not.toMatch(/people_mode_skipped/);
    }
  });

  it('AllLeads asks the shared helpers rather than re-deriving the rule', () => {
    expect(allLeads).toMatch(/isDeferredRecord\(c\)/);
    expect(allLeads).toMatch(/hasArchiveSignal\(c\)/);
  });
});
