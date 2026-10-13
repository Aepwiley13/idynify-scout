/**
 * CSV contact import — the Firestore half (src/services/csvImportService.js).
 *
 * The REAL identity engine runs here (contactWriteGuard → contactIdentityService
 * → identityResolution) against a small in-memory Firestore, so these tests
 * prove the import uses the canonical dedupe hierarchy rather than a copy of
 * it. Only the company resolver is stubbed — it has its own suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory Firestore ─────────────────────────────────────────────────────
const store = vi.hoisted(() => ({
  contacts: new Map(),   // id → data
  updates: [],           // { id, data }
  batchCommits: 0,
  failNextCommit: false,
  scanReads: 0,
  autoId: 0,
}));

vi.mock('firebase/firestore', () => {
  const collection = (_db, ...path) => ({ kind: 'collection', path: path.join('/') });
  const doc = (first, ...rest) => {
    if (first?.kind === 'collection' && rest.length === 0) {
      store.autoId += 1;
      return { kind: 'doc', id: `new_${store.autoId}`, path: `${first.path}/new_${store.autoId}` };
    }
    return { kind: 'doc', id: rest[rest.length - 1], path: rest.join('/') };
  };
  const where = (field, op, value) => ({ type: 'where', field, op, value });
  const limit = (n) => ({ type: 'limit', n });
  const query = (ref, ...constraints) => ({ kind: 'query', ref, constraints });
  const snapOf = (entries) => ({ docs: entries.map(([id, d]) => ({ id, data: () => d })) });
  const getDocs = async (q) => {
    const constraints = q.constraints ?? [];
    const wheres = constraints.filter(c => c.type === 'where');
    if (wheres.length === 0) store.scanReads += 1;
    const lim = constraints.find(c => c.type === 'limit')?.n ?? Infinity;
    const hits = [...store.contacts.entries()]
      .filter(([, d]) => wheres.every(w => d[w.field] === w.value))
      .slice(0, lim);
    return snapOf(hits);
  };
  const getDoc = async (ref) => {
    const d = store.contacts.get(ref.id);
    return { id: ref.id, exists: () => Boolean(d), data: () => d };
  };
  const applyWrite = (current, data) => {
    const next = { ...current };
    for (const [k, v] of Object.entries(data)) {
      if (v && v.__arrayUnion) {
        const arr = Array.isArray(next[k]) ? next[k] : [];
        next[k] = [...arr, ...v.__arrayUnion.filter(x => !arr.includes(x))];
      } else next[k] = v;
    }
    return next;
  };
  const updateDoc = async (ref, data) => {
    store.updates.push({ id: ref.id, data });
    store.contacts.set(ref.id, applyWrite(store.contacts.get(ref.id) ?? {}, data));
  };
  const writeBatch = () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push([ref, data]),
      commit: async () => {
        if (store.failNextCommit) { store.failNextCommit = false; throw new Error('commit failed'); }
        store.batchCommits += 1;
        ops.forEach(([ref, data]) => store.contacts.set(ref.id, data));
      },
    };
  };
  const arrayUnion = (...v) => ({ __arrayUnion: v });
  return { collection, doc, where, limit, query, getDocs, getDoc, updateDoc, writeBatch, arrayUnion };
});

vi.mock('../firebase/config', () => ({ db: {} }));

const mockEnsureCompany = vi.hoisted(() => vi.fn());
vi.mock('../services/companyIdentityService', () => ({
  ensureCompanyForContact: mockEnsureCompany,
  NAME_SOURCE: { USER: 'user' },
}));

import { previewCsvImport, commitCsvImport, summarizePreview, PREVIEW_OUTCOME, CREATE_BATCH_SIZE } from '../services/csvImportService';
import { parseContactCsv, classifyRows } from '../utils/csvContactImport';
import { buildUserAddedContact } from '../schemas/userAddedContact';

const UID = 'user-1';
const NOW = new Date(2026, 9, 2, 12, 0, 0);

function rowsFrom(csv) {
  const p = parseContactCsv(csv);
  return classifyRows(p.rows, p.mappedHeaders);
}

async function previewAndCommit(csv, opts = {}) {
  const preview = await previewCsvImport(UID, rowsFrom(csv));
  const result = await commitCsvImport(UID, preview, { importName: 'Beyond Words', fileName: 'bw.csv', now: NOW, ...opts });
  return { preview, result };
}

beforeEach(() => {
  store.contacts.clear();
  store.updates.length = 0;
  store.batchCommits = 0;
  store.failNextCommit = false;
  store.scanReads = 0;
  store.autoId = 0;
  mockEnsureCompany.mockReset();
  mockEnsureCompany.mockImplementation(async (_uid, c) => ({
    companyId: c.name ? `co_${c.name.toLowerCase().replace(/\W+/g, '_')}` : null,
  }));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('previewCsvImport — the canonical duplicate guard, before anything is written', () => {
  it('classifies new, existing (by normalized email), and name+company review rows', async () => {
    store.contacts.set('existing_1', {
      name: 'Aaron Wiley', email: 'Aaron@Acme.com', email_normalized: 'aaron@acme.com', is_archived: false,
    });
    store.contacts.set('existing_2', { name: 'John Smith', company_name: 'Globex', is_archived: false });

    const preview = await previewCsvImport(UID, rowsFrom(
      'Name,Email,Company\n'
      + 'Aaron Wiley,AARON@acme.com,Acme\n'
      + 'New Person,new@x.com,Initech\n'
      + 'John Smith,,Globex\n',
    ));
    expect(preview.map(r => r.outcome)).toEqual([
      PREVIEW_OUTCOME.EXISTING, PREVIEW_OUTCOME.NEW, PREVIEW_OUTCOME.REVIEW,
    ]);
    expect(preview[0].decision.contactId).toBe('existing_1');
    expect(store.updates).toHaveLength(0); // preview never writes
  });

  it('marks an identity conflict on its row instead of failing the import', async () => {
    store.contacts.set('dup_a', { name: 'A', email_normalized: 'shared@x.com', is_archived: false });
    store.contacts.set('dup_b', { name: 'B', email_normalized: 'shared@x.com', is_archived: false });

    const preview = await previewCsvImport(UID, rowsFrom('Name,Email\nA,shared@x.com\nOK,ok@x.com\n'));
    expect(preview[0].outcome).toBe(PREVIEW_OUTCOME.CONFLICT);
    expect(preview[0].reason).toMatch(/share this email/);
    expect(preview[1].outcome).toBe(PREVIEW_OUTCOME.NEW);
  });

  it('counts one existing person once when two rows resolve to them by different identifiers', async () => {
    store.contacts.set('p1', {
      name: 'Pat', email_normalized: 'pat@x.com', phone_normalized: '8015551234', is_archived: false,
    });
    const preview = await previewCsvImport(UID, rowsFrom('Name,Email,Phone\nPat,pat@x.com,\nPat W,,801-555-1234\n'));
    expect(preview.map(r => r.outcome)).toEqual([PREVIEW_OUTCOME.EXISTING, PREVIEW_OUTCOME.DUPLICATE]);
    expect(preview[1].reason).toMatch(/row 2/);
  });

  it('loads the fallback scan window once per import, not once per row', async () => {
    await previewCsvImport(UID, rowsFrom('Name,Email\nA,a@x.com\nB,b@x.com\nC,c@x.com\nD,d@x.com\n'));
    expect(store.scanReads).toBe(1);
  });

  it('passes non-ready rows through untouched', async () => {
    const preview = await previewCsvImport(UID, rowsFrom('Name,Email\nA,bad\n'));
    expect(preview[0].outcome).toBeUndefined();
    expect(summarizePreview(preview)[PREVIEW_OUTCOME.NEW]).toBe(0);
  });
});

describe('commitCsvImport — new contacts', () => {
  it('writes every supported field, the CSV source metadata and the group tag', async () => {
    const { result } = await previewAndCommit(
      'First Name,Last Name,Email,Phone,Title,Company,Industry,State,LinkedIn,Notes\n'
      + 'Aaron,Wiley,aaron@acme.com,801-555-0000,CEO,"Acme, Inc.",SaaS,UT,https://linkedin.com/in/aw,Met at expo\n',
    );
    expect(result.created).toHaveLength(1);
    const c = store.contacts.get(result.created[0].id);
    expect(c).toMatchObject({
      name: 'Aaron Wiley',
      first_name: 'Aaron',
      last_name: 'Wiley',
      email: 'aaron@acme.com',
      email_normalized: 'aaron@acme.com',
      phone: '801-555-0000',
      title: 'CEO',
      company: 'Acme, Inc.',
      company_name: 'Acme, Inc.',
      company_id: 'co_acme_inc_',
      industry: 'SaaS',
      state: 'UT',
      location: 'UT',
      linkedin_url: 'https://linkedin.com/in/aw',
      // People can tell a CSV import from manual entry.
      source: 'csv_import',
      addedFrom: 'csv',
      import_method: 'csv',
      import_batch_id: result.batchId,
      import_name: 'Beyond Words',
      tags: ['CSV Import - Beyond Words - 2026-10-02'],
      person_type: 'lead',
      is_archived: false,
      record_status: 'active',
    });
    expect(c.notes).toEqual([expect.objectContaining({ content: 'Met at expo' })]);
    expect(result.tag).toBe('CSV Import - Beyond Words - 2026-10-02');
  });

  it('writes the same document shape as Add Manually, plus CSV-only fields', async () => {
    const { result } = await previewAndCommit('Name,Email\nA,a@x.com\n');
    const csv = store.contacts.get(result.created[0].id);
    const manualKeys = Object.keys(buildUserAddedContact({ source: 'manual', addedFrom: 'manual' }));
    for (const k of manualKeys) expect(csv).toHaveProperty(k);
  });

  it('resolves each distinct company once', async () => {
    await previewAndCommit('Name,Email,Company\nA,a@x.com,Acme\nB,b@x.com,acme\nC,c@x.com,Globex\n');
    expect(mockEnsureCompany).toHaveBeenCalledTimes(2);
  });

  it('still imports a contact when company resolution fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockEnsureCompany.mockRejectedValue(new Error('boom'));
    const { result } = await previewAndCommit('Name,Email,Company\nA,a@x.com,Acme\n');
    expect(result.created).toHaveLength(1);
    expect(store.contacts.get(result.created[0].id).company_id).toBeNull();
  });

  it('commits in chunks and reports a failed chunk per row without losing the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const n = CREATE_BATCH_SIZE + 3;
    const csv = 'Name,Email\n' + Array.from({ length: n }, (_, i) => `P${i},p${i}@x.com`).join('\n');
    store.failNextCommit = true;
    const { result } = await previewAndCommit(csv);
    expect(result.failed).toHaveLength(CREATE_BATCH_SIZE);
    expect(result.created).toHaveLength(3);
    expect(result.failed[0]).toEqual({ rowNumber: 2, reason: 'Could not save this contact' });
  });
});

describe('commitCsvImport — people already in IDYNIFY', () => {
  beforeEach(() => {
    store.contacts.set('aaron', {
      name: 'Aaron Wiley (curated)', title: 'Founder', email: 'aaron@acme.com', email_normalized: 'aaron@acme.com',
      tags: ['VIP'], is_archived: false,
    });
  });

  it('includes matched contacts in the result and in the group, without creating a duplicate', async () => {
    const { result } = await previewAndCommit('Name,Email,Title\nAaron W,aaron@acme.com,Intern\nNew,new@x.com,\n');
    expect(result.updated.map(c => c.id)).toEqual(['aaron']);
    expect(result.created).toHaveLength(1);
    expect(store.contacts.size).toBe(2);
    expect(store.contacts.get('aaron').tags).toEqual(['VIP', result.tag]);
    expect(result.updated[0].tags).toEqual(['VIP', result.tag]);
  });

  it('never overwrites what the record already says', async () => {
    await previewAndCommit('Name,Email,Title,Phone\nA. Wiley,aaron@acme.com,Intern,801-555-9999\n');
    const aaron = store.contacts.get('aaron');
    expect(aaron.name).toBe('Aaron Wiley (curated)');
    expect(aaron.title).toBe('Founder');
    // New identifiers are pure gain and are attached.
    expect(aaron.phone).toBe('801-555-9999');
    expect(aaron.identity_sources).toContain('csv_import');
  });

  it('fills a missing company link the way Add Manually would', async () => {
    await previewAndCommit('Name,Email,Company\nAaron,aaron@acme.com,Acme\n');
    expect(store.contacts.get('aaron').company_id).toBe('co_acme');
  });

  it('does not add the same CSV note twice on re-import', async () => {
    await previewAndCommit('Name,Email,Notes\nAaron,aaron@acme.com,VIP guest\n');
    await previewAndCommit('Name,Email,Notes\nAaron,aaron@acme.com,VIP guest\n');
    expect(store.contacts.get('aaron').notes).toHaveLength(1);
  });

  it('does not write conflict rows, and the rest of the file still imports', async () => {
    store.contacts.set('x1', { name: 'X', email_normalized: 'x@x.com', is_archived: false });
    store.contacts.set('x2', { name: 'X2', email_normalized: 'x@x.com', is_archived: false });
    const { result } = await previewAndCommit('Name,Email\nX,x@x.com\nAaron,aaron@acme.com\nNew,n@x.com\n');
    expect(result.updated.map(c => c.id)).toEqual(['aaron']);
    expect(result.created).toHaveLength(1);
    expect(store.updates.some(u => u.id === 'x1' || u.id === 'x2')).toBe(false);
  });
});

describe('email conflicts — matched by phone or LinkedIn, CSV email differs', () => {
  const STORED = {
    name: 'Aaron Wiley', email: 'old@acme.com', email_normalized: 'old@acme.com',
    phone: '801-555-1234', phone_normalized: '8015551234',
    linkedin_url: 'https://www.linkedin.com/in/aaronwiley', linkedin_url_normalized: 'linkedin.com/in/aaronwiley',
    tags: [], is_archived: false,
  };
  beforeEach(() => { store.contacts.set('aaron', { ...STORED }); });

  it('flags a phone match whose CSV email differs, naming both addresses', async () => {
    const [row] = await previewCsvImport(UID, rowsFrom('Name,Email,Phone\nAaron Wiley,new@acme.com,(801) 555-1234\n'));
    expect(row.outcome).toBe(PREVIEW_OUTCOME.EMAIL_CONFLICT);
    expect(row.emailConflict).toEqual({
      signal: 'phone', signalLabel: 'phone', csvEmail: 'new@acme.com', storedEmail: 'old@acme.com',
    });
    expect(row.reason).toMatch(/matched by phone.*new@acme\.com.*old@acme\.com/);
  });

  it('flags a LinkedIn match whose CSV email differs', async () => {
    const [row] = await previewCsvImport(UID, rowsFrom('Name,Email,LinkedIn\nAaron Wiley,new@acme.com,linkedin.com/in/aaronwiley/\n'));
    expect(row.outcome).toBe(PREVIEW_OUTCOME.EMAIL_CONFLICT);
    expect(row.emailConflict.signalLabel).toBe('LinkedIn URL');
  });

  it('is not a conflict when the emails agree, or when the CSV row has no email', async () => {
    const [sameEmail] = await previewCsvImport(UID, rowsFrom('Name,Email,Phone\nAaron Wiley,OLD@acme.com,801-555-1234\n'));
    expect(sameEmail.outcome).toBe(PREVIEW_OUTCOME.EXISTING); // matched by email
    const [noEmail] = await previewCsvImport(UID, rowsFrom('Name,Phone\nAaron W,801-555-1234\n'));
    expect(noEmail.outcome).toBe(PREVIEW_OUTCOME.EXISTING);   // matched by phone, nothing to disagree with
  });

  it('imports the person into the group without touching the stored email, and marks them', async () => {
    const { result } = await previewAndCommit('Name,Email,Phone,Title\nA. Wiley,new@acme.com,801-555-1234,CEO\n');
    const aaron = store.contacts.get('aaron');
    expect(aaron.email).toBe('old@acme.com');
    expect(aaron.email_normalized).toBe('old@acme.com');
    expect(aaron.tags).toEqual([result.tag]);
    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      id: 'aaron', email: 'old@acme.com',
      _emailConflict: { csvEmail: 'new@acme.com', storedEmail: 'old@acme.com', signal: 'phone' },
    });
  });
});

describe('archived matches', () => {
  it('marks an existing contact hidden from People as archived in the result — without reactivating it', async () => {
    store.contacts.set('arch', {
      name: 'Arch', email: 'arch@x.com', email_normalized: 'arch@x.com', is_archived: true, record_status: 'archived',
    });
    store.contacts.set('coarch', {
      name: 'Coco', email: 'coco@x.com', email_normalized: 'coco@x.com', is_archived: false, company_archived: true,
    });
    const { result } = await previewAndCommit('Name,Email\nArch,arch@x.com\nCoco,coco@x.com\nNew,new@x.com\n');
    const byId = Object.fromEntries(result.updated.map(c => [c.id, c]));
    expect(byId.arch._archived).toBe(true);
    expect(byId.coarch._archived).toBe(true);
    expect(store.contacts.get('arch').is_archived).toBe(true);
    expect(store.contacts.get('arch').record_status).toBe('archived');
    expect(store.contacts.get('coarch').company_archived).toBe(true);
    expect(result.created[0]._archived).toBeUndefined();
  });
});

