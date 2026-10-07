/**
 * Preview = Send Test = real send, for the People Pitch email.
 *
 * The preview card renders the exact payload (buildPayloadItem →
 * renderCadenceEmail) — the same call the test send and the real send make.
 * Barry returns a line that starts with a greeting and the name (what the real
 * Gmail test showed); every surface must show it cleaned, identically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSendEmailViaGmail = vi.hoisted(() => vi.fn());
const executorProps = vi.hoisted(() => ({ current: null }));

vi.mock('../utils/sendActionResolver', () => ({
  checkGmailConnection: vi.fn(async () => ({ connected: true })),
  sendEmailViaGmail: mockSendEmailViaGmail,
  SEND_RESULT: { SENT: 'sent', FAILED: 'failed' },
}));
vi.mock('../utils/cadenceSend', async (importOriginal) => ({
  ...(await importOriginal()),
  loadAlreadyDelivered: vi.fn(async () => new Set()),
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', email: 'aaron@example.com', getIdToken: async () => 'tok' }),
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

const SUBJECT = 'Hope you can make it tomorrow — People Pitch';
const BODY = 'I’m hoping you can make it to People Pitch tomorrow.\n\nRegister here:\nhttps://luma.com/ocr6c6e4\n\nAaron';
const CLEAN = 'I thought you’d appreciate what’s happening tomorrow given your connection to the community.';
const EXPECTED = `Hi Michael,\n\n${CLEAN}\n\n${BODY}`;

beforeEach(() => {
  executorProps.current = null;
  mockSendEmailViaGmail.mockReset();
  mockSendEmailViaGmail.mockResolvedValue({ result: 'sent' });
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    return { json: async () => ({ results: body.contacts.map(c => ({ contactId: c.contactId, success: true, openingLine: `Hey Michael, ${CLEAN}` })) }) };
  });
});

describe('People Pitch: preview, test send and real send are identical', { timeout: 20000 }, () => {
  it('renders one greeting, a clean Barry line, the exact subject — everywhere, with the PDF', async () => {
    render(
      <BulkComposeModal
        contacts={[{ id: 'm1', name: 'Michael Reyes', first_name: 'Michael', email: 'michael@example.org' }]}
        onClose={() => {}}
        initialCadenceName="People Pitch" initialSubject={SUBJECT} initialBody={BODY}
      />,
    );
    const pdf = new File(['%PDF-1.4'], 'People Pitch Flyer.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [pdf] } });
    await screen.findByText('People Pitch Flyer.pdf');

    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    const previewBody = (await screen.findByTestId('rendered-body-m1')).textContent;
    const previewSubject = screen.getByTestId('rendered-subject-m1').textContent;
    expect(previewBody).toBe(EXPECTED);
    expect(previewSubject).toBe(`Subject: ${SUBJECT}`);
    expect(document.getElementById('opening-m1').value).toBe(CLEAN); // the editable line is already clean

    fireEvent.click(screen.getByRole('button', { name: /Send Test to Me/ }));
    await screen.findByText(/Test sent to aaron@example.com/);
    const test = mockSendEmailViaGmail.mock.calls[0][0];
    expect(test.subject).toBe(`[TEST] ${SUBJECT}`);
    expect(test.body).toBe(EXPECTED);
    expect(test.attachment.filename).toBe('People Pitch Flyer.pdf');

    fireEvent.click(screen.getByRole('button', { name: /Send to 1 contact/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());
    const [real] = executorProps.current.payload;
    expect(real.subject).toBe(SUBJECT);
    expect(real.body).toBe(EXPECTED);
    expect(real.attachment).toEqual(test.attachment);
  });
});
