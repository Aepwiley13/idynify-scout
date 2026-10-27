/**
 * Barry Enrich end to end, on top of #737: the real barryEnrich handler (Apollo
 * and Google mocked at fetch), the write (src/services/barryEnrichment.js),
 * the shared company resolver, and Find LinkedIn's confirm on the profile,
 * against a small in-memory Firestore.
 *
 * Pins your cases for this change:
 *   1  a LinkedIn Barry finds is not attached until the user confirms it
 *   2  confirming runs the exact lookup and attaches the URL
 *   3-8 name, email, phone, company and website stay; a new number is added safely
 *   9-10 a different title is offered; an empty title is filled
 *   11 an empty company is linked through the company resolver, without duplicates
 *   12 a LinkedIn another contact has is blocked (older URL forms too)
 *   13 running Enrich again changes nothing
 *   14 no value in any log line
 * and that the profile no longer saves a pasted LinkedIn by itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

// ── In-memory Firestore (paths → documents) ─────────────────────────────────
const store = vi.hoisted(() => ({ docs: new Map(), writes: [] }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const real = await importOriginal();
  const parentOf = path => path.split('/').slice(0, -1).join('/');
  const collection = (_db, ...segments) => ({ kind: 'collection', path: segments.join('/') });
  const doc = (first, ...rest) => {
    if (first?.kind === 'collection') {
      const path = `${first.path}/${rest.join('/')}`;
      return { kind: 'doc', path, id: path.split('/').pop() };
    }
    return { kind: 'doc', path: rest.join('/'), id: rest[rest.length - 1] };
  };
  const where = (field, op, value) => ({ type: 'where', field, op, value });
  const limit = n => ({ type: 'limit', n });
  const query = (ref, ...constraints) => ({ kind: 'query', ref, constraints });
  const snapshot = (path) => {
    const data = store.docs.get(path);
    return { id: path.split('/').pop(), ref: { path }, exists: () => data !== undefined, data: () => (data === undefined ? undefined : structuredClone(data)) };
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
    return { empty: hits.length === 0, size: hits.length, docs: hits.map(snapshot) };
  };
  const setDoc = async (ref, data, options = {}) => {
    store.writes.push({ kind: 'set', path: ref.path, data: structuredClone(data) });
    store.docs.set(ref.path, options.merge ? { ...(store.docs.get(ref.path) ?? {}), ...data } : { ...data });
  };
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
    ...real, collection, doc, where, limit, query, getDoc, getDocs, setDoc, updateDoc,
    addDoc: refuse('addDoc'), deleteDoc: refuse('deleteDoc'), runTransaction: refuse('runTransaction'),
  };
});
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: async () => 'tok_u1' }),
}));
const logApiUsage = vi.hoisted(() => vi.fn());
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage }));

import { handler } from '../../netlify/functions/barryEnrich.js';
import { writeBarryEnrichment } from '../services/barryEnrichment';
import FindLinkedIn from '../components/capture/FindLinkedIn.jsx';

const UID = 'u1';
const ID = 'cap_x_p1';
const contactPath = id => `users/${UID}/contacts/${id}`;
const companyPath = id => `users/${UID}/companies/${id}`;
const put = (id, data) => store.docs.set(contactPath(id), structuredClone({ id, ...data }));
const get = id => store.docs.get(contactPath(id));
const companies = () => [...store.docs.keys()].filter(p => p.startsWith(`users/${UID}/companies/`));
const T = { cardBg: '#fff', border: '#ddd', text: '#111', textMuted: '#555' };

/** A contact as Scan Business Card saves it. */
const CARD = Object.freeze({
  name: 'Kristin Sokol', first_name: 'Kristin', last_name: 'Sokol', title: 'Founder',
  company_name: 'Bright Path Learning', company_id: 'co_bright',
  email: 'kristin@brightpathlearning.com', website: 'www.brightpathlearning.com',
  phone: '+14155550100', phone_normalized: null,
  phones: [{ id: 'card-1', value: '415-555-0100', label: 'main', labelSource: 'card', observedLabel: 'Main' }],
  source: 'business_card', addedFrom: 'business_card',
});

const APOLLO_KRISTIN = Object.freeze({
  id: 'ap_123', name: 'Kristin Sokol', title: 'Founder & CEO', headline: 'Matching learners with teachers',
  linkedin_url: 'http://www.linkedin.com/in/kristin-sokol', email: 'k.sokol@other.example',
  city: 'Salt Lake City', state: 'Utah', country: 'United States',
  organization_id: 'org_9', organization: { id: 'org_9', name: 'Bright Path', primary_domain: 'brightpath.example' },
  employment_history: [{ title: 'Founder & CEO', organization_name: 'Bright Path', start_date: '2020-01-01' }],
  phone_numbers: [
    { sanitized_number: '+18015550199', type: 'mobile' },
    { sanitized_number: '+14155550100', type: 'work_hq' },              // the card's main line, with its country code
  ],
});
const GOOGLE_KRISTIN = Object.freeze({
  link: 'https://www.linkedin.com/in/kristin-sokol', title: 'Kristin Sokol - Founder - Bright Path Learning | LinkedIn', snippet: 'Location: Utah',
});
const CANDIDATE = Object.freeze({
  linkedinUrl: 'https://www.linkedin.com/in/kristin-sokol', name: 'Kristin Sokol', headline: 'Founder at Bright Path Learning',
  company: 'Bright Path Learning', location: 'Utah', photoUrl: null, sources: ['apollo', 'search'], strength: 'strong', reasons: ['name', 'company'],
});

const VALUES = ['Kristin', 'Sokol', 'Bright Path', 'brightpath', 'Founder', 'kristin@', 'k.sokol', 'kristin-sokol', '4155550100', '8015550199', 'Salt Lake'];
let logs;
let fetchCalls;

/** Apollo, Google and the exact LinkedIn lookup, as the browser and server see them. */
function stubNetwork({ match = APOLLO_KRISTIN, google = [GOOGLE_KRISTIN], search = [APOLLO_KRISTIN] } = {}) {
  fetchCalls = [];
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const href = String(url);
    fetchCalls.push({ href, body: init.body ? JSON.parse(init.body) : null });
    const json = data => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
    if (href.includes('identitytoolkit')) return json({ users: [{ localId: UID }] });
    if (href === 'https://api.apollo.io/v1/people/match') return json({ person: match });
    if (href === 'https://api.apollo.io/v1/mixed_people/api_search') return json({ people: search });
    if (href.startsWith('https://www.googleapis.com/customsearch/v1')) return json({ items: google });
    if (href === '/.netlify/functions/findContactByLinkedInUrl') {
      return json({ success: true, contact: { apollo_person_id: 'ap_123', headline: 'Matching learners with teachers', title: 'Founder & CEO', organization_name: 'Bright Path' } });
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
}

/** Enrich as the profile does: the server's answer, written by writeBarryEnrichment. */
async function enrichAndWrite(id) {
  const contact = get(id);
  const response = await handler({ httpMethod: 'POST', body: JSON.stringify({ userId: UID, authToken: 'tok', contact }) });
  const result = JSON.parse(response.body);
  const written = await writeBarryEnrichment(UID, contact, result);
  return { result, written };
}

beforeEach(() => {
  store.docs.clear();
  store.writes.length = 0;
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, level).mockImplementation((...a) => logs.push(format(...a)));
  vi.stubEnv('APOLLO_API_KEY', 'test-apollo');
  vi.stubEnv('FIREBASE_API_KEY', 'test-firebase');
  vi.stubEnv('GOOGLE_SEARCH_API_KEY', 'test-google');
  vi.stubEnv('GOOGLE_SEARCH_ENGINE_ID', 'test-cx');
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
  vi.stubEnv('VITE_GOOGLE_PLACES_API_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Enrich, written ────────────────────────────────────────────────────────

describe('Enrich on a card contact', () => {
  it('a LinkedIn Barry finds is not written; it comes back to confirm', async () => {          // 1
    put(ID, CARD);
    stubNetwork();
    const { result } = await enrichAndWrite(ID);
    expect(get(ID)).not.toHaveProperty('linkedin_url');
    expect(get(ID)).not.toHaveProperty('linkedin_url_normalized');
    expect(result.linkedinCandidates.map(c => c.linkedinUrl)).toEqual([CANDIDATE.linkedinUrl]);
  });

  it('name, email, phone, company, website and title stay; a new number is added once', async () => {   // 3-9
    put(ID, { ...CARD, apollo_person_id: 'ap_123' });
    stubNetwork({ google: [] });
    const { result } = await enrichAndWrite(ID);
    expect(get(ID)).toMatchObject({
      name: 'Kristin Sokol', email: 'kristin@brightpathlearning.com', phone: '+14155550100',
      company_name: 'Bright Path Learning', company_id: 'co_bright', website: 'www.brightpathlearning.com', title: 'Founder',
    });
    expect(get(ID).phones.map(p => [p.value, p.label, p.labelSource])).toEqual([
      ['415-555-0100', 'main', 'card'],                                        // the card's, unchanged
      ['+18015550199', 'mobile', 'enrichment'],                                // new
    ]);
    expect(result.suggestions).toEqual([
      { field: 'title', current: 'Founder', suggested: 'Founder & CEO', actionable: true },
      { field: 'company', current: 'Bright Path Learning', suggested: 'Bright Path', actionable: false },
    ]);
    expect(companies()).toEqual([]);
  });

  it('an empty title is filled', async () => {                                                 // 10
    put(ID, { ...CARD, title: '', apollo_person_id: 'ap_123' });
    stubNetwork({ google: [] });
    await enrichAndWrite(ID);
    expect(get(ID).title).toBe('Founder & CEO');
  });

  it('running Enrich again changes nothing: no new values, no repeated numbers', async () => {  // 13
    put(ID, { ...CARD, apollo_person_id: 'ap_123' });
    stubNetwork({ google: [] });
    await enrichAndWrite(ID);
    const first = structuredClone(get(ID));
    await enrichAndWrite(ID);
    // Bookkeeping about the run itself, rewritten every time by design (as in #737's test).
    const RUN = ['last_enriched_at', 'enrichment_summary', 'enrichment_steps', '_raw_apollo_data', 'data_sources'];
    const facts = data => Object.fromEntries(Object.entries(data).filter(([k]) => !RUN.includes(k)));
    const after = facts(get(ID));
    const before = facts(first);
    const changed = Object.keys({ ...after, ...before }).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    expect(changed).toEqual([]);
    expect(get(ID).phones).toHaveLength(2);
  });
});

describe('an empty company is linked through the company resolver', () => {                   // 11
  it('an existing company with that name is reused, not duplicated', async () => {
    store.docs.set(companyPath('co_existing'), { name: 'Bright Path', status: 'accepted' });
    put(ID, { ...CARD, company_name: null, company_id: null, apollo_person_id: 'ap_123' });
    stubNetwork({ google: [] });
    await enrichAndWrite(ID);
    expect(get(ID)).toMatchObject({ company_name: 'Bright Path', company_id: 'co_existing' });
    expect(companies()).toEqual([companyPath('co_existing')]);
  });

  it('no match: one company, keyed by the organization; running again creates no second', async () => {
    put(ID, { ...CARD, company_name: null, company_id: null, apollo_person_id: 'ap_123' });
    stubNetwork({ google: [] });
    await enrichAndWrite(ID);
    expect(get(ID)).toMatchObject({ company_name: 'Bright Path', company_id: 'org_9' });
    await enrichAndWrite(ID);
    expect(companies()).toEqual([companyPath('org_9')]);
  });

  it('a contact with a company, or a company link, is never re-linked', async () => {
    const ensureCompany = vi.fn();
    put('c2', { name: 'A', company_id: 'co_x' });
    await writeBarryEnrichment(UID, get('c2'), { enrichedData: { company_name: 'Other' }, company: { name: 'Other' } }, { ensureCompany });
    put('c3', { name: 'B', company: 'Acme' });
    await writeBarryEnrichment(UID, get('c3'), { enrichedData: { company_name: 'Acme' }, company: null }, { ensureCompany });
    expect(ensureCompany).not.toHaveBeenCalled();
    expect(get('c2').company_id).toBe('co_x');
  });

  it('the write never carries a LinkedIn URL', async () => {
    put('c4', { name: 'A' });
    await writeBarryEnrichment(UID, get('c4'), { enrichedData: { headline: 'H', linkedin_url: 'https://www.linkedin.com/in/x', linkedin_url_normalized: 'linkedin.com/in/x' } });
    expect(get('c4')).toEqual({ id: 'c4', name: 'A', headline: 'H' });
  });
});

// ─── The profile: Barry's profiles through Find LinkedIn's confirm ──────────

function renderProfileFind({ found = [CANDIDATE], contactId = ID } = {}) {
  const onDone = vi.fn();
  render(<FindLinkedIn contactId={contactId} found={found} context="profile" onDone={onDone} T={T} />);
  return { onDone };
}

describe('Barry\'s LinkedIn profiles, confirmed on the profile', () => {
  it('shown at once, labelled for the profile; nothing attached by showing them', async () => {
    put(ID, CARD);
    renderProfileFind();
    expect(await screen.findByText("Kristin's LinkedIn")).toBeTruthy();
    expect(screen.getAllByTestId('linkedin-candidate')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'None of these' })).toBeTruthy();
    expect(store.writes).toEqual([]);
  });

  it('confirmed: the exact lookup runs and the URL is attached', async () => {                 // 2
    put(ID, CARD);
    stubNetwork();
    const { onDone } = renderProfileFind();
    fireEvent.click(await screen.findByRole('button', { name: 'This is Kristin' }));
    expect(await screen.findByText(/LinkedIn added to Kristin/)).toBeTruthy();
    expect(fetchCalls).toEqual([{ href: '/.netlify/functions/findContactByLinkedInUrl', body: { userId: UID, authToken: 'tok_u1', linkedin_url: CANDIDATE.linkedinUrl } }]);
    expect(get(ID)).toMatchObject({
      linkedin_url: CANDIDATE.linkedinUrl, linkedin_url_normalized: 'linkedin.com/in/kristin-sokol',
      enrichment_provenance: { linkedin_url: 'user_confirmed' }, title: 'Founder', company_name: 'Bright Path Learning',
    });
    expect(screen.getAllByText(/The contact says/)).toHaveLength(2);       // title offered, company shown
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledWith(ID);
  });

  it('a profile another contact already has (older URL form too) is blocked: nothing written', async () => {   // 12
    put(ID, CARD);
    put('other_1', { name: 'K. Sokol', linkedin_url: 'http://linkedin.com/in/Kristin-Sokol/' });
    stubNetwork();
    const { onDone } = renderProfileFind();
    fireEvent.click(await screen.findByRole('button', { name: 'This is Kristin' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already on K\. Sokol.*Nothing was changed/);
    expect(fetchCalls).toEqual([]);
    expect(store.writes).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Open K.' }));
    expect(onDone).toHaveBeenCalledWith('other_1');
  });

  it('none found: a pasted link goes through the same confirm', async () => {
    put(ID, CARD);
    stubNetwork();
    renderProfileFind({ found: [] });
    const input = await screen.findByLabelText('Or paste their LinkedIn link');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'linkedin.com/in/kristin-sokol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this profile' }));
    await waitFor(() => expect(get(ID).linkedin_url).toBe('https://www.linkedin.com/in/kristin-sokol'));
    expect(fetchCalls.map(c => c.href)).toEqual(['/.netlify/functions/findContactByLinkedInUrl']);
  });
});

// ─── Logs and the profile's write paths ─────────────────────────────────────

describe('logs and write paths', () => {
  it('no value in any log line: enrich, write, link a company, confirm a profile', async () => {   // 14
    put(ID, { ...CARD, company_name: null, company_id: null, apollo_person_id: 'ap_123' });
    stubNetwork();
    await enrichAndWrite(ID);
    put('c5', CARD);
    renderProfileFind({ contactId: 'c5' });
    fireEvent.click(await screen.findByRole('button', { name: 'This is Kristin' }));
    await screen.findByText(/LinkedIn added to Kristin/);
    expect(logs.filter(line => VALUES.some(v => line.includes(v)))).toEqual([]);
  });

  it('the profile writes Barry\'s result only through writeBarryEnrichment, and no longer saves a pasted LinkedIn itself', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const profile = readFileSync(resolve(repo, 'src/pages/Scout/ContactProfile.jsx'), 'utf8');
    expect(profile).toMatch(/writeBarryEnrichment\(user\.uid, contact, result\)/);
    expect(profile).not.toMatch(/\.\.\.result\.enrichedData/);
    expect(profile).not.toMatch(/manualLinkedInUrl|handleManualLinkedInSubmit/);
    expect(profile).not.toMatch(/linkedin_url:\s*manual/);
    expect(profile).toMatch(/<FindLinkedIn contactId=\{contact\.id\} found=\{barryLinkedIn\} context="profile"/);
    expect(profile).not.toMatch(/console\.log\([^)]*contact\.name/);
    const service = readFileSync(resolve(repo, 'src/services/barryEnrichment.js'), 'utf8');
    expect(service).not.toMatch(/console\./);
  });
});
