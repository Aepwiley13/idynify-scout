/**
 * People Pitch — the final email structure, enforced by the renderer.
 *
 *   Barry OFF:  Hi Michael, / <body>
 *   Barry ON:   Hi Michael, / <one clean Barry sentence> / <body>
 *
 * Inputs below include the exact text from the two failing Gmail screenshots
 * (a body starting "Hey {{first_name}}," and a Barry line starting
 * "Michael, I'm reaching out…"). Also covers the Send Test version check that
 * shows whether the server which sent the test has the subject-encoding fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const mockSendEmailViaGmail = vi.hoisted(() => vi.fn());

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
vi.mock('../components/scout/BulkSendExecutor', () => ({ default: () => null }));

import { renderCadenceEmail } from '../utils/cadenceSend';
import { finalizeBarryOpening, stripLeadingGreeting, BARRY_FALLBACK_OPENING, EMAIL_RENDER_VERSION } from '../utils/emailGreeting';
import BulkComposeModal from '../components/scout/BulkComposeModal';

const SUBJECT = 'Hope you can make it tomorrow — People Pitch';
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

const MICHAEL = { id: 'm1', name: 'Michael Reyes', first_name: 'Michael', email: 'michael@example.org' };
const CLEAN = 'I thought you’d appreciate this because of your connection to Utah’s nonprofit community.';
const count = (text, word) => (text.match(new RegExp(word, 'g')) || []).length;
const render_ = (body, openingLine, personalize = true) =>
  renderCadenceEmail({ subject: SUBJECT, body, contact: MICHAEL, openingLine, personalize }).body;

describe('Barry OFF', () => {
  it('is exactly "Hi Michael," then the body', () => {
    const out = render_(BODY, '', false);
    expect(out).toBe(`Hi Michael,\n\n${BODY}`);
    expect(out.split('\n\n')[1].startsWith('I’m hoping')).toBe(true);
    expect(count(out, 'Michael')).toBe(1);
  });

  it.each([
    'Hey {{first_name}}, I’m hoping',            // the failing screenshot's body
    'Hey Michael, I’m hoping',
    'Hi {{first_name}},\n\nI’m hoping',
    'Hi Michael,\n\nHey Michael, I’m hoping',     // two greetings
    'Hello Michael! I’m hoping',
    '{{first_name}}, I’m hoping',
    'Michael, I’m hoping',
    'michael — I’m hoping',
  ])('strips a greeting the shared body starts with: %j', (start) => {
    const out = render_(BODY.replace('I’m hoping', start), '', false);
    expect(out).toBe(`Hi Michael,\n\n${BODY}`);
  });
});

describe('Barry ON', () => {
  it('is "Hi Michael," + one clean sentence + the body', () => {
    const out = render_(BODY, CLEAN);
    expect(out).toBe(`Hi Michael,\n\n${CLEAN}\n\n${BODY}`);
    const barry = out.split('\n\n')[1];
    expect(barry).not.toMatch(/Michael/);
    expect(barry).not.toMatch(/^(hi|hey|hello|dear)\b/i);
    expect(count(out, 'Michael')).toBe(1);
    expect(count(out, 'I’m hoping you can make it')).toBe(1);
  });

  it('cleans the failing screenshot exactly: "Michael, I’m reaching out…" + body starting "Hey {{first_name}},"', () => {
    const raw = 'Michael, I’m reaching out because I think you’d genuinely enjoy what’s happening tomorrow—it’s a chance to connect with some organizations doing really meaningful work here in Utah.';
    const out = render_(BODY.replace('I’m hoping', 'Hey {{first_name}}, I’m hoping'), raw);
    expect(out).toBe(`Hi Michael,\n\n${raw.replace('Michael, ', '')}\n\n${BODY}`);
    expect(count(out, 'Michael')).toBe(1);
  });

  it.each([
    ['Michael, I thought you’d appreciate this.', 'I thought you’d appreciate this.'],
    ['Hey Michael, I thought you’d appreciate this.', 'I thought you’d appreciate this.'],
    ['Hi Michael — I thought you’d appreciate this.', 'I thought you’d appreciate this.'],
    ['I thought you’d appreciate this given your work, Michael.', 'I thought you’d appreciate this given your work.'],
    ['Given your work, Michael, I thought of you.', 'Given your work, I thought of you.'],
  ])('removes the greeting/name from Barry: %j', (raw, expected) => {
    expect(finalizeBarryOpening(raw, { firstName: 'Michael', body: BODY })).toBe(expected);
    expect(render_(BODY, raw)).toBe(`Hi Michael,\n\n${expected}\n\n${BODY}`);
  });

  it.each([
    'I’m hoping you can make it to People Pitch tomorrow.',          // repeats the body's first sentence
    'I’m hoping you can make it tomorrow!',
    'We have some amazing nonprofits taking the stage tomorrow.',    // repeats a later sentence
    'I know Michael’s team would love this.',                         // still names the recipient
    'Hi Michael,',                                                     // nothing but a greeting
  ])('replaces an unusable Barry line with the safe fallback: %j', (raw) => {
    expect(finalizeBarryOpening(raw, { firstName: 'Michael', body: BODY })).toBe(BARRY_FALLBACK_OPENING);
    const out = render_(BODY, raw);
    expect(out).toBe(`Hi Michael,\n\n${BARRY_FALLBACK_OPENING}\n\n${BODY}`);
    expect(count(out, 'I’m hoping you can make it')).toBe(1);
  });

  it('keeps a good, specific context sentence untouched', () => {
    const good = 'I wanted to make sure this was on your radar given the community work you’ve been involved with.';
    expect(finalizeBarryOpening(good, { firstName: 'Michael', body: BODY })).toBe(good);
  });

  it('adds no line when Barry produced nothing (failed personalization)', () => {
    expect(render_(BODY, '')).toBe(`Hi Michael,\n\n${BODY}`);
  });

  it('strips a leading name only when it is the recipient’s or the tag', () => {
    expect(stripLeadingGreeting('Utah, here we come.', 'Michael')).toBe('Utah, here we come.');
  });
});

describe('Send Test shows which server sent it', { timeout: 20000 }, () => {
  beforeEach(() => {
    mockSendEmailViaGmail.mockReset();
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      return { json: async () => ({ results: body.contacts.map(c => ({ contactId: c.contactId, success: true, openingLine: `Hey Michael, ${CLEAN}` })) }) };
    });
  });

  async function sendTest() {
    render(<BulkComposeModal contacts={[MICHAEL]} onClose={() => {}} initialCadenceName="STAGING - People Pitch Test" initialSubject={SUBJECT} initialBody={BODY} />);
    fireEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
    expect((await screen.findByTestId('rendered-body-m1')).textContent).toBe(`Hi Michael,\n\n${CLEAN}\n\n${BODY}`);
    fireEvent.click(screen.getByRole('button', { name: /Send Test to Me/ }));
  }

  it('confirms an up-to-date server with both versions', async () => {
    mockSendEmailViaGmail.mockResolvedValue({ result: 'sent', emailFormat: 'rfc2047-1' });
    await sendTest();
    expect(await screen.findByText(new RegExp(`app ${EMAIL_RENDER_VERSION} · server rfc2047-1`))).toBeInTheDocument();
    expect(mockSendEmailViaGmail.mock.calls[0][0].body).toBe(`Hi Michael,\n\n${CLEAN}\n\n${BODY}`);
  });

  it('warns loudly when the server that sent the test is outdated', async () => {
    mockSendEmailViaGmail.mockResolvedValue({ result: 'sent' }); // older deploy: no emailFormat
    await sendTest();
    expect(await screen.findByText(/email server that sent it is outdated/)).toBeInTheDocument();
    expect(screen.getByText(/server OUTDATED/)).toBeInTheDocument();
  });

  it('the Gmail function reports its format version in every successful send', () => {
    const src = readFileSync('netlify/functions/gmail-send-quick.js', 'utf8');
    expect(src).toMatch(/export const EMAIL_FORMAT_VERSION = 'rfc2047-1'/);
    expect(src).toMatch(/emailFormat: EMAIL_FORMAT_VERSION/);
    expect(readFileSync('src/utils/sendActionResolver.js', 'utf8')).toMatch(/emailFormat: data\.emailFormat \?\? null/);
  });
});
