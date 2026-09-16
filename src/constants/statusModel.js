/**
 * statusModel — three status dimensions, deliberately not one state machine.
 *
 * WHY THREE
 * ─────────
 * A contact record has been carrying at least four overlapping status fields:
 * `status` (Apollo-flavoured: 'suggested' | 'pending_enrichment' | 'active' |
 * 'saved' | 'people_mode_archived' | …), `contact_status` (the behavioural
 * state machine: 'New' | 'Engaged' | 'Awaiting Reply' | …), `lead_status` (a
 * sales pipeline: 'new_lead' | 'contacted' | …), `is_archived` (a boolean that
 * half the write paths forgot) and `stage` (which module owns the person).
 *
 * These answer different questions, and collapsing them is what produced the
 * contradictions: a contact could be `is_archived: true` and `contact_status:
 * 'In Conversation'`, or `status: 'suggested'` while sitting in Hunter. The
 * fix is not a bigger enum. It is admitting there are three questions:
 *
 *   record_status        Does this record count?          Lifecycle of the ROW.
 *   relationship_status  Where is the human relationship?  Behavioural state.
 *   stage                Which module owns the work?       Pipeline location.
 *
 * They move independently. An `archived` record can have been a `customer`. A
 * contact in `sniper` can be `awaiting_reply`. Any single field that tried to
 * express all three would have to enumerate their cross product, which is
 * exactly the mess this replaces.
 *
 * MIGRATION POSTURE — READ THIS BEFORE CHANGING ANYTHING
 * ─────────────────────────────────────────────────────
 * This sprint adds the three fields at the WRITE paths and adds COMPATIBILITY
 * READS everywhere the old fields are consumed. It does not migrate history and
 * it does not delete the old fields. Both new and old are written; readers that
 * have not moved keep working because their field is still there.
 *
 * That means for the lifetime of the migration the old fields remain
 * authoritative for anything this sprint did not touch, and the compatibility
 * readers below are the ONLY safe way to ask a contact for its status —
 * because a historical record has no new fields at all, and a record written
 * today has both. See docs/STATUS_ARCHITECTURE.md for the field-by-field
 * mapping and the backfill plan.
 */

// ── Dimension 1: record_status — lifecycle of the row ────────────────────────

export const RECORD_STATUS = Object.freeze({
  /** Surfaced by discovery, not yet kept by the user. */
  SUGGESTED: 'suggested',
  /** The user kept it. The default for anything a human deliberately saved. */
  ACTIVE: 'active',
  /** Soft-deleted. Never hard-deleted — see peopleSchema. */
  ARCHIVED: 'archived',
  /** The user explicitly said no. Distinct from archived: rejection is signal. */
  REJECTED: 'rejected',
});

export const RECORD_STATUSES = Object.freeze(Object.values(RECORD_STATUS));

// ── Dimension 2: relationship_status — where the human relationship is ───────

export const RELATIONSHIP_STATUS = Object.freeze({
  NEW: 'new',
  ENGAGED: 'engaged',
  AWAITING_REPLY: 'awaiting_reply',
  IN_CONVERSATION: 'in_conversation',
  CUSTOMER: 'customer',
  DORMANT: 'dormant',
});

export const RELATIONSHIP_STATUSES = Object.freeze(Object.values(RELATIONSHIP_STATUS));

// ── Dimension 3: stage — which module owns the work ──────────────────────────

export const STAGE = Object.freeze({
  SCOUT: 'scout',
  HUNTER: 'hunter',
  SNIPER: 'sniper',
  BASECAMP: 'basecamp',
  REINFORCEMENTS: 'reinforcements',
  FALLBACK: 'fallback',
});

export const STAGES = Object.freeze(Object.values(STAGE));

// ─────────────────────────────────────────────────────────────────────────────
// COMPATIBILITY READS
//
// Every one of these takes a contact document that may be:
//   (a) written today      — has all three new fields
//   (b) written last month — has `status` / `contact_status` / `is_archived`
//   (c) written long ago   — has NEITHER, because the write path omitted it
//
// Case (c) is not hypothetical: `is_archived` was absent from every Scout write
// path until PR #510, and `contact_status` has never been written by the Apollo
// import paths at all. So each reader ends in an explicit documented default
// rather than `undefined`, and the default is stated in the docstring because
// it is a product decision, not an implementation detail.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legacy `status` values → record_status.
 *
 * Values not listed here are Apollo/enrichment lifecycle markers
 * ('pending_enrichment', 'enrichment_failed', 'connected', …). Those say
 * nothing about whether the record counts, so they fall through to the
 * is_archived check and then to the default.
 */
const LEGACY_RECORD_STATUS = Object.freeze({
  suggested: RECORD_STATUS.SUGGESTED,
  active: RECORD_STATUS.ACTIVE,
  saved: RECORD_STATUS.ACTIVE,
  accepted: RECORD_STATUS.ACTIVE,
  archived: RECORD_STATUS.ARCHIVED,
  people_mode_archived: RECORD_STATUS.ARCHIVED,
  rejected: RECORD_STATUS.REJECTED,
});

/**
 * record_status for any contact, old or new.
 *
 * Precedence: the new field, then `is_archived` (a true boolean is decisive —
 * it is what eight read paths filter on), then the legacy `status` vocabulary,
 * then 'active'.
 *
 * DEFAULT IS 'active', AND THAT IS DELIBERATE. A record with no archival
 * signal at all is one the user saved and never dismissed. Defaulting to
 * 'suggested' would hide thousands of historical contacts from every view that
 * filters for active records — the same class of disappearance that the
 * missing `is_archived` field caused.
 */
export function readRecordStatus(contact) {
  if (!contact) return RECORD_STATUS.ACTIVE;

  if (RECORD_STATUSES.includes(contact.record_status)) return contact.record_status;
  if (contact.is_archived === true) return RECORD_STATUS.ARCHIVED;

  const mapped = LEGACY_RECORD_STATUS[contact.status];
  if (mapped) return mapped;

  return RECORD_STATUS.ACTIVE;
}

/** Legacy `contact_status` (title case, space separated) → relationship_status. */
const LEGACY_RELATIONSHIP_STATUS = Object.freeze({
  'New': RELATIONSHIP_STATUS.NEW,
  'Engaged': RELATIONSHIP_STATUS.ENGAGED,
  'Awaiting Reply': RELATIONSHIP_STATUS.AWAITING_REPLY,
  'In Conversation': RELATIONSHIP_STATUS.IN_CONVERSATION,
  'Active Customer': RELATIONSHIP_STATUS.CUSTOMER,
  'Past Customer': RELATIONSHIP_STATUS.DORMANT,
  'Dormant': RELATIONSHIP_STATUS.DORMANT,
  // Legacy campaign/mission states. All three mean "we have reached out and are
  // waiting", which is awaiting_reply — the closest honest mapping. None of
  // them mean 'engaged', which in the new vocabulary means the user opened the
  // engage module without having sent anything yet.
  'In Campaign': RELATIONSHIP_STATUS.AWAITING_REPLY,
  'Active Mission': RELATIONSHIP_STATUS.AWAITING_REPLY,
  'Mission Complete': RELATIONSHIP_STATUS.AWAITING_REPLY,
  // Network and Partner are person_type values that leaked into the status
  // field. They describe a relationship KIND, not its state, and the new model
  // has nowhere to put them — person_type already carries that. Treated as
  // 'engaged': a partner in the book is not a new lead.
  'Network': RELATIONSHIP_STATUS.ENGAGED,
  'Partner': RELATIONSHIP_STATUS.ENGAGED,
});

/**
 * relationship_status for any contact, old or new.
 *
 * DEFAULT IS 'new'. A contact with no behavioural history recorded has not
 * been engaged as far as the system can prove, and 'new' is the state that
 * makes Barry ask rather than assume.
 */
export function readRelationshipStatus(contact) {
  if (!contact) return RELATIONSHIP_STATUS.NEW;

  if (RELATIONSHIP_STATUSES.includes(contact.relationship_status)) {
    return contact.relationship_status;
  }

  const mapped = LEGACY_RELATIONSHIP_STATUS[contact.contact_status];
  if (mapped) return mapped;

  // person_type is the last resort: a record explicitly marked a customer is a
  // customer even if no one ever wrote a status for it.
  if (contact.person_type === 'customer') return RELATIONSHIP_STATUS.CUSTOMER;
  if (contact.person_type === 'past_customer') return RELATIONSHIP_STATUS.DORMANT;

  return RELATIONSHIP_STATUS.NEW;
}

/**
 * stage for any contact, old or new.
 *
 * `stage` predates this sprint and already uses the right vocabulary, so this
 * reader mostly validates. DEFAULT IS 'scout' — the entry point of the
 * pipeline, and where an unclassified contact belongs.
 */
export function readStage(contact) {
  if (!contact) return STAGE.SCOUT;
  if (STAGES.includes(contact.stage)) return contact.stage;

  if (contact.person_type === 'customer') return STAGE.BASECAMP;
  if (contact.person_type === 'past_customer') return STAGE.FALLBACK;

  return STAGE.SCOUT;
}

/** All three at once, for callers that want the whole picture. */
export function readStatusTriple(contact) {
  return {
    record_status: readRecordStatus(contact),
    relationship_status: readRelationshipStatus(contact),
    stage: readStage(contact),
  };
}

/** Is this record one that active views should show? */
export function isActiveRecord(contact) {
  const status = readRecordStatus(contact);
  return status === RECORD_STATUS.ACTIVE || status === RECORD_STATUS.SUGGESTED;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGAGEMENT PROMOTION
//
// `suggested` means "surfaced by discovery, not yet kept by the user". Sending
// a contact an email, enrolling them in a cadence or assigning them a mission
// is the strongest possible statement that the user kept them — so a record
// cannot still be `suggested` once it is engaged.
//
// Leaving it there is not a harmless inconsistency, because the two Scout
// people surfaces filter on DIFFERENT dimensions and a row can fall out of
// both at once:
//
//   Saved Companies "Total Contacts"  excludes status === 'suggested'
//   People "Total Leads"              excludes engaged contacts
//
// A contact that is BOTH suggested and engaged is excluded by each of them,
// for opposite reasons, and appears in neither. It is invisible while still
// being actively emailed. Promoting on engagement closes that gap at the
// source; `isActiveRecord` and the readers below close it for rows already
// written.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * relationship_status values that mean the user has actually reached out.
 *
 * `dormant` belongs here: a contact only goes dormant after engagement went
 * quiet, so the record was kept. `new` is the only non-engaged state.
 */
export const ENGAGED_RELATIONSHIP_STATUSES = Object.freeze([
  RELATIONSHIP_STATUS.ENGAGED,
  RELATIONSHIP_STATUS.AWAITING_REPLY,
  RELATIONSHIP_STATUS.IN_CONVERSATION,
  RELATIONSHIP_STATUS.CUSTOMER,
  RELATIONSHIP_STATUS.DORMANT,
]);

/**
 * hunter_status values that mean outreach is under way.
 *
 * `readRelationshipStatus` does not consult hunter_status at all, but it is
 * the field the Hunter module actually maintains, so for a contact that has
 * only ever been through Hunter it is the only engagement evidence there is.
 */
export const ENGAGED_HUNTER_STATUSES = Object.freeze([
  'active_mission', 'awaiting_reply', 'engaged_pending', 'in_conversation', 'converted',
]);

/**
 * Has the user engaged this contact? Works on old and new records alike.
 *
 * This deliberately asks EVERY field that could know, rather than trusting
 * `readRelationshipStatus` alone, because the new-model field goes stale:
 * `createStatusFields` stamps `relationship_status: 'new'` at creation and no
 * engagement write path has ever updated it — they update `contact_status`
 * and `hunter_status`. `readRelationshipStatus` checks the new field first,
 * so for those records the stale 'new' beats the fresher legacy value.
 *
 * That is not hypothetical either: in the audited workspace 80 contacts say
 * `relationship_status: 'new'` while carrying 'Awaiting Reply', an active
 * mission and a `last_sent_at`. Thirteen of them were exactly the contacts
 * this whole fix exists to rescue, and asking only the new field would have
 * left them behind.
 *
 * Any single field saying "engaged" is therefore enough. Over-detecting
 * engagement means a contact gets counted as real, which is the safe
 * direction — the same reasoning that makes `readRecordStatus` default to
 * 'active' rather than hiding records it cannot classify.
 */
export function isEngagedRecord(contact) {
  if (!contact) return false;

  if (ENGAGED_RELATIONSHIP_STATUSES.includes(readRelationshipStatus(contact))) return true;

  // The legacy behavioural field, consulted directly rather than through the
  // reader, so a stale `relationship_status` cannot mask it.
  const legacy = LEGACY_RELATIONSHIP_STATUS[contact.contact_status];
  if (legacy && ENGAGED_RELATIONSHIP_STATUSES.includes(legacy)) return true;

  if (ENGAGED_HUNTER_STATUSES.includes(contact.hunter_status)) return true;

  return false;
}

/**
 * The fields that promote a discovery suggestion to a kept record, for a
 * contact that is being engaged right now.
 *
 * Returns `{}` — an empty patch, safe to spread into any update — when the
 * record is not `suggested`. Archived and rejected records are deliberately
 * NOT resurrected: engaging someone the user archived should not silently
 * undo the archive, and `record_status` is not the field that decides it.
 *
 * @param {object} contact  The contact document as it exists BEFORE the write.
 * @param {object} [opts]
 * @param {string} [opts.now]     ISO timestamp, injectable for tests.
 * @param {string} [opts.reason]  What engaged it — appears on the record.
 */
export function engagementPromotionFields(contact, { now, reason = 'engagement' } = {}) {
  if (readRecordStatus(contact) !== RECORD_STATUS.SUGGESTED) return {};

  const out = {
    record_status: RECORD_STATUS.ACTIVE,
    record_status_promoted_at: now || new Date().toISOString(),
    record_status_promoted_by: reason,
  };

  // Only rewrite the legacy field when the legacy field is the thing saying
  // 'suggested'. `status` also carries Apollo enrichment markers
  // ('pending_enrichment', 'enrichment_failed', …) that say nothing about
  // whether the record counts, and clobbering one would lose real state.
  if (contact?.status === RECORD_STATUS.SUGGESTED) {
    out.status = RECORD_STATUS.ACTIVE;
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the three status fields for a contact write, validated.
 *
 * Throws on an unknown value rather than passing it through, for the same
 * reason createCompanyRecord throws on an unknown company status: a document
 * written with a value nothing queries for is invisible to every reader, and
 * invisible is far more expensive to diagnose than a thrown error at the call
 * site.
 *
 * Returns the LEGACY fields alongside the new ones by default. This is the
 * whole compatibility story in one place: `is_archived` still exists because
 * eight read paths filter on it, and dropping it here would break them all on
 * the day this shipped.
 *
 * @param {object}  fields
 * @param {string}  [fields.recordStatus='active']
 * @param {string}  [fields.relationshipStatus='new']
 * @param {string}  [fields.stage='scout']
 * @param {boolean} [fields.withLegacy=true]  Also emit is_archived.
 */
export function createStatusFields({
  recordStatus = RECORD_STATUS.ACTIVE,
  relationshipStatus = RELATIONSHIP_STATUS.NEW,
  stage = STAGE.SCOUT,
  withLegacy = true,
} = {}) {
  if (!RECORD_STATUSES.includes(recordStatus)) {
    throw new Error(
      `createStatusFields: unknown record_status "${recordStatus}". ` +
      `Expected one of ${RECORD_STATUSES.join(' | ')}.`
    );
  }
  if (!RELATIONSHIP_STATUSES.includes(relationshipStatus)) {
    throw new Error(
      `createStatusFields: unknown relationship_status "${relationshipStatus}". ` +
      `Expected one of ${RELATIONSHIP_STATUSES.join(' | ')}.`
    );
  }
  if (!STAGES.includes(stage)) {
    throw new Error(
      `createStatusFields: unknown stage "${stage}". Expected one of ${STAGES.join(' | ')}.`
    );
  }

  const out = {
    record_status: recordStatus,
    relationship_status: relationshipStatus,
    stage,
  };

  if (withLegacy) {
    // The one legacy field that is not merely redundant but load-bearing:
    // where('is_archived','==',false) is how search, AllLeads and six other
    // readers find contacts at all.
    out.is_archived = recordStatus === RECORD_STATUS.ARCHIVED;
  }

  return out;
}

export default {
  RECORD_STATUS,
  RELATIONSHIP_STATUS,
  STAGE,
  readRecordStatus,
  readRelationshipStatus,
  readStage,
  readStatusTriple,
  isActiveRecord,
  isEngagedRecord,
  ENGAGED_HUNTER_STATUSES,
  engagementPromotionFields,
  createStatusFields,
};
