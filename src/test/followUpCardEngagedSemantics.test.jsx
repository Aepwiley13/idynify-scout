/**
 * FollowUpCard's "Mark as Done" used to force contact_status to 'Engaged'
 * via a raw, ungated write — bypassing the state machine's own priority
 * check entirely. Dismissing a reminder is task management, not a
 * confirmed interaction: it closes the follow-up and nothing else.
 *
 * Real RTL mount — this component is small enough to mount cleanly, unlike
 * its heavier siblings (InlineEngagementSection, HunterContactDrawer,
 * PersistentEngageBar), whose own tests use a source-contract check instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const updateDocCalls = [];
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  updateDoc: vi.fn((ref, data) => { updateDocCalls.push({ path: ref.path, data }); return Promise.resolve(); }),
  Timestamp: { now: () => ({ __now: true }), fromMillis: (ms) => ({ __ms: ms }) },
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: {} }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1' }),
}));
vi.mock('../components/shared/EmailDraftCard', () => ({ EmailDraftCard: () => null }));

const { default: FollowUpCard } = await import('../components/hunter/FollowUpCard.jsx');
const { updateDoc } = await import('firebase/firestore');

const NOTIFICATION = {
  id: 'notif1', contactId: 'c1', contactName: 'Dana Whitfield', companyName: 'Acme',
  reason: 'no_reply', createdAt: { toMillis: () => Date.now() - 5 * 86400000 },
};

beforeEach(() => {
  updateDocCalls.length = 0;
  updateDoc.mockClear();
});

describe('FollowUpCard "Mark as Done": closes the task, never advances relationship status', () => {
  it('resolves the notification but writes nothing to the contact document at all', async () => {
    render(<FollowUpCard notification={NOTIFICATION} userId="u1" onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Done' }));

    await waitFor(() => expect(updateDocCalls.length).toBeGreaterThan(0));

    const notifWrite = updateDocCalls.find((c) => c.path === 'users/u1/notifications/notif1');
    expect(notifWrite).toBeTruthy();
    expect(notifWrite.data.read).toBe(true);

    const contactWrite = updateDocCalls.find((c) => c.path === 'users/u1/contacts/c1');
    expect(contactWrite).toBeUndefined(); // the whole point: no contact-doc write at all
  });

  it('calls onDismiss so the card leaves the list, independent of the (now-absent) status write', async () => {
    const onDismiss = vi.fn();
    render(<FollowUpCard notification={NOTIFICATION} userId="u1" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Done' }));
    expect(onDismiss).toHaveBeenCalledWith('notif1');
  });
});
