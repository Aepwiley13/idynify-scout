/**
 * BARRY REPLY CARD — Sprint 3 Team Alpha
 *
 * The card is the only path from "Barry drafted a reply" to "the prospect got
 * an email", so the tests concentrate on the rules that protect that path:
 *
 *   - Barry never sends without an explicit tap
 *   - the body that is sent is whatever is in the textarea, edits included
 *   - the card still renders when analysis is null
 *   - snooze and dismiss leave the contact in a consistent state
 *   - failures are visible and recoverable, never silent
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateDoc = vi.fn(async () => {});
const docFn = vi.fn((...args) => ({ path: args.slice(1).join('/') }));

vi.mock('firebase/firestore', () => ({
  doc: (...args) => docFn(...args),
  updateDoc: (...args) => updateDoc(...args),
  serverTimestamp: () => '__ts__',
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: {} }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'user_1', getIdToken: async () => 'token_abc' }),
}));

import BarryReplyCard, { visibleSignals, SOFT_BODY_LIMIT } from '../components/hunter/BarryReplyCard';

const contact = { id: 'contact_1', firstName: 'Jane', name: 'Jane Doe' };

const draft = {
  id: 'rec_1',
  messageRecordId: 'rec_1',
  bodyText: 'Thursday at 2pm works — I will send an invite.',
  recipientEmail: 'jane@acme.com',
  gmailThreadId: 'thr_1',
  approvalStatus: 'awaiting_user',
};

const analysis = {
  summary: 'Jane asked whether Thursday works and raised a pricing concern.',
  intent: 'scheduling',
  sentiment: 'positive',
  urgency: 'high',
  questionsAsked: ['Does Thursday at 2 work for you?'],
  objections: ['The annual plan feels expensive.'],
  positiveSignals: ['Wants to bring their VP to the call.'],
  recommendedActionReason: 'They proposed a time — confirm it before it slips.',
};

function renderCard(props = {}) {
  return render(
    <BarryReplyCard
      contact={contact}
      draft={draft}
      analysis={analysis}
      userId="user_1"
      {...props}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  updateDoc.mockResolvedValue(undefined);
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, gmailMessageId: 'sent_1', gmailThreadId: 'thr_1' }),
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('visibleSignals', () => {
  it('returns only the non-empty signal arrays, in reading order', () => {
    expect(visibleSignals(analysis).map((s) => s.key)).toEqual([
      'questionsAsked',
      'objections',
      'positiveSignals',
    ]);
  });

  it('drops empty arrays', () => {
    const partial = { ...analysis, objections: [], positiveSignals: [] };
    expect(visibleSignals(partial).map((s) => s.key)).toEqual(['questionsAsked']);
  });

  it('returns nothing for a null analysis', () => {
    expect(visibleSignals(null)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('rendering', () => {
  it('shows Barry summary, intent badge and every extracted signal', () => {
    renderCard();
    expect(screen.getByText(analysis.summary)).toBeInTheDocument();
    expect(screen.getByText('Wants to meet')).toBeInTheDocument();
    expect(screen.getByText('Questions to answer')).toBeInTheDocument();
    expect(screen.getByText('Does Thursday at 2 work for you?')).toBeInTheDocument();
    expect(screen.getByText('Concerns raised')).toBeInTheDocument();
    expect(screen.getByText('Positive signals')).toBeInTheDocument();
  });

  it('pre-populates the editable textarea with the draft body', () => {
    renderCard();
    expect(screen.getByRole('textbox')).toHaveValue(draft.bodyText);
    expect(screen.getByRole('textbox')).not.toBeDisabled();
  });

  it('renders with analysis null — draft only, no crash', () => {
    renderCard({ analysis: null });
    expect(screen.getByRole('textbox')).toHaveValue(draft.bodyText);
    expect(screen.getByRole('button', { name: /send reply/i })).toBeInTheDocument();
    expect(screen.queryByText('Questions to answer')).not.toBeInTheDocument();
    expect(screen.getByText(/read of their message isn't available/i)).toBeInTheDocument();
  });

  it('skips the signals zone entirely when all three arrays are empty', () => {
    renderCard({
      analysis: { ...analysis, questionsAsked: [], objections: [], positiveSignals: [] },
    });
    expect(screen.getByText(analysis.summary)).toBeInTheDocument();
    expect(screen.queryByText('Questions to answer')).not.toBeInTheDocument();
  });

  it('renders nothing when there is no draft', () => {
    const { container } = render(
      <BarryReplyCard contact={contact} draft={null} analysis={analysis} userId="user_1" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('warns past the soft character limit without blocking send', async () => {
    const user = userEvent.setup();
    renderCard({ draft: { ...draft, bodyText: 'x'.repeat(SOFT_BODY_LIMIT + 1) } });
    expect(screen.getByText(/consider trimming/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reply/i })).not.toBeDisabled();
    await user.click(screen.getByRole('button', { name: /send reply/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('send', () => {
  it('does not send anything on render — only an explicit tap sends', () => {
    renderCard();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the edited body, not the original draft', async () => {
    const user = userEvent.setup();
    renderCard();

    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'Thursday works. Sending an invite now.');
    await user.click(screen.getByRole('button', { name: /send reply/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(payload.bodyText).toBe('Thursday works. Sending an invite now.');
    expect(payload.bodyText).not.toBe(draft.bodyText);
  });

  it('sends the thread id and recipient from the draft', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /send reply/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/barry-approve-send');
    expect(options.headers.Authorization).toBe('Bearer token_abc');
    const payload = JSON.parse(options.body);
    expect(payload).toMatchObject({
      userId: 'user_1',
      contactId: 'contact_1',
      messageRecordId: 'rec_1',
      gmailThreadId: 'thr_1',
      recipientEmail: 'jane@acme.com',
    });
  });

  it('calls onSent after a successful send', async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    renderCard({ onSent });
    await user.click(screen.getByRole('button', { name: /send reply/i }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  });

  it('disables the actions while the send is in flight', async () => {
    const user = userEvent.setup();
    let release;
    global.fetch = vi.fn(() => new Promise((resolve) => { release = resolve; }));

    renderCard();
    await user.click(screen.getByRole('button', { name: /send reply/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sending…/i })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /snooze/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();

    release({ ok: true, status: 200, json: async () => ({ success: true }) });
  });

  it('shows the server error inline and re-enables the buttons', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'gmailThreadId is required — a reply must stay in its thread' }),
    }));

    const onSent = vi.fn();
    renderCard({ onSent });
    await user.click(screen.getByRole('button', { name: /send reply/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/must stay in its thread/i);
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send reply/i })).not.toBeDisabled();
  });

  it('never sends an empty body', async () => {
    const user = userEvent.setup();
    renderCard({ draft: { ...draft, bodyText: '   ' } });
    expect(screen.getByRole('button', { name: /send reply/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /send reply/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('snooze', () => {
  it('marks the draft snoozed and leaves conversationState alone', async () => {
    const user = userEvent.setup();
    const onSnooze = vi.fn();
    renderCard({ onSnooze });

    await user.click(screen.getByRole('button', { name: /snooze/i }));

    await waitFor(() => expect(onSnooze).toHaveBeenCalledTimes(1));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ approvalStatus: 'snoozed' });
    // The contact document is never touched by a snooze.
    const paths = docFn.mock.calls.map((c) => c.join('/'));
    expect(paths.some((p) => p.endsWith('barry_drafts/rec_1'))).toBe(true);
  });

  it('surfaces a snooze failure instead of hiding the card', async () => {
    const user = userEvent.setup();
    updateDoc.mockRejectedValueOnce(new Error('permission denied'));
    const onSnooze = vi.fn();
    renderCard({ onSnooze });

    await user.click(screen.getByRole('button', { name: /snooze/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not snooze/i);
    expect(onSnooze).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('dismiss', () => {
  it('requires a confirmation tap before doing anything', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderCard({ onDismiss });

    await user.click(screen.getByRole('button', { name: /^dismiss$/i }));

    expect(updateDoc).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /tap again to confirm/i })).toBeInTheDocument();
  });

  it('retires the draft and clears the action flag on confirm', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderCard({ onDismiss });

    await user.click(screen.getByRole('button', { name: /^dismiss$/i }));
    await user.click(screen.getByRole('button', { name: /tap again to confirm/i }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(updateDoc).toHaveBeenCalledTimes(2);
    // Draft retired, and the contact moved off "needs you" so it is not left
    // stranded in user_action_required with no draft to act on.
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ approvalStatus: 'dismissed' });
    expect(updateDoc.mock.calls[1][1]).toMatchObject({
      conversationState: 'active_conversation',
    });
  });

  it('does not touch stage, brigade or icpScore', async () => {
    const user = userEvent.setup();
    renderCard({ onDismiss: vi.fn() });

    await user.click(screen.getByRole('button', { name: /^dismiss$/i }));
    await user.click(screen.getByRole('button', { name: /tap again to confirm/i }));

    await waitFor(() => expect(updateDoc).toHaveBeenCalledTimes(2));
    for (const [, patch] of updateDoc.mock.calls) {
      expect(patch).not.toHaveProperty('stage');
      expect(patch).not.toHaveProperty('brigade');
      expect(patch).not.toHaveProperty('icpScore');
      expect(patch).not.toHaveProperty('name');
      expect(patch).not.toHaveProperty('company_name');
    }
  });
});
