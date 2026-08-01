/**
 * usePendingReplies — Sprint 3 Team Alpha
 *
 * Covers the selection and ordering rules that decide which draft a user sees,
 * and the snooze semantics that keep a snoozed reply out of the morning-brief
 * roll-up while leaving it available in the contact drawer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getDocs = vi.fn();
const getDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args) => ({ __path: args.slice(1).join('/') }),
  query: (ref) => ref,
  where: (...args) => ({ __where: args }),
  doc: (...args) => ({ __path: args.slice(1).join('/') }),
  getDocs: (...args) => getDocs(...args),
  getDoc: (...args) => getDoc(...args),
}));
vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'user_1' }),
}));

import {
  pickPendingDraft,
  sortByUrgency,
  toMillis,
  fetchPendingDraftForContact,
  DRAFT_APPROVAL,
  OPEN_APPROVAL_STATUSES,
} from '../hooks/usePendingReplies';

const ts = (seconds) => ({ seconds });

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('toMillis', () => {
  it('reads a Firestore Timestamp via toMillis()', () => {
    expect(toMillis({ toMillis: () => 1500 })).toBe(1500);
  });

  it('falls back to seconds', () => {
    expect(toMillis(ts(3))).toBe(3000);
  });

  it('parses ISO strings', () => {
    expect(toMillis('2026-08-01T00:00:00.000Z')).toBe(Date.parse('2026-08-01T00:00:00.000Z'));
  });

  it('returns 0 for missing or unparseable values', () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis('not a date')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('pickPendingDraft', () => {
  const awaiting = { id: 'a', approvalStatus: 'awaiting_user', createdAt: ts(100) };
  const newerAwaiting = { id: 'b', approvalStatus: 'awaiting_user', createdAt: ts(200) };
  const snoozed = { id: 'c', approvalStatus: 'snoozed', createdAt: ts(300) };
  const sent = { id: 'd', approvalStatus: 'sent', createdAt: ts(400) };
  const dismissed = { id: 'e', approvalStatus: 'dismissed', createdAt: ts(500) };

  it('takes the most recent draft still awaiting the user', () => {
    expect(pickPendingDraft([awaiting, newerAwaiting])?.id).toBe('b');
  });

  it('ignores sent and dismissed drafts', () => {
    expect(pickPendingDraft([sent, dismissed])).toBeNull();
  });

  it('excludes snoozed drafts by default — the roll-up should not count them', () => {
    expect(pickPendingDraft([snoozed])).toBeNull();
  });

  it('includes snoozed drafts when asked — the drawer still shows them', () => {
    expect(pickPendingDraft([snoozed], OPEN_APPROVAL_STATUSES)?.id).toBe('c');
  });

  it('returns null for an empty or missing list', () => {
    expect(pickPendingDraft([])).toBeNull();
    expect(pickPendingDraft(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sortByUrgency', () => {
  it('orders high → medium → low', () => {
    const input = [
      { analysis: { urgency: 'low' }, draft: { createdAt: ts(1) } },
      { analysis: { urgency: 'high' }, draft: { createdAt: ts(1) } },
      { analysis: { urgency: 'medium' }, draft: { createdAt: ts(1) } },
    ];
    expect(sortByUrgency(input).map((r) => r.analysis.urgency)).toEqual([
      'high', 'medium', 'low',
    ]);
  });

  it('treats a missing analysis as medium rather than dropping it', () => {
    const input = [
      { analysis: null, draft: { createdAt: ts(1) } },
      { analysis: { urgency: 'low' }, draft: { createdAt: ts(1) } },
      { analysis: { urgency: 'high' }, draft: { createdAt: ts(1) } },
    ];
    const order = sortByUrgency(input).map((r) => r.analysis?.urgency ?? 'none');
    expect(order).toEqual(['high', 'none', 'low']);
  });

  it('breaks ties by newest draft first', () => {
    const input = [
      { analysis: { urgency: 'high' }, draft: { id: 'old', createdAt: ts(10) } },
      { analysis: { urgency: 'high' }, draft: { id: 'new', createdAt: ts(20) } },
    ];
    expect(sortByUrgency(input).map((r) => r.draft.id)).toEqual(['new', 'old']);
  });

  it('does not mutate its input', () => {
    const input = [
      { analysis: { urgency: 'low' }, draft: {} },
      { analysis: { urgency: 'high' }, draft: {} },
    ];
    const copy = [...input];
    sortByUrgency(input);
    expect(input).toEqual(copy);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('fetchPendingDraftForContact', () => {
  const snapOf = (docs) => ({
    empty: docs.length === 0,
    docs: docs.map((d) => ({ id: d.id, data: () => d })),
  });

  it('pairs the draft with the analysis keyed by messageRecordId', async () => {
    getDocs.mockResolvedValue(
      snapOf([{ id: 'rec_1', messageRecordId: 'rec_1', approvalStatus: 'awaiting_user', createdAt: ts(1) }])
    );
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ urgency: 'high' }) });

    const result = await fetchPendingDraftForContact('user_1', 'contact_1');

    expect(result.draft.id).toBe('rec_1');
    expect(result.analysis).toEqual({ urgency: 'high' });
    expect(getDoc.mock.calls[0][0].__path).toContain('barry_analysis/rec_1');
  });

  it('returns the draft with a null analysis when the analysis is missing', async () => {
    getDocs.mockResolvedValue(
      snapOf([{ id: 'rec_1', messageRecordId: 'rec_1', approvalStatus: 'awaiting_user', createdAt: ts(1) }])
    );
    getDoc.mockResolvedValue({ exists: () => false });

    const result = await fetchPendingDraftForContact('user_1', 'contact_1');
    expect(result.draft.id).toBe('rec_1');
    expect(result.analysis).toBeNull();
  });

  it('still returns the draft when the analysis read throws', async () => {
    getDocs.mockResolvedValue(
      snapOf([{ id: 'rec_1', messageRecordId: 'rec_1', approvalStatus: 'awaiting_user', createdAt: ts(1) }])
    );
    getDoc.mockRejectedValue(new Error('permission denied'));

    const result = await fetchPendingDraftForContact('user_1', 'contact_1');
    expect(result.draft.id).toBe('rec_1');
    expect(result.analysis).toBeNull();
  });

  it('includes a snoozed draft by default so the drawer still surfaces it', async () => {
    getDocs.mockResolvedValue(
      snapOf([{ id: 'rec_1', messageRecordId: 'rec_1', approvalStatus: DRAFT_APPROVAL.SNOOZED, createdAt: ts(1) }])
    );
    getDoc.mockResolvedValue({ exists: () => false });

    const result = await fetchPendingDraftForContact('user_1', 'contact_1');
    expect(result.draft.approvalStatus).toBe('snoozed');
  });

  it('excludes a snoozed draft when only awaiting_user is requested', async () => {
    getDocs.mockResolvedValue(
      snapOf([{ id: 'rec_1', messageRecordId: 'rec_1', approvalStatus: DRAFT_APPROVAL.SNOOZED, createdAt: ts(1) }])
    );
    await expect(
      fetchPendingDraftForContact('user_1', 'contact_1', { statuses: [DRAFT_APPROVAL.AWAITING] })
    ).resolves.toBeNull();
  });

  it('returns null when the contact has no drafts at all', async () => {
    getDocs.mockResolvedValue(snapOf([]));
    await expect(fetchPendingDraftForContact('user_1', 'contact_1')).resolves.toBeNull();
  });

  it('returns null without reading anything when ids are missing', async () => {
    await expect(fetchPendingDraftForContact(null, 'contact_1')).resolves.toBeNull();
    await expect(fetchPendingDraftForContact('user_1', null)).resolves.toBeNull();
    expect(getDocs).not.toHaveBeenCalled();
  });
});
