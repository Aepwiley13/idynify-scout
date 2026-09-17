/**
 * Enrichment may not manufacture the duplicates the resolver prevents.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * Enrichment is the one moment a company's identity signals CHANGE. A company
 * born from a typed name has no Apollo id and often no domain; an Apollo
 * Organizations lookup can hand it both at once. That makes it the one moment a
 * record can collide with a document that was already in the workspace under an
 * identity nobody had discovered yet.
 *
 * Before this, all three company surfaces wrote enrichment back with a bare
 * `updateDoc({ apollo_id: ... })`. Two distinct failure modes followed, and
 * both are pinned here:
 *
 *   1. THE ALIAS SPLIT. Apollo's organization id has lived under two field
 *      names in this codebase. Writing only `apollo_organization_id` (or only
 *      `apollo_id`) leaves the other unset, and every reader still on the other
 *      name stops seeing the company — the exact split `apolloIdFields` was
 *      introduced to close, re-opened from the enrichment side.
 *
 *   2. THE NAME REVERT. A name from Apollo or typed by the user is
 *      authoritative. Only a name this module GUESSED from a domain label may
 *      be corrected. Without the rule, enrichment renames a company the user
 *      deliberately renamed — and does it again on every cache expiry.
 *
 * Plus the end-to-end question the lazy path depends on: does a bare-name
 * company created by `ensureCompanyForContact` actually carry enough signal for
 * `enrichCompany` to be callable at all?
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

let COMPANIES = [];
let WRITES = [];

vi.mock('../firebase/config', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...path) => ({ __collection: path.join('/') }),
  doc: (_db, ...path) => ({ __doc: path.join('/'), id: path[path.length - 1] }),
  query: (ref, ...clauses) => ({ ref, clauses }),
  where: (field, op, value) => ({ __where: true, field, op, value }),
  limit: (n) => ({ __limit: n }),
  getDoc: async (ref) => {
    const row = COMPANIES.find(r => r.id === ref.id);
    return { exists: () => Boolean(row), id: ref.id, data: () => row };
  },
  getDocs: async (q) => {
    const clause = q.clauses.find(c => c.__where);
    const rows = clause ? COMPANIES.filter(r => r[clause.field] === clause.value) : COMPANIES;
    return { empty: rows.length === 0, docs: rows.map(r => ({ id: r.id, data: () => r })) };
  },
  setDoc: async (ref, data) => {
    WRITES.push({ op: 'set', id: ref.id, data });
    COMPANIES.push({ id: ref.id, ...data });
  },
  updateDoc: async (ref, patch) => {
    WRITES.push({ op: 'update', id: ref.id, data: patch });
    const row = COMPANIES.find(r => r.id === ref.id);
    if (row) Object.assign(row, patch);
  },
}));

import {
  applyCompanyEnrichment,
  ensureCompanyForContact,
  enrichmentSignals,
  canEnrich,
  NAME_SOURCE,
} from '../services/companyIdentityService';

const UID = 'user-1';
const lastUpdate = () => [...WRITES].reverse().find(w => w.op === 'update')?.data ?? null;

beforeEach(() => {
  COMPANIES = [];
  WRITES = [];
});

// ─── FAILURE MODE 1: the alias split ────────────────────────────────────────
describe('enrichment writing a discovered Apollo org id', () => {
  it('writes BOTH id field names, never just one', async () => {
    COMPANIES = [{ id: 'company_1700000000000', name: 'Rd Advantage', status: 'accepted', name_source: 'email_domain' }];

    await applyCompanyEnrichment(UID, 'company_1700000000000', { apollo_organization_id: 'apollo-xyz' });

    const patch = lastUpdate();
    // Both, from apolloIdFields — a reader on either convention still finds it.
    expect(patch.apollo_organization_id).toBe('apollo-xyz');
    expect(patch.apollo_id).toBe('apollo-xyz');
  });

  it('leaves a timestamp-keyed document findable by its new Apollo id', async () => {
    // The vector this guards: a bare company gets a `company_<ts>` doc id, so
    // the id it later learns lives only in a FIELD. If enrichment writes one
    // field name, a lookup on the other reports "no such company" and the next
    // save creates a second document for the same organization.
    COMPANIES = [{ id: 'company_1700000000000', name: 'Esslyo', status: 'accepted', name_source: 'email_domain' }];

    await applyCompanyEnrichment(UID, 'company_1700000000000', { apollo_organization_id: 'apollo-xyz' });

    const row = COMPANIES.find(r => r.id === 'company_1700000000000');
    for (const field of ['apollo_organization_id', 'apollo_id']) {
      const found = COMPANIES.filter(r => r[field] === 'apollo-xyz');
      expect(found, `lookup on ${field} found nothing`).toHaveLength(1);
      expect(found[0].id).toBe(row.id);
    }
  });

  it('never writes a null id over a good one', async () => {
    COMPANIES = [{ id: 'c1', name: 'Domo', status: 'accepted', apollo_organization_id: 'real', apollo_id: 'real' }];

    await applyCompanyEnrichment(UID, 'c1', { apollo_organization_id: null });

    const row = COMPANIES.find(r => r.id === 'c1');
    expect(row.apollo_organization_id).toBe('real');
    expect(row.apollo_id).toBe('real');
  });
});

// ─── FAILURE MODE 2: the name revert ────────────────────────────────────────
describe('enrichment and the company name', () => {
  it('corrects a name it guessed from a domain', async () => {
    // companyNameFromDomain turns rd-advantage.com into "Rd Advantage"; the
    // organization writes itself "R&D Advantage". That correction is the whole
    // point of marking the name as derived.
    COMPANIES = [{ id: 'c1', name: 'Rd Advantage', status: 'accepted', name_source: NAME_SOURCE.EMAIL_DOMAIN }];

    await applyCompanyEnrichment(UID, 'c1', { name: 'R&D Advantage' });

    const row = COMPANIES.find(r => r.id === 'c1');
    expect(row.name).toBe('R&D Advantage');
    expect(row.name_source).toBe(NAME_SOURCE.APOLLO);
    expect(row.name_was).toBe('Rd Advantage');   // the guess is kept, for audit
  });

  it('refuses to overwrite a name the user typed', async () => {
    COMPANIES = [{ id: 'c1', name: 'Acme (Northeast)', status: 'accepted', name_source: NAME_SOURCE.USER }];

    await applyCompanyEnrichment(UID, 'c1', { name: 'Acme Corporation' });

    expect(COMPANIES.find(r => r.id === 'c1').name).toBe('Acme (Northeast)');
  });

  it('refuses to overwrite a name Apollo already reported', async () => {
    COMPANIES = [{ id: 'c1', name: 'Domo', status: 'accepted', name_source: NAME_SOURCE.APOLLO }];

    await applyCompanyEnrichment(UID, 'c1', { name: 'Domo, Inc.' });

    expect(COMPANIES.find(r => r.id === 'c1').name).toBe('Domo');
  });

  it('treats an unset name_source as authoritative, not as a guess', async () => {
    // Every company written before this field existed has no name_source. The
    // safe reading of "unknown provenance" is "do not touch" — the alternative
    // renames the entire historical workspace on first view.
    COMPANIES = [{ id: 'c1', name: 'Historical Co', status: 'accepted' }];

    await applyCompanyEnrichment(UID, 'c1', { name: 'Historical Company LLC' });

    expect(COMPANIES.find(r => r.id === 'c1').name).toBe('Historical Co');
  });
});

// ─── The collision check ────────────────────────────────────────────────────
describe('enrichment discovering an identity that already exists', () => {
  it('refuses to write when the discovered Apollo id belongs to another document', async () => {
    COMPANIES = [
      { id: 'company_1700000000000', name: 'Esslyo', status: 'accepted', name_source: 'email_domain' },
      { id: 'apollo-xyz', name: 'Esslyo Inc', status: 'accepted', apollo_organization_id: 'apollo-xyz', apollo_id: 'apollo-xyz' },
    ];

    const result = await applyCompanyEnrichment(UID, 'company_1700000000000', {
      apollo_organization_id: 'apollo-xyz', name: 'Esslyo Inc',
    });

    expect(result.action).toBe('merged');
    expect(result.into).toBe('apollo-xyz');
    expect(WRITES.filter(w => w.op === 'update')).toHaveLength(0);
  });

  it('refuses to write when the discovered domain belongs to another document', async () => {
    COMPANIES = [
      { id: 'c_bare', name: 'Strike Visual', status: 'accepted', name_source: 'user' },
      { id: 'c_real', name: 'Strike Visual Inc', status: 'accepted', domain: 'strikenow.com' },
    ];

    const result = await applyCompanyEnrichment(UID, 'c_bare', { domain: 'https://www.strikenow.com/' });

    expect(result.action).toBe('merged');
    expect(result.into).toBe('c_real');
    expect(WRITES.filter(w => w.op === 'update')).toHaveLength(0);
  });

  it('writes normally when the discovered signals are new to the workspace', async () => {
    COMPANIES = [{ id: 'c1', name: 'Esslyo', status: 'accepted', name_source: 'email_domain' }];

    const result = await applyCompanyEnrichment(UID, 'c1', {
      apollo_organization_id: 'brand-new', domain: 'esslyo.com',
    });

    expect(result.action).toBe('updated');
    expect(COMPANIES.find(r => r.id === 'c1').apollo_id).toBe('brand-new');
  });

  it('does not treat the company\'s own existing signals as a collision', async () => {
    // Re-enriching a company that already has its id must not read itself as a
    // duplicate of itself and refuse forever.
    COMPANIES = [{
      id: 'apollo-xyz', name: 'Domo', status: 'accepted',
      apollo_organization_id: 'apollo-xyz', apollo_id: 'apollo-xyz', domain: 'domo.com',
    }];

    const result = await applyCompanyEnrichment(UID, 'apollo-xyz', {
      apollo_organization_id: 'apollo-xyz', domain: 'domo.com', industry: 'Software',
    });

    expect(result.action).toBe('updated');
    expect(COMPANIES.find(r => r.id === 'apollo-xyz').industry).toBe('Software');
  });

  it('fills only holes in the descriptive fields', async () => {
    COMPANIES = [{ id: 'c1', name: 'Domo', status: 'accepted', industry: 'Analytics', name_source: 'apollo' }];

    await applyCompanyEnrichment(UID, 'c1', { industry: 'Software', linkedin_url: 'https://linkedin.com/company/domo' });

    const row = COMPANIES.find(r => r.id === 'c1');
    expect(row.industry).toBe('Analytics');                                  // kept
    expect(row.linkedin_url).toBe('https://linkedin.com/company/domo');      // filled
  });

  it('is a no-op on a company that does not exist', async () => {
    const result = await applyCompanyEnrichment(UID, 'ghost', { name: 'Anything' });
    expect(result.action).toBe('noop');
    expect(WRITES).toHaveLength(0);
  });
});

// ─── End-to-end: can the lazy path actually fire? ───────────────────────────
describe('a bare-name company reaches the existing lazy enrichment', () => {
  it('created from a work email alone, it carries the domain enrichCompany needs', async () => {
    const { companyId, created } = await ensureCompanyForContact(
      UID, { email: 'todd@esslyo.com' }, { source: 'LinkedIn Link' },
    );
    expect(created).toBe(true);

    const row = COMPANIES.find(r => r.id === companyId);
    expect(row.domain).toBe('esslyo.com');
    expect(row.name_source).toBe(NAME_SOURCE.EMAIL_DOMAIN);
    expect(row.apolloEnriched).toBe(false);
    expect(row.apolloEnrichment).toBeUndefined();   // so the view-side trigger fires

    // The precondition enrichCompany enforces server-side.
    expect(canEnrich(row)).toBe(true);
    expect(enrichmentSignals(row).domain).toBe('esslyo.com');
  });

  it('created from a typed name with no domain, it is correctly NOT called', async () => {
    const { companyId } = await ensureCompanyForContact(
      UID, { name: 'Strike Visual' }, { source: 'manual', nameSource: NAME_SOURCE.USER },
    );
    const row = COMPANIES.find(r => r.id === companyId);

    expect(row.name_source).toBe(NAME_SOURCE.USER);
    // enrichCompany rejects a request with neither signal, so the surfaces skip
    // it rather than fire a guaranteed-failing round trip on every open.
    expect(canEnrich(row)).toBe(false);
  });

  it('keeps the company LinkedIn URL the import used to discard', async () => {
    const { companyId } = await ensureCompanyForContact(UID, {
      apollo_organization_id: 'org-1',
      name: 'Domo',
      email: 'macy@domo.com',
      linkedin_url: 'https://www.linkedin.com/company/domo',
    }, { source: 'LinkedIn Link' });

    expect(COMPANIES.find(r => r.id === companyId).linkedin_url)
      .toBe('https://www.linkedin.com/company/domo');
  });

  it('reads the Apollo org id off either field name', () => {
    expect(enrichmentSignals({ apollo_organization_id: 'a' }).organizationId).toBe('a');
    expect(enrichmentSignals({ apollo_id: 'b' }).organizationId).toBe('b');
    expect(canEnrich({ apollo_id: 'b' })).toBe(true);
    expect(canEnrich({ website_url: 'https://acme.com/x' })).toBe(true);
    expect(canEnrich({ name: 'Nothing Else' })).toBe(false);
  });
});

// ─── One creation path, not four ────────────────────────────────────────────
describe('every contact-driven entry point routes through the shared helper', () => {
  // FindContact, ContactSearch and BusinessCardCapture each carried their own
  // `ensureCompanyExists`. FindContact's and ContactSearch's were verbatim
  // copies of LinkedInLinkSearch's, bailout bug and copied comment included —
  // so the fix that landed in LinkedInLinkSearch silently missed them, and a
  // contact added through either still arrived with no company. Structure, not
  // discipline, is what keeps a fifth copy from appearing.
  const ENTRY_POINTS = [
    'src/components/scout/LinkedInLinkSearch.jsx',
    'src/components/scout/ManualContactForm.jsx',
    'src/components/scout/FindContact.jsx',
    'src/pages/Scout/ContactSearch.jsx',
    'src/components/scout/BusinessCardCapture.jsx',
  ];

  it.each(ENTRY_POINTS)('%s calls ensureCompanyForContact', (file) => {
    expect(readFileSync(file, 'utf8')).toContain('ensureCompanyForContact');
  });

  it.each(ENTRY_POINTS)('%s builds no company document of its own', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src, 'hand-built company record').not.toContain('createCompanyRecord');
  });

  /** Strip comments — these files DESCRIBE the old bug in prose, deliberately. */
  const code = (file) => readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it.each(ENTRY_POINTS)('%s no longer carries the bailout bug', (file) => {
    // The literal shape that dropped a contact whose work-email domain
    // identified their company perfectly well.
    expect(code(file)).not.toMatch(/if\s*\(\s*!companyName\s*\)[\s\S]{0,80}?return null/);
  });

  it('no company surface writes an Apollo id by hand any more', () => {
    for (const file of [
      'src/pages/Scout/CompanyDetail.jsx',
      'src/components/scout/CompanyDetailModal.jsx',
      'src/pages/Scout/CompanyProfileView.jsx',
    ]) {
      // `apollo_id:` in an updateDoc payload is the alias split re-opening.
      expect(code(file), `${file} writes apollo_id directly`).not.toMatch(/apollo_id:\s*result\.data/);
      expect(readFileSync(file, 'utf8'), `${file} does not use the guard`).toContain('applyCompanyEnrichment');
    }
  });
});
