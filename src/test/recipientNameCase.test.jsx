/**
 * Recipient name capitalization — presentation only.
 *
 * "chelsie hightower" rendered as "Hi chelsie,". Names that are entirely
 * lowercase or entirely uppercase are title-cased for display; names with
 * intentional mixed capitalization are left exactly as stored. The contact
 * record itself is never rewritten.
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
  loadDeliveryHistory: vi.fn(async () => new Map()),
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

import { displayNameCase } from '../utils/emailGreeting';
import { renderCadenceEmail, firstNameFor, displayContactName, greetingFor } from '../utils/cadenceSend';
import BulkComposeModal from '../components/scout/BulkComposeModal';

describe('displayNameCase', () => {
  it.each([
    ['chelsie', 'Chelsie'],
    ['MICHAEL', 'Michael'],
    ['hightower', 'Hightower'],
    ['UILBARRI', 'Uilbarri'],
    ['chelsie hightower', 'Chelsie Hightower'],
    ["o'neill", "O'Neill"],
    ["O'NEILL", "O'Neill"],
    ['MARY-JANE', 'Mary-Jane'],
    ['josé', 'José'],
  ])('title-cases an all-lower or all-upper name: %s → %s', (input, expected) => {
    expect(displayNameCase(input)).toBe(expected);
  });

  it.each([
    'McDonald', 'MacArthur', 'DeLaCruz', 'LaToya', "O'Neill", "D'Angelo", 'van Buren', 'de la Cruz', 'Michael',
  ])('preserves intentional capitalization exactly: %s', (name) => {
    expect(displayNameCase(name)).toBe(name);
  });

  it('leaves empty values and email addresses alone', () => {
    expect(displayNameCase('')).toBe('');
    expect(displayNameCase('sam@x.com')).toBe('sam@x.com');
  });
});

describe('greeting and display use the display casing', () => {
  it('greets "chelsie hightower" as "Hi Chelsie," and shows "Chelsie Hightower"', () => {
    const chelsie = { name: 'chelsie hightower', email: 'c@x.com' };
    expect(firstNameFor(chelsie)).toBe('Chelsie');
    expect(greetingFor(chelsie)).toBe('Hi Chelsie,');
    expect(displayContactName(chelsie)).toBe('Chelsie Hightower');
    expect(renderCadenceEmail({ subject: 'For {{first_name}}', body: 'Body.', contact: chelsie, openingLine: '' }))
      .toEqual({ subject: 'For Chelsie', body: 'Hi Chelsie,\n\nBody.', inline: false });
  });

  it('greets "MICHAEL" as "Hi Michael," and keeps "LaToya" as written', () => {
    expect(greetingFor({ first_name: 'MICHAEL' })).toBe('Hi Michael,');
    expect(greetingFor({ first_name: 'LaToya' })).toBe('Hi LaToya,');
    expect(displayContactName({ first_name: 'latoya', last_name: 'McDonald' })).toBe('latoya McDonald');
  });

  it('strips a Barry line that starts with the name in any casing', () => {
    const { body } = renderCadenceEmail({
      subject: 'S', body: 'Body.', contact: { name: 'chelsie hightower' }, openingLine: 'chelsie, I thought of you.',
    });
    expect(body).toBe('Hi Chelsie,\n\nI thought of you.\n\nBody.');
  });
});

describe('compose: preview, Barry context, test send and real send', { timeout: 20000 }, () => {
  let fetchBodies;
  beforeEach(() => {
    executorProps.current = null;
    mockSendEmailViaGmail.mockReset();
    mockSendEmailViaGmail.mockResolvedValue({ result: 'sent', emailFormat: 'rfc2047-1' });
    fetchBodies = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      fetchBodies.push(body);
      return { json: async () => ({ results: body.contacts.map(c => ({ contactId: c.contactId, success: true, openingLine: 'I thought of you.' })) }) };
    });
  });

  it('shows and sends "Chelsie Hightower" / "Hi Chelsie," for a lowercase contact', async () => {
    render(
      <BulkComposeModal
        contacts={[{ id: 'c1', name: 'chelsie hightower', email: 'chelsie@x.com' }]}
        onClose={() => {}}
        initialCadenceName="People Pitch" initialSubject="See you, {{first_name}}" initialBody="Body."
      />,
    );
    expect(screen.getAllByText('Chelsie Hightower').length).toBeGreaterThan(0); // recipient list
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));

    expect((await screen.findByTestId('rendered-body-c1')).textContent).toBe('Hi Chelsie,\n\nI thought of you.\n\nBody.');
    expect(screen.getByTestId('rendered-subject-c1').textContent).toBe('Subject: See you, Chelsie');
    expect(screen.getAllByText('Chelsie Hightower').length).toBeGreaterThan(0); // preview card
    expect(fetchBodies[0].contacts[0]).toMatchObject({ firstName: 'Chelsie', lastName: 'Hightower' });

    fireEvent.click(screen.getByRole('button', { name: /Send Test to Me/ }));
    await screen.findByText(/personalized as Chelsie Hightower/);
    expect(mockSendEmailViaGmail.mock.calls[0][0].body).toBe('Hi Chelsie,\n\nI thought of you.\n\nBody.');

    fireEvent.click(screen.getByRole('button', { name: /Send to 1 contact/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());
    expect(executorProps.current.payload[0].body).toBe('Hi Chelsie,\n\nI thought of you.\n\nBody.');
    // Presentation only: the contact handed to the send pipeline is unchanged.
    expect(executorProps.current.payload[0].contact.name).toBe('chelsie hightower');
  });
});
