/**
 * TRACK OPEN + tracking-pixel embed tests (Phase 2, Workstream A)
 *
 * - track-open handler: always returns a valid 1x1 GIF with the right headers,
 *   even for missing/malformed params; records the open (first-open only) when
 *   valid params decode.
 * - buildTrackingPixel / buildRawEmail: pixel URL shape + opt-in embed.
 *
 * firebase-admin is mocked — no real Firestore is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── firebase-admin mock (shared across both modules under test) ───
const timelineAdd = vi.fn().mockResolvedValue();
const contactUpdate = vi.fn().mockResolvedValue();
const txUpdate = vi.fn();
let txGetResult;

const ref = {};
ref.doc = vi.fn(() => ref);
ref.update = contactUpdate;
ref.collection = vi.fn(() => ({ doc: vi.fn(() => ref), add: timelineAdd }));

const runTransaction = vi.fn(async (fn) => fn({
  get: vi.fn().mockResolvedValue(txGetResult),
  update: txUpdate,
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: () => [{}],
  cert: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: vi.fn(() => ({ doc: vi.fn(() => ref) })), runTransaction }),
  FieldValue: { increment: (n) => ({ __increment: n }), serverTimestamp: () => ({ __ts: 'server' }) },
  Timestamp: { now: () => ({ __ts: 'now' }) },
}));
// gmail-send-quick's extra side-effect imports
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: class {} }, gmail: vi.fn() } }));
vi.mock('../../netlify/functions/utils/gmailSignature.js', () => ({
  getGmailSignatureHtml: vi.fn(),
  appendSignatureHtml: (body) => body,
}));

const { handler } = await import('../../netlify/functions/track-open.js');
const { buildTrackingPixel, buildRawEmail } = await import('../../netlify/functions/gmail-send-quick.js');

const GIF_HEADER = 'GIF89a';

function decodeBody(res) {
  return Buffer.from(res.body, 'base64');
}

beforeEach(() => {
  timelineAdd.mockClear();
  contactUpdate.mockClear();
  txUpdate.mockClear();
  runTransaction.mockClear();
  txGetResult = { exists: true, data: () => ({ contacts: [{ contactId: 'c1', opened: false }], openedCount: 0 }) };
});

describe('track-open handler', () => {
  it('returns a valid 1x1 GIF with the correct headers when no params are given', async () => {
    const res = await handler({ queryStringParameters: null });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/gif');
    expect(res.headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate');
    expect(res.isBase64Encoded).toBe(true);
    expect(decodeBody(res).toString('ascii', 0, 6)).toBe(GIF_HEADER);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('returns the pixel without throwing on malformed base64 data', async () => {
    const res = await handler({ queryStringParameters: { data: '@@not-valid@@' } });
    expect(res.statusCode).toBe(200);
    expect(decodeBody(res).toString('ascii', 0, 6)).toBe(GIF_HEADER);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('returns the pixel when params decode but lack required ids', async () => {
    const data = Buffer.from(JSON.stringify({ userId: 'u1' })).toString('base64');
    const res = await handler({ queryStringParameters: { data } });
    expect(res.statusCode).toBe(200);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('records a first open: increments openedCount, flags the contact, writes timeline + last_opened_at', async () => {
    const data = Buffer.from(JSON.stringify({
      userId: 'u1', cadenceId: 'cad1', contactId: 'c1', messageId: 'trk-123',
    })).toString('base64');

    const res = await handler({ queryStringParameters: { data } });

    expect(res.statusCode).toBe(200);
    expect(decodeBody(res).toString('ascii', 0, 6)).toBe(GIF_HEADER);
    expect(runTransaction).toHaveBeenCalledTimes(1);

    const update = txUpdate.mock.calls[0][1];
    expect(update.openedCount).toEqual({ __increment: 1 });
    expect(update.contacts[0]).toMatchObject({ contactId: 'c1', opened: true });

    expect(timelineAdd).toHaveBeenCalledTimes(1);
    expect(timelineAdd.mock.calls[0][0]).toMatchObject({
      type: 'email_opened',
      metadata: { cadenceId: 'cad1', gmailMessageId: 'trk-123' },
    });
    expect(contactUpdate).toHaveBeenCalledWith({ last_opened_at: { __ts: 'server' } });
  });

  it('does not increment or write timeline on a repeat open (already opened)', async () => {
    txGetResult = { exists: true, data: () => ({ contacts: [{ contactId: 'c1', opened: true }], openedCount: 1 }) };
    const data = Buffer.from(JSON.stringify({
      userId: 'u1', cadenceId: 'cad1', contactId: 'c1', messageId: 'trk-123',
    })).toString('base64');

    const res = await handler({ queryStringParameters: { data } });

    expect(res.statusCode).toBe(200);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(timelineAdd).not.toHaveBeenCalled();
    expect(contactUpdate).not.toHaveBeenCalled();
  });
});

describe('buildTrackingPixel', () => {
  it('builds a 1x1 hidden img whose data param decodes to the send params', () => {
    const tag = buildTrackingPixel({
      baseUrl: 'https://app.example.com/',
      userId: 'u1', contactId: 'c1', cadenceId: 'cad1', messageId: 'trk-9',
    });
    expect(tag).toMatch(/width="1" height="1"/);
    expect(tag).toMatch(/display:none/);
    // Single collapsed slash after the domain (trailing slash trimmed)
    expect(tag).toContain('https://app.example.com/.netlify/functions/track-open?data=');

    const data = decodeURIComponent(tag.match(/data=([^"]+)/)[1]);
    const params = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    expect(params).toEqual({ contactId: 'c1', cadenceId: 'cad1', userId: 'u1', messageId: 'trk-9' });
  });
});

describe('buildRawEmail tracking pixel', () => {
  const base = {
    toEmail: 'jane@acme.com', recipientName: 'Jane Doe',
    subject: 'Hi', bodyText: 'Hello Jane,',
  };

  it('appends the pixel to the end of the HTML body when provided', () => {
    const pixel = '<img src="https://x/.netlify/functions/track-open?data=abc" width="1" height="1" border="0" style="display:none;" alt="">';
    const raw = buildRawEmail({ ...base, ccHeader: null, attachment: null, trackingPixel: pixel });
    expect(raw.endsWith('<p>Hello Jane,</p>' + pixel)).toBe(true);
  });

  it('omits the pixel entirely when not provided', () => {
    const raw = buildRawEmail({ ...base, ccHeader: null, attachment: null });
    expect(raw).not.toContain('track-open');
    expect(raw.endsWith('<p>Hello Jane,</p>')).toBe(true);
  });
});
