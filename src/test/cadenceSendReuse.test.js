/**
 * Cadence reuse, resend protection and list reliability.
 *
 *   sortCadencesByRecency   interrupted sends stay in the list
 *   getCadenceStatus        …and are labelled Interrupted, not Draft/Active
 *   cadenceTemplate         reuse the template, not the first recipient's email
 *   distinctCadencesForReuse one picker entry per cadence name
 *   loadAlreadyDelivered    who already received a cadence, incl. interrupted sends
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const mockGetDocs = vi.hoisted(() => vi.fn());
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...p) => ({ path: p.join('/') })),
  query: vi.fn((ref, ...c) => ({ ref, c })),
  where: vi.fn((f, op, v) => ({ f, op, v })),
  getDocs: mockGetDocs,
}));
vi.mock('../firebase/config', () => ({ db: {} }));

import {
  sortCadencesByRecency, cadenceTemplate, distinctCadencesForReuse, loadAlreadyDelivered,
  MAX_BULK_CONTACTS, PERSONALIZE_CHUNK, renderCadenceEmail, greetingFor, firstNameFor,
} from '../utils/cadenceSend';

const ts = (iso) => ({ toMillis: () => new Date(iso).getTime(), toDate: () => new Date(iso) });

describe('cadence list reliability', () => {
  it('keeps a send with no completedAt in the list, sorted by when it started', () => {
    const sorted = sortCadencesByRecency([
      { id: 'old-done', completedAt: ts('2026-09-01T10:00:00Z'), createdAt: ts('2026-09-01T09:59:00Z') },
      { id: 'interrupted', createdAt: ts('2026-10-01T10:00:00Z'), status: 'active' },
      { id: 'recent-done', completedAt: ts('2026-09-20T10:00:00Z') },
    ]);
    expect(sorted.map(c => c.id)).toEqual(['interrupted', 'recent-done', 'old-done']);
  });

  it('CadencesList no longer orders its query by completedAt (which hides docs lacking it)', () => {
    const src = readFileSync('src/pages/Scout/CadencesList.jsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/orderBy\(\s*['"]completedAt/);
    expect(src).toContain('sortCadencesByRecency');
  });
});

describe('getCadenceStatus', () => {
  // Imported lazily: CadenceDetail pulls in UI modules this file does not need mocked.
  let getCadenceStatus;
  beforeEach(async () => {
    vi.doMock('../theme/ThemeContext', () => ({ useT: () => ({}) }));
    ({ getCadenceStatus } = await import('../pages/Scout/CadenceDetail'));
  });

  const now = new Date('2026-10-02T12:00:00Z').getTime();

  it('labels an active send with no recent activity as Interrupted', () => {
    expect(getCadenceStatus({ status: 'active', createdAt: ts('2026-10-02T10:00:00Z') }, now)).toBe('Interrupted');
    expect(getCadenceStatus({
      status: 'active', createdAt: ts('2026-10-02T10:00:00Z'), lastSentAt: ts('2026-10-02T11:50:00Z'),
    }, now)).toBe('Active');
  });

  it('keeps the existing labels for completed and legacy docs', () => {
    expect(getCadenceStatus({ completedAt: ts('2026-10-01T00:00:00Z'), status: 'completed' }, now)).toBe('Completed');
    expect(getCadenceStatus({ sentCount: 3 }, now)).toBe('Active');
    expect(getCadenceStatus({}, now)).toBe('Draft');
  });
});

describe('cadenceTemplate — reuse the message, not the first email', () => {
  it('uses the stored template when present', () => {
    expect(cadenceTemplate({
      subject: 'You are invited, Aaron', body: 'Hi Aaron,\n\nPersonal line\n\nBody',
      templateSubject: 'You are invited, {{first_name}}', templateBody: 'Body', path: 'write_your_own',
      personalizedWithBarry: true,
    })).toMatchObject({ subject: 'You are invited, {{first_name}}', body: 'Body', legacy: false, personalize: true });
  });

  it('strips the first recipient greeting from an older cadence and flags it for review', () => {
    const t = cadenceTemplate({ subject: 'Invite', body: 'Hi Aaron,\n\nJoin us on Friday.' });
    expect(t.body).toBe('Join us on Friday.');
    expect(t.legacy).toBe(true);
  });

  it('offers each cadence name once, newest send first', () => {
    const list = distinctCadencesForReuse([
      { id: 'a1', name: 'Beyond Words Invitation', createdAt: ts('2026-09-01T00:00:00Z') },
      { id: 'a2', name: 'Beyond Words Invitation', createdAt: ts('2026-09-15T00:00:00Z') },
      { id: 'b', name: 'People Pitch Invite', createdAt: ts('2026-09-10T00:00:00Z') },
      { id: 'unnamed', name: '' },
    ]);
    expect(list.map(c => c.id)).toEqual(['a2', 'b']);
  });
});

describe('loadAlreadyDelivered — resend protection', () => {
  beforeEach(() => mockGetDocs.mockReset());

  it('collects people delivered by any send with that name, including interrupted ones', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { data: () => ({ contacts: [{ contactId: 'c1', status: 'sent' }, { contactId: 'c2', status: 'failed' }, { contactId: 'c3', status: 'opened' }] }) },
        // Interrupted before its completion write: rows still 'pending', ids recorded as they sent.
        { data: () => ({ contacts: [{ contactId: 'c4', status: 'pending' }], deliveredContactIds: ['c4'] }) },
      ],
    });
    const ids = await loadAlreadyDelivered('u1', ' Beyond Words Invitation ');
    expect([...ids].sort()).toEqual(['c1', 'c3', 'c4']);
    const q = mockGetDocs.mock.calls[0][0];
    expect(q.c[0]).toEqual({ f: 'name', op: '==', v: 'Beyond Words Invitation' });
  });

  it('checks nothing without a cadence name', async () => {
    expect((await loadAlreadyDelivered('u1', '  ')).size).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
  });
});

describe('send limits', () => {
  it('allows a 50-person import in one send, personalized in chunks the server accepts', () => {
    expect(MAX_BULK_CONTACTS).toBeGreaterThanOrEqual(50);
    expect(PERSONALIZE_CHUNK).toBe(25);
  });
});

describe('renderCadenceEmail — the one message model', () => {
  const ana = { name: 'Ana Lopez', first_name: 'Ana', company_name: 'Acme' };

  it('greeting mode: Hi {first}, + Barry line + body, tags filled', () => {
    expect(renderCadenceEmail({
      subject: 'Invite for {{first_name}}', body: 'See you, {{company}}.', contact: ana, openingLine: 'Loved your talk.',
    })).toEqual({ subject: 'Invite for Ana', body: 'Hi Ana,\n\nLoved your talk.\n\nSee you, Acme.', inline: false });
  });

  it('greeting mode without personalization drops the opening line', () => {
    expect(renderCadenceEmail({ subject: 'S', body: 'B', contact: ana, openingLine: 'x', personalize: false }).body)
      .toBe('Hi Ana,\n\nB');
  });

  it('inline mode fills {{personalize}} in place; the system greeting replaces the body’s own', () => {
    expect(renderCadenceEmail({ subject: 'S', body: 'Dear {{first_name}}, {{personalize}}', contact: ana, openingLine: 'great work.' }).body)
      .toBe('Hi Ana,\n\nGreat work.');
  });

  it('never sends a literal {{personalize}} when Barry failed for a contact', () => {
    expect(renderCadenceEmail({ subject: 'S', body: 'Hello. {{personalize}} Bye.', contact: ana, openingLine: '' }).body)
      .toBe('Hi Ana,\n\nHello.  Bye.');
  });

  it('does not use an email address as a first name', () => {
    const emailOnly = { name: 'sam@x.com', email: 'sam@x.com' };
    expect(firstNameFor(emailOnly)).toBe('');
    expect(greetingFor(emailOnly)).toBe('Hi,');
    expect(greetingFor({ name: 'Sam Ray' })).toBe('Hi Sam,');
  });
});

