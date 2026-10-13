/* global Buffer */
/**
 * Every Gmail send path RFC 2047-encodes its headers (#685).
 *
 * gmail-send-quick.js was fixed in #684: it wrote `Subject:` raw, so "tomorrow
 * — People Pitch" arrived as "tomorrow Ã¢Â€Â” People Pitch". Six other send
 * functions built the header the same old way. They now share
 * utils/emailHeaders.js; this file proves the shared builder round-trips, and
 * pins each function to it so none of them can quietly go back to writing the
 * subject raw.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPlainTextEmail,
  encodeHeaderValue,
  formatAddress,
} from '../../netlify/functions/utils/emailHeaders.js';

const here = dirname(fileURLToPath(import.meta.url));

const SUBJECT = 'Hope you can make it tomorrow — People Pitch';

/** What the Gmail API receives, decoded the way a mail client reads it. */
function receivedHeader(raw, name) {
  const gmailRaw = Buffer.from(raw).toString('base64url');
  const bytes = Buffer.from(gmailRaw, 'base64url');
  const headerBlock = bytes.toString('latin1').split(/\r?\n\r?\n/)[0]; // headers are ASCII by contract
  const line = headerBlock.split(/\r?\n/).find((l) => l.startsWith(`${name}: `));
  return line.slice(name.length + 2)
    .replace(/\?=\s+=\?/g, '?==?') // whitespace between adjacent encoded words is not content
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
}

describe('buildPlainTextEmail', () => {
  const SUBJECTS = [
    SUBJECT,
    'It’s tomorrow — don’t miss it',
    'Range 9–5 · “Quoted” · café · Déjà vu',
    `${'A very long subject line that keeps going — '.repeat(4)}end`,
  ];

  it.each(SUBJECTS)('subject round-trips byte for byte, with either line ending: %s', (subject) => {
    for (const eol of ['\n', '\r\n']) {
      const raw = buildPlainTextEmail({ toName: 'Aaron', toEmail: 'a@example.com', subject, body: 'x', eol });
      const decoded = receivedHeader(raw, 'Subject');
      expect(Buffer.from(decoded, 'utf8').equals(Buffer.from(subject, 'utf8'))).toBe(true);
    }
  });

  it('puts only 7-bit ASCII in the header lines', () => {
    const raw = buildPlainTextEmail({ toName: 'José Núñez', toEmail: 'j@example.com', subject: SUBJECT, body: 'Olá — ✓' });
    const headers = raw.split('\n\n')[0];
    expect(/^[\n\x20-\x7E]*$/.test(headers)).toBe(true);
  });

  it('encodes a non-ASCII display name in To and keeps the address readable', () => {
    const raw = buildPlainTextEmail({ toName: 'José Núñez', toEmail: 'j@example.com', subject: 's', body: 'x' });
    expect(receivedHeader(raw, 'To')).toBe('José Núñez <j@example.com>');
    expect(raw).toMatch(/^To: =\?UTF-8\?B\?[^\n]+ <j@example\.com>$/m);
  });

  it('sends a bare address when there is no display name', () => {
    for (const toName of [undefined, null, '', 'j@example.com']) {
      const raw = buildPlainTextEmail({ toName, toEmail: 'j@example.com', subject: 's', body: 'x' });
      expect(raw.split('\n')[0]).toBe('To: j@example.com');
    }
  });

  it('leaves plain-ASCII headers exactly as written and keeps the body untouched', () => {
    const raw = buildPlainTextEmail({ toName: 'Jane Doe', toEmail: 'jane@acme.com', subject: 'Quick question', body: 'Hi — Jane' });
    expect(raw).toBe(
      'To: Jane Doe <jane@acme.com>\nSubject: Quick question\nContent-Type: text/plain; charset=utf-8\nMIME-Version: 1.0\n\nHi — Jane',
    );
  });

  it('cannot be used to inject a header through the subject', () => {
    const raw = buildPlainTextEmail({ toEmail: 'a@b.com', subject: 'Hi\r\nBcc: evil@x.com', body: 'x' });
    expect(raw).not.toMatch(/^Bcc:/m);
  });
});

describe('the shared helpers are the ones gmail-send-quick already shipped', () => {
  it('formatAddress and encodeHeaderValue behave as before for ASCII', () => {
    expect(encodeHeaderValue('Quick question')).toBe('Quick question');
    expect(formatAddress('Jane Doe', 'jane@acme.com')).toBe('Jane Doe <jane@acme.com>');
  });
});

describe('every Gmail send function encodes its subject', () => {
  const SENDERS = [
    'gmail-send-quick.js',
    'gmail-send.js',
    'gmail-send-wave.js',
    'send-followup.js',
    'process-scheduled-engagements.js',
    'barryActions.js',
    'barry-approve-send.js',
  ];

  it.each(SENDERS)('%s builds headers through utils/emailHeaders.js, never raw', (file) => {
    const src = readFileSync(resolve(here, `../../netlify/functions/${file}`), 'utf8');
    expect(src).toMatch(/['"]\.\/utils\/emailHeaders\.js['"]/);
    // A `Subject: ${…}` template that is not wrapped in encodeHeaderValue is the #684 bug.
    const raw = src.split('\n').filter((l) => /Subject: \$\{/.test(l) && !/encodeHeaderValue\(/.test(l));
    expect(raw).toEqual([]);
  });
});
