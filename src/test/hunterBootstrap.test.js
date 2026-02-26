/**
 * HUNTER BOOTSTRAP — QA Unit Tests
 *
 * Tests the conservative seeding logic that runs on first Hunter load.
 * This is one of the two highest-risk items in Sprint 1:
 * wrong seeds here corrupts Barry's recommendations platform-wide.
 *
 * Core rule: when in doubt, seed 'unaware' not 'warm'.
 * Barry should underestimate a relationship and be corrected,
 * not assume warmth that isn't there and send the wrong message.
 */

import { describe, it, expect } from 'vitest';
import {
  inferRelationshipState,
  inferHunterStatus,
  getRelationshipStateForNewContact,
  getHunterStatusForNewContact
} from '../utils/hunterBootstrap';

// ── inferRelationshipState ───────────────────────────────────────────────────

describe('inferRelationshipState — conservative seeding', () => {

  // ── Empty / unknown contacts ──

  it('returns unaware for a contact with no fields at all', () => {
    expect(inferRelationshipState({})).toBe('unaware');
  });

  it('returns unaware for a brand new contact with no warmth or status', () => {
    expect(inferRelationshipState({ name: 'Jane Doe', contact_status: 'New' })).toBe('unaware');
  });

  it('returns unaware when warmth_level is cold', () => {
    expect(inferRelationshipState({ warmth_level: 'cold' })).toBe('unaware');
  });

  it('returns unaware when warmth_level is an unrecognized value', () => {
    expect(inferRelationshipState({ warmth_level: 'unknown_value' })).toBe('unaware');
  });

  // ── Conservative warmth_level mapping ──

  it('maps warm warmth_level to aware (not warm — conservative)', () => {
    // Key conservative rule: warmth 'warm' → state 'aware', NOT 'warm'
    // 'warm' state requires demonstrated trust, not just contact temperature
    expect(inferRelationshipState({ warmth_level: 'warm' })).toBe('aware');
  });

  it('maps hot warmth_level to warm (not trusted — conservative)', () => {
    // Key conservative rule: warmth 'hot' → state 'warm', NOT 'trusted'
    // 'trusted' requires proven value, not just engagement temperature
    expect(inferRelationshipState({ warmth_level: 'hot' })).toBe('warm');
  });

  // ── contact_status takes priority over warmth_level ──

  it('uses contact_status over warmth_level when both are present', () => {
    // contact_status 'Dormant' should win even if warmth_level says 'hot'
    expect(inferRelationshipState({
      contact_status: 'Dormant',
      warmth_level: 'hot'
    })).toBe('dormant');
  });

  // ── contact_status mappings ──

  it('maps Dormant contact_status to dormant', () => {
    expect(inferRelationshipState({ contact_status: 'Dormant' })).toBe('dormant');
  });

  it('maps In Conversation contact_status to engaged', () => {
    expect(inferRelationshipState({ contact_status: 'In Conversation' })).toBe('engaged');
  });

  it('maps Active Mission contact_status to warm', () => {
    // They were engaged enough to go on a mission — that implies some warmth
    expect(inferRelationshipState({ contact_status: 'Active Mission' })).toBe('warm');
  });

  it('maps Mission Complete contact_status to warm', () => {
    expect(inferRelationshipState({ contact_status: 'Mission Complete' })).toBe('warm');
  });

  it('maps Awaiting Reply contact_status to aware', () => {
    // We reached out — they know us — but no reply yet
    expect(inferRelationshipState({ contact_status: 'Awaiting Reply' })).toBe('aware');
  });

  it('maps Engaged contact_status to aware', () => {
    expect(inferRelationshipState({ contact_status: 'Engaged' })).toBe('aware');
  });

  it('maps In Campaign contact_status to aware', () => {
    expect(inferRelationshipState({ contact_status: 'In Campaign' })).toBe('aware');
  });

  // ── No accidental warm/trusted seeding ──

  it('never returns trusted from bootstrap (requires earned trust)', () => {
    const states = [
      { warmth_level: 'hot' },
      { contact_status: 'Active Mission' },
      { contact_status: 'Mission Complete' },
      { warmth_level: 'hot', contact_status: 'In Conversation' }
    ];
    states.forEach(contact => {
      expect(inferRelationshipState(contact)).not.toBe('trusted');
    });
  });

  it('never returns advocate from bootstrap (requires demonstrated advocacy)', () => {
    const states = [
      { warmth_level: 'hot' },
      { contact_status: 'Mission Complete' }
    ];
    states.forEach(contact => {
      expect(inferRelationshipState(contact)).not.toBe('advocate');
    });
  });

  // ── Null safety ──

  it('handles null contact_status gracefully', () => {
    expect(inferRelationshipState({ contact_status: null })).toBe('unaware');
  });

  it('handles null warmth_level gracefully', () => {
    expect(inferRelationshipState({ warmth_level: null })).toBe('unaware');
  });
});

// ── inferHunterStatus ────────────────────────────────────────────────────────

describe('inferHunterStatus — deck seeding', () => {

  it('returns deck for a contact with no status', () => {
    expect(inferHunterStatus({})).toBe('deck');
  });

  it('returns deck for a new contact', () => {
    expect(inferHunterStatus({ contact_status: 'New' })).toBe('deck');
  });

  it('returns active_mission for a contact with Active Mission status', () => {
    expect(inferHunterStatus({ contact_status: 'Active Mission' })).toBe('active_mission');
  });

  it('returns deck for a dormant contact (goes back into deck for reconnect)', () => {
    expect(inferHunterStatus({ contact_status: 'Dormant' })).toBe('deck');
  });

  it('returns deck for engaged, awaiting_reply, in_campaign contacts', () => {
    ['Engaged', 'Awaiting Reply', 'In Campaign', 'In Conversation'].forEach(status => {
      expect(inferHunterStatus({ contact_status: status })).toBe('deck');
    });
  });

  it('never returns engaged_pending from bootstrap (that is a runtime transient state)', () => {
    [
      {},
      { contact_status: 'Active Mission' },
      { warmth_level: 'hot' }
    ].forEach(contact => {
      expect(inferHunterStatus(contact)).not.toBe('engaged_pending');
    });
  });

  it('never returns archived from bootstrap (archive is a user action)', () => {
    [
      {},
      { contact_status: 'Dormant' }
    ].forEach(contact => {
      expect(inferHunterStatus(contact)).not.toBe('archived');
    });
  });
});

// ── getRelationshipStateForNewContact ────────────────────────────────────────

describe('getRelationshipStateForNewContact — new contact default', () => {

  it('returns unaware for a clean new contact with no context', () => {
    expect(getRelationshipStateForNewContact({})).toBe('unaware');
  });

  it('returns aware when warmth_level is warm', () => {
    expect(getRelationshipStateForNewContact({ warmth_level: 'warm' })).toBe('aware');
  });

  it('returns warm when warmth_level is hot', () => {
    expect(getRelationshipStateForNewContact({ warmth_level: 'hot' })).toBe('warm');
  });

  it('returns warm when relationship_type is partner', () => {
    expect(getRelationshipStateForNewContact({ relationship_type: 'partner' })).toBe('warm');
  });

  it('returns aware when relationship_type is known', () => {
    expect(getRelationshipStateForNewContact({ relationship_type: 'known' })).toBe('aware');
  });

  it('returns unaware for an unrecognized relationship_type', () => {
    expect(getRelationshipStateForNewContact({ relationship_type: 'prospect' })).toBe('unaware');
  });
});

// ── getHunterStatusForNewContact ─────────────────────────────────────────────

describe('getHunterStatusForNewContact', () => {
  it('always returns deck for new contacts from Scout', () => {
    expect(getHunterStatusForNewContact()).toBe('deck');
  });
});
