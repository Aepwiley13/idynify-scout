/* global Buffer */
/**
 * People Pitch email output — the two release blockers found in a real Gmail test.
 *
 *  1. Subject mojibake. "tomorrow — People Pitch" arrived as
 *     "tomorrow Ã¢Â€Â” People Pitch". Root cause: buildRawEmail wrote the
 *     subject into the raw RFC 2822 header unencoded. Headers must be 7-bit;
 *     the em dash's UTF-8 bytes were read as Latin-1. Now RFC 2047-encoded.
 *
 *  2. Duplicate greeting / name: "Hi Michael, / Michael, I'm reaching out… /
 *     Hey Michael, I'm hoping…". The system greeting is now the only one.
 *
 * These tests run the REAL rendering function and the REAL raw-message builder
 * and then decode the payload the way a mail client does, so what is asserted
 * is what Gmail receives.
 */
import { describe, it, expect, vi } from 'vitest';

// The send function's side-effectful imports, mocked exactly as gmailSendQuick.test.js does.
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {} }, gmail: vi.fn() } }));
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{}], cert: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}), FieldValue: {} }));
vi.mock('../../netlify/functions/utils/gmailSignature.js', () => ({
  getGmailSignatureHtml: vi.fn(),
  appendSignatureHtml: (body) => body,
}));
vi.mock('../firebase/config', () => ({ db: {} }));
import { renderCadenceEmail } from '../utils/cadenceSend';
import { stripLeadingGreeting, cleanBarryOpening } from '../utils/emailGreeting';
import { buildRawEmail, encodeHeaderValue } from '../../netlify/functions/gmail-send-quick.js';

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
const BARRY = 'I thought you’d appreciate what’s happening tomorrow given your connection to the community.';

// ── A mail client's view of the raw message ─────────────────────────────────

/** What the Gmail API receives: the raw message, UTF-8 → base64url (as the handler does). */
function toGmailRaw(raw) {
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url back to the message bytes, then decode RFC 2047 words in a header. */
function receivedHeader(gmailRaw, name) {
  const bytes = Buffer.from(gmailRaw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const headerBlock = bytes.toString('latin1').split('\n\n')[0]; // headers are ASCII by contract
  const line = headerBlock.split('\n').find(l => l.startsWith(`${name}: `));
  const value = line.slice(name.length + 2);
  return value
    .replace(/\?=\s+=\?/g, '?==?') // whitespace between adjacent encoded words is not content
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
}

function receivedBodyUtf8(gmailRaw) {
  const bytes = Buffer.from(gmailRaw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return bytes.toString('utf8');
}

function rawFor(subject, { body = '<p>x</p>', attachment = null } = {}) {
  return buildRawEmail({
    toEmail: 'aaron@example.com', recipientName: 'Aaron', subject, bodyText: body,
    ccHeader: null, attachment, trackingPixel: '', signatureHtml: '',
  });
}

// ── Blocker 1: UTF-8 in the subject ─────────────────────────────────────────

describe('subject encoding survives to the Gmail payload', () => {
  const CASES = [
    `[TEST] ${SUBJECT}`,
    SUBJECT,
    'It’s tomorrow — don’t miss it',
    'Range 9–5 · “Quoted” · café · Déjà vu',
    `${'A very long subject line that keeps going — '.repeat(4)}end`,
  ];

  it.each(CASES)('decodes byte-for-byte: %s', (subject) => {
    for (const attachment of [null, { data: 'QUJD', filename: 'flyer.pdf', mimeType: 'application/pdf' }]) {
      const gmailRaw = toGmailRaw(rawFor(subject, { attachment }));
      const decoded = receivedHeader(gmailRaw, 'Subject');
      expect(decoded).toBe(subject);
      expect(Buffer.from(decoded, 'utf8').equals(Buffer.from(subject, 'utf8'))).toBe(true);
    }
  });

  it('puts only 7-bit ASCII in the header lines', () => {
    const raw = rawFor(`[TEST] ${SUBJECT}`);
    const headers = raw.split('\n\n')[0];
    expect(/^[\t\n\r\x20-\x7E]*$/.test(headers)).toBe(true);
    expect(headers).toMatch(/^Subject: =\?UTF-8\?B\?/m);
  });

  it('reproduces the reported mojibake from the old raw header, for the record', () => {
    // UTF-8 bytes of the em dash read as Latin-1 and re-encoded, then read again.
    const once = Buffer.from('—', 'utf8').toString('latin1');
    const twice = Buffer.from(once, 'utf8').toString('latin1');
    expect(twice).toBe('Ã¢Â\u0080Â\u0094');
  });

  it('leaves plain-ASCII subjects exactly as before', () => {
    expect(encodeHeaderValue('Quick question')).toBe('Quick question');
    expect(rawFor('Quick question')).toContain('\nSubject: Quick question\n');
  });

  it('keeps every encoded word within the 75-character limit, splitting only on whole characters', () => {
    const encoded = encodeHeaderValue('—'.repeat(60));
    for (const word of encoded.split(' ')) expect(word.length).toBeLessThanOrEqual(75);
  });
});

// ── Blocker 2: one greeting, no repeated name ───────────────────────────────

describe('one greeting layer', () => {
  const EXPECTED = `Hi Michael,\n\n${BARRY}\n\n${BODY}`;

  it('People Pitch: greeting + one Barry sentence + the shared body, exactly', () => {
    const { subject, body } = renderCadenceEmail({ subject: SUBJECT, body: BODY, contact: MICHAEL, openingLine: BARRY });
    expect(subject).toBe(SUBJECT);
    expect(body).toBe(EXPECTED);
    expect(body.match(/Michael/g)).toHaveLength(1);
  });

  it.each([
    'Michael, I thought you’d appreciate what’s happening tomorrow given your connection to the community.',
    'Hey Michael, I thought you’d appreciate what’s happening tomorrow given your connection to the community.',
    'Hi Michael — I thought you’d appreciate what’s happening tomorrow given your connection to the community.',
    'Hello Michael! I thought you’d appreciate what’s happening tomorrow given your connection to the community.',
    'michael, i thought you’d appreciate what’s happening tomorrow given your connection to the community.',
  ])('strips a greeting or leading name from Barry’s line: %s', (line) => {
    const { body } = renderCadenceEmail({ subject: SUBJECT, body: BODY, contact: MICHAEL, openingLine: line });
    expect(body.startsWith('Hi Michael,\n\nI thought you’d appreciate')).toBe(true);
    expect(body.match(/Michael/g)).toHaveLength(1);
  });

  it.each([
    'Hey {{first_name}}, I’m hoping you can make it',
    'Hi {{first_name}},\n\nI’m hoping you can make it',
    'Hey Michael, I’m hoping you can make it',
    'Hello there — I’m hoping you can make it',
  ])('drops a greeting the user typed into the shared body: %s', (start) => {
    const userBody = BODY.replace('I’m hoping you can make it', start);
    const { body } = renderCadenceEmail({ subject: SUBJECT, body: userBody, contact: MICHAEL, openingLine: BARRY });
    expect(body).toBe(EXPECTED);
  });

  it('a shared body without a greeting gets exactly one', () => {
    const { body } = renderCadenceEmail({ subject: 'S', body: 'Body.', contact: MICHAEL, openingLine: '' });
    expect(body).toBe('Hi Michael,\n\nBody.');
  });

  it('leaves a name used later in Barry’s sentence, and non-greeting openers, alone', () => {
    expect(cleanBarryOpening('Given your work with United Angels, Michael, this felt right.', 'Michael'))
      .toBe('Given your work with United Angels, Michael, this felt right.');
    expect(stripLeadingGreeting('Hiking season is here.')).toBe('Hiking season is here.');
    expect(stripLeadingGreeting('Hi-res photos attached.')).toBe('Hi-res photos attached.');
    expect(stripLeadingGreeting('Dear friends of the arts are welcome.')).toBe('Dear friends of the arts are welcome.');
  });

  it('{{personalize}} mode is unchanged — the body owns its greeting there', () => {
    const { body } = renderCadenceEmail({
      subject: 'S', body: 'Hey {{first_name}}, {{personalize}} See you.', contact: MICHAEL, openingLine: 'great work.',
    });
    expect(body).toBe('Hey Michael, great work. See you.');
  });
});

// ── The full payload Gmail gets ─────────────────────────────────────────────

describe('People Pitch, end to end through the raw Gmail payload', () => {
  it('carries the subject, one greeting, the UTF-8 body and a clickable Luma link', () => {
    const rendered = renderCadenceEmail({
      subject: SUBJECT, body: BODY, contact: MICHAEL, openingLine: `Michael, ${BARRY}`,
    });
    const gmailRaw = toGmailRaw(rawFor(`[TEST] ${rendered.subject}`, { body: rendered.body }));

    expect(receivedHeader(gmailRaw, 'Subject')).toBe(`[TEST] ${SUBJECT}`);
    const html = receivedBodyUtf8(gmailRaw);
    expect(html).toContain('<p>Hi Michael,</p><p>I thought you’d appreciate');
    expect(html).toContain('<p>I’m hoping you can make it to People Pitch tomorrow.</p>');
    expect(html).toContain('United Angels — supporting individuals');
    expect(html).toContain('<a href="https://luma.com/ocr6c6e4">https://luma.com/ocr6c6e4</a>');
    expect(html.match(/Michael/g)).toHaveLength(1);
    expect(html).not.toMatch(/Ã|Â/);
  });

  it('keeps the PDF part intact alongside the encoded subject', () => {
    const attachment = { data: 'JVBERi0xLjQK', filename: 'People Pitch Flyer.pdf', mimeType: 'application/pdf' };
    const raw = rawFor(`[TEST] ${SUBJECT}`, { body: 'Body', attachment });
    expect(raw).toContain('Content-Type: application/pdf; name="People Pitch Flyer.pdf"');
    expect(raw).toContain('Content-Disposition: attachment; filename="People Pitch Flyer.pdf"');
    expect(raw).toContain('JVBERi0xLjQK');
    expect(receivedHeader(toGmailRaw(raw), 'Subject')).toBe(`[TEST] ${SUBJECT}`);
  });

  it('encodes a non-ASCII attachment name rather than sending raw bytes', () => {
    const raw = rawFor('S', { attachment: { data: 'QUJD', filename: 'Café flyer.pdf', mimeType: 'application/pdf' } });
    expect(raw).toContain("filename*=UTF-8''Caf%C3%A9%20flyer.pdf");
    expect(/^[\t\n\r\x20-\x7E]*$/.test(raw)).toBe(true);
  });
});
