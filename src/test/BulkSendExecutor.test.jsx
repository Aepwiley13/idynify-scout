/**
 * BULK SEND EXECUTOR (Phase 1 Workstream C) — Unit Tests
 *
 * Covers the Workstream C QA checklist with executeSendAction mocked:
 *   - sequential sends with per-contact status transitions
 *   - mandatory 1500ms delay between sends (never simultaneous)
 *   - SENT / OPENED / FAILED / UNAVAILABLE / unknown result handling
 *   - loop never aborts early — a failure/throw continues to the next contact
 *   - completion summary with failed contacts and reasons
 *   - "Retry failed" re-runs only the failed contacts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const mockExecuteSendAction = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/sendActionResolver', () => ({
  executeSendAction: mockExecuteSendAction,
  CHANNELS: { EMAIL: 'email' },
  SEND_RESULT: {
    SENT: 'sent', OPENED: 'opened', PREPARED: 'prepared',
    FAILED: 'failed', UNAVAILABLE: 'unavailable',
  },
}));

vi.mock('../../src/context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'user-1' }),
}));

vi.mock('../../src/theme/ThemeContext', () => ({
  useT: () => ({
    cardBg: '#101', surface: '#202', border: '#303',
    text: '#fee', textMuted: '#abc', textFaint: '#889',
  }),
}));

import BulkSendExecutor, { SEND_DELAY_MS } from '../components/scout/BulkSendExecutor';

const T = {
  cardBg: '#111', surface: '#222', border: '#333',
  text: '#fff', textMuted: '#aaa', textFaint: '#888',
};

function makeItem(i) {
  return {
    contact: { id: `c${i}`, firstName: `Name${i}`, lastName: 'Test', email: `c${i}@x.com` },
    subject: 'Subject',
    body: `Body for c${i}`,
  };
}

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function advance(ms) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockExecuteSendAction.mockReset();
  mockExecuteSendAction.mockResolvedValue({ result: 'sent' });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BulkSendExecutor send loop', () => {
  it('sends sequentially with a 1500ms delay between sends', async () => {
    render(<BulkSendExecutor payload={[makeItem(1), makeItem(2), makeItem(3)]} T={T} />);

    await flush();
    // First send fires immediately; the rest wait on the delay
    expect(mockExecuteSendAction).toHaveBeenCalledTimes(1);

    await advance(SEND_DELAY_MS - 1);
    expect(mockExecuteSendAction).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(mockExecuteSendAction).toHaveBeenCalledTimes(2);

    await advance(SEND_DELAY_MS);
    expect(mockExecuteSendAction).toHaveBeenCalledTimes(3);

    // Sequential order, all through the unified pipeline
    expect(mockExecuteSendAction.mock.calls.map(([args]) => args.contact.id)).toEqual(['c1', 'c2', 'c3']);
    expect(mockExecuteSendAction.mock.calls.every(([args]) =>
      args.channel === 'email' && args.userId === 'user-1'
    )).toBe(true);

    expect(screen.getByText('3 sent, 0 failed')).toBeInTheDocument();
  });

  it('shows "do not close this tab" while sending and a summary when done', async () => {
    render(<BulkSendExecutor payload={[makeItem(1), makeItem(2)]} T={T} />);
    await flush();
    expect(screen.getByText('Sending — do not close this tab')).toBeInTheDocument();

    await advance(SEND_DELAY_MS);
    expect(screen.queryByText('Sending — do not close this tab')).not.toBeInTheDocument();
    expect(screen.getByText('2 sent, 0 failed')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 sent')).toBeInTheDocument();
  });

  it('maps OPENED to a non-failure "Opened in mail app" status', async () => {
    mockExecuteSendAction.mockResolvedValue({ result: 'opened' });
    render(<BulkSendExecutor payload={[makeItem(1)]} T={T} />);
    await flush();

    expect(screen.getByText('Opened in mail app')).toBeInTheDocument();
    expect(screen.getByText('1 sent, 0 failed')).toBeInTheDocument();
  });

  it('maps UNAVAILABLE to failed with "No email address on file"', async () => {
    mockExecuteSendAction.mockResolvedValue({ result: 'unavailable', reason: 'No email address' });
    render(<BulkSendExecutor payload={[makeItem(1)]} T={T} />);
    await flush();

    expect(screen.getAllByText('No email address on file').length).toBeGreaterThan(0);
    expect(screen.getByText('0 sent, 1 failed')).toBeInTheDocument();
  });

  it('marks unknown results as failed and continues', async () => {
    mockExecuteSendAction
      .mockResolvedValueOnce({ result: 'prepared' })
      .mockResolvedValueOnce({ result: 'sent' });
    render(<BulkSendExecutor payload={[makeItem(1), makeItem(2)]} T={T} />);
    await flush();
    await advance(SEND_DELAY_MS);

    expect(mockExecuteSendAction).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1 sent, 1 failed')).toBeInTheDocument();
  });

  it('never aborts the loop — a FAILED result and a thrown error both continue', async () => {
    mockExecuteSendAction
      .mockResolvedValueOnce({ result: 'failed', error: 'Gmail token expired' })
      .mockRejectedValueOnce(new Error('Network exploded'))
      .mockResolvedValueOnce({ result: 'sent' });

    render(<BulkSendExecutor payload={[makeItem(1), makeItem(2), makeItem(3)]} T={T} />);
    await flush();
    await advance(SEND_DELAY_MS * 2);

    expect(mockExecuteSendAction).toHaveBeenCalledTimes(3);
    expect(screen.getByText('1 sent, 2 failed')).toBeInTheDocument();
    expect(screen.getAllByText(/Gmail token expired/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Network exploded/).length).toBeGreaterThan(0);
  });

  it('"Retry failed" re-runs only the failed contacts', async () => {
    mockExecuteSendAction
      .mockResolvedValueOnce({ result: 'sent' })                                  // c1
      .mockResolvedValueOnce({ result: 'failed', error: 'Temporary error' })      // c2
      .mockResolvedValueOnce({ result: 'sent' })                                  // c3
      .mockResolvedValue({ result: 'sent' });                                     // retry of c2

    render(<BulkSendExecutor payload={[makeItem(1), makeItem(2), makeItem(3)]} T={T} />);
    await flush();
    await advance(SEND_DELAY_MS * 2);
    expect(screen.getByText('2 sent, 1 failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retry failed \(1\)/ }));
    await flush();

    // Only c2 was retried
    expect(mockExecuteSendAction).toHaveBeenCalledTimes(4);
    expect(mockExecuteSendAction.mock.calls[3][0].contact.id).toBe('c2');
    expect(screen.getByText('3 sent, 0 failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry failed/ })).not.toBeInTheDocument();
  });

  it('passes per-item attachment and cc through to executeSendAction (Phase 1.5)', async () => {
    const attachment = { data: 'QUJD', filename: 'guide.pdf', mimeType: 'application/pdf' };
    const items = [
      { ...makeItem(1), attachment, cc: 'boss@x.com' },
      makeItem(2), // no attachment/cc — Phase 1 shape
    ];
    render(<BulkSendExecutor payload={items} T={T} />);
    await flush();
    await advance(SEND_DELAY_MS);

    const [first] = mockExecuteSendAction.mock.calls[0];
    expect(first.attachment).toEqual(attachment);
    expect(first.cc).toBe('boss@x.com');

    const [second] = mockExecuteSendAction.mock.calls[1];
    expect('attachment' in second).toBe(false);
    expect('cc' in second).toBe(false);
  });

  it('falls back to the theme context when no T prop is passed', async () => {
    render(<BulkSendExecutor payload={[makeItem(1)]} />);
    await flush();
    expect(screen.getByText('1 sent, 0 failed')).toBeInTheDocument();
  });

  it('renders an empty state when payload is empty', () => {
    render(<BulkSendExecutor payload={[]} T={T} />);
    expect(screen.getByText('No contacts to send to.')).toBeInTheDocument();
    expect(mockExecuteSendAction).not.toHaveBeenCalled();
  });
});
