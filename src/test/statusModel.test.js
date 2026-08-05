/**
 * The three status dimensions, and the compatibility reads that keep the
 * migration from breaking anything.
 *
 * The reads are the part that matters most. Every contact in production
 * predates this sprint, so every one of them will go through the legacy
 * branches — and a wrong default there does not throw, it makes records
 * disappear from views that filter on status. That is the failure this file
 * exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import {
  RECORD_STATUS,
  RELATIONSHIP_STATUS,
  STAGE,
  readRecordStatus,
  readRelationshipStatus,
  readStage,
  readStatusTriple,
  isActiveRecord,
  createStatusFields,
} from '../constants/statusModel';

describe('createStatusFields', () => {
  it('writes all three dimensions explicitly', () => {
    expect(createStatusFields()).toEqual({
      record_status: 'active',
      relationship_status: 'new',
      stage: 'scout',
      is_archived: false,
    });
  });

  it('emits is_archived alongside — the legacy field eight readers filter on', () => {
    expect(createStatusFields({ recordStatus: RECORD_STATUS.ARCHIVED }).is_archived).toBe(true);
    expect(createStatusFields({ recordStatus: RECORD_STATUS.SUGGESTED }).is_archived).toBe(false);
  });

  it('can omit the legacy field when a caller genuinely does not want it', () => {
    expect(createStatusFields({ withLegacy: false })).not.toHaveProperty('is_archived');
  });

  it('throws on a value nothing queries for, rather than writing it', () => {
    // Same reasoning as createCompanyRecord rejecting status 'active': a
    // document written with an unknown value is invisible to every reader,
    // and invisible is far more expensive to diagnose than a thrown error.
    expect(() => createStatusFields({ recordStatus: 'pending' })).toThrow(/unknown record_status/);
    expect(() => createStatusFields({ relationshipStatus: 'Engaged' })).toThrow(/unknown relationship_status/);
    expect(() => createStatusFields({ stage: 'prospecting' })).toThrow(/unknown stage/);
  });

  it('keeps the three dimensions independent', () => {
    // An archived record can have been a customer, in Basecamp. No single
    // state machine could express that without enumerating a cross product.
    expect(createStatusFields({
      recordStatus: RECORD_STATUS.ARCHIVED,
      relationshipStatus: RELATIONSHIP_STATUS.CUSTOMER,
      stage: STAGE.BASECAMP,
    })).toMatchObject({
      record_status: 'archived',
      relationship_status: 'customer',
      stage: 'basecamp',
    });
  });
});

describe('readRecordStatus — compatibility', () => {
  it('prefers the new field', () => {
    expect(readRecordStatus({ record_status: 'rejected', status: 'active' })).toBe('rejected');
  });

  it('treats is_archived: true as decisive', () => {
    expect(readRecordStatus({ is_archived: true, status: 'active' })).toBe('archived');
  });

  it('maps the legacy status vocabulary', () => {
    expect(readRecordStatus({ status: 'suggested' })).toBe('suggested');
    expect(readRecordStatus({ status: 'saved' })).toBe('active');
    expect(readRecordStatus({ status: 'people_mode_archived' })).toBe('archived');
    expect(readRecordStatus({ status: 'rejected' })).toBe('rejected');
  });

  it('defaults an enrichment-lifecycle status to active, not to nothing', () => {
    // 'pending_enrichment' says nothing about whether the record counts.
    expect(readRecordStatus({ status: 'pending_enrichment' })).toBe('active');
  });

  it('defaults a record with NO status field to active', () => {
    // The load-bearing default. Historical contacts have no archival signal at
    // all; treating them as 'suggested' would hide thousands of records from
    // every active view — the exact disappearance the missing is_archived
    // field already caused once.
    expect(readRecordStatus({})).toBe('active');
    expect(readRecordStatus(null)).toBe('active');
  });
});

describe('readRelationshipStatus — compatibility', () => {
  it('prefers the new field', () => {
    expect(readRelationshipStatus({ relationship_status: 'dormant', contact_status: 'New' }))
      .toBe('dormant');
  });

  it('maps the contact_status state machine', () => {
    expect(readRelationshipStatus({ contact_status: 'New' })).toBe('new');
    expect(readRelationshipStatus({ contact_status: 'Awaiting Reply' })).toBe('awaiting_reply');
    expect(readRelationshipStatus({ contact_status: 'In Conversation' })).toBe('in_conversation');
    expect(readRelationshipStatus({ contact_status: 'Active Customer' })).toBe('customer');
  });

  it('maps the deprecated campaign and mission states to awaiting_reply', () => {
    // All three mean "we reached out and are waiting". None mean 'engaged',
    // which now means the user opened the engage module without sending.
    expect(readRelationshipStatus({ contact_status: 'In Campaign' })).toBe('awaiting_reply');
    expect(readRelationshipStatus({ contact_status: 'Active Mission' })).toBe('awaiting_reply');
    expect(readRelationshipStatus({ contact_status: 'Mission Complete' })).toBe('awaiting_reply');
  });

  it('falls back to person_type when no status was ever written', () => {
    expect(readRelationshipStatus({ person_type: 'customer' })).toBe('customer');
    expect(readRelationshipStatus({ person_type: 'past_customer' })).toBe('dormant');
  });

  it('defaults to new', () => {
    expect(readRelationshipStatus({})).toBe('new');
    expect(readRelationshipStatus(null)).toBe('new');
  });
});

describe('readStage — compatibility', () => {
  it('passes a valid stage through', () => {
    expect(readStage({ stage: 'sniper' })).toBe('sniper');
  });

  it('rejects a stage outside the vocabulary and falls back', () => {
    expect(readStage({ stage: 'prospecting' })).toBe('scout');
  });

  it('derives from person_type when stage was never set', () => {
    expect(readStage({ person_type: 'customer' })).toBe('basecamp');
    expect(readStage({ person_type: 'past_customer' })).toBe('fallback');
  });

  it('defaults to scout — the entry point of the pipeline', () => {
    expect(readStage({})).toBe('scout');
  });
});

describe('the three dimensions read together', () => {
  it('resolves a fully historical record', () => {
    // What almost every record in production looks like today.
    expect(readStatusTriple({
      status: 'suggested',
      contact_status: 'Awaiting Reply',
      person_type: 'lead',
    })).toEqual({
      record_status: 'suggested',
      relationship_status: 'awaiting_reply',
      stage: 'scout',
    });
  });

  it('resolves a record with no status fields whatsoever', () => {
    expect(readStatusTriple({ name: 'Someone' })).toEqual({
      record_status: 'active',
      relationship_status: 'new',
      stage: 'scout',
    });
  });

  it('does not let one dimension contradict another into invisibility', () => {
    // The contradiction the audit flagged: status 'suggested' with
    // contact_status 'Engaged'. Both are now true of different things.
    const contact = { status: 'suggested', contact_status: 'Engaged' };
    expect(readRecordStatus(contact)).toBe('suggested');
    expect(readRelationshipStatus(contact)).toBe('engaged');
    expect(isActiveRecord(contact)).toBe(true);
  });
});

describe('isActiveRecord', () => {
  it('counts active and suggested, excludes archived and rejected', () => {
    expect(isActiveRecord({ record_status: 'active' })).toBe(true);
    expect(isActiveRecord({ record_status: 'suggested' })).toBe(true);
    expect(isActiveRecord({ record_status: 'archived' })).toBe(false);
    expect(isActiveRecord({ record_status: 'rejected' })).toBe(false);
    expect(isActiveRecord({ is_archived: true })).toBe(false);
  });
});
