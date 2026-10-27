/**
 * Find LinkedIn, after "This is Kristin": linkedinEnrichment.js (what a
 * confirmed profile adds) and linkedinConfirm.js (the one write), plus the
 * LinkedIn Link lookup they reuse (findContactByLinkedInUrl).
 *
 * The REAL identity resolver runs here, against a small in-memory Firestore.
 * These tests pin:
 *   - the URL is stored in the canonical identity fields, marked as the user's;
 *   - the profile fills only what the contact does not have, and never touches
 *     name, email, phones, company or website;
 *   - a title or company that differs from the card's is a suggestion, never a write;
 *   - a profile already on another contact, or a contact that already has a
 *     different LinkedIn, writes nothing;
 *   - a repeat confirmation is harmless;
 *   - the lookup's log lines and usage record carry no name or URL.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format } from 'node:util';

// ── In-memory Firestore (paths → documents) ─────────────────────────────────
const store = vi.hoisted(() => ({ docs: new Map(), writes: [] }));
const logApiUsage = vi.hoisted(() => vi.fn());
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const real = await importOriginal();
  const parentOf = path => path.split('/').slice(0, -1).join('/');
  const collection = (_db, ...segments) => ({ kind: 'collection', path: segments.join('/') });
  const doc = (_db, ...segments) => ({ kind: 'doc', path: segments.join('/'), id: segments[segments.length - 1] });
  const where = (field, op, value) => ({ type: 'where', field, op, value });
  const limit = n => ({ type: 'limit', n });
  const query = (ref, ...constraints) => ({ kind: 'query', ref, constraints });
  const snapshot = (path) => {
    const data = store.docs.get(path);
    return { id: path.split('/').pop(), exists: () => data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
  };
  const getDoc = async ref => snapshot(ref.path);
  const getDocs = async (q) => {
    const ref = q.kind === 'query' ? q.ref : q;
    const constraints = q.constraints ?? [];
    const wheres = constraints.filter(c => c.type === 'where');
    const cap = constraints.find(c => c.type === 'limit')?.n ?? Infinity;
    const hits = [...store.docs.keys()]
      .filter(path => parentOf(path) === ref.path)
      .filter(path => wheres.every(w => store.docs.get(path)[w.field] === w.value))
      .slice(0, cap);
    return { empty: hits.length === 0, docs: hits.map(snapshot) };
  };
  // Firestore's update: top-level keys replace, dotted keys set one nested field.
  const updateDoc = async (ref, data) => {
    if (!store.docs.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
    store.writes.push({ kind: 'update', path: ref.path, data: structuredClone(data) });
    const next = structuredClone(store.docs.get(ref.path));
    for (const [key, value] of Object.entries(data)) {
      const [head, ...rest] = key.split('.');
      if (rest.length) next[head] = { ...(next[head] ?? {}), [rest.join('.')]: value };
      else next[key] = value;
    }
    store.docs.set(ref.path, next);
  };
  const refuse = name => async () => { throw new Error(`${name} is not expected here`); };
  return {
    ...real, collection, doc, where, limit, query, getDoc, getDocs, updateDoc,
    setDoc: refuse('setDoc'), addDoc: refuse('addDoc'), deleteDoc: refuse('deleteDoc'), runTransaction: refuse('runTransaction'),
  };
});
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: async () => 'tok_u1' }),
}));

import { enrichmentFromProfile, profileUrl, PROVENANCE } from '../components/capture/linkedinEnrichment.js';
import { confirmLinkedIn, acceptLinkedInSuggestion, fetchLinkedInProfile } from '../components/capture/linkedinConfirm.js';

const UID = 'u1';
const ID = 'cap_3f2a9c1e_p1';
const path = id => `users/${UID}/contacts/${id}`;
const put = (id, data) => store.docs.set(path(id), structuredClone(data));
const get = id => store.docs.get(path(id));
const URL = 'https://www.linkedin.com/in/kristin-sokol';
const NOW = '2026-10-26T12:00:00.000Z';

/** A contact as Scan Business Card saves it. */
const CARD = Object.freeze({
  name: 'Kristin Sokol', first_name: 'Kristin', last_name: 'Sokol',
  title: 'Instructional Matchmaker', company_name: 'Bright Path Learning', company_id: 'co_1',
  email: 'kristin@brightpathlearning.com', website: 'www.brightpathlearning.com',
  phone: '+14155550142', phones: [{ id: 'card-1', value: '+14155550142', label: 'mobile' }],
  source: 'business_card', addedFrom: 'business_card', capture_operation_id: 'cap_3f2a9c1e',
});

/** findContactByLinkedInUrl's contact for that URL. */
const PROFILE = Object.freeze({
  id: 'ap_123', apollo_person_id: 'ap_123', name: 'Kristin Sokol (LinkedIn)',
  title: 'Director of Instructional Matching', headline: 'Matching learners with the right teachers',
  organization_name: 'Bright Path', location: 'Salt Lake City, Utah', city: 'Salt Lake City', state: 'Utah', country: 'United States',
  email: 'k.sokol@other.example', phone_numbers: [{ raw_number: '+1 801 555 0199' }],
  linkedin_url: 'http://www.linkedin.com/in/kristin-sokol', photo_url: 'https://media.licdn.com/kristin.jpg',
  departments: ['education'], seniority: 'director',
});
const found = (profile = PROFILE) => vi.fn(async () => ({ status: 'found', profile }));

let logs;
beforeEach(() => {
  store.docs.clear();
  store.writes.length = 0;
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, level).mockImplementation((...a) => logs.push(format(...a)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── What a confirmed profile adds ──────────────────────────────────────────

describe('enrichmentFromProfile: fills what is empty, suggests what differs', () => {
  it('a card contact: the URL as the user\'s, LinkedIn\'s details where the card had none', () => {
    const { patch, filled, suggestions } = enrichmentFromProfile(CARD, 'linkedin.com/in/kristin-sokol/', PROFILE, { now: NOW });
    expect(patch).toEqual({
      linkedin_url: URL,
      linkedin_url_normalized: 'linkedin.com/in/kristin-sokol',
      linkedin_confirmed_at: NOW,
      headline: 'Matching learners with the right teachers',
      seniority: 'director',
      departments: ['education'],
      location: 'Salt Lake City, Utah', city: 'Salt Lake City', state: 'Utah', country: 'United States',
      photo_url: 'https://media.licdn.com/kristin.jpg', photo_source: 'linkedin',
      apollo_person_id: 'ap_123',
      last_enriched_at: NOW,
      enrichment_provenance: {
        linkedin_url: PROVENANCE.CONFIRMED,
        headline: 'apollo_match', seniority: 'apollo_match', departments: 'apollo_match', location: 'apollo_match', photo_url: 'apollo_match',
      },
    });
    expect(filled).toEqual(['headline', 'seniority', 'departments', 'location', 'photo_url']);
    expect(suggestions).toEqual([
      { field: 'title', current: 'Instructional Matchmaker', suggested: 'Director of Instructional Matching', actionable: true },
      { field: 'company', current: 'Bright Path Learning', suggested: 'Bright Path', actionable: false },
    ]);
  });

  it('never writes name, email, phones, company, website or title over the card', () => {
    const { patch } = enrichmentFromProfile(CARD, URL, PROFILE, { now: NOW });
    for (const field of ['name', 'first_name', 'last_name', 'email', 'phone', 'phones', 'company_name', 'company_id', 'website', 'title', 'source', 'addedFrom']) {
      expect(patch).not.toHaveProperty(field);
    }
  });

  it('an empty title is filled; the same title in other words is no suggestion', () => {
    const noTitle = enrichmentFromProfile({ ...CARD, title: '  ' }, URL, PROFILE, { now: NOW });
    expect(noTitle.patch.title).toBe('Director of Instructional Matching');
    expect(noTitle.filled).toContain('title');
    expect(noTitle.suggestions.map(s => s.field)).toEqual(['company']);

    const same = enrichmentFromProfile({ ...CARD, title: 'director of instructional-matching' }, URL, { ...PROFILE, organization_name: 'Bright Path Learning, ' }, { now: NOW });
    expect(same.suggestions).toEqual([]);
  });

  it('location is one thing: a contact that says anything about where they are keeps it all', () => {
    for (const has of [{ city: 'Provo' }, { state: 'UT' }, { country: 'US' }, { location: 'Provo, UT' }]) {
      const { patch, filled } = enrichmentFromProfile({ ...CARD, ...has }, URL, PROFILE, { now: NOW });
      expect(filled).not.toContain('location');
      for (const field of ['location', 'city', 'state', 'country']) expect(patch).not.toHaveProperty(field);
    }
    const partsOnly = enrichmentFromProfile(CARD, URL, { ...PROFILE, location: null, country: null }, { now: NOW });
    expect(partsOnly.patch).toMatchObject({ location: 'Salt Lake City, Utah', city: 'Salt Lake City', state: 'Utah' });
    expect(partsOnly.patch).not.toHaveProperty('country');
  });

  it('keeps a real photo, departments and seniority the contact already has; replaces only a placeholder photo', () => {
    const own = { ...CARD, photo_url: 'https://cdn.example/own.jpg', departments: ['sales'], seniority: 'vp' };
    const kept = enrichmentFromProfile(own, URL, PROFILE, { now: NOW });
    for (const field of ['photo_url', 'photo_source', 'departments', 'seniority']) expect(kept.patch).not.toHaveProperty(field);

    const placeholder = enrichmentFromProfile({ ...CARD, photo_url: 'https://static.licdn.com/sc/h/ghost-person.png' }, URL, PROFILE, { now: NOW });
    expect(placeholder.patch.photo_url).toBe('https://media.licdn.com/kristin.jpg');
  });

  it('an Apollo id another contact holds is not copied; an id the contact has is kept', () => {
    expect(enrichmentFromProfile(CARD, URL, PROFILE, { apolloIdTaken: true, now: NOW }).patch).not.toHaveProperty('apollo_person_id');
    expect(enrichmentFromProfile({ ...CARD, apollo_person_id: 'ap_9' }, URL, PROFILE, { now: NOW }).patch).not.toHaveProperty('apollo_person_id');
  });

  it('no profile details: the URL alone, still marked as the user\'s; earlier provenance is kept', () => {
    const { patch, filled, suggestions } = enrichmentFromProfile({ ...CARD, enrichment_provenance: { email: 'manual' } }, URL, null, { now: NOW });
    expect(patch).toEqual({
      linkedin_url: URL, linkedin_url_normalized: 'linkedin.com/in/kristin-sokol', linkedin_confirmed_at: NOW,
      enrichment_provenance: { email: 'manual', linkedin_url: 'user_confirmed' },
    });
    expect(filled).toEqual([]);
    expect(suggestions).toEqual([]);
  });

  it('only a person\'s profile URL, in one form', () => {
    expect(profileUrl('https://uk.linkedin.com/in/kristin-sokol/?trk=x')).toBe(URL);
    expect(profileUrl('LinkedIn.com/in/Kristin-Sokol')).toBe(URL);
    expect(profileUrl('https://www.linkedin.com/company/bright-path')).toBeNull();
    expect(profileUrl('https://example.com/in/kristin')).toBeNull();
    expect(profileUrl('')).toBeNull();
    expect(profileUrl(null)).toBeNull();
    expect(() => enrichmentFromProfile(CARD, 'not a url', PROFILE)).toThrow();
  });
});

// ─── The write ──────────────────────────────────────────────────────────────

describe('confirmLinkedIn: one write, after the user said so', () => {
  it('links the profile and fills the empty fields, in one update to that contact', async () => {
    put(ID, CARD);
    const fetchProfile = found();
    const result = await confirmLinkedIn(UID, ID, 'https://linkedin.com/in/kristin-sokol/', { fetchProfile });

    expect(fetchProfile).toHaveBeenCalledWith(URL);
    expect(result).toEqual({
      status: 'linked', profileStatus: 'found',
      filled: ['headline', 'seniority', 'departments', 'location', 'photo_url'],
      suggestions: [
        { field: 'title', current: 'Instructional Matchmaker', suggested: 'Director of Instructional Matching', actionable: true },
        { field: 'company', current: 'Bright Path Learning', suggested: 'Bright Path', actionable: false },
      ],
    });
    expect(store.writes.map(w => [w.kind, w.path])).toEqual([['update', path(ID)]]);
    const saved = get(ID);
    expect(saved).toMatchObject({
      ...CARD,
      linkedin_url: URL, linkedin_url_normalized: 'linkedin.com/in/kristin-sokol',
      headline: 'Matching learners with the right teachers', location: 'Salt Lake City, Utah', apollo_person_id: 'ap_123',
    });
    expect(saved.title).toBe('Instructional Matchmaker');
    expect(saved.email).toBe(CARD.email);
    expect(saved.phones).toEqual(CARD.phones);
  });

  it('a profile already on another contact: nothing written, and who has it', async () => {
    put(ID, CARD);
    put('other_1', { name: 'K. Sokol', linkedin_url: URL, linkedin_url_normalized: 'linkedin.com/in/kristin-sokol' });
    const fetchProfile = found();
    const result = await confirmLinkedIn(UID, ID, URL, { fetchProfile });
    expect(result).toEqual({ status: 'taken', by: { contactId: 'other_1', name: 'K. Sokol', count: 1 } });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  it('found on another contact only by the stored form of its URL: still taken', async () => {
    put(ID, CARD);
    put('legacy_1', { name: 'Kristin', linkedin_url: 'http://www.linkedin.com/in/Kristin-Sokol/' });
    const result = await confirmLinkedIn(UID, ID, URL, { fetchProfile: found() });
    expect(result.status).toBe('taken');
    expect(result.by.contactId).toBe('legacy_1');
    expect(store.writes).toEqual([]);
  });

  it('a contact that already has a different LinkedIn: nothing written', async () => {
    put(ID, { ...CARD, linkedin_url: 'https://www.linkedin.com/in/someone-else' });
    const fetchProfile = found();
    expect(await confirmLinkedIn(UID, ID, URL, { fetchProfile })).toEqual({ status: 'has_other' });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  it('confirming the same profile again changes nothing the first time set', async () => {
    put(ID, CARD);
    await confirmLinkedIn(UID, ID, URL, { fetchProfile: found() });
    const first = structuredClone(get(ID));
    const again = await confirmLinkedIn(UID, ID, 'linkedin.com/in/kristin-sokol', { fetchProfile: found() });
    expect(again.status).toBe('linked');
    expect(again.filled).toEqual([]);
    const { linkedin_confirmed_at: _a, last_enriched_at: _b, ...rest } = get(ID);
    const { linkedin_confirmed_at: _c, last_enriched_at: _d, ...firstRest } = first;
    expect(rest).toEqual(firstRest);
  });

  it('details unavailable: the URL is still linked, and the screen is told why nothing was added', async () => {
    for (const status of ['not_found', 'failed']) {
      store.docs.clear();
      put(ID, CARD);
      const result = await confirmLinkedIn(UID, ID, URL, { fetchProfile: vi.fn(async () => ({ status })) });
      expect(result).toEqual({ status: 'linked', profileStatus: status, filled: [], suggestions: [] });
      expect(get(ID)).toMatchObject({ linkedin_url: URL, title: CARD.title });
      expect(get(ID)).not.toHaveProperty('last_enriched_at');
    }
  });

  it('an Apollo id another contact holds is linked without the id', async () => {
    put(ID, CARD);
    put('other_2', { name: 'Someone', apollo_person_id: 'ap_123' });
    const result = await confirmLinkedIn(UID, ID, URL, { fetchProfile: found() });
    expect(result.status).toBe('linked');
    expect(get(ID)).not.toHaveProperty('apollo_person_id');
    expect(get('other_2')).toEqual({ name: 'Someone', apollo_person_id: 'ap_123' });
  });

  it('not a profile URL, or no such contact: nothing looked up, nothing written', async () => {
    const fetchProfile = found();
    expect(await confirmLinkedIn(UID, ID, 'https://www.linkedin.com/company/x', { fetchProfile })).toEqual({ status: 'invalid' });
    expect(await confirmLinkedIn(UID, 'nope', URL, { fetchProfile })).toEqual({ status: 'missing' });
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(store.writes).toEqual([]);
  });

  it('writes nowhere but the contact, and logs no value', async () => {
    put(ID, CARD);
    put('other_2', { name: 'Someone', apollo_person_id: 'ap_123' });
    await confirmLinkedIn(UID, ID, URL, { fetchProfile: found() });
    expect(store.writes.every(w => w.path === path(ID))).toBe(true);
    expect([...store.docs.keys()].some(p => p.includes('capture_operations'))).toBe(false);
    const values = ['Kristin', 'Sokol', 'Bright Path', 'kristin-sokol', 'Matchmaker', 'ap_123', 'brightpath'];
    expect(logs.filter(line => values.some(v => line.includes(v)))).toEqual([]);
  });
});

describe('taking a suggestion', () => {
  it('the title, recorded as the user\'s choice; nothing else', async () => {
    put(ID, { ...CARD, enrichment_provenance: { linkedin_url: 'user_confirmed' } });
    await acceptLinkedInSuggestion(UID, ID, { field: 'title', current: CARD.title, suggested: 'Director of Instructional Matching', actionable: true });
    expect(store.writes).toEqual([{
      kind: 'update', path: path(ID),
      data: { title: 'Director of Instructional Matching', 'enrichment_provenance.title': 'user_accepted' },
    }]);
    expect(get(ID).enrichment_provenance).toEqual({ linkedin_url: 'user_confirmed', title: 'user_accepted' });
  });

  it('the company is never taken from LinkedIn', async () => {
    put(ID, CARD);
    await expect(acceptLinkedInSuggestion(UID, ID, { field: 'company', suggested: 'Bright Path', actionable: false })).rejects.toThrow();
    expect(store.writes).toEqual([]);
  });
});

describe('fetchLinkedInProfile: LinkedIn Link\'s exact lookup, as the signed-in user', () => {
  it('sends the URL with the user\'s token; reads found, not found and failure', async () => {
    const calls = [];
    const replies = [
      { ok: true, status: 200, json: async () => ({ success: true, contact: PROFILE }) },
      { ok: false, status: 404, json: async () => ({ success: false }) },
      { ok: false, status: 500, json: async () => ({ success: false }) },
    ];
    vi.stubGlobal('fetch', async (url, init) => { calls.push({ url, init }); return replies.shift(); });
    expect(await fetchLinkedInProfile(URL)).toEqual({ status: 'found', profile: PROFILE });
    expect(await fetchLinkedInProfile(URL)).toEqual({ status: 'not_found' });
    expect(await fetchLinkedInProfile(URL)).toEqual({ status: 'failed' });
    expect(calls[0].url).toBe('/.netlify/functions/findContactByLinkedInUrl');
    expect(JSON.parse(calls[0].init.body)).toEqual({ userId: 'u1', authToken: 'tok_u1', linkedin_url: URL });

    vi.stubGlobal('fetch', async () => { throw new TypeError('offline'); });
    expect(await fetchLinkedInProfile(URL)).toEqual({ status: 'failed' });
  });
});

// ─── The lookup it reuses ───────────────────────────────────────────────────

describe('findContactByLinkedInUrl: no name or URL in its logs or usage record', () => {
  const APOLLO_PERSON = {
    id: 'ap_123', name: 'Kristin Sokol', title: 'Director of Instructional Matching', headline: 'Matching learners with the right teachers',
    organization: { id: 'org_1', name: 'Bright Path' }, city: 'Salt Lake City', state: 'Utah', country: 'United States',
    linkedin_url: 'http://www.linkedin.com/in/kristin-sokol', photo_url: 'https://media.licdn.com/kristin.jpg', departments: ['education'], seniority: 'director',
  };
  const VALUES = ['Kristin', 'Sokol', 'kristin-sokol', 'Bright Path', 'Salt Lake'];

  async function lookup(apolloReply) {
    vi.stubEnv('APOLLO_API_KEY', 'test-apollo-key');
    vi.stubEnv('FIREBASE_API_KEY', 'test-firebase-key');
    vi.stubGlobal('fetch', async (url) => (String(url).includes('identitytoolkit')
      ? { ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) }
      : apolloReply));
    const { handler } = await import('../../netlify/functions/findContactByLinkedInUrl.js');
    return handler({ httpMethod: 'POST', body: JSON.stringify({ userId: 'u1', authToken: 'tok', linkedin_url: `${URL}/` }) });
  }

  afterEach(() => { vi.unstubAllEnvs(); logApiUsage.mockReset(); });

  it('found: the headline and country come back; logs and usage say only that it was found', async () => {
    const response = await lookup({ ok: true, status: 200, json: async () => ({ person: APOLLO_PERSON }) });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).contact).toMatchObject({
      apollo_person_id: 'ap_123', headline: 'Matching learners with the right teachers', country: 'United States',
      location: 'Salt Lake City, Utah', organization_name: 'Bright Path',
    });
    expect(logApiUsage).toHaveBeenCalledWith('u1', 'findContactByLinkedInUrl', 'success', expect.objectContaining({ metadata: { contactFound: true } }));
    expect(logs.filter(line => VALUES.some(v => line.includes(v)))).toEqual([]);
  });

  it('Apollo refuses: the error log carries no URL', async () => {
    const response = await lookup({ ok: false, status: 404, statusText: 'Not Found', text: async () => 'not found', json: async () => ({}), headers: new Map() });
    expect(response.statusCode).toBe(404);
    expect(logs.filter(line => VALUES.some(v => line.includes(v)))).toEqual([]);
    expect(JSON.stringify(logApiUsage.mock.calls)).not.toMatch(/kristin|sokol/i);
  });
});
