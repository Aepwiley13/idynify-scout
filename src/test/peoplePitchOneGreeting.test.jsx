/**
 * ONE name / ONE greeting — the final People Pitch opening structure.
 *
 *   Barry OFF:  Hi Michael, / I’m hoping you can make it… / …
 *   Barry ON:   Hi Michael, / <one Barry sentence, no greeting, no name> / I’m hoping… / …
 *
 * Recipient: Michael Ulibarri. Includes the variants that slipped through the
 * previous renderer: an invisible zero-width character before "Hey", a
 * two-word address ("Hey there Michael,"), a greeting at the start of the
 * second paragraph (a body reused from an older cadence), and a body using
 * {{personalize}}.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockSendEmailViaGmail = vi.hoisted(() => vi.fn());
const executorProps = vi.hoisted(() => ({ current: null }));
const barry = vi.hoisted(() => ({ line: '' }));

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

import { renderCadenceEmail } from '../utils/cadenceSend';
import { EMAIL_RENDER_VERSION } from '../utils/emailGreeting';
import BulkComposeModal from '../components/scout/BulkComposeModal';

const BODY = `I’m hoping you can make it to People Pitch tomorrow.

We have some amazing nonprofits taking the stage, and I’d really love for you to come hear what they’re working on and help us share their stories with more people.

United Angels — supporting individuals with disabilities and their families.
Golden Gap Foundation — helping close gaps in support for people and families who need it most.
Lucky Ones Coffee — creating inclusive employment and community through coffee.

We’d love to have you there, connect with you, and have you help spread the word about these organizations and the work they’re doing across Utah.

Register here:
https://luma.com/ocr6c6e4

Hope to see you tomorrow.

Aaron`;

const MICHAEL = { id: 'mu', name: 'Michael Ulibarri', first_name: 'Michael', last_name: 'Ulibarri', email: 'michael@example.org' };
const OFF = `Hi Michael,\n\n${BODY}`;
const SENTENCE = 'I thought you’d appreciate this because of your work in the community.';
const ON = `Hi Michael,\n\n${SENTENCE}\n\n${BODY}`;

const out = (body, openingLine = '', personalize = false) =>
  renderCadenceEmail({ subject: 'Hope you can make it tomorrow — People Pitch', body, contact: MICHAEL, openingLine, personalize }).body;
const opening = (text) => text.split('I’m hoping you can make it')[0];
const occurrences = (text, s) => text.split(s).length - 1;

describe('Barry OFF — the accidental greeting is removed', () => {
  it.each([
    ['the clean body', BODY],
    ['Hey {{first_name}},', BODY.replace('I’m hoping', 'Hey {{first_name}}, I’m hoping')],
    ['Hey Michael,', BODY.replace('I’m hoping', 'Hey Michael, I’m hoping')],
    ['Hi {{first_name}}, on its own line', `Hi {{first_name}},\n\n${BODY}`],
    ['Hi Michael, then Hey Michael,', `Hi Michael,\n\nHey Michael, ${BODY}`],
    ['Hello {{first_name}},', BODY.replace('I’m hoping', 'Hello {{first_name}}, I’m hoping')],
    ['{{first_name}},', BODY.replace('I’m hoping', '{{first_name}}, I’m hoping')],
    ['Michael,', BODY.replace('I’m hoping', 'Michael, I’m hoping')],
    ['Hi Michael!', BODY.replace('I’m hoping', 'Hi Michael! I’m hoping')],
    ['Hey Michael:', BODY.replace('I’m hoping', 'Hey Michael: I’m hoping')],
    ['Michael —', BODY.replace('I’m hoping', 'Michael — I’m hoping')],
    ['a zero-width space before Hey', `​Hey {{first_name}}, ${BODY}`],
    ['a non-breaking space inside', BODY.replace('I’m hoping', 'Hey {{first_name}}, I’m hoping')],
    ['Hey there Michael,', BODY.replace('I’m hoping', 'Hey there Michael, I’m hoping')],
    ['Hey {{first_name}} {{last_name}},', BODY.replace('I’m hoping', 'Hey {{first_name}} {{last_name}}, I’m hoping')],
    ['blank lines and spaces first', `\n\n   Hey {{first_name}},\n\n${BODY}`],
  ])('%s → identical to the clean output', (_label, body) => {
    const text = out(body);
    expect(text).toBe(OFF);
    expect(occurrences(text, 'Hi Michael,')).toBe(1);
    expect(occurrences(text, 'Hey Michael')).toBe(0);
    expect(occurrences(opening(text), 'Michael')).toBe(1); // only the system greeting
  });

  it('a body reused from an older cadence: a greeting at the start of the second paragraph is removed too', () => {
    const legacy = `Michael, I’m reaching out because you care about Utah’s nonprofits.\n\nHey Michael, ${BODY}`;
    const text = out(legacy);
    expect(text).toBe(`Hi Michael,\n\nI’m reaching out because you care about Utah’s nonprofits.\n\n${BODY}`);
    expect(occurrences(text, 'Michael')).toBe(1);
  });
});

describe('Barry ON — one clean context sentence', () => {
  it.each([
    'Michael, I thought you’d appreciate this because of your work in the community.',
    'Hey Michael, I thought you’d appreciate this because of your work in the community.',
    'Hi Michael — I thought you’d appreciate this because of your work in the community.',
    '​Michael, I thought you’d appreciate this because of your work in the community.',
  ])('cleans %j', (line) => {
    for (const body of [BODY, BODY.replace('I’m hoping', 'Hey {{first_name}}, I’m hoping')]) {
      const text = out(body, line, true);
      expect(text).toBe(ON);
      expect(occurrences(text, 'Hi Michael,')).toBe(1);
      expect(occurrences(opening(text), 'Michael')).toBe(1);
    }
  });

  it('removes the name used as an address at the end: "…this, Michael." → "…this."', () => {
    expect(out(BODY, 'I thought you’d appreciate this, Michael.', true))
      .toBe(`Hi Michael,\n\nI thought you’d appreciate this.\n\n${BODY}`);
  });

  it('discards a Barry line that duplicates the body opening and uses the safe fallback', () => {
    expect(out(BODY, 'Michael, I’m hoping you can make it to People Pitch tomorrow!', true))
      .toBe(`Hi Michael,\n\nI wanted to make sure this was on your radar.\n\n${BODY}`);
  });

  it('with {{personalize}} in the body: still one system greeting, Barry text cleaned in place', () => {
    const body = BODY.replace('I’m hoping', 'Hey {{first_name}}, {{personalize}} I’m hoping');
    const text = out(body, 'Michael, great to see your work lately.', true);
    expect(text.startsWith('Hi Michael,\n\nGreat to see your work lately. I’m hoping you can make it')).toBe(true);
    expect(occurrences(opening(text), 'Michael')).toBe(1);
  });
});

describe('names in normal content are left alone', () => {
  it('only the opening layer is touched', () => {
    const body = `${BODY}\n\nP.S. Michael, Sarah asked me to say hi — Michael Smith is speaking too.`;
    expect(out(body)).toBe(`Hi Michael,\n\n${body}`);
  });
});

describe('Preview = Send Test = real send', { timeout: 20000 }, () => {
  beforeEach(() => {
    executorProps.current = null;
    mockSendEmailViaGmail.mockReset();
    mockSendEmailViaGmail.mockResolvedValue({ result: 'sent', emailFormat: 'rfc2047-1' });
    globalThis.fetch = vi.fn(async (_url, init) => {
      const req = JSON.parse(init.body);
      return { json: async () => ({ results: req.contacts.map(c => ({ contactId: c.contactId, success: true, openingLine: barry.line })) }) };
    });
  });

  it.each([
    ['Barry ON', true, 'Hey Michael, I thought you’d appreciate this because of your work in the community.', ON],
    ['Barry OFF', false, '', OFF],
  ])('%s: the preview card, the test and the real send carry the same final string', async (_label, barryOn, line, expected) => {
    barry.line = line;
    render(
      <BulkComposeModal
        contacts={[MICHAEL]} onClose={() => {}}
        initialCadenceName="STAGING - People Pitch Test"
        initialSubject="Hope you can make it tomorrow — People Pitch"
        initialBody={`​Hey {{first_name}}, ${BODY}`}
        initialPersonalize={barryOn}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    const preview = (await screen.findByTestId('rendered-body-mu')).textContent;
    expect(preview).toBe(expected);
    expect(preview).not.toMatch(/Hey Michael/);

    fireEvent.click(screen.getByRole('button', { name: /Send Test to Me/ }));
    await screen.findByText(new RegExp(`app ${EMAIL_RENDER_VERSION} · server rfc2047-1`));
    expect(mockSendEmailViaGmail.mock.calls[0][0].body).toBe(expected);

    fireEvent.click(screen.getByRole('button', { name: /Send to 1 contact/ }));
    await waitFor(() => expect(executorProps.current).not.toBeNull());
    expect(executorProps.current.payload[0].body).toBe(expected);
  });
});
