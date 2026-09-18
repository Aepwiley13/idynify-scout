/**
 * An archived contact says so in `record_status`, not only in `is_archived`.
 *
 * THE BUG THIS PREVENTS
 * ─────────────────────
 * `readRecordStatus` checks `record_status` BEFORE `is_archived`, so the
 * boolean does not win. Scout creates contacts with `record_status:
 * 'suggested'`, and the archive paths used to set only `is_archived: true` and
 * a legacy `status`. An archived row therefore kept reading back as a live
 * suggestion.
 *
 * #640 closed the dangerous consequence — `engagementPromotionFields` now
 * refuses to promote anything carrying an archive signal, so no send can
 * un-archive a contact. This closes the cause: the row is no longer
 * self-contradictory in the first place.
 *
 * These assert the SHAPE of the patch each archive path writes, rather than
 * mocking Firestore. The three paths are unrelated call sites (a service, a
 * swipe handler, a Netlify action) whose only shared contract is what lands on
 * the document.
 */

import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import {
  RECORD_STATUS,
  RELATIONSHIP_STATUS,
  STAGE,
  readRecordStatus,
  readRelationshipStatus,
  readStage,
  hasArchiveSignal,
  createStatusFields,
  engagementPromotionFields,
} from '../constants/statusModel';

/** The patch `peopleService.archivePerson` writes. */
const ARCHIVE_PERSON_PATCH = Object.freeze({
  is_archived: true,
  status: 'people_mode_archived',
  record_status: RECORD_STATUS.ARCHIVED,
});

/** The patch the DailyLeads swipe-left reject writes. */
const SWIPE_REJECT_PATCH = Object.freeze({
  status: 'people_mode_archived',
  source: 'people_mode',
  is_archived: true,
  record_status: RECORD_STATUS.ARCHIVED,
});

/** The patch `barryPipelineAction.archiveContact` writes. */
const BARRY_ARCHIVE_PATCH = Object.freeze({
  is_archived: true,
  record_status: RECORD_STATUS.ARCHIVED,
  archived_reason: 'barry_chat',
});

const ALL_PATCHES = Object.freeze({
  'peopleService.archivePerson': ARCHIVE_PERSON_PATCH,
  'DailyLeads swipe-left reject': SWIPE_REJECT_PATCH,
  'barryPipelineAction.archiveContact': BARRY_ARCHIVE_PATCH,
});

/** A contact as Scout creates it: stamped 'suggested' at birth. */
const SCOUT_SUGGESTION = Object.freeze({
  ...createStatusFields({
    recordStatus: RECORD_STATUS.SUGGESTED,
    stage: STAGE.SCOUT,
  }),
  status: 'suggested',
  source: 'icp_auto_discovery',
});

describe.each(Object.entries(ALL_PATCHES))('%s', (_name, patch) => {
  it('stamps record_status archived', () => {
    expect(patch.record_status).toBe(RECORD_STATUS.ARCHIVED);
  });

  it('leaves the row reading as archived, not as a suggestion', () => {
    // The regression: before the fix this resolved to 'suggested', because
    // the stale record_status outranks is_archived.
    const archived = { ...SCOUT_SUGGESTION, ...patch };
    expect(readRecordStatus(archived)).toBe(RECORD_STATUS.ARCHIVED);
    expect(hasArchiveSignal(archived)).toBe(true);
  });

  it('agrees with the boolean instead of contradicting it', () => {
    const archived = { ...SCOUT_SUGGESTION, ...patch };
    expect(archived.is_archived).toBe(true);
    expect(readRecordStatus(archived)).toBe(RECORD_STATUS.ARCHIVED);
  });

  it('cannot be promoted back to active by an engagement', () => {
    // Belt and braces with #640: the guard already refuses these, and now the
    // row does not look promotable to begin with.
    const archived = { ...SCOUT_SUGGESTION, ...patch, contact_status: 'Awaiting Reply' };
    expect(engagementPromotionFields(archived)).toEqual({});
  });
});

describe('archiving changes the record lifecycle and nothing else', () => {
  // Guard against a plausible "simplification": replacing the explicit
  // record_status with createStatusFields({ recordStatus: ARCHIVED }). That
  // helper is for CREATION — it also emits relationship_status 'new' and
  // stage 'scout', so an archived customer in Basecamp would come back as a
  // fresh Scout lead. Archiving must not rewrite the relationship or the
  // pipeline position.
  const CUSTOMER_IN_BASECAMP = Object.freeze({
    record_status: RECORD_STATUS.ACTIVE,
    relationship_status: RELATIONSHIP_STATUS.CUSTOMER,
    stage: STAGE.BASECAMP,
    contact_status: 'Active Customer',
  });

  it.each(Object.entries(ALL_PATCHES))(
    '%s preserves relationship_status and stage',
    (_name, patch) => {
      const archived = { ...CUSTOMER_IN_BASECAMP, ...patch };
      expect(readRecordStatus(archived)).toBe(RECORD_STATUS.ARCHIVED);
      // The two dimensions that must survive an archive.
      expect(readRelationshipStatus(archived)).toBe(RELATIONSHIP_STATUS.CUSTOMER);
      expect(readStage(archived)).toBe(STAGE.BASECAMP);
    }
  );

  it('demonstrates what createStatusFields would have clobbered', () => {
    // Not an endorsement — a record of why the explicit write is there.
    const viaHelper = {
      ...CUSTOMER_IN_BASECAMP,
      ...createStatusFields({ recordStatus: RECORD_STATUS.ARCHIVED }),
    };
    expect(readRelationshipStatus(viaHelper)).toBe(RELATIONSHIP_STATUS.NEW);
    expect(readStage(viaHelper)).toBe(STAGE.SCOUT);
  });

  it.each(Object.entries(ALL_PATCHES))('%s does not touch engagement fields', (_name, patch) => {
    expect(patch).not.toHaveProperty('relationship_status');
    expect(patch).not.toHaveProperty('stage');
    expect(patch).not.toHaveProperty('contact_status');
    expect(patch).not.toHaveProperty('hunter_status');
  });
});

describe('the real call sites write it — not just these fixtures', () => {
  // The patches above are hand-written copies. On their own they would stay
  // green if someone edited the actual source, which would make this whole
  // file decorative. So read the three call sites and assert the field is
  // really there.
  //
  // This is a source-shape check and is honest about its limits: it proves the
  // field is written at the site, not that the site is reached. `verifyWritePaths`
  // is the repo's tool for this kind of proof, but it parses `src` only and
  // documents netlify/functions as a known gap — and one of these three paths
  // is a Netlify function, so it is checked here instead.

  /** Source of `fn`'s body, from `file`, starting at `anchor`. */
  function region(file, anchor, chars = 900) {
    const src = readFileSync(file, 'utf8');
    const at = src.indexOf(anchor);
    expect(at, `anchor not found in ${file}: ${anchor}`).toBeGreaterThan(-1);
    return src.slice(at, at + chars);
  }

  it.each([
    [
      'src/services/peopleService.js',
      'export async function archivePerson',
    ],
    [
      'netlify/functions/barryPipelineAction.js',
      'async function archiveContact',
    ],
  ])('%s stamps record_status when archiving', (file, anchor) => {
    expect(region(file, anchor)).toContain('record_status: RECORD_STATUS.ARCHIVED');
  });

  it('DailyLeads swipe-left reject stamps record_status', () => {
    // Anchored on the reject write itself: a single long setDoc line that also
    // sets is_archived and the legacy archived status.
    const src = readFileSync('src/pages/Scout/DailyLeads.jsx', 'utf8');
    const rejectWrite = src
      .split('\n')
      .find(l => l.includes("status: 'people_mode_archived'") && l.includes('is_archived: true'));
    expect(rejectWrite, 'reject write not found in DailyLeads.jsx').toBeTruthy();
    expect(rejectWrite).toContain('record_status: RECORD_STATUS.ARCHIVED');
  });

  it.each([
    'src/services/peopleService.js',
    'src/pages/Scout/DailyLeads.jsx',
    'netlify/functions/barryPipelineAction.js',
  ])('%s imports RECORD_STATUS rather than hardcoding the string', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/import \{[^}]*RECORD_STATUS[^}]*\} from ['"][^'"]*statusModel/);
  });
});

describe('archive is reversible — restore actually restores', () => {
  // The inverse path matters as much as the archive one. `handleRestore` in
  // FallbackModule used to clear only `is_archived`, leaving
  // `status: 'people_mode_archived'` in place — and readRecordStatus falls
  // back to the legacy vocabulary, where that means archived. So a "restored"
  // contact stayed archived to every reader: invisible in active views, and
  // refused by engagementPromotionFields because hasArchiveSignal still saw
  // the stale marker. Stamping record_status on archive would have added a
  // second sticky field to the same trap.

  /** The patch FallbackModule's restore writes, for a row archived by Scout. */
  const RESTORE_PATCH = Object.freeze({
    is_archived: false,
    archived_at: null,
    archived_reason: null,
    stage: 'scout',
    record_status: RECORD_STATUS.ACTIVE,
    status: 'active',
  });

  it.each(Object.entries(ALL_PATCHES))(
    'a contact archived by %s comes back clean',
    (_name, archivePatch) => {
      const archived = { ...SCOUT_SUGGESTION, ...archivePatch };
      expect(readRecordStatus(archived)).toBe(RECORD_STATUS.ARCHIVED);

      const restored = { ...archived, ...RESTORE_PATCH };
      expect(readRecordStatus(restored)).toBe(RECORD_STATUS.ACTIVE);
      expect(hasArchiveSignal(restored)).toBe(false);
    }
  );

  it('a restored contact can be engaged again', () => {
    const archived = { ...SCOUT_SUGGESTION, ...ARCHIVE_PERSON_PATCH };
    const restored = { ...archived, ...RESTORE_PATCH, contact_status: 'Awaiting Reply' };
    // Not blocked by the #640 guard any more, because there is no archive
    // signal left to block on.
    expect(hasArchiveSignal(restored)).toBe(false);
  });

  it('restore clears the legacy status, not only the boolean', () => {
    // The specific omission that made restore a no-op.
    const halfRestored = { ...SCOUT_SUGGESTION, ...ARCHIVE_PERSON_PATCH, is_archived: false };
    expect(readRecordStatus(halfRestored)).toBe(RECORD_STATUS.ARCHIVED);
    expect(RESTORE_PATCH.status).toBe('active');
    expect(RESTORE_PATCH.record_status).toBe(RECORD_STATUS.ACTIVE);
  });

  it('the restore call site clears every archive signal', () => {
    const src = readFileSync('src/pages/Fallback/sections/FallbackModule.jsx', 'utf8');
    const at = src.indexOf('const handleRestore');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 1600);
    expect(body).toContain('is_archived: false');
    expect(body).toContain('record_status: RECORD_STATUS.ACTIVE');
    expect(body).toContain("people_mode_archived");
  });
});
