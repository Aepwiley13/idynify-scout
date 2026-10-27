// @vitest-environment node
/**
 * Contact protection for Barry Enrich (#733): the rules #732 set for LinkedIn
 * confirm, applied to every enrichment.
 *
 * Pins: a contact's own name, email, phones, company and website are never
 * overwritten; enrichment fills empty fields only; a different title or
 * company is a suggestion, never a write (title actionable, company for
 * information); location fills as one unit; the provider's numbers are added
 * next to the contact's own in the canonical list, never instead of them; a
 * LinkedIn URL is never written (the user confirms one through Find
 * LinkedIn); an email found on a company website is only offered; provenance
 * keeps every existing entry and records the source of each field written.
 *
 * The second half runs the real barryEnrich handler with Apollo mocked at
 * fetch, so the function's own pipeline is what is checked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import process from 'node:process';
import { enrichmentPatch, differenceSuggestions, sameText, mergeFoundPhones } from '../utils/contactProtection';

const APOLLO_PERSON = {
  id: 'apollo-1',
  name: 'Jimmy Choi',
  email: 'jimmy.choi@contoso.com',
  email_status: 'verified',
  title: 'Chief Revenue Officer',
  organization_name: 'Contoso',
  headline: 'Building revenue teams',
  seniority: 'c_suite',
  departments: ['sales'],
  photo_url: 'https://media.licdn.com/dms/image/v2/x/profile-displayphoto-shrink_400_400/0/1',
  linkedin_url: 'https://www.linkedin.com/in/jimmychoi',
  city: 'Denver', state: 'Colorado', country: 'United States', time_zone: 'America/Denver',
  employment_history: [{ title: 'Chief Revenue Officer', organization_name: 'Contoso', start_date: '2024-01-01' }],
  phone_numbers: [{ sanitized_number: '+13035550142', type: 'mobile' }],
};

// What barryEnrich's steps would have found for that person.
const FOUND = {
  email: APOLLO_PERSON.email, email_status: 'verified',
  linkedin_url: APOLLO_PERSON.linkedin_url, headline: APOLLO_PERSON.headline, seniority: 'c_suite',
  departments: ['sales'], photo_url: APOLLO_PERSON.photo_url,
  city: 'Denver', state: 'Colorado', country: 'United States', time_zone: 'America/Denver',
  employment_history: APOLLO_PERSON.employment_history,
  current_position_title: 'Chief Revenue Officer', current_company_name: 'Contoso', job_start_date: '2024-01-01',
  company_website: 'https://contoso.com', is_likely_decision_maker: true,
};
const PROVENANCE = {
  email: 'apollo_match', linkedin_url: 'apollo_match', headline: 'apollo_match', seniority: 'apollo_match',
  departments: 'apollo_match', photo_url: 'apollo_match', location: 'apollo_match', employment_history: 'apollo_match',
  company_website: 'google_places',
};
const opts = { provenance: PROVENANCE, phoneNumbers: APOLLO_PERSON.phone_numbers, person: APOLLO_PERSON };

// A contact saved from a business card: the user reviewed every value here.
const CARD = {
  id: 'c1',
  name: 'Jimmy Choi',
  email: 'jimmy@northwind.com',
  phones: [{ id: 'p1', value: '801-555-1234', label: 'direct', labelSource: 'card', normalized: '8015551234' }],
  phone: '801-555-1234', phone_direct: '801-555-1234',
  title: 'VP Sales',
  company_name: 'Northwind',
  company_website: 'https://northwind.com',
  city: 'Salt Lake City',
  linkedin_url: 'https://www.linkedin.com/in/jimmychoi',
  enrichment_provenance: { linkedin_url: 'user_confirmed', title: 'user_accepted' },
};

describe('enrichmentPatch: the contact\'s own values win', () => {
  it('never writes name, email, phones, company, website, title or location the card has', () => {
    const { patch } = enrichmentPatch(CARD, FOUND, opts);
    for (const field of ['name', 'email', 'email_status', 'phone', 'phone_direct',
      'title', 'company_name', 'company_website', 'linkedin_url', 'city', 'state', 'country', 'time_zone', 'job_start_date']) {
      expect(patch, field).not.toHaveProperty(field);
    }
    // The card's number stays first, with its label; Apollo's new one is added after it.
    expect(patch.phones.map(p => [p.value, p.label, p.labelSource])).toEqual([
      ['801-555-1234', 'direct', 'card'],
      ['+13035550142', 'mobile', 'enrichment'],
    ]);
  });

  it('fills what the card left empty, with the source of each', () => {
    const { patch, filled } = enrichmentPatch(CARD, FOUND, opts);
    expect(patch).toMatchObject({ headline: 'Building revenue teams', seniority: 'c_suite', departments: ['sales'], photo_url: APOLLO_PERSON.photo_url });
    expect(filled.sort()).toEqual(['departments', 'employment_history', 'headline', 'phone', 'photo_url', 'seniority']);
    expect(patch.enrichment_provenance).toEqual({
      linkedin_url: 'user_confirmed', title: 'user_accepted',              // kept
      headline: 'apollo_match', seniority: 'apollo_match', departments: 'apollo_match', photo_url: 'apollo_match', employment_history: 'apollo_match',
      phone: 'apollo_match',
    });
  });

  it('a different title is an actionable suggestion; a different company is for information', () => {
    expect(enrichmentPatch(CARD, FOUND, opts).suggestions).toEqual([
      { field: 'title', current: 'VP Sales', suggested: 'Chief Revenue Officer', actionable: true },
      { field: 'company', current: 'Northwind', suggested: 'Contoso', actionable: false },
    ]);
  });

  it('the same title or company in other words is not a difference', () => {
    expect(sameText('VP, Sales', 'vp sales')).toBe(true);
    expect(differenceSuggestions({ title: 'VP, Sales', company_name: 'Northwind Inc.' }, { title: 'vp sales', company: 'northwind inc' })).toEqual([]);
  });

  it('a contact whose only number is an older single field keeps it, and its number to call', () => {
    const { patch } = enrichmentPatch({ name: 'A', phone_work: '801-555-0000' }, FOUND, opts);
    expect(patch.phones.map(p => [p.value, p.label])).toEqual([['801-555-0000', 'work'], ['+13035550142', 'mobile']]);
    expect(patch).not.toHaveProperty('phone');
    expect(patch).not.toHaveProperty('phone_work');
    expect(patch.phone_mobile).toBe('+13035550142');
  });

  it('a website under `website` keeps company_website from being filled', () => {
    expect(enrichmentPatch({ name: 'A', website: 'https://northwind.com' }, FOUND, opts).patch).not.toHaveProperty('company_website');
  });

  it('a real photo stays; a placeholder is replaced', () => {
    const real = 'https://media.licdn.com/dms/image/v2/y/profile-displayphoto-shrink_200_200/0/1';
    expect(enrichmentPatch({ ...CARD, photo_url: real }, FOUND, opts).patch).not.toHaveProperty('photo_url');
    expect(enrichmentPatch({ ...CARD, photo_url: 'https://static.licdn.com/sc/h/ghost' }, FOUND, opts).patch.photo_url).toBe(APOLLO_PERSON.photo_url);
  });
});

describe('enrichmentPatch: filling an empty contact', () => {
  const BARE = { name: 'Jimmy Choi', company: 'Northwind' };

  it('fills email, title, location as one, and phones as one canonical list', () => {
    const { patch, suggestions } = enrichmentPatch(BARE, FOUND, opts);
    expect(patch).toMatchObject({
      email: 'jimmy.choi@contoso.com', email_status: 'verified',
      title: 'Chief Revenue Officer', current_position_title: 'Chief Revenue Officer', job_start_date: '2024-01-01',
      city: 'Denver', state: 'Colorado', country: 'United States', time_zone: 'America/Denver',
      phone: '+13035550142', phone_mobile: '+13035550142',
    });
    expect(patch.phones).toEqual([expect.objectContaining({ value: '+13035550142', label: 'mobile', labelSource: 'enrichment' })]);
    expect(patch.enrichment_provenance).toMatchObject({ email: 'apollo_match', title: 'apollo_match', location: 'apollo_match', phone: 'apollo_match' });
    expect(patch).not.toHaveProperty('linkedin_url');                   // a found LinkedIn is only a candidate
    // Their company, under its other name, is copied — not replaced by Apollo's.
    expect(patch.company_name).toBe('Northwind');
    expect(patch.current_company_name).toBe('Northwind');
    expect(patch.enrichment_provenance).not.toHaveProperty('company_name');
    expect(suggestions).toEqual([{ field: 'company', current: 'Northwind', suggested: 'Contoso', actionable: false }]);
  });

  it('fills an empty company from the match', () => {
    const { patch } = enrichmentPatch({ name: 'Jimmy Choi' }, FOUND, opts);
    expect(patch).toMatchObject({ company_name: 'Contoso', current_company_name: 'Contoso' });
    expect(patch.enrichment_provenance.company_name).toBe('apollo_match');
  });

  it('location never mixes: one field present means none is filled; company location only as a whole fallback', () => {
    expect(enrichmentPatch({ name: 'A', state: 'Utah' }, FOUND, opts).patch).not.toHaveProperty('city');
    const company = enrichmentPatch({ name: 'A' }, { company_city: 'Provo', company_state: 'Utah' }, {}).patch;
    expect(company).toMatchObject({ city: 'Provo', state: 'Utah' });
    expect(company.enrichment_provenance.location).toBe('google_places');
  });

  it('job start date is kept only when it describes the contact\'s own title', () => {
    expect(enrichmentPatch({ name: 'A', title: 'VP Sales' }, FOUND, opts).patch).not.toHaveProperty('job_start_date');
  });
});

describe('enrichmentPatch: what is never written, and what is only offered', () => {
  it('a found LinkedIn URL is never written, even on a contact with none', () => {
    const { patch, filled } = enrichmentPatch({ name: 'Jimmy Choi' }, FOUND, opts);
    expect(patch).not.toHaveProperty('linkedin_url');
    expect(filled).not.toContain('linkedin_url');
  });

  it('an email found on a company website is offered, not filled; one from an exact match is filled', () => {
    const fromSite = enrichmentPatch({ name: 'A' }, { email: 'info@contoso.com', emailSource: 'website' }, { provenance: { email: 'website_scrape' } });
    expect(fromSite.patch).not.toHaveProperty('email');
    expect(fromSite.suggestions).toEqual([{ field: 'email', current: null, suggested: 'info@contoso.com', actionable: true, source: 'website' }]);
    expect(enrichmentPatch({ name: 'A' }, { email: 'jimmy@contoso.com' }, { provenance: { email: 'apollo_match' } }).patch.email).toBe('jimmy@contoso.com');
  });
});

describe('mergeFoundPhones: Apollo\'s numbers next to the contact\'s own', () => {
  const MAIN_ONLY = { name: 'A', phones: [{ id: 'card-1', value: '+14155550100', label: 'main', labelSource: 'card' }], phone: '+14155550100' };

  it('keeps every number and label; adds only new ones, by Apollo\'s stated type', () => {
    const { patch, added } = mergeFoundPhones(MAIN_ONLY, [
      { sanitized_number: '+18015550199', type: 'mobile' },
      { sanitized_number: '+14155550100', type: 'work_hq' },        // the card's number again
      { sanitized_number: '+18015550111', type: 'work_hq' },        // a type Apollo does not state as ours
    ]);
    expect(added).toHaveLength(2);
    expect(patch.phones.map(p => [p.value, p.label, p.labelSource])).toEqual([
      ['+14155550100', 'main', 'card'],
      ['+18015550199', 'mobile', 'enrichment'],
      ['+18015550111', 'unknown', null],
    ]);
    expect(patch).not.toHaveProperty('phone');                      // the number to call stays the card's
    expect(patch.phone_mobile).toBe('+18015550199');
    expect(patch.phone_normalized).toBe('+18015550199');            // a stated mobile may identify; was empty
  });

  it('an untyped number never becomes the identity number', () => {
    const { patch } = mergeFoundPhones(MAIN_ONLY, [{ sanitized_number: '+18015550111', type: 'work_hq' }]);
    expect(patch.phones.at(-1)).toMatchObject({ label: 'unknown' });
    expect(patch).not.toHaveProperty('phone_normalized');
  });

  it('the same number with or without its country code is not added twice', () => {
    expect(mergeFoundPhones(MAIN_ONLY, [{ raw_number: '(415) 555-0100', type: 'mobile' }])).toEqual({ patch: {}, added: [] });
    const card = { name: 'A', phones: [{ id: 'card-1', value: '801-555-1234', label: 'mobile', labelSource: 'card' }] };
    expect(mergeFoundPhones(card, [{ sanitized_number: '+18015551234', type: 'mobile' }])).toEqual({ patch: {}, added: [] });
    expect(mergeFoundPhones({ name: 'B', phone: '801-555-1234' }, [{ sanitized_number: '+18015551234', type: 'mobile' }])).toEqual({ patch: {}, added: [] });
  });

  it('a number the user removed from the list is not added back', () => {
    const removed = { ...MAIN_ONLY, phone_numbers: [{ sanitized_number: '+18015550199', type: 'mobile' }] };
    expect(mergeFoundPhones(removed, [{ sanitized_number: '+18015550199', type: 'mobile' }])).toEqual({ patch: {}, added: [] });
  });

  it('running it again on the result adds nothing', () => {
    const numbers = [{ sanitized_number: '+18015550199', type: 'mobile' }];
    const once = { ...MAIN_ONLY, ...mergeFoundPhones(MAIN_ONLY, numbers).patch };
    expect(mergeFoundPhones(once, numbers)).toEqual({ patch: {}, added: [] });
  });
});

// ─── The real handler ───────────────────────────────────────────────────────

vi.mock('../../netlify/functions/utils/logApiUsage.js', () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock('../../netlify/functions/utils/apolloErrorLogger.js', () => ({ logApolloError: vi.fn(async () => {}), logApolloWarning: vi.fn() }));
vi.mock('../../netlify/functions/utils/googleBusinessLookup.js', () => ({
  googleBusinessLookup: vi.fn(async () => ({ status: 'no_data', message: 'none', fieldsFound: [], data: {} })),
}));
vi.mock('../../netlify/functions/utils/linkedinSearch.js', () => ({
  searchLinkedInCandidates: vi.fn(async () => ({ configured: false, failed: false, results: [] })),
  searchLinkedInProfile: vi.fn(async () => ({ success: false, message: 'not configured' })),
  searchLinkedInPhoto: vi.fn(async () => ({ success: false, message: 'none' })),
  extractEmailDomain: () => null,
}));

const { handler } = await import('../../netlify/functions/barryEnrich.js');
const { APOLLO_ENDPOINTS } = await import('../../netlify/functions/utils/apolloConstants.js');

async function enrich(contact, person = APOLLO_PERSON) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).startsWith('https://identitytoolkit.googleapis.com')) return { ok: true, json: async () => ({ users: [{ localId: 'u1' }] }) };
    if (url === APOLLO_ENDPOINTS.PEOPLE_MATCH) return { ok: true, json: async () => ({ person }) };
    if (url === APOLLO_ENDPOINTS.PEOPLE_SEARCH) return { ok: true, json: async () => ({ people: [] }) };
    throw new Error(`unexpected fetch ${url}`);
  }));
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ userId: 'u1', authToken: 't', contact }) });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

describe('barryEnrich: what it returns to be written', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.APOLLO_API_KEY = 'test-apollo-key';
    process.env.FIREBASE_API_KEY = 'test-firebase-key';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('a card contact keeps its email, phone, title, company and website; differences come back as suggestions', async () => {
    const { enrichedData, suggestions } = await enrich(CARD);
    expect(enrichedData).not.toHaveProperty('email');
    expect(enrichedData).not.toHaveProperty('phone');
    expect(enrichedData).not.toHaveProperty('phone_direct');
    // The card's number stays first, with its label; Apollo's new number is added after it.
    expect(enrichedData.phones.map(p => [p.value, p.label, p.labelSource])).toEqual([
      ['801-555-1234', 'direct', 'card'],
      ['+13035550142', 'mobile', 'enrichment'],
    ]);
    expect(enrichedData).not.toHaveProperty('title');
    expect(enrichedData).not.toHaveProperty('company_name');
    expect(enrichedData).not.toHaveProperty('company_website');
    expect(enrichedData).not.toHaveProperty('city');
    expect(enrichedData).toMatchObject({ headline: 'Building revenue teams', seniority: 'c_suite' });
    expect(enrichedData.enrichment_provenance).toMatchObject({ linkedin_url: 'user_confirmed', title: 'user_accepted', headline: 'apollo_match' });
    expect(suggestions).toEqual([
      { field: 'title', current: 'VP Sales', suggested: 'Chief Revenue Officer', actionable: true },
      { field: 'company', current: 'Northwind', suggested: 'Contoso', actionable: false },
    ]);
    // Written as before by the caller: what it writes cannot touch the protected fields.
    expect({ ...CARD, ...enrichedData }).toMatchObject({ email: CARD.email, phone: CARD.phone, title: 'VP Sales', company_name: 'Northwind' });
  });

  it('an empty contact is filled, with provenance, and nothing is suggested over a blank', async () => {
    const { enrichedData, suggestions, linkedinCandidates } = await enrich({ id: 'c2', name: 'Jimmy Choi', apollo_person_id: 'apollo-1' });
    expect(enrichedData).toMatchObject({
      email: 'jimmy.choi@contoso.com', title: 'Chief Revenue Officer', company_name: 'Contoso',
      city: 'Denver', phone: '+13035550142',
    });
    // The matched record's LinkedIn is offered for the user to confirm, never written.
    expect(enrichedData).not.toHaveProperty('linkedin_url');
    expect(linkedinCandidates.map(c => c.linkedinUrl)).toEqual(['https://www.linkedin.com/in/jimmychoi']);
    expect(enrichedData.enrichment_provenance).toMatchObject({ email: 'apollo_match', title: 'apollo_match', company_name: 'apollo_match' });
    expect(enrichedData.enrichment_summary.fields_filled).toEqual(expect.arrayContaining(['email', 'title', 'company_name', 'phone']));
    expect(suggestions).toEqual([]);
  });

  it('location is one unit: an organization city with no state never meets Apollo\'s state; the person\'s location wins', async () => {
    const { enrichedData } = await enrich({ id: 'c3', name: 'Jimmy Choi', apollo_person_id: 'apollo-1', organization: { city: 'Provo' } });
    expect(enrichedData).toMatchObject({ city: 'Denver', state: 'Colorado', country: 'United States' });
    expect(enrichedData.enrichment_provenance.location).toBe('apollo_match');
  });

  it('the organization\'s location is used only whole, as the company-level fallback', async () => {
    const noPlace = { ...APOLLO_PERSON, city: null, state: null, country: null, time_zone: null };
    const { enrichedData } = await enrich({ id: 'c4', name: 'Jimmy Choi', apollo_person_id: 'apollo-1', organization: { city: 'Provo', state: 'Utah' } }, noPlace);
    expect(enrichedData).toMatchObject({ city: 'Provo', state: 'Utah' });
    expect(enrichedData).not.toHaveProperty('country');
    expect(enrichedData.enrichment_provenance.location).toBe('internal_db');
  });
});

// ─── Running Enrich again changes nothing ───────────────────────────────────

describe('barryEnrich: repeated runs are idempotent', () => {
  // Bookkeeping about the run itself, rewritten every time by design.
  const RUN_FIELDS = ['lead_status', 'export_ready', 'last_enriched_at', 'data_sources', 'enrichment_steps', 'enrichment_summary', '_raw_apollo_data', 'enrichment_provenance'];
  const facts = (data) => Object.fromEntries(Object.entries(data).filter(([k]) => !RUN_FIELDS.includes(k)));

  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.APOLLO_API_KEY = 'test-apollo-key';
    process.env.FIREBASE_API_KEY = 'test-firebase-key';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([
    ['a card contact', CARD],
    ['an empty contact', { id: 'c2', name: 'Jimmy Choi', apollo_person_id: 'apollo-1' }],
    ['a contact with an organization location', { id: 'c3', name: 'Jimmy Choi', apollo_person_id: 'apollo-1', organization: { city: 'Provo' } }],
  ])('%s: the second run writes no fact, keeps provenance, and suggests the same', async (_name, start) => {
    // Written the way ContactProfile writes it: the result spread onto the contact.
    const first = await enrich(start);
    const once = { ...start, ...first.enrichedData };
    const second = await enrich(once);
    const twice = { ...once, ...second.enrichedData };

    expect(facts(second.enrichedData)).toEqual({});
    expect(second.enrichedData.enrichment_provenance).toEqual(once.enrichment_provenance);
    expect(facts(twice)).toEqual(facts(once));
    expect(second.suggestions).toEqual(first.suggestions);
  });
});

