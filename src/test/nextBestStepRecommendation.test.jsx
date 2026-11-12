/**
 * NextBestStep's proposal logic used to gate "Accelerate" on
 * contact_status === 'replied' || 'engaged' — two literals the status
 * vocabulary (src/constants/contactStatuses.js) never produces, so that
 * branch could never fire. It also only ever looked at message_sent
 * events: an In Conversation contact who had already been followed up on
 * since their last reply still showed "Accelerate" (stale), and a contact
 * whose only inbound activity was unverified or automated could never be
 * distinguished from one who never replied at all.
 *
 * deriveContactNextBestStep lives in src/utils/deriveContactNextBestStep.js — pure, no
 * Firestore or React — so these tests exercise it directly rather than
 * mounting the full NextBestStep component (which owns Firestore listeners,
 * timeline writes and confirm/dismiss flows unrelated to this fix).
 */
import { describe, it, expect } from 'vitest';
import { deriveContactNextBestStep } from '../utils/deriveContactNextBestStep.js';
import { ADVANCED_RELATIONSHIP_STATUSES } from '../constants/contactStatuses.js';

function sentDaysAgo(days) {
  return { type: 'message_sent', timestamp: { toDate: () => new Date(Date.now() - days * 86_400_000) } };
}

describe('deriveContactNextBestStep: no proposal before any outreach, and none for advanced relationship statuses', () => {
  it('returns null when nothing has been sent yet — a different surface owns first touch', () => {
    expect(deriveContactNextBestStep({ contact_status: 'New' }, [])).toBeNull();
  });

  it.each([...ADVANCED_RELATIONSHIP_STATUSES])(
    'returns null for the advanced relationship status %s even with prior sends',
    (status) => {
      const contact = { contact_status: status, last_reply_at: new Date().toISOString() };
      expect(deriveContactNextBestStep(contact, [sentDaysAgo(1)])).toBeNull();
    }
  );
});

describe('deriveContactNextBestStep: "Accelerate" requires both the canonical in-conversation signal and that their reply is the most recent thing on the thread', () => {
  it('recommends Accelerate when a genuine reply is more recent than our last send', () => {
    const contact = {
      contact_status: 'In Conversation', hunter_status: 'in_conversation',
      last_reply_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    };
    const result = deriveContactNextBestStep(contact, [sentDaysAgo(5)]);
    expect(result?.type).toBe('accelerate');
  });

  it('recognizes the in-conversation signal via hunter_status alone', () => {
    const contact = {
      hunter_status: 'in_conversation',
      last_reply_at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    };
    const result = deriveContactNextBestStep(contact, [sentDaysAgo(5)]);
    expect(result?.type).toBe('accelerate');
  });

  it('does NOT recommend Accelerate when we have followed up again since their reply — falls through to normal follow-up timing', () => {
    const contact = {
      contact_status: 'In Conversation', hunter_status: 'in_conversation',
      last_reply_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    };
    const result = deriveContactNextBestStep(contact, [sentDaysAgo(4)]);
    expect(result?.type).toBe('follow_up');
  });

  it('does NOT recommend Accelerate for a contact with no canonical in-conversation signal at all, even with an old legacy reply-ish field unset', () => {
    const contact = { contact_status: 'Awaiting Reply', hunter_status: 'awaiting_reply' };
    const result = deriveContactNextBestStep(contact, [sentDaysAgo(4)]);
    expect(result?.type).toBe('follow_up');
    expect(result?.type).not.toBe('accelerate');
  });

  it('ignores an unverified or automated sender\'s activity: no last_reply_at means no Accelerate, even if some other message arrived', () => {
    // replyPolling.js never writes last_reply_at/last_replied_at or flips
    // hunter_status for category !== 'genuine' — an unverified or automated
    // message simply never produces the signal this function looks for.
    const contact = { contact_status: 'Awaiting Reply', hunter_status: 'awaiting_reply' };
    const result = deriveContactNextBestStep(contact, [sentDaysAgo(6)]);
    expect(result?.type).not.toBe('accelerate');
  });
});

describe('deriveContactNextBestStep: unchanged send-cadence behavior for contacts not in conversation', () => {
  it('still recommends a follow-up after a single stale send', () => {
    const result = deriveContactNextBestStep({ contact_status: 'Awaiting Reply' }, [sentDaysAgo(4)]);
    expect(result?.type).toBe('follow_up');
  });

  it('still recommends trying a new channel after repeated sends on one channel with no reply', () => {
    const events = [
      { type: 'message_sent', timestamp: { toDate: () => new Date(Date.now() - 6 * 86_400_000) }, metadata: { channel: 'email' } },
      { type: 'message_sent', timestamp: { toDate: () => new Date(Date.now() - 12 * 86_400_000) }, metadata: { channel: 'email' } },
    ];
    const result = deriveContactNextBestStep({ contact_status: 'Awaiting Reply' }, events);
    expect(result?.type).toBe('try_new_channel');
  });
});
