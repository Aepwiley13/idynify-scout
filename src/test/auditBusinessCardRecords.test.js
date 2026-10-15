/**
 * The historical business-card audit (scripts/auditBusinessCardRecords.mjs).
 *
 * It must be read-only, private and deterministic. These tests run it end to
 * end against an in-memory Firestore that throws on any write method and
 * counts every read, check each flag and each cleanup outcome, scan its source
 * for write calls, and prove no personal value reaches the output.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SELECTORS, CONTACT_FLAGS, COMPANY_FLAGS, HEURISTIC_FLAGS, TOTAL_ONLY_FLAGS, CLEANUP_RULES,
  DUPLICATE_DOMAIN_PAIR_LIMIT, classifyContact, classifyCompany, decideCleanup, auditWorkspace,
  summarizeUsage, buildReport, formatText, parseArgs, main, monthOf, companyNameFromDomain,
  firstLastShaped,
} from '../../scripts/auditBusinessCardRecords.mjs';

vi.mock('../firebase/config', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({}));

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT_PATH = 'scripts/auditBusinessCardRecords.mjs';
const SCRIPT = readFileSync(resolve(repo, SCRIPT_PATH), 'utf8');
const S = 'Scanned Business Card';

// ─── An in-memory Firestore: reads only, and it counts them ──────────────────

const WRITE_METHODS = new Set([
  'set', 'update', 'delete', 'add', 'create', 'batch', 'commit', 'runTransaction', 'bulkWriter', 'recursiveDelete',
]);

function fakeFirestore({ users = [], docs = {} }) {
  const writes = [];
  const reads = { queries: 0, documents: 0, emptyQueries: 0 };
  const guard = (target, label) => new Proxy(target, {
    get(object, prop) {
      if (typeof prop === 'string' && WRITE_METHODS.has(prop)) {
        return () => {
          writes.push(`${label}.${prop}`);
          throw new Error(`write attempted: ${label}.${prop}`);
        };
      }
      return object[prop];
    },
  });
  const matches = (actual, op, value) => {
    if (op === '==') return actual === value;
    if (op === 'array-contains') return Array.isArray(actual) && actual.includes(value);
    if (op === 'in') return value.includes(actual);
    throw new Error(`unsupported operator ${op}`);
  };
  const project = (data, fields) => (fields
    ? Object.fromEntries(fields.filter(field => field in data).map(field => [field, data[field]]))
    : { ...data });
  const query = (path, filters = [], fields = null, max = Infinity) => guard({
    where: (field, op, value) => query(path, [...filters, { field, op, value }], fields, max),
    select: (...selected) => query(path, filters, selected, max),
    limit: n => query(path, filters, fields, n),
    get: async () => {
      const rows = Object.entries(docs[path] ?? {})
        .filter(([, data]) => filters.every(({ field, op, value }) => matches(data[field], op, value)))
        .slice(0, max);
      reads.queries += 1;
      reads.documents += rows.length;
      if (!rows.length) reads.emptyQueries += 1;
      const snapshots = rows.map(([id, data]) => guard({ id, exists: true, data: () => project(data, fields) }, `${path}/${id}`));
      return { docs: snapshots, size: snapshots.length, empty: snapshots.length === 0 };
    },
  }, path);
  const docRef = path => guard({
    id: path.slice(path.lastIndexOf('/') + 1),
    path,
    collection: name => collection(`${path}/${name}`),
  }, path);
  const collection = path => {
    const base = query(path);
    return guard({
      where: base.where, select: base.select, limit: base.limit, get: base.get,
      doc: id => docRef(`${path}/${id}`),
      listDocuments: async () => {
        if (path !== 'users') throw new Error('listDocuments is only expected on users');
        reads.queries += 1;
        reads.documents += users.length;
        if (!users.length) reads.emptyQueries += 1;
        return users.map(id => docRef(`users/${id}`));
      },
    }, path);
  };
  const db = guard({
    collection,
    getAll: async (...refs) => refs.map(ref => {
      const at = ref.path.lastIndexOf('/');
      const data = docs[ref.path.slice(0, at)]?.[ref.path.slice(at + 1)];
      reads.queries += 1;
      if (data) reads.documents += 1;
      else reads.emptyQueries += 1;
      return guard({ id: ref.id, exists: Boolean(data), data: () => (data ? { ...data } : undefined) }, ref.path);
    }),
  }, 'db');
  return { db, writes, reads };
}

// ─── Fixtures: every personal value is distinctive, so the privacy test can find it ──

const PII = [
  'Zelda Quixote', 'zelda.quixote', 'acmerockets', 'Acme Rockets', '4155550199', '(415) 555-0199',
  'Yorick', 'OBrien', 'obrien-design', 'Wilhelmina Ploughshare', 'wilhelmina', '2125550142', '212 555 0142',
  'Nimbus Widgets', 'Bramble Bakery', 'brambleb', 'wixsite', 'Ferngully', 'ferngully', 'Gmail', 'gmail',
  'Vision quota text', 'Chief Executive Officer', 'unrelated.com', 'Unrelated Things',
];

/** The legacy scanner's real failure modes, plus clean neighbours to collide with. */
function alphaWorkspace() {
  const scanned = { source: S, capture_method: 'business_card_ocr', enrichment_status: 'ocr_extracted' };
  return {
    'users/ws-alpha/contacts': {
      k1: { ...scanned, name: 'Zelda Quixote', email: 'Zelda.Quixote@acmerockets.com', email_normalized: 'zelda.quixote@acmerockets.com', phone: '(415) 555-0199', phone_normalized: '4155550199', company_id: 'm1' },
      k2: { ...scanned, name: 'Chief Executive Officer', email: 'ceo.person@gmail.com', company_id: null },
      k3: { ...scanned, name: 'Nimbus Widgets LLC' },
      k4: { ...scanned, name: 'Yorick OBrien', email: 'yorick@obrien-design.com', identity_review_required: true },
      k5: { source: 'ManualContactForm', addedFrom: 'manual', identity_sources: ['ManualContactForm', S], name: 'Wilhelmina Ploughshare', email: 'wilhelmina@ferngully.io', phone: '212 555 0142', phone_normalized: '2125550142', company_id: 'm2' },
      k6: { source: 'ManualContactForm', addedFrom: 'manual', name: 'Not Scanned', email: 'zelda.quixote@acmerockets.com', email_normalized: 'zelda.quixote@acmerockets.com', phone_normalized: '2125550142', company_id: 'm4' },
    },
    'users/ws-alpha/companies': {
      // The parser's email-local-part "website", kept as the domain.
      m1: { source: S, name: 'Acme Rockets', domain: 'zelda.quixote', website_url: 'zelda.quixote', name_source: 'user', contact_count: 1, saved_at: '2026-09-20T10:00:00.000Z' },
      // "Gmail" made from a free-mail address.
      m2: { source: S, name: 'Gmail', domain: null, website_url: 'wilhelmina.p', contact_count: 1, saved_at: '2026-08-30T09:00:00.000Z' },
      // A site-builder domain as the company key, never linked.
      m3: { source: S, name: 'Bramble Bakery', domain: 'brambleb.wixsite.com', website_url: 'https://brambleb.wixsite.com/home', name_source: 'user', contact_count: 0, saved_at: '2026-09-02T12:00:00.000Z' },
      // A pending company promoted by the scanner; a guessed name locked as the user's.
      m4: { source: 'apollo', accepted_via: S, name: 'Ferngully', domain: 'ferngully.io', name_source: 'user', contact_count: 2, saved_at: '2026-10-01T08:00:00.000Z' },
      // Not scanner records: here to collide with m4.
      m5: { source: 'apollo', name: 'Ferngully Inc', domain: 'www.ferngully.io' },
      m6: { source: 'apollo', name: 'Unrelated Things', domain: 'unrelated.com' },
    },
  };
}

const USAGE_ROWS = {
  u1: { operation: 'extractBusinessCard', endpoint: 'GOOGLE_EXTRACTBUSINESSCARD', status: 'success', userId: 'ws-alpha', timestamp: { toDate: () => new Date('2026-10-14T23:10:00Z') } },
  u2: { operation: 'extractBusinessCard', endpoint: 'APOLLO_EXTRACTBUSINESSCARD', status: 'error', userId: 'ws-alpha', errorCode: 'Vision quota text: Zelda Quixote zelda.quixote@acmerockets.com', timestamp: { _seconds: Date.parse('2026-08-12T10:00:00Z') / 1000 } },
  u3: { operation: 'extractBusinessCard', endpoint: 'GOOGLE_EXTRACTBUSINESSCARD', status: 'error', userId: 'ws-beta', errorCode: 'NO_TEXT_FOUND', timestamp: { toDate: () => new Date('2026-10-15T01:00:00Z') } },
  // An old row with no operation field: found by the endpoint selector.
  u4: { endpoint: 'APOLLO_EXTRACTBUSINESSCARD', status: 'success', userId: 'ws-alpha', timestamp: '2026-08-20T00:00:00Z' },
  u5: { operation: 'searchPeople', endpoint: 'APOLLO_SEARCHPEOPLE', status: 'success', userId: 'ws-alpha' },
};

function fullStore() {
  return {
    users: ['ws-alpha', 'ws-empty'],
    docs: {
      ...alphaWorkspace(),
      'users/ws-empty/contacts': { e1: { name: 'Someone Else', source: 'ManualContactForm', addedFrom: 'manual' } },
      apiLogs: USAGE_ROWS,
    },
  };
}

async function run(argv, store = fullStore()) {
  const fake = fakeFirestore(store);
  let out = '';
  let err = '';
  const code = await main(argv, {
    db: fake.db, write: s => { out += s; }, warn: s => { err += s; }, now: () => new Date('2026-10-15T12:00:00Z'),
  });
  return { code, out, err, ...fake };
}

// ─── Selectors and flags are exactly what was approved ───────────────────────

describe('scope', () => {
  it('selects exactly the approved records', () => {
    expect(SELECTORS.contacts.map(s => [s.field, s.op, s.value])).toEqual([
      ['source', '==', S],
      ['capture_method', '==', 'business_card_ocr'],
      ['enrichment_status', '==', 'ocr_extracted'],
      ['identity_sources', 'array-contains', S],
    ]);
    expect(SELECTORS.companies.map(s => [s.field, s.op, s.value])).toEqual([
      ['source', '==', S],
      ['accepted_via', '==', S],
    ]);
    expect(SELECTORS.usage.map(s => [s.field, s.op, s.value])).toEqual([
      ['operation', '==', 'extractBusinessCard'],
      ['endpoint', 'in', ['APOLLO_EXTRACTBUSINESSCARD', 'GOOGLE_EXTRACTBUSINESSCARD']],
    ]);
  });

  it('raises exactly the approved flags, with the heuristic and total-only ones labelled', () => {
    expect(Object.keys(CONTACT_FLAGS)).toEqual([
      'MISSING_COMPANY', 'NO_ADDED_FROM', 'IDENTITY_REVIEW_UNSURFACED', 'NAME_LOOKS_LIKE_TITLE',
      'NAME_LOOKS_LIKE_COMPANY', 'NAME_POSSIBLY_STRIPPED', 'NO_EMAIL_OR_PHONE', 'DUPLICATE_EMAIL', 'DUPLICATE_PHONE',
    ]);
    expect(Object.keys(COMPANY_FLAGS)).toEqual([
      'PERSONAL_PROVIDER', 'MALFORMED_DOMAIN', 'FIRST_LAST_DOMAIN', 'SHARED_HOST_DOMAIN', 'DUPLICATE_DOMAIN',
      'DUPLICATE_NAME', 'NO_LEGITIMATE_DOMAIN', 'LOCKED_GUESSED_NAME', 'ORPHAN',
    ]);
    expect([...HEURISTIC_FLAGS]).toEqual(['NAME_POSSIBLY_STRIPPED']);
    expect(CONTACT_FLAGS.NAME_POSSIBLY_STRIPPED).toMatch(/^HEURISTIC/);
    expect([...TOTAL_ONLY_FLAGS]).toEqual(['NO_ADDED_FROM']);
  });
});

// ─── Contact flags ───────────────────────────────────────────────────────────

describe('contact flags', () => {
  const base = { addedFrom: 'manual', name: 'Jane Smith', email: 'jane@acme.com', company_id: 'c1' };

  it('a complete, clean contact raises nothing', () => {
    expect(classifyContact(base)).toEqual([]);
  });

  it.each([
    ['MISSING_COMPANY', { company_id: null }],
    ['NO_ADDED_FROM', { addedFrom: undefined }],
    ['IDENTITY_REVIEW_UNSURFACED', { identity_review_required: true }],
    ['NAME_LOOKS_LIKE_TITLE', { name: 'VP of Sales' }],
    ['NAME_LOOKS_LIKE_TITLE', { name: 'Head Chef', title: 'Head Chef' }],
    ['NAME_LOOKS_LIKE_COMPANY', { name: 'Acme Rocket Works', company: 'Acme Rocket Works' }],
    ['NAME_LOOKS_LIKE_COMPANY', { name: 'Smith Holdings Ltd' }],
    ['NAME_LOOKS_LIKE_COMPANY', { name: 'Consulting Group' }],
    ['NAME_POSSIBLY_STRIPPED', { name: 'Sean OBrien' }],
    ['NAME_POSSIBLY_STRIPPED', { name: 'Jos� Ruiz' }],
    ['NO_EMAIL_OR_PHONE', { email: null }],
  ])('%s', (code, patch) => {
    expect(classifyContact({ ...base, ...patch })).toEqual([code]);
  });

  it('duplicates come from the read layer', () => {
    expect(classifyContact(base, { duplicateEmail: true, duplicatePhone: true })).toEqual(['DUPLICATE_EMAIL', 'DUPLICATE_PHONE']);
  });

  it('a personal address does not mean a missing company', () => {
    expect(classifyContact({ ...base, company_id: null, email: 'jane@gmail.com' })).toEqual([]);
    expect(classifyContact({ ...base, company_id: null, email: 'jane@comcast.net' })).toEqual([]);
  });

  it('ordinary names are not flagged: Mc/Mac, De, two-letter surnames, a phone with no email', () => {
    for (const name of ['Ann McDonald', 'Pieter DeVries', 'Maria Sa', 'Lee Co', 'Dana Lee']) {
      expect(classifyContact({ ...base, name })).toEqual([]);
    }
    expect(classifyContact({ ...base, email: null, phone: '415-555-0100' })).toEqual([]);
  });

  it('tolerates missing and odd fields without throwing', () => {
    for (const contact of [{}, { name: 42, email: ['x'], phone: {}, company_id: 7 }, { name: '   ', identity_review_required: 'yes' }]) {
      expect(() => classifyContact(contact)).not.toThrow();
    }
  });
});

// ─── Company flags ───────────────────────────────────────────────────────────

describe('company flags', () => {
  const base = { name: 'Acme', domain: 'acme.com', website_url: 'https://www.acme.com', contact_count: 1 };
  const flags = (patch, context = { linked: true }) => classifyCompany({ ...base, ...patch }, context);

  it('a clean, linked company raises nothing', () => {
    expect(flags({})).toEqual([]);
  });

  it('PERSONAL_PROVIDER: a provider domain, or a free-mail brand name with no usable domain', () => {
    expect(flags({ domain: 'gmail.com', website_url: null })).toContain('PERSONAL_PROVIDER');
    expect(flags({ name: 'Gmail', domain: null, website_url: null })).toContain('PERSONAL_PROVIDER');
    // An ISP name is also a real company, and a brand with its own domain is fine.
    expect(flags({ name: 'Verizon', domain: null, website_url: null })).not.toContain('PERSONAL_PROVIDER');
    expect(flags({ name: 'Zoho', domain: 'zohocorp.com', website_url: null })).not.toContain('PERSONAL_PROVIDER');
  });

  it('MALFORMED_DOMAIN: @, whitespace or no registrable domain in a stored domain field', () => {
    for (const domain of ['jane@acme.com', 'acme .com', 'acme.corn', 'jane.smith']) {
      expect(flags({ domain })).toContain('MALFORMED_DOMAIN');
    }
    expect(flags({ primary_domain: 'acme' })).toContain('MALFORMED_DOMAIN');
  });

  it('FIRST_LAST_DOMAIN: an email local part, a suffix-less first.last, or two name labels', () => {
    const jane = { name: 'Jane Smith', email: 'jane.smith@acme.com' };
    expect(firstLastShaped('jane.smith', [jane])).toBe(true);
    expect(firstLastShaped('sarah.chen', [])).toBe(true);
    expect(firstLastShaped('jane.smith.com', [jane])).toBe(true);
    // Not person-shaped: a real domain, an OCR misreading, a one-label personal brand.
    expect(firstLastShaped('acme.com', [jane])).toBe(false);
    expect(firstLastShaped('acme.corn', [])).toBe(false);
    expect(firstLastShaped('janesmith.com', [jane])).toBe(false);
    expect(flags({ domain: 'sarah.chen', website_url: null })).toContain('FIRST_LAST_DOMAIN');
  });

  it('SHARED_HOST_DOMAIN: a shared host as the identity key; a shared-host website alone is not', () => {
    expect(flags({ domain: 'acme.wixsite.com' })).toContain('SHARED_HOST_DOMAIN');
    expect(flags({ domain: 'linkedin.com' })).toContain('SHARED_HOST_DOMAIN');
    expect(flags({ website_url: 'https://acme.wixsite.com/home' })).not.toContain('SHARED_HOST_DOMAIN');
  });

  it('NO_LEGITIMATE_DOMAIN: nothing usable to match on', () => {
    expect(flags({ domain: null, website_url: null })).toContain('NO_LEGITIMATE_DOMAIN');
    expect(flags({ domain: 'acme.wixsite.com', website_url: 'acme.wixsite.com' })).toContain('NO_LEGITIMATE_DOMAIN');
    expect(flags({ domain: null, website_url: 'https://www.acme.com' })).not.toContain('NO_LEGITIMATE_DOMAIN');
  });

  it('LOCKED_GUESSED_NAME: a user-sourced name equal to the guess from the domain', () => {
    expect(flags({ name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'user' })).toContain('LOCKED_GUESSED_NAME');
    expect(flags({ name: 'R&D Advantage', domain: 'rd-advantage.com', name_source: 'user' })).not.toContain('LOCKED_GUESSED_NAME');
    expect(flags({ name: 'Rd Advantage', domain: 'rd-advantage.com', name_source: 'email_domain' })).not.toContain('LOCKED_GUESSED_NAME');
  });

  it('ORPHAN: no contacts by count and none pointing at it', () => {
    expect(flags({ contact_count: 0 }, { linked: false })).toContain('ORPHAN');
    expect(flags({ contact_count: undefined }, { linked: false })).toContain('ORPHAN');
    expect(flags({ contact_count: 0 }, { linked: true })).not.toContain('ORPHAN');
    expect(flags({ contact_count: 3 }, { linked: false })).not.toContain('ORPHAN');
  });

  it('duplicates come from the workspace', () => {
    expect(flags({}, { linked: true, duplicateDomain: true, duplicateName: true })).toEqual(['DUPLICATE_DOMAIN', 'DUPLICATE_NAME']);
  });

  it('the local companyNameFromDomain matches the service exactly', async () => {
    const service = await import('../services/companyIdentityService.js');
    for (const domain of ['rd-advantage.com', 'acme.com', 'my_co-op.io', '', null, undefined, '.com', 'a--b.org']) {
      expect(companyNameFromDomain(domain)).toBe(service.companyNameFromDomain(domain));
    }
  });

  it('tolerates missing and odd fields without throwing', () => {
    for (const company of [{}, { name: 5, domain: ['x'], website_url: {}, contact_count: 'many' }, { domain: '   ' }]) {
      expect(() => classifyCompany(company)).not.toThrow();
    }
  });
});

// ─── The cleanup decision ────────────────────────────────────────────────────

describe('cleanup decision: fixed rules, no judgement', () => {
  const company = (codes, linked = true) => ({ codes, linked });
  const contact = codes => ({ codes });

  it('documents every rule with its level', () => {
    expect(CLEANUP_RULES.map(rule => [rule.id, rule.level])).toEqual([
      ['R1', 'REQUIRED'], ['R2', 'REQUIRED'], ['R3', 'REQUIRED'], ['R4', 'REQUIRED'], ['O1', 'OPTIONAL'], ['N1', 'NONE'],
    ]);
    expect(DUPLICATE_DOMAIN_PAIR_LIMIT).toBe(5);
  });

  it('R1: a linked personal-provider company', () => {
    expect(decideCleanup({ companies: [company(['PERSONAL_PROVIDER'])] })).toEqual({ level: 'REQUIRED', matched: [{ id: 'R1', count: 1 }] });
    expect(decideCleanup({ companies: [company(['PERSONAL_PROVIDER'], false)] }).level).toBe('OPTIONAL');
  });

  it('R2: a linked first.last-domain company', () => {
    expect(decideCleanup({ companies: [company(['FIRST_LAST_DOMAIN'])] })).toEqual({ level: 'REQUIRED', matched: [{ id: 'R2', count: 1 }] });
    expect(decideCleanup({ companies: [company(['FIRST_LAST_DOMAIN'], false)] }).level).toBe('OPTIONAL');
  });

  it('R3: more than 5 duplicate-domain pairs, and not 5', () => {
    expect(decideCleanup({ companies: [company(['DUPLICATE_DOMAIN'])], duplicateDomainPairs: 6 })).toEqual({ level: 'REQUIRED', matched: [{ id: 'R3', count: 6 }] });
    expect(decideCleanup({ companies: [company(['DUPLICATE_DOMAIN'])], duplicateDomainPairs: 5 }).level).toBe('OPTIONAL');
  });

  it('R4: a contact named like a title or a company; the heuristic flag never counts', () => {
    expect(decideCleanup({ contacts: [contact(['NAME_LOOKS_LIKE_TITLE'])] })).toEqual({ level: 'REQUIRED', matched: [{ id: 'R4', count: 1 }] });
    expect(decideCleanup({ contacts: [contact(['NAME_LOOKS_LIKE_COMPANY'])] }).level).toBe('REQUIRED');
    expect(decideCleanup({ contacts: [contact(['NAME_POSSIBLY_STRIPPED'])] }).level).toBe('OPTIONAL');
  });

  it('OPTIONAL: any other flag', () => {
    expect(decideCleanup({ contacts: [contact(['NO_ADDED_FROM'])], companies: [company(['ORPHAN'], false)] }))
      .toEqual({ level: 'OPTIONAL', matched: [{ id: 'O1', count: 2 }] });
  });

  it('NONE: no flags, or no records at all', () => {
    expect(decideCleanup({ contacts: [contact([])], companies: [company([])] })).toEqual({ level: 'NONE', matched: [{ id: 'N1', count: 0 }] });
    expect(decideCleanup({}).level).toBe('NONE');
  });

  it('reports every REQUIRED rule that matched', () => {
    expect(decideCleanup({
      contacts: [contact(['NAME_LOOKS_LIKE_TITLE'])],
      companies: [company(['PERSONAL_PROVIDER', 'FIRST_LAST_DOMAIN'])],
      duplicateDomainPairs: 9,
    }).matched.map(m => m.id)).toEqual(['R1', 'R2', 'R3', 'R4']);
  });
});

// ─── End to end against the in-memory Firestore ──────────────────────────────

describe('end-to-end run on fixtures', () => {
  it('finds the legacy damage, decides REQUIRED, exits 2, and writes nothing', async () => {
    const { code, out, writes, reads } = await run(['--json']);
    const report = JSON.parse(out);
    expect(code).toBe(2);
    expect(writes).toEqual([]);
    expect(report.readOnly).toBe(true);

    expect(report.totals).toEqual({
      workspacesScanned: 2, workspacesWithRecords: 1, contacts: 5, companies: 4, linkedCompanies: 3, duplicateDomainPairs: 1,
    });
    expect(report.selected).toEqual({
      contacts: { source: 4, capture_method: 4, enrichment_status: 4, identity_sources: 1 },
      companies: { source: 3, accepted_via: 1, referenced: 2 },
    });
    expect(report.contactFlags).toEqual({
      MISSING_COMPANY: 1, NO_ADDED_FROM: 4, IDENTITY_REVIEW_UNSURFACED: 1, NAME_LOOKS_LIKE_TITLE: 1,
      NAME_LOOKS_LIKE_COMPANY: 1, NAME_POSSIBLY_STRIPPED: 1, NO_EMAIL_OR_PHONE: 1, DUPLICATE_EMAIL: 1, DUPLICATE_PHONE: 1,
    });
    expect(report.companyFlags).toEqual({
      PERSONAL_PROVIDER: 1, MALFORMED_DOMAIN: 1, FIRST_LAST_DOMAIN: 2, SHARED_HOST_DOMAIN: 1, DUPLICATE_DOMAIN: 1,
      DUPLICATE_NAME: 1, NO_LEGITIMATE_DOMAIN: 3, LOCKED_GUESSED_NAME: 1, ORPHAN: 1,
    });
    expect(report.cleanup).toEqual({
      level: 'REQUIRED',
      matched: [{ id: 'R1', count: 1 }, { id: 'R2', count: 2 }, { id: 'R4', count: 2 }],
    });
    expect(report.companiesByMonth).toEqual({ created: { '2026-08': 1, '2026-09': 2 }, promoted: { '2026-10': 1 } });
    expect(report.usage).toEqual({
      total: 4, success: 2, error: 2,
      byMonth: { '2026-08': { total: 2, success: 1, error: 1 }, '2026-10': { total: 2, success: 1, error: 1 } },
      errorCodes: { NO_TEXT_FOUND: 1, OTHER: 1 },
      formats: { APOLLO_EXTRACTBUSINESSCARD: 2, GOOGLE_EXTRACTBUSINESSCARD: 2 },
      workspaces: 2,
    });
    expect(report.byWorkspace).toEqual([{
      workspace: 'ws-alpha', contacts: 5, companies: 4, flaggedContacts: 5, flaggedCompanies: 4, flags: 24, duplicateDomainPairs: 1,
    }]);
    // The counter saw every read the database served.
    expect(report.reads).toEqual(reads);
    expect(report.details).toBeUndefined();
  });

  it('per record: the flags land on the right documents', async () => {
    const report = JSON.parse((await run(['--json', '--details'])).out);
    const where = (kind, code) => report.details[kind][code];
    expect(where('contacts', 'DUPLICATE_EMAIL')).toEqual(['users/ws-alpha/contacts/k1']);
    expect(where('contacts', 'DUPLICATE_PHONE')).toEqual(['users/ws-alpha/contacts/k5']);
    expect(where('contacts', 'NAME_LOOKS_LIKE_TITLE')).toEqual(['users/ws-alpha/contacts/k2']);
    expect(where('contacts', 'NAME_LOOKS_LIKE_COMPANY')).toEqual(['users/ws-alpha/contacts/k3']);
    expect(where('contacts', 'MISSING_COMPANY')).toEqual(['users/ws-alpha/contacts/k4']);
    expect(where('companies', 'PERSONAL_PROVIDER')).toEqual(['users/ws-alpha/companies/m2']);
    expect(where('companies', 'FIRST_LAST_DOMAIN')).toEqual(['users/ws-alpha/companies/m1', 'users/ws-alpha/companies/m2']);
    expect(where('companies', 'SHARED_HOST_DOMAIN')).toEqual(['users/ws-alpha/companies/m3']);
    expect(where('companies', 'ORPHAN')).toEqual(['users/ws-alpha/companies/m3']);
    expect(where('companies', 'LOCKED_GUESSED_NAME')).toEqual(['users/ws-alpha/companies/m4']);
    expect(where('companies', 'DUPLICATE_DOMAIN')).toEqual(['users/ws-alpha/companies/m4']);
    // The systemic flag is a total only, even in details.
    expect(report.details.contacts.NO_ADDED_FROM).toBeUndefined();
  });

  it('--user-id narrows to one workspace without listing users, and its usage rows', async () => {
    const { code, out, writes } = await run(['--json', '--user-id=ws-empty']);
    const report = JSON.parse(out);
    expect(code).toBe(0);
    expect(writes).toEqual([]);
    expect(report.scope).toBe('one');
    expect(report.totals.workspacesScanned).toBe(1);
    expect(report.totals.contacts).toBe(0);
    expect(report.usage.total).toBe(0);
    expect(report.cleanup.level).toBe('NONE');
  });

  it('OPTIONAL exits 0', async () => {
    const store = {
      users: ['ws-opt'],
      docs: { 'users/ws-opt/contacts': { k1: { source: S, name: 'Jane Smith', email: 'jane@gmail.com' } } },
    };
    const { code, out } = await run(['--json'], store);
    expect(JSON.parse(out).cleanup).toEqual({ level: 'OPTIONAL', matched: [{ id: 'O1', count: 1 }] });
    expect(code).toBe(0);
  });

  it('NONE exits 0, including an empty project', async () => {
    const clean = {
      users: ['ws-clean'],
      docs: {
        'users/ws-clean/contacts': { k1: { source: S, addedFrom: 'saved', name: 'Jane Smith', email: 'jane@acme.com', company_id: 'm1' } },
        'users/ws-clean/companies': { m1: { source: S, name: 'Acme', domain: 'acme.com', contact_count: 1 } },
      },
    };
    for (const store of [clean, { users: [], docs: {} }]) {
      const { code, out, writes } = await run(['--json'], store);
      expect(JSON.parse(out).cleanup.level).toBe('NONE');
      expect(code).toBe(0);
      expect(writes).toEqual([]);
    }
  });

  it('R3 from the database: six duplicate-domain pairs make it REQUIRED, five do not', async () => {
    const workspace = pairs => {
      const companies = { s1: { source: S, name: 'Acme', domain: 'acme.com', contact_count: 1 } };
      for (let i = 0; i < pairs; i += 1) companies[`o${i}`] = { name: `Other ${i}`, domain: 'acme.com' };
      return { users: ['ws-dup'], docs: { 'users/ws-dup/companies': companies } };
    };
    const six = JSON.parse((await run(['--json'], workspace(6))).out);
    expect(six.totals.duplicateDomainPairs).toBe(6);
    expect(six.cleanup.matched).toEqual([{ id: 'R3', count: 6 }]);
    const five = JSON.parse((await run(['--json'], workspace(5))).out);
    expect(five.totals.duplicateDomainPairs).toBe(5);
    expect(five.cleanup.level).toBe('OPTIONAL');
  });

  it('old and odd documents do not crash the run', async () => {
    const store = {
      users: ['ws-odd'],
      docs: {
        'users/ws-odd/contacts': {
          k1: { source: S, name: null, email: 12, phone: ['x'], company_id: 'ghost' },
          k2: { capture_method: 'business_card_ocr' },
        },
        'users/ws-odd/companies': { m1: { source: S, domain: 'Acme.COM ', saved_at: { seconds: 1756000000 }, contact_count: '2' } },
      },
    };
    const { code, writes, out } = await run(['--json'], store);
    expect([0, 2]).toContain(code);
    expect(writes).toEqual([]);
    expect(JSON.parse(out).totals.contacts).toBe(2);
  });
});

// ─── Output ──────────────────────────────────────────────────────────────────

describe('output', () => {
  it('is summary-first by default: no document IDs without --details', async () => {
    const { out } = await run([]);
    expect(out.split('\n')[0]).toMatch(/READ-ONLY, nothing was written/);
    for (const heading of ['CLEANUP: REQUIRED', 'Totals', 'Contact flags', 'Company flags', 'Scanner companies by month', 'Endpoint usage', 'By workspace', 'Reads:']) {
      expect(out).toContain(heading);
    }
    expect(out).toMatch(/NAME_POSSIBLY_STRIPPED\s+1\s+\(heuristic\)/);
    expect(out).toMatch(/NO_ADDED_FROM\s+4\s+\(total only\)/);
    expect(out).not.toMatch(/users\/ws-alpha\/(contacts|companies)\//);
    expect(out).not.toContain('Details');
  });

  it('--details adds document IDs, never the systemic flag\'s', async () => {
    const { out } = await run(['--details']);
    expect(out).toContain('Details (document IDs by flag)');
    expect(out).toContain('users/ws-alpha/companies/m3');
    const details = out.slice(out.indexOf('Details'));
    expect(details).not.toContain('NO_ADDED_FROM');
  });

  it('text and JSON agree on the decision', async () => {
    const text = (await run([])).out;
    const json = JSON.parse((await run(['--json'])).out);
    expect(text).toContain(`CLEANUP: ${json.cleanup.level}`);
    expect(formatText(json)).toBe(text);
  });
});

// ─── Privacy ─────────────────────────────────────────────────────────────────

describe('privacy: IDs and codes only', () => {
  it('no name, email, phone, domain, company name or stored error text reaches any output mode', async () => {
    const outputs = [
      (await run([])).out,
      (await run(['--details'])).out,
      (await run(['--json'])).out,
      (await run(['--json', '--details'])).out,
    ];
    for (const output of outputs) {
      for (const value of PII) expect(output.toLowerCase()).not.toContain(value.toLowerCase());
      expect(output).not.toContain('@');
    }
  });

  it('the fixtures really do contain those values (the check is not vacuous)', () => {
    const fixtureText = JSON.stringify(fullStore()).toLowerCase();
    for (const value of PII) expect(fixtureText).toContain(value.toLowerCase());
  });

  it('stored error text is reduced to a known code or OTHER', () => {
    expect(summarizeUsage([
      { data: { status: 'error', errorCode: 'Request failed: {"name":"Someone"}' } },
      { data: { status: 'error', errorCode: 'UPSTREAM_OCR_FAILURE' } },
      { data: { status: 'error' } },
    ]).errorCodes).toEqual({ NONE: 1, OTHER: 1, UPSTREAM_OCR_FAILURE: 1 });
  });
});

// ─── Read-only, at the source ────────────────────────────────────────────────

/** Comments removed, so documentation that names a method is never mistaken for a call. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

const BEGIN = '// ═══ FIRESTORE READS — BEGIN';
const END = '// ═══ FIRESTORE READS — END';
const WRITE_CALL = /\.(?:update|delete|create|batch|commit|runTransaction|bulkWriter|recursiveDelete)\s*\(|\bFieldValue\b|\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch)\b/;
const SET_OR_ADD_CALL = /\.(?:set|add)\s*\(/;
const DB_ACCESS = /\.(?:collection|collectionGroup|doc|listDocuments|getAll)\s*\(|\bgetFirestore\b|\binitializeApp\b/;
const WRITE_FLAG = /--(?:apply|live|write|fix|commit|execute)\b/;

function regions(source) {
  const begin = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  return { inside: code(source.slice(begin, end)), outside: code(source.slice(0, begin) + source.slice(end)), begin, end };
}

describe('read-only at the source', () => {
  it('has exactly one Firestore section', () => {
    expect(SCRIPT.split(BEGIN)).toHaveLength(2);
    expect(SCRIPT.split(END)).toHaveLength(2);
    const { begin, end } = regions(SCRIPT);
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
  });

  it('calls no write method anywhere', () => {
    expect(code(SCRIPT)).not.toMatch(WRITE_CALL);
    expect(code(SCRIPT)).not.toMatch(WRITE_FLAG);
  });

  it('touches the database only inside that section, and never with set() or add() there', () => {
    const { inside, outside } = regions(SCRIPT);
    expect(inside).toMatch(DB_ACCESS);
    expect(outside).not.toMatch(DB_ACCESS);
    expect(inside).not.toMatch(SET_OR_ADD_CALL);
  });

  it('has no hard-coded project and only one credential path', () => {
    expect(SCRIPT).not.toMatch(/projectId:\s*['"`]/);
    expect(SCRIPT).not.toMatch(/idynify-/);
    expect(SCRIPT).not.toMatch(/GOOGLE_APPLICATION_CREDENTIALS|applicationDefault/);
    expect(code(SCRIPT)).toMatch(/env\.FIREBASE_SERVICE_ACCOUNT_PATH/);
  });

  it('imports only node built-ins, the identity normalizers, the capture building blocks and firebase-admin', () => {
    const specifiers = [...code(SCRIPT).matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect([...new Set(specifiers)].sort()).toEqual([
      '../src/capture/safeguards.js', '../src/capture/validators.js', '../src/utils/identityNormalization.js',
      'firebase-admin/app', 'firebase-admin/firestore', 'node:fs', 'node:process', 'node:url',
    ]);
  });

  it('the guard is not vacuous: it catches real calls and ignores comments and in-memory maps', () => {
    const planted = `x\n${BEGIN}\nconst r = db.collection('a').doc('b');\nr.set({});\n${END}\nconst m = new Map(); m.set(1, 2);\n// never call .update( or .delete(\n`;
    const { inside, outside } = regions(planted);
    expect(inside).toMatch(SET_OR_ADD_CALL);
    // Map.set outside the section is ordinary code, not a database write.
    expect(outside).toMatch(SET_OR_ADD_CALL);
    expect(outside).not.toMatch(DB_ACCESS);
    expect(code(planted)).not.toMatch(WRITE_CALL);
    expect(code('ref.update({ a: 1 })')).toMatch(WRITE_CALL);
    expect(code('db.batch()')).toMatch(WRITE_CALL);
    expect(code('const x = FieldValue.serverTimestamp()')).toMatch(WRITE_CALL);
    expect(code('db.collection("x")')).toMatch(DB_ACCESS);
  });
});

// ─── Arguments, credentials and exit codes ───────────────────────────────────

describe('arguments and exit codes', () => {
  it('accepts only the documented flags', () => {
    expect(parseArgs(['--details', '--json', '--user-id=abc_123'])).toEqual({ userId: 'abc_123', details: true, json: true, help: false });
    for (const bad of [['--apply'], ['--live'], ['--write'], ['--dry-run'], ['--user-id=a/b'], ['--user-id='], ['extra']]) {
      expect(() => parseArgs(bad)).toThrow();
    }
  });

  it('exits 1 on a bad argument, before touching the database', async () => {
    const { code, err, reads } = await run(['--apply']);
    expect(code).toBe(1);
    expect(err).toContain('unknown argument: --apply');
    expect(reads.queries).toBe(0);
  });

  it('exits 1 without the read-only key, and never echoes key file content', async () => {
    let err = '';
    expect(await main([], { env: {}, warn: s => { err += s; }, write: () => {} })).toBe(1);
    expect(err).toContain('FIREBASE_SERVICE_ACCOUNT_PATH is required');
    err = '';
    expect(await main([], { env: { FIREBASE_SERVICE_ACCOUNT_PATH: resolve(repo, 'package.json') }, warn: s => { err += s; }, write: () => {} })).toBe(1);
    expect(err).toContain('has no project_id');
  });

  it('exits 1 when Firestore fails mid-run', async () => {
    const failing = { collection: () => { throw new Error('UNAVAILABLE'); } };
    let err = '';
    expect(await main([], { db: failing, warn: s => { err += s; }, write: () => {} })).toBe(1);
    expect(err).toContain('did not complete');
  });

  it('months are read from every timestamp shape the data holds', () => {
    expect(monthOf('2026-09-20T10:00:00Z')).toBe('2026-09');
    expect(monthOf({ toDate: () => new Date('2026-10-01T00:00:00Z') })).toBe('2026-10');
    expect(monthOf({ _seconds: Date.parse('2026-08-12T00:00:00Z') / 1000 })).toBe('2026-08');
    expect(monthOf(new Date('2026-07-04T00:00:00Z'))).toBe('2026-07');
    for (const value of [undefined, null, 'soon', {}, 12]) expect(monthOf(value)).toBe('unknown');
  });

  it('buildReport and auditWorkspace are pure: same input, same report', () => {
    const snapshot = { uid: 'w', contacts: [{ id: 'a', data: { source: S, name: 'Jane Smith' }, lineage: ['source'] }], companies: [], workspaceCompanies: [] };
    const first = buildReport({ workspaces: [auditWorkspace(snapshot)], workspacesScanned: 1 }, { generatedAt: 't' });
    const second = buildReport({ workspaces: [auditWorkspace(snapshot)], workspacesScanned: 1 }, { generatedAt: 't' });
    expect(first).toEqual(second);
  });
});
