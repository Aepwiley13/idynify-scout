/**
 * GMAIL SEND QUICK — MIME construction tests (Phase 1.5)
 *
 * Unit-tests the exported buildRawEmail and prepareAttachment helpers:
 *   - no attachment / no cc → byte-identical to the pre-1.5 plain-text format
 *   - cc → Cc header present
 *   - attachment → valid multipart/mixed with a base64 application/pdf part
 *   - attachment validation: non-PDF, bad base64, oversized, header injection
 *
 * The module's side-effectful imports (googleapis, firebase-admin) are mocked;
 * only the pure helpers are exercised here.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('googleapis', () => ({
  google: { auth: { OAuth2: class {} }, gmail: vi.fn() },
}));
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: () => [{}],
  cert: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: {},
}));
vi.mock('../../netlify/functions/utils/gmailSignature.js', () => ({
  getGmailSignature: vi.fn(),
  appendSignature: (body) => body,
}));

import { buildRawEmail, prepareAttachment } from '../../netlify/functions/gmail-send-quick.js';

const base = {
  toEmail: 'jane@acme.com',
  recipientName: 'Jane Doe',
  subject: 'Quick question',
  bodyText: 'Hello Jane,\n\nHere is the message.',
};

// "%PDF-1.4 test" base64-encoded
const PDF_B64 = btoa('%PDF-1.4 test');

describe('buildRawEmail', () => {
  it('produces the exact pre-1.5 plain-text format with no attachment and no cc', () => {
    const raw = buildRawEmail({ ...base, ccHeader: null, attachment: null });
    expect(raw).toBe(
      'To: Jane Doe <jane@acme.com>\n' +
      'Subject: Quick question\n' +
      'Content-Type: text/plain; charset=utf-8\n' +
      'MIME-Version: 1.0\n' +
      '\n' +
      'Hello Jane,\n\nHere is the message.'
    );
  });

  it('adds a Cc header when ccHeader is provided', () => {
    const raw = buildRawEmail({ ...base, ccHeader: 'boss@acme.com', attachment: null });
    expect(raw).toContain('To: Jane Doe <jane@acme.com>\nCc: boss@acme.com\nSubject: Quick question');
  });

  it('builds a multipart/mixed message when an attachment is present', () => {
    const { part } = prepareAttachment({ data: PDF_B64, filename: 'guide.pdf', mimeType: 'application/pdf' });
    const raw = buildRawEmail({ ...base, ccHeader: 'boss@acme.com', attachment: part });

    const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();

    // Headers
    expect(raw).toContain('Cc: boss@acme.com');
    expect(raw).toContain('MIME-Version: 1.0');
    expect(raw).toContain(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    // Two parts plus terminator
    expect(raw.split(`--${boundary}\n`).length - 1).toBe(2);
    expect(raw).toContain(`--${boundary}--`);

    // Text part carries the body
    expect(raw).toContain('Content-Type: text/plain; charset=utf-8\n\nHello Jane,');

    // PDF part
    expect(raw).toContain('Content-Type: application/pdf; name="guide.pdf"');
    expect(raw).toContain('Content-Transfer-Encoding: base64');
    expect(raw).toContain('Content-Disposition: attachment; filename="guide.pdf"');
    expect(raw).toContain(PDF_B64);
  });

  it('wraps long base64 data at 76 characters', () => {
    const bigData = btoa('x'.repeat(600));
    const { part } = prepareAttachment({ data: bigData, filename: 'big.pdf' });
    const raw = buildRawEmail({ ...base, ccHeader: null, attachment: part });
    const dataLines = raw.split('Content-Disposition')[1].split('\n').slice(2);
    const b64Lines = dataLines.filter(l => /^[A-Za-z0-9+/=]+$/.test(l));
    expect(b64Lines.length).toBeGreaterThan(1);
    expect(b64Lines.every(l => l.length <= 76)).toBe(true);
  });
});

describe('prepareAttachment', () => {
  it('accepts a valid PDF attachment and defaults mimeType', () => {
    const { error, part } = prepareAttachment({ data: PDF_B64, filename: 'doc.pdf' });
    expect(error).toBeUndefined();
    expect(part).toEqual({ data: PDF_B64, filename: 'doc.pdf', mimeType: 'application/pdf' });
  });

  it('strips a data-URL prefix and whitespace from the base64 payload', () => {
    const { part } = prepareAttachment({
      data: `data:application/pdf;base64,${PDF_B64.slice(0, 8)}\n${PDF_B64.slice(8)}`,
      filename: 'doc.pdf',
    });
    expect(part.data).toBe(PDF_B64);
  });

  it('rejects non-PDF mime types', () => {
    const { error } = prepareAttachment({ data: PDF_B64, filename: 'doc.docx', mimeType: 'application/msword' });
    expect(error).toMatch(/Only PDF attachments/);
  });

  it('rejects invalid base64 and missing fields', () => {
    expect(prepareAttachment({ data: 'not!!valid@@base64', filename: 'x.pdf' }).error).toMatch(/not valid base64/);
    expect(prepareAttachment({ filename: 'x.pdf' }).error).toMatch(/base64-encoded string/);
    expect(prepareAttachment({ data: PDF_B64 }).error).toMatch(/filename is required/);
    expect(prepareAttachment('nope').error).toBeTruthy();
    expect(prepareAttachment(null).error).toBeTruthy();
  });

  it('rejects attachments over the 10MB limit', () => {
    // Fake an ~11MB decoded payload without allocating it: 11MB * 4/3 base64 chars
    const hugeLength = Math.ceil((11 * 1024 * 1024 * 4) / 3);
    const huge = 'A'.repeat(hugeLength);
    expect(prepareAttachment({ data: huge, filename: 'huge.pdf' }).error).toMatch(/10MB limit/);
  });

  it('sanitizes header-injection attempts in the filename', () => {
    const { part } = prepareAttachment({
      data: PDF_B64,
      filename: 'evil"\r\nBcc: attacker@x.com\r\n.pdf',
    });
    expect(part.filename).not.toMatch(/[\r\n"]/);
    // Without CRLF or quotes the leftover text stays inside the quoted
    // filename value — it can never start a new header line
    const raw = buildRawEmail({ ...base, ccHeader: null, attachment: part });
    expect(raw).not.toMatch(/^Bcc:/m);
  });
});
