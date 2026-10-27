/**
 * Barry Enrich, the server half (netlify/functions/barryEnrich.js), on top of
 * #737's contact protection.
 *
 * Pins that a LinkedIn profile Barry finds (Apollo's people search, Google,
 * or the LinkedIn on an exactly matched record) is never written and its
 * record is never read: it comes back in `linkedinCandidates`, ranked by Find
 * LinkedIn's rules; that a search match supplies no person details; that an
 * email found on a company website is only offered; that a company filled
 * where the contact had none comes with the organization to link it; and that
 * no name, email, phone, company, title or URL reaches a log line or the
 * usage record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format } from 'node:util';

const logApiUsage = vi.hoisted(() => vi.fn());
vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage }));

import { handler } from '../../netlify/functions/barryEnrich.js';

const PEOPLE_MATCH = 'https://api.apollo.io/v1/people/match';
const PEOPLE_SEARCH = 'https://api.apollo.io/v1/mixed_people/api_search';

/** A contact as Scan Business Card saves it: everything the card said, no LinkedIn. */
const CARD = Object.freeze({
  id: 'cap_x_p1', name: 'Kristin Sokol', title: 'Founder', company_name: 'Bright Path Learning',
  email: 'kristin@brightpathlearning.com', website: 'www.brightpathlearning.com', phone: '+14155550142',
  phones: [{ id: 'card-1', value: '+14155550142', label: 'mobile', labelSource: 'card' }],
});
const PERSON = Object.freeze({ name: 'Kristin Sokol', company: 'Bright Path Learning', title: 'Founder', domain: 'brightpathlearning.com', email: CARD.email, location: null });

const APOLLO_KRISTIN = Object.freeze({
  id: 'ap_123', name: 'Kristin Sokol', title: 'Founder & CEO', headline: 'Matching learners with teachers',
  linkedin_url: 'http://www.linkedin.com/in/kristin-sokol', photo_url: 'https://media.example/kristin.jpg',
  email: 'k.sokol@other.example', city: 'Salt Lake City', state: 'Utah', country: 'United States',
  organization_id: 'org_9', organization: { id: 'org_9', name: 'Bright Path', primary_domain: 'brightpath.example' },
  employment_history: [{ title: 'Founder & CEO', organization_name: 'Bright Path', start_date: '2020-01-01' }],
  phone_numbers: [{ sanitized_number: '+18015550199', type: 'mobile' }, { sanitized_number: '+14155550142', type: 'work_hq' }],
});
const NAMESAKE = Object.freeze({ name: 'Kristin Sokol', title: 'Nurse', headline: 'Nurse', photo_url: 'https://media.example/other.jpg', linkedin_url: 'https://www.linkedin.com/in/kristin-sokol-rn', organization: { name: 'St. Mark Hospital' } });
const GOOGLE_KRISTIN = Object.freeze({
  link: 'https://www.linkedin.com/in/kristin-sokol', title: 'Kristin Sokol - Founder - Bright Path Learning | LinkedIn',
  snippet: 'Location: Utah · Founder at Bright Path Learning',
});

const VALUES = ['Kristin', 'Sokol', 'Bright Path', 'brightpath', 'Founder', 'kristin@', 'k.sokol', 'kristin-sokol', '4155550142', '8015550199', 'Salt Lake', 'info@'];

let calls;
let logs;

function stubFetch({ match = APOLLO_KRISTIN, search = [APOLLO_KRISTIN, NAMESAKE], google = [GOOGLE_KRISTIN], site = null } = {}) {
  calls = [];
  vi.stubGlobal('fetch', async (url, init = {}) => {
    const href = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ href, body });
    const json = data => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
    if (href.includes('identitytoolkit')) return json({ users: [{ localId: 'u1' }] });
    if (href === PEOPLE_MATCH) return match ? json({ person: match }) : { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    if (href === PEOPLE_SEARCH) return json({ people: search });
    if (href.startsWith('https://www.googleapis.com/customsearch/v1')) return json({ items: google });
    if (site && href.startsWith(`https://${site.domain}`)) return { ok: true, status: 200, text: async () => site.html };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
}

async function enrich(contact, { person = PERSON } = {}) {
  const response = await handler({ httpMethod: 'POST', body: JSON.stringify({ userId: 'u1', authToken: 'tok', contact, person }) });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

beforeEach(() => {
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, level).mockImplementation((...a) => logs.push(format(...a)));
  vi.stubEnv('APOLLO_API_KEY', 'test-apollo');
  vi.stubEnv('FIREBASE_API_KEY', 'test-firebase');
  vi.stubEnv('GOOGLE_SEARCH_API_KEY', 'test-google');
  vi.stubEnv('GOOGLE_SEARCH_ENGINE_ID', 'test-cx');
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
  vi.stubEnv('VITE_GOOGLE_PLACES_API_KEY', '');
  logApiUsage.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a LinkedIn profile Barry finds is offered, never written', () => {
  it('a card contact: the search finds Kristin; no URL to write, no record read for it', async () => {
    stubFetch();
    const { status, body } = await enrich(CARD);
    expect(status).toBe(200);
    expect(body.enrichedData).not.toHaveProperty('linkedin_url');
    expect(calls.filter(c => c.href === PEOPLE_MATCH)).toEqual([]);           // no lookup of a profile nobody confirmed
    expect(body.linkedinCandidates.map(c => c.linkedinUrl)).toEqual(['https://www.linkedin.com/in/kristin-sokol']);
    expect(body.linkedinCandidates[0]).toMatchObject({ strength: 'strong', sources: ['apollo', 'search'] });
    expect(body.enrichedData.enrichment_summary.needs_manual_linkedin).toBe(false);
  });

  it('a search match supplies nothing but the candidate: no photo, headline, location, email or phones', async () => {
    stubFetch();
    const { body } = await enrich({ ...CARD, email: null });
    for (const field of ['photo_url', 'headline', 'city', 'state', 'email', 'phones', 'seniority']) {
      expect(body.enrichedData, field).not.toHaveProperty(field);
    }
  });

  it('nothing found: no candidates, and the profile offers a pasted link', async () => {
    stubFetch({ search: [], google: [] });
    const { body } = await enrich(CARD);
    expect(body.linkedinCandidates).toEqual([]);
    expect(body.enrichedData.enrichment_summary.needs_manual_linkedin).toBe(true);
  });

  it('an exact match by the contact\'s own Apollo id: its LinkedIn is still only a candidate', async () => {
    stubFetch({ google: [] });
    const { body } = await enrich({ ...CARD, apollo_person_id: 'ap_123' });
    expect(calls.filter(c => c.href === PEOPLE_MATCH).map(c => c.body)).toEqual([{ id: 'ap_123' }]);
    expect(calls.filter(c => c.href === PEOPLE_SEARCH)).toEqual([]);
    expect(body.enrichedData).not.toHaveProperty('linkedin_url');
    expect(body.linkedinCandidates.map(c => c.linkedinUrl)).toEqual(['https://www.linkedin.com/in/kristin-sokol']);
  });

  it('a contact with its own LinkedIn: matched by it, and no search for another', async () => {
    stubFetch();
    const own = 'https://www.linkedin.com/in/kristin-sokol';
    const { body } = await enrich({ ...CARD, linkedin_url: own, photo_url: 'https://cdn.example/own.jpg' });
    expect(calls.filter(c => c.href === PEOPLE_MATCH).map(c => c.body)).toEqual([{ linkedin_url: own }]);
    expect(calls.filter(c => c.href === PEOPLE_SEARCH || c.href.includes('customsearch'))).toEqual([]);
    expect(body.linkedinCandidates).toEqual([]);
    expect(body.enrichedData).not.toHaveProperty('linkedin_url');
  });
});

describe('an exact match, through #737\'s protection', () => {
  it('the card\'s values stay; a new number is added next to the card\'s; differences are suggestions', async () => {
    stubFetch({ google: [] });
    const { body } = await enrich({ ...CARD, apollo_person_id: 'ap_123' });
    for (const field of ['name', 'email', 'phone', 'title', 'company_name', 'website']) {
      expect(body.enrichedData, field).not.toHaveProperty(field);
    }
    expect(body.enrichedData.phones.map(p => [p.value, p.label, p.labelSource])).toEqual([
      ['+14155550142', 'mobile', 'card'],
      ['+18015550199', 'mobile', 'enrichment'],
    ]);
    expect(body.suggestions).toEqual([
      { field: 'title', current: 'Founder', suggested: 'Founder & CEO', actionable: true },
      { field: 'company', current: 'Bright Path Learning', suggested: 'Bright Path', actionable: false },
    ]);
    expect(body.company).toBeNull();
  });

  it('a company filled where the contact had none comes with the organization to link it', async () => {
    stubFetch({ google: [] });
    const { body } = await enrich({ ...CARD, company_name: null, apollo_person_id: 'ap_123' });
    expect(body.enrichedData.company_name).toBe('Bright Path');
    expect(body.company).toEqual({ name: 'Bright Path', apollo_organization_id: 'org_9', domain: 'brightpath.example' });
  });
});

describe('an email found on the company website', () => {
  it('is offered, never written', async () => {
    stubFetch({ search: [], google: [], site: { domain: 'brightpath.example', html: '<a href="mailto:info@brightpath.example">Email us</a>' } });
    const { body } = await enrich({ id: 'c2', name: 'Kristin Sokol', company_name: 'Bright Path', company_website: 'https://brightpath.example' });
    expect(body.enrichedData).not.toHaveProperty('email');
    expect(body.suggestions).toContainEqual({ field: 'email', current: null, suggested: 'info@brightpath.example', actionable: true, source: 'website' });
  });
});

describe('logs', () => {
  it('no name, email, phone, company, title or URL in a log line or the usage record', async () => {
    stubFetch();
    await enrich(CARD);
    stubFetch({ google: [] });
    await enrich({ ...CARD, apollo_person_id: 'ap_123' });
    stubFetch({ search: [], google: [], site: { domain: 'brightpath.example', html: '<a href="mailto:info@brightpath.example">x</a>' } });
    await enrich({ id: 'c2', name: 'Kristin Sokol', company_name: 'Bright Path', company_website: 'https://brightpath.example' });
    expect(logs.filter(line => VALUES.some(v => line.includes(v)))).toEqual([]);
    expect(logApiUsage).toHaveBeenCalled();
    const usage = JSON.stringify(logApiUsage.mock.calls);
    expect(VALUES.filter(v => usage.includes(v))).toEqual([]);
    expect(logApiUsage.mock.calls[0][3].metadata).toMatchObject({ linkedinCandidates: 1 });
  });
});
