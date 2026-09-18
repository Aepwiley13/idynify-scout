/**
 * An engaged contact cannot remain `suggested`.
 *
 * THE BUG THIS PREVENTS
 * ─────────────────────
 * Auto-discovery stamps `status: 'suggested'` and nothing used to clear it.
 * The two Scout people surfaces filter on different dimensions:
 *
 *   Saved Companies "Total Contacts"  excludes status === 'suggested'
 *   People "Total Leads"              excludes engaged contacts
 *
 * So a contact that was BOTH suggested and engaged was excluded by each of
 * them for opposite reasons and counted in neither, while cadences kept
 * running against it. In workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2 that was 27
 * contacts, and it made six accepted companies report "0 contacts" while
 * their people were mid-conversation.
 *
 * Two independent guarantees are asserted here, because the fix has two
 * halves and either alone leaves a hole:
 *
 *   1. WRITE — engagement promotes the record out of 'suggested', so no new
 *      row can reach the contradictory state.
 *   2. READ  — the counter treats an engaged contact as kept regardless of
 *      what its row still says, so the rows already written are counted
 *      correctly without a backfill.
 */

import { describe, it, expect } from 'vitest';
import {
  RECORD_STATUS,
  readRecordStatus,
  isEngagedRecord,
  hasArchiveSignal,
  engagementPromotionFields,
} from '../constants/statusModel';

/**
 * The Saved Companies classifier, as implemented in SavedCompanies.jsx.
 *
 * Archived contacts are excluded from BOTH counts before the suggested test
 * runs — the user removed them, so they are neither a real contact nor a
 * pending suggestion. See savedCompaniesArchivedCount.test.js, which owns that
 * behaviour; it is mirrored here so this file's counter claims stay true to
 * the component.
 */
function countsAsSuggested(contact) {
  if (hasArchiveSignal(contact)) return false;
  return readRecordStatus(contact) === RECORD_STATUS.SUGGESTED && !isEngagedRecord(contact);
}

/** Does the contact feed the "Total Contacts" KPI? */
function countsAsRealContact(contact) {
  if (hasArchiveSignal(contact)) return false;
  return !(readRecordStatus(contact) === RECORD_STATUS.SUGGESTED && !isEngagedRecord(contact));
}

/** The People (scout mode) classifier, as implemented in AllLeads.jsx. */
function countsAsLead(contact) {
  const s = contact.status || '';
  const archived =
    contact.is_archived === true ||
    ['people_mode_archived', 'people_mode_skipped'].includes(s);
  return !archived && !isEngagedRecord(contact);
}

/**
 * The real document the audit found, verbatim from Firestore on 2026-09-15:
 * users/peqhaq8Cw1UUPeaYhaSLwZ0iCRk2/contacts/
 *   54a116d169702d3ec0b70700_54a7b51074686965d95f854d
 */
const AUDITED_CONTACT = Object.freeze({
  status: 'suggested',
  contact_status: 'Awaiting Reply',
  hunter_status: 'engaged_pending',
  active_mission_id: 'm_8Xq2',
  gmail_thread_id: '18f0c9a1b2c3',
  last_sent_at: '2026-07-31T16:04:11.000Z',
  company_id: 'co_54a116d169702d3ec0b70700',
  source: 'icp_auto_discovery',
});

describe('an engaged contact is never left as a suggestion', () => {
  it('promotes the audited production document out of suggested', () => {
    expect(readRecordStatus(AUDITED_CONTACT)).toBe(RECORD_STATUS.SUGGESTED);
    expect(isEngagedRecord(AUDITED_CONTACT)).toBe(true);

    const promoted = { ...AUDITED_CONTACT, ...engagementPromotionFields(AUDITED_CONTACT) };

    expect(readRecordStatus(promoted)).toBe(RECORD_STATUS.ACTIVE);
    // The legacy field is cleared too, because that is the one the Saved
    // Companies query actually filtered on.
    expect(promoted.status).toBe('active');
  });

  it.each([
    ['Engaged', undefined],
    ['Awaiting Reply', 'engaged_pending'],
    ['In Conversation', 'in_conversation'],
    ['Active Mission', 'active_mission'],
    ['In Campaign', undefined],
    ['Mission Complete', undefined],
    ['Active Customer', undefined],
    ['Dormant', undefined],
  ])('leaves no engaged state (%s) still suggested', (contact_status, hunter_status) => {
    const contact = { status: 'suggested', contact_status, hunter_status };
    const promoted = { ...contact, ...engagementPromotionFields(contact) };
    expect(readRecordStatus(promoted)).toBe(RECORD_STATUS.ACTIVE);
  });

  it('is the state no contact may occupy: counted by neither surface', () => {
    // Before the fix this contact was invisible to both counters at once.
    expect(countsAsSuggested(AUDITED_CONTACT)).toBe(false);
    expect(countsAsLead(AUDITED_CONTACT)).toBe(false);

    // After promotion it is a real contact for Saved Companies. It is still
    // not a scout-mode lead — engaged people belong to Hunter — but it is now
    // counted exactly once rather than zero times.
    const promoted = { ...AUDITED_CONTACT, ...engagementPromotionFields(AUDITED_CONTACT) };
    expect(countsAsSuggested(promoted)).toBe(false);
    expect(countsAsLead(promoted)).toBe(false);
  });

  it('counts an engaged suggestion even with no promotion written — no backfill needed', () => {
    // The read-side guarantee, which is what rescues the 27 rows already in
    // production. The raw document is untouched here.
    expect(countsAsSuggested(AUDITED_CONTACT)).toBe(false);
  });
});

describe('engagement is detected even when the new-model field is stale', () => {
  // createStatusFields stamps relationship_status 'new' at creation and no
  // engagement write path updates it — they write contact_status and
  // hunter_status. readRelationshipStatus checks the new field first, so the
  // stale value would otherwise win. 80 contacts in the audited workspace are
  // in this state; 13 of them are contacts this fix exists to rescue.
  const STALE = Object.freeze({
    record_status: 'suggested',
    relationship_status: 'new',      // stale — never updated after creation
    contact_status: 'Awaiting Reply', // fresher, and says otherwise
    hunter_status: 'awaiting_reply',
    last_sent_at: '2026-08-27T23:29:48.088Z',
  });

  it('trusts the legacy field over a stale relationship_status', () => {
    expect(isEngagedRecord(STALE)).toBe(true);
  });

  it('rescues the record the stale field would have hidden', () => {
    expect(countsAsSuggested(STALE)).toBe(false);
    const promoted = { ...STALE, ...engagementPromotionFields(STALE) };
    expect(readRecordStatus(promoted)).toBe(RECORD_STATUS.ACTIVE);
  });

  it('detects engagement from hunter_status alone', () => {
    // Contacts that only ever went through Hunter have no contact_status at
    // all, so hunter_status is the only evidence that exists.
    for (const hunter_status of [
      'active_mission', 'awaiting_reply', 'engaged_pending', 'in_conversation', 'converted',
    ]) {
      expect(isEngagedRecord({ status: 'suggested', hunter_status })).toBe(true);
    }
  });

  it('still reports an untouched record as unengaged', () => {
    expect(isEngagedRecord({ status: 'suggested', relationship_status: 'new' })).toBe(false);
    expect(isEngagedRecord({ status: 'suggested', hunter_status: 'deck' })).toBe(false);
    expect(isEngagedRecord({ status: 'suggested', hunter_status: 'none' })).toBe(false);
  });
});

describe('promotion is narrow — it changes nothing it should not', () => {
  it('leaves a genuinely unengaged suggestion counted as suggested', () => {
    // The helper itself does NOT gate on engagement, and must not: at the
    // call site the transition into the engaged status has not been written
    // yet, so the document it is handed still reads as unengaged. The CALLER
    // is what decides engagement happened. What matters for the surfaces is
    // that a discovery suggestion nobody touched still counts as suggested.
    const fresh = { status: 'suggested', source: 'icp_auto_discovery' };
    expect(isEngagedRecord(fresh)).toBe(false);
    expect(countsAsSuggested(fresh)).toBe(true);
    expect(countsAsLead(fresh)).toBe(true);
  });

  it('does not resurrect an archived contact', () => {
    const archived = { status: 'suggested', is_archived: true, contact_status: 'Engaged' };
    // This one has no `record_status`, so readRecordStatus does fall through
    // to is_archived. That is why it passed even before the guard existed —
    // and why it proved nothing. See the stale-'suggested' cases below.
    expect(engagementPromotionFields(archived)).toEqual({});
  });

  it('does not clobber an Apollo enrichment marker', () => {
    // `status` doubles as an enrichment lifecycle field. A record whose
    // record_status is suggested but whose legacy status is mid-enrichment
    // must keep that marker — it is real state nothing else records.
    const enriching = {
      record_status: 'suggested',
      status: 'pending_enrichment',
      contact_status: 'Awaiting Reply',
    };
    const fields = engagementPromotionFields(enriching);
    expect(fields.record_status).toBe('active');
    expect(fields).not.toHaveProperty('status');
  });

  it('is idempotent', () => {
    const promoted = { ...AUDITED_CONTACT, ...engagementPromotionFields(AUDITED_CONTACT) };
    expect(engagementPromotionFields(promoted)).toEqual({});
  });

  it('records why and when, so a promoted row is auditable', () => {
    const fields = engagementPromotionFields(AUDITED_CONTACT, {
      now: '2026-09-15T00:00:00.000Z',
      reason: 'message_sent',
    });
    expect(fields.record_status_promoted_at).toBe('2026-09-15T00:00:00.000Z');
    expect(fields.record_status_promoted_by).toBe('message_sent');
  });
});

describe('an archive is never undone by engagement', () => {
  // THE GAP THIS CLOSES
  // ───────────────────
  // `readRecordStatus` checks `record_status` BEFORE `is_archived`, so
  // `is_archived: true` does not win. `createStatusFields` stamps
  // `record_status: 'suggested'` at creation and the archive paths never
  // update it, so an archived row keeps reading back as 'suggested' and
  // walks straight past the archive signal into the promotion.
  //
  // Workspace peqhaq8Cw1UUPeaYhaSLwZ0iCRk2 holds 7 rows in exactly this
  // state. None was promoted before the guard only because all 7 are
  // unengaged today — luck, not a rule. The promotion helper is wired into
  // contactStateMachine and six Netlify send paths, so an archived row that
  // is also engaged would be promoted on a real send.

  /** The shape of the 7 audited rows: archived, but stale-stamped 'suggested'. */
  const ARCHIVED_STALE = Object.freeze({
    status: 'people_mode_archived',
    is_archived: true,
    record_status: 'suggested',
  });

  it('reproduces the precedence that made the guard necessary', () => {
    // Not an assertion about what SHOULD happen — a record of why the
    // readRecordStatus test alone was never enough.
    expect(readRecordStatus(ARCHIVED_STALE)).toBe(RECORD_STATUS.SUGGESTED);
    expect(hasArchiveSignal(ARCHIVED_STALE)).toBe(true);
  });

  it('refuses to promote an archived, stale-suggested, engaged contact', () => {
    const contact = { ...ARCHIVED_STALE, contact_status: 'Awaiting Reply' };
    // Engaged and reading as 'suggested' — every condition the promotion
    // wants. The archive is the only thing standing in the way, and it holds.
    expect(isEngagedRecord(contact)).toBe(true);
    expect(readRecordStatus(contact)).toBe(RECORD_STATUS.SUGGESTED);
    expect(engagementPromotionFields(contact)).toEqual({});
  });

  it.each([
    ['contact_status', { contact_status: 'In Conversation' }],
    ['hunter_status', { hunter_status: 'active_mission' }],
    ['relationship_status', { relationship_status: 'engaged' }],
  ])('holds whatever field carries the engagement (%s)', (_label, engagement) => {
    const contact = { ...ARCHIVED_STALE, ...engagement };
    expect(isEngagedRecord(contact)).toBe(true);
    expect(engagementPromotionFields(contact)).toEqual({});
  });

  it.each([
    ['is_archived', { is_archived: true, status: 'suggested' }],
    ['status archived', { status: 'archived' }],
    ['status people_mode_archived', { status: 'people_mode_archived' }],
  ])('honours every archive signal (%s)', (_label, archival) => {
    const contact = { record_status: 'suggested', contact_status: 'Engaged', ...archival };
    expect(engagementPromotionFields(contact)).toEqual({});
  });

  it('still promotes an engaged suggestion that was never archived', () => {
    // The guard must not swallow the case the helper exists for.
    const contact = { status: 'suggested', record_status: 'suggested', contact_status: 'Engaged' };
    expect(hasArchiveSignal(contact)).toBe(false);
    expect(engagementPromotionFields(contact).record_status).toBe(RECORD_STATUS.ACTIVE);
  });

  it('leaves the Saved Companies contact counter unchanged', () => {
    // The counter never calls the promotion helper, so suppressing a write
    // cannot move it. Stronger still now that archived rows are excluded from
    // both counts outright: whether the promotion was written or refused, an
    // archived contact is in neither bucket.
    const engagedArchived = { ...ARCHIVED_STALE, contact_status: 'Awaiting Reply' };
    const asIfPromoted = {
      ...engagedArchived,
      record_status: RECORD_STATUS.ACTIVE,
      status: 'active',
    };
    expect(countsAsSuggested(engagedArchived)).toBe(countsAsSuggested(asIfPromoted));
    expect(countsAsRealContact(engagedArchived)).toBe(countsAsRealContact(asIfPromoted));
    expect(countsAsSuggested(engagedArchived)).toBe(false);
    expect(countsAsRealContact(engagedArchived)).toBe(false);

    // The 7 audited rows are archived, so they feed neither count. They are
    // not "suggested" — the earlier version of this test said they were,
    // because the classifier it mirrored had no archive check yet.
    expect(countsAsSuggested(ARCHIVED_STALE)).toBe(false);
    expect(countsAsRealContact(ARCHIVED_STALE)).toBe(false);
    expect(countsAsLead(ARCHIVED_STALE)).toBe(false);
  });
});
