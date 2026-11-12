/**
 * sendShouldMarkAwaitingReply — the send-side half of the forward-only
 * relationship-state rule. Pure function, no mocks needed: this is the
 * one place the four outbound send paths (gmail-send-quick.js,
 * gmail-send-wave.js, process-scheduled-engagements.js's single-send and
 * wave paths) decide whether a confirmed Gmail send may mark a contact
 * newly awaiting reply.
 */
import { describe, it, expect } from 'vitest';
import { sendShouldMarkAwaitingReply } from '../utils/relationshipRead.js';

describe('sendShouldMarkAwaitingReply', () => {
  it('a brand-new contact (no hunter_status/contact_status at all) should be marked', () => {
    expect(sendShouldMarkAwaitingReply({})).toBe(true);
    expect(sendShouldMarkAwaitingReply(null)).toBe(true);
  });

  it('a contact at New or Engaged should be marked — a first/early send legitimately starts the waiting clock', () => {
    expect(sendShouldMarkAwaitingReply({ contact_status: 'New' })).toBe(true);
    expect(sendShouldMarkAwaitingReply({ contact_status: 'Engaged' })).toBe(true);
  });

  it('a contact already at Awaiting Reply should still be marked — a genuine resend legitimately resets the clock', () => {
    expect(sendShouldMarkAwaitingReply({ contact_status: 'Awaiting Reply', hunter_status: 'awaiting_reply' })).toBe(true);
  });

  it('a contact already In Conversation (by contact_status) must NOT be marked', () => {
    expect(sendShouldMarkAwaitingReply({ contact_status: 'In Conversation' })).toBe(false);
  });

  it('a contact already in_conversation by hunter_status alone (contact_status not yet synced) must NOT be marked — isInConversation ORs both signals', () => {
    expect(sendShouldMarkAwaitingReply({ hunter_status: 'in_conversation', contact_status: 'Awaiting Reply' })).toBe(false);
  });

  it('a contact in_conversation by the canonical relationship.state alone must NOT be marked', () => {
    expect(sendShouldMarkAwaitingReply({ relationship: { state: 'in_conversation' } })).toBe(false);
  });

  it.each(['Active Customer', 'Past Customer', 'Partner', 'Network', 'Mission Complete'])(
    'a contact holding the advanced relationship status %s must NOT be marked, even if hunter_status is stale',
    (status) => {
      expect(sendShouldMarkAwaitingReply({ contact_status: status, hunter_status: 'awaiting_reply' })).toBe(false);
    }
  );
});
