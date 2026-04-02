/**
 * COMMAND CENTER — Unit Tests
 *
 * Covers the remaining Command Center logic that is testable without
 * full component rendering:
 *
 * 1. scoutNavConfig — shared nav constant correctness and consistency
 * 2. Bulk brigade allSettled — partial failure detection pattern
 * 3. addToMission email guard — contact email validation logic
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SCOUT_TAB_TO_ITEM,
  SCOUT_ITEM_TO_TAB,
  SCOUT_DRAWER_NAV_ITEMS,
} from '../constants/scoutNavConfig';

// ── 1. Scout Nav Config ───────────────────────────────────────────────────────

describe('scoutNavConfig', () => {

  describe('SCOUT_DRAWER_NAV_ITEMS', () => {
    it('exports exactly 4 drawer items', () => {
      expect(SCOUT_DRAWER_NAV_ITEMS).toHaveLength(4);
    });

    it('every drawer item has a label and tab', () => {
      SCOUT_DRAWER_NAV_ITEMS.forEach(item => {
        expect(item).toHaveProperty('label');
        expect(item).toHaveProperty('tab');
        expect(typeof item.label).toBe('string');
        expect(typeof item.tab).toBe('string');
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.tab.length).toBeGreaterThan(0);
      });
    });

    it('all drawer tab values are valid keys in SCOUT_TAB_TO_ITEM', () => {
      SCOUT_DRAWER_NAV_ITEMS.forEach(item => {
        expect(SCOUT_TAB_TO_ITEM).toHaveProperty(item.tab);
      });
    });
  });

  describe('SCOUT_TAB_TO_ITEM', () => {
    it('maps all expected tab params', () => {
      const expectedTabs = ['daily-leads', 'saved-companies', 'all-leads', 'icp-settings', 'scout-plus', 'company-search'];
      expectedTabs.forEach(tab => {
        expect(SCOUT_TAB_TO_ITEM).toHaveProperty(tab);
        expect(typeof SCOUT_TAB_TO_ITEM[tab]).toBe('string');
      });
    });

    it('both scout-plus and company-search resolve to scoutplus', () => {
      expect(SCOUT_TAB_TO_ITEM['scout-plus']).toBe('scoutplus');
      expect(SCOUT_TAB_TO_ITEM['company-search']).toBe('scoutplus');
    });
  });

  describe('SCOUT_ITEM_TO_TAB', () => {
    it('maps all expected internal IDs', () => {
      const expectedIds = ['daily', 'saved', 'all', 'icpsettings', 'scoutplus'];
      expectedIds.forEach(id => {
        expect(SCOUT_ITEM_TO_TAB).toHaveProperty(id);
        expect(typeof SCOUT_ITEM_TO_TAB[id]).toBe('string');
      });
    });

    it('scoutplus canonical tab is scout-plus (not company-search)', () => {
      // Guards against accidentally deriving this map from TAB_TO_ITEM via
      // Object.fromEntries, which would produce 'company-search' as the winner.
      expect(SCOUT_ITEM_TO_TAB['scoutplus']).toBe('scout-plus');
    });

    it('round-trips correctly for non-aliased tabs', () => {
      // For tabs without aliases, TAB_TO_ITEM → ITEM_TO_TAB should round-trip.
      ['daily-leads', 'saved-companies', 'all-leads', 'icp-settings'].forEach(tab => {
        const itemId = SCOUT_TAB_TO_ITEM[tab];
        const canonical = SCOUT_ITEM_TO_TAB[itemId];
        expect(canonical).toBe(tab);
      });
    });
  });
});

// ── 2. Bulk Brigade Partial Failure Detection ─────────────────────────────────

/**
 * Replicates the Promise.allSettled pattern from handleBulkBrigadeAssign
 * in AllLeads.jsx. Tests that partial failure reporting works correctly.
 */
async function runBulkBrigadeAssign(contactIds, onBrigadeChange) {
  const results = await Promise.allSettled(
    contactIds.map(id => onBrigadeChange({ contactId: id }))
  );
  const failed = results.filter(r => r.status === 'rejected');
  return { total: contactIds.length, failed: failed.length };
}

describe('bulk brigade allSettled pattern', () => {
  it('reports 0 failures when all updates succeed', async () => {
    const onBrigadeChange = vi.fn().mockResolvedValue('ok');
    const result = await runBulkBrigadeAssign(['c1', 'c2', 'c3'], onBrigadeChange);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(3);
  });

  it('reports all failures when every update fails', async () => {
    const onBrigadeChange = vi.fn().mockRejectedValue(new Error('network'));
    const result = await runBulkBrigadeAssign(['c1', 'c2', 'c3'], onBrigadeChange);
    expect(result.failed).toBe(3);
  });

  it('reports partial failure count accurately', async () => {
    let callCount = 0;
    const onBrigadeChange = vi.fn().mockImplementation(() => {
      callCount++;
      // Fail on calls 2 and 3
      return callCount >= 2
        ? Promise.reject(new Error('firestore error'))
        : Promise.resolve('ok');
    });
    const result = await runBulkBrigadeAssign(['c1', 'c2', 'c3'], onBrigadeChange);
    expect(result.failed).toBe(2);
    expect(result.total).toBe(3);
  });

  it('does not throw when some updates fail (does not use Promise.all)', async () => {
    const onBrigadeChange = vi.fn().mockRejectedValue(new Error('error'));
    // With Promise.allSettled this should resolve, not reject
    await expect(
      runBulkBrigadeAssign(['c1', 'c2'], onBrigadeChange)
    ).resolves.toBeDefined();
  });
});

// ── 3. addToMission Email Guard ───────────────────────────────────────────────

/**
 * Replicates the email validation guard from addToMission in GoToWar.jsx.
 * Tests that contacts without email are rejected before being added.
 */
function validateContactForMission(contact) {
  if (!contact.email) {
    return { ok: false, reason: 'no_email' };
  }
  return { ok: true };
}

function addToMission(missionContacts, contact) {
  if (missionContacts.find(c => c.contactId === contact.id)) {
    return { contacts: missionContacts, blocked: 'duplicate' };
  }
  const validation = validateContactForMission(contact);
  if (!validation.ok) {
    return { contacts: missionContacts, blocked: validation.reason };
  }
  return {
    contacts: [...missionContacts, { contactId: contact.id, email: contact.email, name: contact.name }],
    blocked: null,
  };
}

describe('addToMission email guard', () => {
  it('adds a contact with a valid email', () => {
    const result = addToMission([], { id: 'c1', email: 'alice@example.com', name: 'Alice' });
    expect(result.blocked).toBeNull();
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].contactId).toBe('c1');
  });

  it('blocks a contact with no email', () => {
    const result = addToMission([], { id: 'c1', email: null, name: 'Bob' });
    expect(result.blocked).toBe('no_email');
    expect(result.contacts).toHaveLength(0);
  });

  it('blocks a contact with undefined email', () => {
    const result = addToMission([], { id: 'c1', name: 'Carol' });
    expect(result.blocked).toBe('no_email');
    expect(result.contacts).toHaveLength(0);
  });

  it('blocks a contact with empty string email', () => {
    const result = addToMission([], { id: 'c1', email: '', name: 'Dave' });
    expect(result.blocked).toBe('no_email');
    expect(result.contacts).toHaveLength(0);
  });

  it('does not add duplicate contacts', () => {
    const existing = [{ contactId: 'c1', email: 'alice@example.com', name: 'Alice' }];
    const result = addToMission(existing, { id: 'c1', email: 'alice@example.com', name: 'Alice' });
    expect(result.blocked).toBe('duplicate');
    expect(result.contacts).toHaveLength(1);
  });

  it('allows adding a second distinct contact', () => {
    const existing = [{ contactId: 'c1', email: 'alice@example.com', name: 'Alice' }];
    const result = addToMission(existing, { id: 'c2', email: 'bob@example.com', name: 'Bob' });
    expect(result.blocked).toBeNull();
    expect(result.contacts).toHaveLength(2);
  });
});
