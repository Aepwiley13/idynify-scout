/**
 * GMAIL MESSAGE SERVICE — Sprint 1 Team A
 *
 * Covers the pure half of the service: MIME decoding, address parsing, quoted
 * reply stripping, signature extraction, classification, the Section 4 filter,
 * and full NormalizedMessage assembly (validated against Team B's schema).
 *
 * googleapis is mocked — only getOAuthClient touches it, and that is exercised
 * separately with a fake Firestore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal OAuth2 stand-in: refreshAccessToken rejects so the needs_reconnect
// path is exercisable; the happy path never calls it. Declared inside the
// factory because vi.mock is hoisted above every top-level binding.
vi.mock('googleapis', () => {
  class FakeOAuth2 {
    setCredentials(credentials) {
      this.credentials = credentials;
    }

    async refreshAccessToken() {
      throw new Error('invalid_grant');
    }
  }
  return { google: { auth: { OAuth2: FakeOAuth2 }, gmail: vi.fn() } };
});

import {
  decodeBody,
  htmlToText,
  parseEmailAddress,
  splitAddressList,
  getHeader,
  stripQuotedReply,
  extractSignature,
  classifyMessage,
  isAutomatedSender,
  normalizeMessage,
  shouldProcessMessage,
  isKnownContact,
  isKnownIdynifyThread,
  getOAuthClient,
} from '../../netlify/functions/utils/gmailMessageService.js';
import { validateNormalizedMessage } from '../types/normalizedMessage.js';

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64url');

const header = (name, value) => ({ name, value });

// ─────────────────────────────────────────────────────────────────────────────
describe('parseEmailAddress', () => {
  it('splits a quoted display name from the address', () => {
    expect(parseEmailAddress('"Jane Doe" <Jane@Acme.com>')).toEqual({
      email: 'jane@acme.com',
      name: 'Jane Doe',
    });
  });

  it('handles an unquoted display name', () => {
    expect(parseEmailAddress('Jane Doe <jane@acme.com>')).toEqual({
      email: 'jane@acme.com',
      name: 'Jane Doe',
    });
  });

  it('handles a bare address with no display name', () => {
    expect(parseEmailAddress('  JANE@acme.com ')).toEqual({ email: 'jane@acme.com', name: null });
  });

  it('returns an empty email for missing input', () => {
    expect(parseEmailAddress(null)).toEqual({ email: '', name: null });
    expect(parseEmailAddress('')).toEqual({ email: '', name: null });
  });
});

describe('splitAddressList', () => {
  it('does not split on commas inside a quoted display name', () => {
    expect(splitAddressList('"Doe, Jane" <jane@acme.com>, bob@beta.com')).toEqual([
      '"Doe, Jane" <jane@acme.com>',
      'bob@beta.com',
    ]);
  });

  it('returns an empty array for a missing header', () => {
    expect(splitAddressList(null)).toEqual([]);
  });
});

describe('getHeader', () => {
  it('matches case-insensitively', () => {
    const headers = [header('In-Reply-To', '<abc@mail>')];
    expect(getHeader(headers, 'in-reply-to')).toBe('<abc@mail>');
    expect(getHeader(headers, 'Missing')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('decodeBody', () => {
  it('decodes a single-part text/plain message', () => {
    const result = decodeBody({ mimeType: 'text/plain', body: { data: b64('Hello there') } });
    expect(result).toEqual({ bodyText: 'Hello there', bodyHtml: null, attachments: [] });
  });

  it('returns text and HTML separately for multipart/alternative', () => {
    const result = decodeBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Plain version') } },
        { mimeType: 'text/html', body: { data: b64('<p>HTML version</p>') } },
      ],
    });
    expect(result.bodyText).toBe('Plain version');
    expect(result.bodyHtml).toBe('<p>HTML version</p>');
  });

  it('recurses through multipart/alternative nested in multipart/mixed', () => {
    const result = decodeBody({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64('Nested plain') } },
            { mimeType: 'text/html', body: { data: b64('<p>Nested html</p>') } },
          ],
        },
      ],
    });
    expect(result.bodyText).toBe('Nested plain');
    expect(result.bodyHtml).toBe('<p>Nested html</p>');
  });

  it('collects attachment metadata alongside the body', () => {
    const result = decodeBody({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('See attached') } },
        {
          mimeType: 'application/pdf',
          filename: 'proposal.pdf',
          body: { attachmentId: 'ATT_123', size: 20480 },
        },
      ],
    });
    expect(result.bodyText).toBe('See attached');
    expect(result.attachments).toEqual([
      {
        filename: 'proposal.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 20480,
        gmailAttachmentId: 'ATT_123',
      },
    ]);
  });

  it('derives plain text from HTML when there is no text/plain part', () => {
    const result = decodeBody({
      mimeType: 'text/html',
      body: { data: b64('<p>Hi Jane</p><p>Talk soon</p>') },
    });
    expect(result.bodyText).toBe('Hi Jane\nTalk soon');
    expect(result.bodyHtml).toBe('<p>Hi Jane</p><p>Talk soon</p>');
  });

  it('returns an empty body and never null attachments for an empty payload', () => {
    expect(decodeBody(null)).toEqual({ bodyText: '', bodyHtml: null, attachments: [] });
    expect(decodeBody({})).toEqual({ bodyText: '', bodyHtml: null, attachments: [] });
  });
});

describe('htmlToText', () => {
  it('drops script and style blocks', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Visible</p><script>x()</script>')).toBe(
      'Visible'
    );
  });

  it('decodes entities and turns <br> into newlines', () => {
    expect(htmlToText('Tom &amp; Jerry<br>Line&nbsp;two')).toBe('Tom & Jerry\nLine two');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('stripQuotedReply', () => {
  it('cuts at an "On ... wrote:" marker', () => {
    const body = [
      'Yes, that works for me.',
      '',
      'On Mon, Jan 5, 2026 at 9:14 AM Jane Doe <jane@acme.com> wrote:',
      '> Are you free Thursday?',
    ].join('\n');

    const { newContent, quotedContent } = stripQuotedReply(body);
    expect(newContent).toBe('Yes, that works for me.');
    expect(quotedContent).toContain('Are you free Thursday?');
  });

  it('cuts at an Outlook original-message separator', () => {
    const body = 'Sounds good.\n\n-----Original Message-----\nFrom: Jane\nSubject: Hi';
    const { newContent, quotedContent } = stripQuotedReply(body);
    expect(newContent).toBe('Sounds good.');
    expect(quotedContent.startsWith('-----Original Message-----')).toBe(true);
  });

  it('cuts at the Outlook underscore separator', () => {
    const body = `Thanks!\n\n${'_'.repeat(32)}\nFrom: Jane Doe`;
    const { newContent, quotedContent } = stripQuotedReply(body);
    expect(newContent).toBe('Thanks!');
    expect(quotedContent).toContain('From: Jane Doe');
  });

  it('cuts at a From: header block that follows a blank line', () => {
    const body = 'Confirmed.\n\nFrom: Jane Doe <jane@acme.com>\nSent: Monday\nTo: Aaron';
    const { newContent, quotedContent } = stripQuotedReply(body);
    expect(newContent).toBe('Confirmed.');
    expect(quotedContent.startsWith('From: Jane Doe')).toBe(true);
  });

  it('cuts at the first ">" quote line', () => {
    const { newContent, quotedContent } = stripQuotedReply('Agreed.\n\n> earlier text');
    expect(newContent).toBe('Agreed.');
    expect(quotedContent).toBe('> earlier text');
  });

  it('picks the earliest marker when several are present', () => {
    const body = 'New text.\n\n> quoted line\n\n-----Original Message-----\nolder';
    const { newContent } = stripQuotedReply(body);
    expect(newContent).toBe('New text.');
  });

  it('leaves a body with no quoted content untouched', () => {
    const { newContent, quotedContent } = stripQuotedReply('Just a fresh message.');
    expect(newContent).toBe('Just a fresh message.');
    expect(quotedContent).toBeNull();
  });

  it('treats a message that is entirely quoted as having no new content', () => {
    const { newContent, quotedContent } = stripQuotedReply('> all of it is quoted');
    expect(newContent).toBe('');
    expect(quotedContent).toBe('> all of it is quoted');
  });

  it('handles empty input', () => {
    expect(stripQuotedReply('')).toEqual({ newContent: '', quotedContent: null });
    expect(stripQuotedReply(null)).toEqual({ newContent: '', quotedContent: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('extractSignature', () => {
  it('splits on the RFC "--" delimiter', () => {
    const { bodyWithoutSig, signature } = extractSignature(
      'Here is the update.\n\n--\nJane Doe\nVP Sales, Acme'
    );
    expect(bodyWithoutSig).toBe('Here is the update.');
    expect(signature).toBe('--\nJane Doe\nVP Sales, Acme');
  });

  it('splits on a short closing block', () => {
    const { bodyWithoutSig, signature } = extractSignature(
      'Can we move to Thursday?\n\nBest,\nJane\nAcme Corp'
    );
    expect(bodyWithoutSig).toBe('Can we move to Thursday?');
    expect(signature).toBe('Best,\nJane\nAcme Corp');
  });

  it('splits on a mobile footer', () => {
    const { bodyWithoutSig, signature } = extractSignature('On my way.\n\nSent from my iPhone');
    expect(bodyWithoutSig).toBe('On my way.');
    expect(signature).toBe('Sent from my iPhone');
  });

  it('never empties the body — a signature-only message stays as the body', () => {
    const { bodyWithoutSig, signature } = extractSignature('Best,\nJane');
    expect(bodyWithoutSig).toBe('Best,\nJane');
    expect(signature).toBeNull();
  });

  it('ignores a long trailing block that is really body copy', () => {
    const tail = Array.from({ length: 12 }, (_, i) => `Point ${i} about the proposal`).join('\n');
    const { bodyWithoutSig, signature } = extractSignature(`Thanks,\n${tail}`);
    expect(signature).toBeNull();
    expect(bodyWithoutSig).toContain('Point 11');
  });

  it('returns nothing for empty input', () => {
    expect(extractSignature('')).toEqual({ bodyWithoutSig: '', signature: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('classifyMessage', () => {
  const USER = 'aaron@idynify.com';

  it('classifies a "Re:" subject as a reply', () => {
    const headers = [header('Subject', 'Re: Intro call')];
    expect(classifyMessage(headers, 'sure', 'jane@acme.com', USER)).toBe('reply');
  });

  it('classifies an In-Reply-To header as a reply', () => {
    const headers = [header('Subject', 'Intro call'), header('In-Reply-To', '<x@mail>')];
    expect(classifyMessage(headers, 'sure', 'jane@acme.com', USER)).toBe('reply');
  });

  it('treats References as a reply only when the thread has more than one message', () => {
    const headers = [header('Subject', 'Intro call'), header('References', '<x@mail>')];
    expect(
      classifyMessage(headers, 'sure', 'jane@acme.com', USER, { threadMessageCount: 1 })
    ).toBe('unknown');
    expect(
      classifyMessage(headers, 'sure', 'jane@acme.com', USER, { threadMessageCount: 3 })
    ).toBe('reply');
  });

  it('classifies a known sender with no reply markers as new_inbound', () => {
    const headers = [header('Subject', 'Quick question')];
    expect(
      classifyMessage(headers, 'hi', 'jane@acme.com', USER, { isKnownContact: true })
    ).toBe('new_inbound');
  });

  it('falls back to unknown for an unrecognised sender', () => {
    const headers = [header('Subject', 'Quick question')];
    expect(classifyMessage(headers, 'hi', 'stranger@nowhere.com', USER)).toBe('unknown');
  });

  it.each([
    ['no-reply local part', [header('Subject', 'Your weekly digest')], 'no-reply@acme.com'],
    ['List-Unsubscribe header', [header('List-Unsubscribe', '<mailto:x@y>')], 'news@acme.com'],
    ['marketing X-Mailer', [header('X-Mailer', 'Mailchimp v3')], 'hello@acme.com'],
    ['out of office subject', [header('Subject', 'Out of Office: Jane Doe')], 'jane@acme.com'],
    ['undeliverable subject', [header('Subject', 'Undeliverable: Intro')], 'jane@acme.com'],
  ])('classifies %s as automated', (_label, headers, from) => {
    expect(classifyMessage(headers, 'body', from, USER)).toBe('automated');
  });

  it('classifies automated ahead of a "Re:" subject so newsletters are not mistaken for replies', () => {
    const headers = [header('Subject', 'Re: Your weekly digest'), header('List-Id', '<news.acme>')];
    expect(classifyMessage(headers, 'body', 'news@acme.com', USER)).toBe('automated');
  });

  // ── Calendar / auto-responder subject prefixes ────────────────────────────
  // Regression: a production Google Calendar notification was classified
  // "unknown" and flowed through the whole pipeline instead of being filtered.
  it('classifies the production Calendar invite that was misclassified as unknown', () => {
    const headers = [
      header('Subject', 'Updated invitation: Follow Up: Post-Screening Dinner @ Fri Aug 21, 2026'),
    ];
    expect(classifyMessage(headers, 'body', 'realtylayne@gmail.com', USER)).toBe('automated');
  });

  it.each([
    ['Updated invitation:', 'Updated invitation: Dinner @ Fri Aug 21, 2026'],
    ['Invitation:',         'Invitation: Intro call @ Mon Aug 24, 2026'],
    ['Accepted:',           'Accepted: Intro call @ Mon Aug 24, 2026'],
    ['Declined:',           'Declined: Intro call @ Mon Aug 24, 2026'],
    ['Tentative:',          'Tentative: Intro call @ Mon Aug 24, 2026'],
    ['Canceled:',           'Canceled: Intro call @ Mon Aug 24, 2026'],
    ['Cancelled:',          'Cancelled: Intro call @ Mon Aug 24, 2026'],
    ['Event reminder:',     'Event reminder: Intro call @ Mon Aug 24, 2026'],
    ['Reminder:',           'Reminder: Intro call @ Mon Aug 24, 2026'],
  ])('classifies the Calendar prefix %s as automated', (_label, subject) => {
    const headers = [header('Subject', subject)];
    expect(classifyMessage(headers, 'body', 'jane@acme.com', USER)).toBe('automated');
  });

  it.each([
    ['Automatic reply:', 'Automatic reply: Out of the country'],
    ['Auto-reply:',      'Auto-reply: I am away'],
    ['Auto reply:',      'Auto reply: I am away'],
    ['Out of office:',   'Out of office: back Monday'],
    ['OOO:',             'OOO: back Monday'],
  ])('classifies the auto-responder prefix %s as automated', (_label, subject) => {
    const headers = [header('Subject', subject)];
    expect(classifyMessage(headers, 'body', 'jane@acme.com', USER)).toBe('automated');
  });

  it.each([
    ['Delivery Status Notification', 'Delivery Status Notification (Failure)'],
    ['Mail Delivery Subsystem',      'Mail Delivery Subsystem — returned to sender'],
    ['Undeliverable:',               'Undeliverable: Intro call'],
    ['Returned mail:',               'Returned mail: see transcript for details'],
  ])('classifies the bounce notice %s as automated', (_label, subject) => {
    const headers = [header('Subject', subject)];
    expect(classifyMessage(headers, 'body', 'jane@acme.com', USER)).toBe('automated');
  });

  // The prefixes are anchored — these are the cases that would break if they
  // were matched anywhere in the subject.
  it.each([
    ['a mid-subject reminder',  'Quick reminder: can you send the deck?'],
    ['a mid-subject invitation','Following up on the invitation: are you free?'],
    ['a human reply to a Calendar thread', 'Re: Updated invitation: Dinner @ Fri Aug 21, 2026'],
  ])('does not treat %s as automated', (_label, subject) => {
    const headers = [header('Subject', subject)];
    expect(classifyMessage(headers, 'body', 'jane@acme.com', USER)).not.toBe('automated');
  });

  it('classifies a same-domain test address as internal', () => {
    const headers = [header('Subject', 'Ping')];
    expect(classifyMessage(headers, 'body', 'test@idynify.com', USER)).toBe('internal');
  });

  it('does not classify a same-domain colleague as internal', () => {
    const headers = [header('Subject', 'Ping')];
    expect(classifyMessage(headers, 'body', 'sarah@idynify.com', USER)).toBe('unknown');
  });

  // ── Sender-level automation, independent of the subject ───────────────────
  it.each([
    ['calendar-notification@google.com', 'calendar-notification@google.com'],
    ['a calendar.google.com address',    'notifications@calendar.google.com'],
    ['a calendar.google.com subdomain',  'bot@mail.calendar.google.com'],
    ['noreply@',                         'noreply@acme.com'],
    ['no-reply@',                        'no-reply@acme.com'],
    ['donotreply@',                      'donotreply@acme.com'],
    ['a noreply address with a suffix',  'noreply-billing@acme.com'],
  ])('classifies %s as automated whatever the subject says', (_label, from) => {
    // A subject that would otherwise read as a genuine human reply.
    const headers = [header('Subject', 'Re: Thanks for the intro call')];
    expect(classifyMessage(headers, 'body', from, USER)).toBe('automated');
  });

  it('leaves an ordinary sender alone', () => {
    const headers = [header('Subject', 'Re: Thanks for the intro call')];
    expect(classifyMessage(headers, 'body', 'jane@acme.com', USER)).toBe('reply');
  });
});

describe('isAutomatedSender', () => {
  it.each([
    'calendar-notification@google.com',
    'CALENDAR-NOTIFICATION@GOOGLE.COM',
    'anything@calendar.google.com',
    'bot@mail.calendar.google.com',
    'noreply@acme.com',
    'no-reply@acme.com',
    'no.reply@acme.com',
    'donotreply@acme.com',
    'do-not-reply@acme.com',
  ])('flags %s', (email) => {
    expect(isAutomatedSender(email)).toBe(true);
  });

  it.each([
    'jane@acme.com',
    'realtylayne@gmail.com',
    'calendar@acme.com',
    // Not a Google Calendar domain — a lookalike must not be trusted.
    'bot@calendar.google.com.evil.test',
    'replyto@acme.com',
  ])('does not flag %s', (email) => {
    expect(isAutomatedSender(email)).toBe(false);
  });

  it('handles missing or malformed input', () => {
    expect(isAutomatedSender(null)).toBe(false);
    expect(isAutomatedSender('')).toBe(false);
    expect(isAutomatedSender('not-an-email')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const RAW_REPLY = {
  id: 'msg_abc123',
  threadId: 'thr_xyz789',
  internalDate: '1767612840000', // 2026-01-05T11:34:00.000Z
  labelIds: ['INBOX', 'UNREAD'],
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      header('From', '"Jane Doe" <Jane@Acme.com>'),
      header('To', 'aaron@idynify.com'),
      header('Cc', '"Smith, Bob" <bob@acme.com>, carol@acme.com'),
      header('Subject', 'Re: Test integration — Barry Inbox'),
      header('Date', 'Mon, 5 Jan 2026 11:34:00 +0000'),
      header('In-Reply-To', '<orig@mail.idynify.com>'),
    ],
    parts: [
      {
        mimeType: 'text/plain',
        body: {
          data: b64(
            'Hi, this is a test reply. Does this work?\n\n' +
            'Best,\nJane\n\n' +
            'On Mon, Jan 5, 2026 at 9:00 AM Aaron <aaron@idynify.com> wrote:\n' +
            '> Original outreach text\n'
          ),
        },
      },
      { mimeType: 'text/html', body: { data: b64('<p>Hi, this is a test reply.</p>') } },
    ],
  },
};

describe('normalizeMessage', () => {
  it('produces a NormalizedMessage that passes Team B validation', () => {
    const msg = normalizeMessage(RAW_REPLY, 'user_1', 'aaron@idynify.com', {
      threadMessageCount: 2,
    });
    expect(validateNormalizedMessage(msg)).toEqual({ valid: true, errors: [] });
  });

  it('fills identity and envelope fields from the Gmail message', () => {
    const msg = normalizeMessage(RAW_REPLY, 'user_1', 'Aaron@Idynify.com', {
      threadMessageCount: 2,
    });

    expect(msg.idynifyUserId).toBe('user_1');
    expect(msg.gmailAccountId).toBe('aaron@idynify.com');
    expect(msg.gmailMessageId).toBe('msg_abc123');
    expect(msg.gmailThreadId).toBe('thr_xyz789');
    expect(msg.fromEmail).toBe('jane@acme.com');
    expect(msg.fromName).toBe('Jane Doe');
    expect(msg.toEmails).toEqual(['aaron@idynify.com']);
    expect(msg.ccEmails).toEqual(['bob@acme.com', 'carol@acme.com']);
    expect(msg.subject).toBe('Re: Test integration — Barry Inbox');
  });

  it('uses the per-message id, never the thread id', () => {
    const msg = normalizeMessage(RAW_REPLY, 'user_1', 'aaron@idynify.com');
    expect(msg.gmailMessageId).toBe(RAW_REPLY.id);
    expect(msg.gmailMessageId).not.toBe(RAW_REPLY.threadId);
  });

  it('converts internalDate to ISO 8601 UTC', () => {
    const msg = normalizeMessage(RAW_REPLY, 'user_1', 'aaron@idynify.com');
    expect(msg.receivedAt).toBe('2026-01-05T11:34:00.000Z');
  });

  it('strips the quoted reply and the signature out of bodyText', () => {
    const msg = normalizeMessage(RAW_REPLY, 'user_1', 'aaron@idynify.com', {
      threadMessageCount: 2,
    });
    expect(msg.bodyText).toBe('Hi, this is a test reply. Does this work?');
    expect(msg.quotedReplyText).toContain('Original outreach text');
    expect(msg.signature).toBe('Best,\nJane');
    expect(msg.bodyHtml).toBe('<p>Hi, this is a test reply.</p>');
  });

  it('marks a message from the connected account as outbound', () => {
    const raw = {
      ...RAW_REPLY,
      payload: {
        ...RAW_REPLY.payload,
        headers: [
          header('From', 'Aaron <aaron@idynify.com>'),
          header('To', 'jane@acme.com'),
          header('Subject', 'Intro'),
        ],
      },
    };
    const msg = normalizeMessage(raw, 'user_1', 'aaron@idynify.com');
    expect(msg.direction).toBe('outbound');
    // "outbound" is not a valid category — the payload must stay schema-valid.
    expect(msg.category).toBe('unknown');
    expect(validateNormalizedMessage(msg).valid).toBe(true);
  });

  it('derives isFirstMessageInThread from threadMessageCount', () => {
    expect(
      normalizeMessage(RAW_REPLY, 'u', 'aaron@idynify.com', { threadMessageCount: 1 })
        .isFirstMessageInThread
    ).toBe(true);
    expect(
      normalizeMessage(RAW_REPLY, 'u', 'aaron@idynify.com', { threadMessageCount: 4 })
        .isFirstMessageInThread
    ).toBe(false);
  });

  it('falls back to the subject when the body is empty', () => {
    const raw = {
      id: 'm1',
      threadId: 't1',
      internalDate: '1767612840000',
      payload: { mimeType: 'text/plain', headers: [
        header('From', 'jane@acme.com'),
        header('To', 'aaron@idynify.com'),
        header('Subject', 'Subject only'),
      ] },
    };
    const msg = normalizeMessage(raw, 'user_1', 'aaron@idynify.com');
    expect(msg.bodyText).toBe('Subject only');
    expect(validateNormalizedMessage(msg).valid).toBe(true);
  });

  it('falls back to a marker when body and subject are both missing', () => {
    const raw = { id: 'm1', threadId: 't1', internalDate: '1767612840000', payload: { headers: [] } };
    const msg = normalizeMessage(raw, 'user_1', 'aaron@idynify.com');
    expect(msg.subject).toBe('(no subject)');
    expect(msg.bodyText).toBe('(no subject)');
    expect(validateNormalizedMessage(msg).valid).toBe(true);
  });

  it('truncates bodyText at 50,000 characters', () => {
    const raw = {
      id: 'm1',
      threadId: 't1',
      internalDate: '1767612840000',
      payload: {
        mimeType: 'text/plain',
        headers: [header('From', 'jane@acme.com'), header('Subject', 'Long')],
        body: { data: b64('x'.repeat(60000)) },
      },
    };
    const msg = normalizeMessage(raw, 'user_1', 'aaron@idynify.com');
    expect(msg.bodyText).toHaveLength(50000);
    expect(validateNormalizedMessage(msg).valid).toBe(true);
  });

  it('returns empty arrays — never null — for attachments and cc', () => {
    const raw = {
      id: 'm1',
      threadId: 't1',
      internalDate: '1767612840000',
      payload: {
        mimeType: 'text/plain',
        headers: [header('From', 'jane@acme.com'), header('Subject', 'Hi')],
        body: { data: b64('Hello') },
      },
    };
    const msg = normalizeMessage(raw, 'user_1', 'aaron@idynify.com');
    expect(msg.attachments).toEqual([]);
    expect(msg.ccEmails).toEqual([]);
    expect(msg.toEmails).toEqual([]);
  });

  it('falls back to the Date header when internalDate is missing', () => {
    const raw = {
      id: 'm1',
      threadId: 't1',
      payload: {
        mimeType: 'text/plain',
        headers: [
          header('From', 'jane@acme.com'),
          header('Subject', 'Hi'),
          header('Date', 'Mon, 5 Jan 2026 11:34:00 +0000'),
        ],
        body: { data: b64('Hello') },
      },
    };
    const msg = normalizeMessage(raw, 'user_1', 'aaron@idynify.com');
    expect(msg.receivedAt).toBe('2026-01-05T11:34:00.000Z');
    expect(msg.sentAt).toBe('2026-01-05T11:34:00.000Z');
  });

  it('stamps the Sprint 1 ingestion version', () => {
    const msg = normalizeMessage(RAW_REPLY, 'user_1', 'aaron@idynify.com');
    expect(msg.ingestionVersion).toBe('1.0.0');
    expect(() => new Date(msg.ingestedAt).toISOString()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('shouldProcessMessage', () => {
  const base = {
    direction: 'inbound',
    category: 'reply',
    fromEmail: 'jane@acme.com',
    gmailAccountId: 'aaron@idynify.com',
    gmailThreadId: 'thr_1',
  };

  it('processes an inbound reply in the inbox', () => {
    expect(shouldProcessMessage(base, { labelIds: ['INBOX'] })).toEqual({
      process: true,
      reason: 'ok',
    });
  });

  it('processes new_inbound and unknown', () => {
    expect(shouldProcessMessage({ ...base, category: 'new_inbound' }, { labelIds: ['INBOX'] }).process).toBe(true);
    expect(shouldProcessMessage({ ...base, category: 'unknown' }, { labelIds: ['INBOX'] }).process).toBe(true);
  });

  it('skips outbound messages', () => {
    expect(shouldProcessMessage({ ...base, direction: 'outbound' }).process).toBe(false);
  });

  it('skips self-sent messages', () => {
    const msg = { ...base, fromEmail: 'aaron@idynify.com' };
    expect(shouldProcessMessage(msg, { labelIds: ['INBOX'] }).reason).toBe('self_sent');
  });

  it('skips internal test messages', () => {
    expect(shouldProcessMessage({ ...base, category: 'internal' }, { labelIds: ['INBOX'] }).reason)
      .toBe('internal');
  });

  it('skips automated mail on an unknown thread', () => {
    const decision = shouldProcessMessage({ ...base, category: 'automated' }, {
      labelIds: ['INBOX'],
      isKnownThread: false,
    });
    expect(decision).toEqual({ process: false, reason: 'automated_unknown_thread' });
  });

  it('processes automated mail on a known Idynify thread', () => {
    const decision = shouldProcessMessage({ ...base, category: 'automated' }, {
      labelIds: ['INBOX'],
      isKnownThread: true,
    });
    expect(decision.process).toBe(true);
  });

  it.each([['SPAM'], ['TRASH'], ['CATEGORY_PROMOTIONS'], ['CATEGORY_UPDATES'], ['DRAFT']])(
    'skips messages labelled %s',
    (label) => {
      expect(shouldProcessMessage(base, { labelIds: ['INBOX', label] }).process).toBe(false);
    }
  );

  it('skips messages that are in neither INBOX nor SENT', () => {
    expect(shouldProcessMessage(base, { labelIds: ['IMPORTANT'] })).toEqual({
      process: false,
      reason: 'no_inbox_or_sent_label',
    });
  });

  it('processes SENT messages that reached the inbound path', () => {
    expect(shouldProcessMessage(base, { labelIds: ['SENT'] }).process).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Firestore-backed helpers, driven by a minimal fake db.
// ─────────────────────────────────────────────────────────────────────────────

function fakeQuery(empty) {
  const q = {
    where: () => q,
    limit: () => q,
    get: async () => ({ empty, docs: [] }),
  };
  return q;
}

describe('isKnownContact', () => {
  it('returns true when the primary email matches', async () => {
    const db = { collection: () => ({ doc: () => ({ collection: () => fakeQuery(false) }) }) };
    await expect(isKnownContact(db, 'u1', 'Jane@Acme.com')).resolves.toBe(true);
  });

  it('returns false when nothing matches', async () => {
    const db = { collection: () => ({ doc: () => ({ collection: () => fakeQuery(true) }) }) };
    await expect(isKnownContact(db, 'u1', 'stranger@nowhere.com')).resolves.toBe(false);
  });

  it('returns false for a blank email without querying', async () => {
    const db = { collection: () => { throw new Error('should not query'); } };
    await expect(isKnownContact(db, 'u1', '')).resolves.toBe(false);
  });

  it('degrades to false when Firestore throws', async () => {
    const db = { collection: () => ({ doc: () => ({ collection: () => ({
      where: () => ({ limit: () => ({ get: async () => { throw new Error('index missing'); } }) }),
    }) }) }) };
    await expect(isKnownContact(db, 'u1', 'jane@acme.com')).resolves.toBe(false);
  });
});

describe('isKnownIdynifyThread', () => {
  it('returns true when a communication_record exists for the thread', async () => {
    const db = { collection: () => fakeQuery(false) };
    await expect(isKnownIdynifyThread(db, 'u1', 'thr_1')).resolves.toBe(true);
  });

  it('returns false without querying when there is no thread id', async () => {
    const db = { collection: () => { throw new Error('should not query'); } };
    await expect(isKnownIdynifyThread(db, 'u1', null)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getOAuthClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_REDIRECT_URI = 'https://example.test/callback';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  const makeDb = (docData, { exists = true, update = vi.fn() } = {}) => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists,
              data: () => docData,
              ref: { update },
            }),
          }),
        }),
      }),
    }),
  });

  it('returns null when Gmail is not connected', async () => {
    const db = makeDb({ status: 'disconnected' });
    await expect(getOAuthClient('u1', db)).resolves.toBeNull();
  });

  it('returns null when the integration document is missing', async () => {
    const db = makeDb({}, { exists: false });
    await expect(getOAuthClient('u1', db)).resolves.toBeNull();
  });

  it('returns a client with an unexpired token', async () => {
    const db = makeDb({
      status: 'connected',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 3_600_000,
      email: 'aaron@idynify.com',
    });
    const result = await getOAuthClient('u1', db);
    expect(result).not.toBeNull();
    expect(result.gmailData.email).toBe('aaron@idynify.com');
  });

  it('marks needs_reconnect and returns null when the refresh fails', async () => {
    const update = vi.fn();
    const db = makeDb(
      {
        status: 'connected',
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() - 1000,
      },
      { update }
    );

    const result = await getOAuthClient('u1', db);
    expect(result).toBeNull();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ syncStatus: 'needs_reconnect' })
    );
  });

  it('throws when Google OAuth env vars are missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const db = makeDb({ status: 'connected', expiresAt: Date.now() + 3_600_000 });
    await expect(getOAuthClient('u1', db)).rejects.toThrow('Google OAuth not configured');
  });
});
