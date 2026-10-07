/**
 * BulkComposeModal with an imported group of people.
 *
 *   - more than 25 people enter compose without row-by-row selection
 *   - Barry personalization is requested in chunks the server accepts (25)
 *   - people who already received this cadence are excluded (resend guard)
 *   - "Send Test to Me" sends the real first email to the user, untracked
 *   - the send carries the cadence template so it can be reused
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSendEmailViaGmail = vi.hoisted(() => vi.fn());
const mockLoadAlreadyDelivered = vi.hoisted(() => vi.fn());
const executorProps = vi.hoisted(() => ({ current: null }));

vi.mock('../utils/sendActionResolver', () => ({
  checkGmailConnection: vi.fn(async () => ({ connected: true })),
  sendEmailViaGmail: mockSendEmailViaGmail,
  SEND_RESULT: { SENT: 'sent', FAILED: 'failed' },
}));

vi.mock('../utils/cadenceSend', async (importOriginal) => ({
  ...(await importOriginal()),
  loadAlreadyDelivered: mockLoadAlreadyDelivered,
}));

vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', email: 'me@idynify.com', getIdToken: async () => 'tok' }),
}));

vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({ cardBg: '#fff', surface: '#fafafa', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888' }),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  setDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  deleteDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  getDocs: vi.fn(async () => ({ docs: [] })),
  query: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
}));
vi.mock('../firebase/config', () => ({ db: {} }));

vi.mock('../components/scout/BulkSendExecutor', () => ({
  default: (props) => { executorProps.current = props; return <div data-testid="executor">sending {props.payload.length}</div>; },
}));

import BulkComposeModal from '../components/scout/BulkComposeModal';

// 30 > the server's 25-per-request cap, so personalization must chunk.
// (Kept small: jsdom renders every preview card.)
const people = Array.from({ length: 30 }, (_, i) => ({
  id: `c${i}`, name: `Person ${i} Last`, first_name: `Person${i}`, email: `p${i}@x.com`, company: 'Acme',
}));

let fetchBodies;
beforeEach(() => {
  executorProps.current = null;
  mockSendEmailViaGmail.mockReset();
  mockSendEmailViaGmail.mockResolvedValue({ result: 'sent', emailFormat: 'rfc2047-1' });
  mockLoadAlreadyDelivered.mockReset();
  mockLoadAlreadyDelivered.mockResolvedValue(new Set(['c0']));
  fetchBodies = [];
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    fetchBodies.push(body);
    return {
      json: async () => ({
        results: body.contacts.map(c => ({ contactId: c.contactId, success: true, openingLine: `Context for ${c.contactId}.` })),
      }),
    };
  });
});

function renderModal() {
  return render(
    <BulkComposeModal
      contacts={people}
      onClose={() => {}}
      initialCadenceName="Beyond Words Invitation"
      initialSubject="You're invited, {{first_name}}"
      initialBody="Join us at Beyond Words."
    />,
  );
}

async function goToPreview() {
  renderModal();
  expect(screen.getByText(/30 contacts/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
  await screen.findByText(/already received "Beyond Words Invitation"/);
}

describe('BulkComposeModal — imported group', { timeout: 20000 }, () => {
  it('accepts more than 25 people and personalizes them in chunks of 25', async () => {
    await goToPreview();
    expect(fetchBodies.map(b => b.contacts.length)).toEqual([25, 5]);
    expect(fetchBodies[0].sharedBody).toBe('Join us at Beyond Words.');
  });

  it('excludes people who already received this cadence, unless the user opts back in', async () => {
    await goToPreview();
    expect(mockLoadAlreadyDelivered).toHaveBeenCalledWith('u1', 'Beyond Words Invitation');
    expect(screen.getByRole('button', { name: /Send to 29 contacts/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Send to them again/));
    expect(screen.getByRole('button', { name: /Send to 30 contacts/ })).toBeInTheDocument();
  });

  it('sends a real test of the first email to the user, without touching a contact or cadence', async () => {
    await goToPreview();
    fireEvent.click(screen.getByRole('button', { name: /Send Test to Me/ }));
    await screen.findByText(/Test sent to me@idynify.com/);

    expect(mockSendEmailViaGmail).toHaveBeenCalledTimes(1);
    const args = mockSendEmailViaGmail.mock.calls[0][0];
    expect(args.contact).toMatchObject({ id: null, email: 'me@idynify.com' });
    expect(args.cadenceId).toBeUndefined();
    expect(args.subject).toBe("[TEST] You're invited, Person1");  // c0 is excluded; c1 is the first recipient
    expect(args.body).toBe('Hi Person1,\n\nContext for c1.\n\nJoin us at Beyond Words.');
  });

  it('hands the send loop every sendable person and the reusable template', async () => {
    await goToPreview();
    fireEvent.click(screen.getByRole('button', { name: /Send to 29 contacts/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());

    const { payload, cadenceMeta } = executorProps.current;
    expect(payload).toHaveLength(29);
    expect(payload.every(p => p.cadenceName === 'Beyond Words Invitation')).toBe(true);
    expect(payload.some(p => p.contact.id === 'c0')).toBe(false);
    expect(cadenceMeta).toMatchObject({
      templateSubject: "You're invited, {{first_name}}",
      templateBody: 'Join us at Beyond Words.',
      path: 'write_your_own',
      personalizedWithBarry: true,
    });
  });

  it('sends to a contact that only has a work_email', async () => {
    mockLoadAlreadyDelivered.mockResolvedValue(new Set());
    render(
      <BulkComposeModal
        contacts={[{ id: 'w1', name: 'Wendy Work', work_email: 'wendy@corp.com' }]}
        onClose={() => {}}
        initialCadenceName="X" initialSubject="S" initialBody="B" initialPersonalize={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Send to 1 contact/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());
    expect(executorProps.current.payload[0].contact.email).toBe('wendy@corp.com');
  });
});
