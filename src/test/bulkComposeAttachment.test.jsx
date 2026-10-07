/**
 * One message, optional attachment.
 *
 * Reusing a cadence and then attaching the event flyer used to mean switching
 * to a separate "Send with attachment" mode whose subject and body started
 * empty, with no greeting and no Barry toggle. The attachment is now an
 * addition to the same message: the reused subject and body survive, the
 * greeting and Barry personalization still apply, and the test send and the
 * real send carry the same content and the same PDF.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSendEmailViaGmail = vi.hoisted(() => vi.fn());
const gmail = vi.hoisted(() => ({ connected: true }));
const executorProps = vi.hoisted(() => ({ current: null }));

vi.mock('../utils/sendActionResolver', () => ({
  checkGmailConnection: vi.fn(async () => ({ connected: gmail.connected })),
  sendEmailViaGmail: mockSendEmailViaGmail,
  SEND_RESULT: { SENT: 'sent', FAILED: 'failed' },
}));
vi.mock('../utils/cadenceSend', async (importOriginal) => ({
  ...(await importOriginal()),
  loadAlreadyDelivered: vi.fn(async () => new Set()),
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', email: 'me@idynify.com', getIdToken: async () => 'tok' }),
}));
vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({ cardBg: '#fff', surface: '#fafafa', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888' }),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})), setDoc: vi.fn(async () => {}), getDoc: vi.fn(async () => ({ exists: () => false })),
  deleteDoc: vi.fn(async () => {}), serverTimestamp: vi.fn(() => ({})), collection: vi.fn(() => ({})),
  getDocs: vi.fn(async () => ({ docs: [] })), query: vi.fn(() => ({})), orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})), where: vi.fn(() => ({})),
}));
vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('../components/scout/BulkSendExecutor', () => ({
  default: (props) => { executorProps.current = props; return <div data-testid="executor" />; },
}));

import BulkComposeModal from '../components/scout/BulkComposeModal';

const PEOPLE = [
  { id: 'c1', name: 'Ana Lopez', first_name: 'Ana', email: 'ana@x.com', company: 'Acme' },
  { id: 'c2', name: 'Ben Ito', first_name: 'Ben', email: 'ben@x.com', company: 'Globex' },
];
const SUBJECT = "You're invited, {{first_name}}";
const BODY = 'Join us at Beyond Words with {{company}}.';

let fetchBodies;
beforeEach(() => {
  gmail.connected = true;
  executorProps.current = null;
  mockSendEmailViaGmail.mockReset();
  mockSendEmailViaGmail.mockResolvedValue({ result: 'sent', emailFormat: 'rfc2047-1' });
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

function renderReused(props = {}) {
  return render(
    <BulkComposeModal
      contacts={PEOPLE}
      onClose={() => {}}
      initialCadenceName="STAGING - Beyond Words Test"
      initialSubject={SUBJECT}
      initialBody={BODY}
      {...props}
    />,
  );
}

async function attachFlyer() {
  const pdf = new File(['%PDF-1.4 flyer'], 'Beyond Words Flyer.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [pdf] } });
  await screen.findByText('Beyond Words Flyer.pdf');
}

const subjectInput = () => screen.getByPlaceholderText('Email subject line');
const bodyInput = () => screen.getByLabelText('Email Body');

describe('reused cadence + attachment', { timeout: 20000 }, () => {
  it('keeps the reused subject and body when the flyer is attached', async () => {
    renderReused();
    expect(subjectInput()).toHaveValue(SUBJECT);
    expect(bodyInput()).toHaveValue(BODY);
    await attachFlyer();
    expect(subjectInput()).toHaveValue(SUBJECT);
    expect(bodyInput()).toHaveValue(BODY);
    expect(screen.getByLabelText('Personalize with Barry')).toHaveAttribute('aria-pressed', 'true');
  });

  it('personalizes with Barry and the first-name greeting, with the PDF on the review cards', async () => {
    renderReused();
    await attachFlyer();
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    await screen.findByText(/Send to 2 contacts/);

    expect(fetchBodies).toHaveLength(1);
    expect(fetchBodies[0].mode).toBeUndefined(); // opening-line mode, as before
    expect(fetchBodies[0].sharedBody).toBe(BODY);
    // The card shows the exact rendered email (same path as the send).
    expect(screen.getByTestId('rendered-body-c1').textContent)
      .toBe('Hi Ana,\n\nContext for c1.\n\nJoin us at Beyond Words with Acme.');
    expect(screen.getAllByText(/PDF attached: Beyond Words Flyer.pdf/)).toHaveLength(2);
  });

  it('sends the test and the real send with the same message and the same PDF', async () => {
    renderReused();
    await attachFlyer();
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Send Test to Me/ }));
    await screen.findByText(/Test sent to me@idynify.com/);

    const test = mockSendEmailViaGmail.mock.calls[0][0];
    expect(test.subject).toBe("[TEST] You're invited, Ana");
    expect(test.body).toBe('Hi Ana,\n\nContext for c1.\n\nJoin us at Beyond Words with Acme.');
    expect(test.attachment).toMatchObject({ filename: 'Beyond Words Flyer.pdf', mimeType: 'application/pdf' });
    expect(test.attachment.data).toEqual(expect.any(String));

    fireEvent.click(screen.getByRole('button', { name: /Send to 2 contacts/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());
    const [first, second] = executorProps.current.payload;
    expect(first.subject).toBe("You're invited, Ana");
    expect(first.body).toBe(test.body);
    expect(first.attachment).toEqual(test.attachment);
    expect(second.body).toBe('Hi Ben,\n\nContext for c2.\n\nJoin us at Beyond Words with Globex.');
    expect(second.attachment).toEqual(test.attachment);
    expect(executorProps.current.cadenceMeta).toMatchObject({
      templateSubject: SUBJECT, templateBody: BODY, hasAttachment: true, personalizedWithBarry: true,
    });
  });

  it('keeps explicit {{personalize}} behavior: Barry fills the tag in place, no added greeting', async () => {
    renderReused({ initialBody: 'Dear friend — {{personalize}} The flyer is attached.' });
    await attachFlyer();
    expect(screen.getByTestId('inline-personalize-note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Send to 2 contacts/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());

    expect(fetchBodies[0].mode).toBe('inline_personalize');
    const [first] = executorProps.current.payload;
    expect(first.body).toBe('Dear friend — Context for c1. The flyer is attached.');
    expect(first.attachment.filename).toBe('Beyond Words Flyer.pdf');
  });

  it('requires Gmail to send an attachment', async () => {
    gmail.connected = false;
    renderReused();
    await attachFlyer();
    expect(await screen.findByText(/Gmail connection required to send attachments/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Preview$/ })).toBeDisabled();
  });

  it('greets an email-only contact with "Hi," instead of their address', async () => {
    render(
      <BulkComposeModal
        contacts={[{ id: 'e1', name: 'sam@x.com', email: 'sam@x.com' }]}
        onClose={() => {}}
        initialCadenceName="X" initialSubject="Hello {{first_name}}" initialBody="Body" initialPersonalize={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Send to 1 contact/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());
    expect(executorProps.current.payload[0].body).toBe('Hi,\n\nBody');
    expect(executorProps.current.payload[0].subject).toBe('Hello ');
  });

  it('sends to archived contacts like any other recipient (no archive-based exclusion)', async () => {
    render(
      <BulkComposeModal
        contacts={[
          { id: 'a1', name: 'Arch One', first_name: 'Arch', email: 'arch@x.com', is_archived: true, _archived: true },
          { id: 'a2', name: 'Coco Two', first_name: 'Coco', email: 'coco@x.com', company_archived: true, _archived: true },
        ]}
        onClose={() => {}}
        initialCadenceName="X" initialSubject="S" initialBody="B" initialPersonalize={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Send to 2 contacts/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());
    expect(executorProps.current.payload.map(p => p.contact.id)).toEqual(['a1', 'a2']);
  });
});

