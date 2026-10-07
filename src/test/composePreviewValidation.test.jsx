/**
 * Compose → Preview button: enabled when the required fields are filled, and
 * when it is not, the screen says exactly why. Never silently disabled.
 *
 * Required: cadence name, subject, body, at least one recipient (and Gmail,
 * only when an attachment or CC is added). Barry, attachment, CC and template
 * tags are optional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const gmail = vi.hoisted(() => ({ connected: true }));

vi.mock('../utils/sendActionResolver', () => ({
  checkGmailConnection: vi.fn(async () => ({ connected: gmail.connected })),
  sendEmailViaGmail: vi.fn(),
  SEND_RESULT: { SENT: 'sent', FAILED: 'failed' },
}));
vi.mock('../utils/cadenceSend', async (importOriginal) => ({
  ...(await importOriginal()),
  loadAlreadyDelivered: vi.fn(async () => new Set()),
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', email: 'me@x.com', getIdToken: async () => 'tok' }),
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
vi.mock('../components/scout/BulkSendExecutor', () => ({ default: () => null }));

import BulkComposeModal from '../components/scout/BulkComposeModal';

const RECIPIENTS = [{ id: 'c1', name: 'chelsie hightower', email: 'chelsie@x.com' }];

const nameInput = () => screen.getByPlaceholderText(/Bank CEO Introduction/);
const subjectInput = () => screen.getByPlaceholderText('Email subject line');
const bodyInput = () => screen.getByLabelText('Email Body');
const previewButton = () => screen.getByRole('button', { name: /^Preview$/ });
const blockers = () => screen.queryByTestId('preview-blockers');

function renderBlank(contacts = RECIPIENTS) {
  return render(<BulkComposeModal contacts={contacts} onClose={() => {}} />);
}

function fillAll() {
  fireEvent.change(nameInput(), { target: { value: 'STAGING - People Pitch Test' } });
  fireEvent.change(subjectInput(), { target: { value: 'Hope you can make it tomorrow — People Pitch' } });
  fireEvent.change(bodyInput(), { target: { value: 'See you there, {{first_name}}.' } });
}

beforeEach(() => { gmail.connected = true; });

describe('Compose → Preview validation', { timeout: 20000 }, () => {
  it('enables Preview once name, subject, body and recipients are filled — Barry off, no attachment, no CC, {{first_name}} used', async () => {
    renderBlank();
    fillAll();
    fireEvent.click(screen.getByLabelText('Personalize with Barry')); // Barry OFF
    expect(screen.getByLabelText('Personalize with Barry')).toHaveAttribute('aria-pressed', 'false');
    expect(previewButton()).toBeEnabled();
    expect(blockers()).not.toBeInTheDocument();
  });

  it('tells the user every missing field instead of silently disabling Preview', () => {
    renderBlank();
    expect(previewButton()).toBeDisabled();
    expect(blockers()).toHaveTextContent('Cadence name is required');
    expect(blockers()).toHaveTextContent('Subject is required');
    expect(blockers()).toHaveTextContent('Email body is required');
  });

  it.each([
    ['cadence name', () => nameInput(), 'Cadence name is required'],
    ['subject', () => subjectInput(), 'Subject is required'],
    ['body', () => bodyInput(), 'Email body is required'],
  ])('names a missing %s on its own', (_label, field, message) => {
    renderBlank();
    fillAll();
    fireEvent.change(field(), { target: { value: '   ' } });
    expect(previewButton()).toBeDisabled();
    expect(blockers()).toHaveTextContent(message);
    expect(blockers().textContent.split('·')).toHaveLength(1);
  });

  it('says "Add at least one recipient" when there are none', () => {
    renderBlank([]);
    fillAll();
    expect(previewButton()).toBeDisabled();
    expect(blockers()).toHaveTextContent('Add at least one recipient');
  });

  it('only requires Gmail once a CC is added', async () => {
    gmail.connected = false;
    renderBlank();
    fillAll();
    expect(previewButton()).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText('cc@example.com'), { target: { value: 'boss@x.com' } });
    expect(await screen.findByText(/Connect Gmail to send an attachment or CC/)).toBeInTheDocument();
    expect(previewButton()).toBeDisabled();
  });
});
