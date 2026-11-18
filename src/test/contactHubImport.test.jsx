/**
 * W2: a Free account imports its existing contacts from a CSV file in My People.
 *
 * Everything real except Firestore and company resolution: the dialog, the existing importer
 * (ContactCsvImport), the parser, the canonical duplicate guard and the writer
 * (csvImportService). Firestore is an in-memory store that records the path of every write, so
 * "the canonical contact records" is checked by path, not assumed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

const store = vi.hoisted(() => ({ contacts: new Map(), paths: new Set(), autoId: 0, writes: [] }));

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
  const getDocs = async (q) => {
    const wheres = (q.constraints ?? []).filter((c) => c.type === 'where');
    const lim = (q.constraints ?? []).find((c) => c.type === 'limit')?.n ?? Infinity;
    const hits = [...store.contacts.entries()].filter(([, d]) => wheres.every((w) => d[w.field] === w.value)).slice(0, lim);
    return { docs: hits.map(([id, d]) => ({ id, data: () => d })) };
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
        next[k] = [...arr, ...v.__arrayUnion.filter((x) => !arr.includes(x))];
      } else next[k] = v;
    }
    return next;
  };
  const updateDoc = async (ref, data) => {
    store.paths.add(ref.path);
    store.writes.push(['update', ref.path]);
    store.contacts.set(ref.id, applyWrite(store.contacts.get(ref.id) ?? {}, data));
  };
  const writeBatch = () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push([ref, data]),
      commit: async () => ops.forEach(([ref, data]) => {
        store.paths.add(ref.path);
        store.writes.push(['set', ref.path]);
        store.contacts.set(ref.id, data);
      }),
    };
  };
  const arrayUnion = (...v) => ({ __arrayUnion: v });
  return { collection, doc, where, limit, query, getDocs, getDoc, updateDoc, writeBatch, arrayUnion };
});
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null, onAuthStateChanged: () => () => {} } }));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../services/companyIdentityService', () => ({
  ensureCompanyForContact: vi.fn(async (_uid, c) => ({ companyId: c?.name ? `co_${c.name.toLowerCase().replace(/\W+/g, '_')}` : null })),
  resolveCompany: vi.fn(),
  NAME_SOURCE: { USER: 'user' },
}));

import { ThemeProvider } from '../theme/ThemeContext';
import ImportPeopleDialog from '../components/contactImport/ImportPeopleDialog';
import { importSummary, HUB_IMPORT_COPY } from '../components/contactImport/importPeople';
import { listMyPeople } from '../pages/ContactHub/peopleRules';

const FIVE = [
  'First Name,Last Name,Email,Phone,Company,Title',
  'Ana,Lopez,ana@example.test,801-555-0101,Acme,CEO',
  'Ben,Okafor,ben@example.test,801-555-0102,Globex,CTO',
  'Cara,Singh,cara@example.test,,Initech,Designer',
  'Dev,Patel,dev@example.test,801-555-0104,,Engineer',
  'Eve,Martin,eve@example.test,801-555-0105,Umbrella,',
].join('\n');

beforeEach(() => {
  store.contacts.clear();
  store.paths.clear();
  store.writes.length = 0;
  store.autoId = 0;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

async function importCsv(csv, { name = 'people.csv' } = {}) {
  const onImported = vi.fn();
  render(<ThemeProvider><ImportPeopleDialog onClose={() => {}} onImported={onImported} /></ThemeProvider>);
  fireEvent.change(screen.getByTestId('csv-upload'), { target: { files: [new File([csv], name, { type: 'text/csv' })] } });
  await screen.findByText(`Preview: ${name}`);
  return onImported;
}

async function confirmImport(count, onImported) {
  fireEvent.click(screen.getByRole('button', { name: `Import ${count} contact${count === 1 ? '' : 's'}` }));
  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  return onImported.mock.calls[0][0];
}

const records = () => [...store.contacts.entries()].map(([id, d]) => ({ ...d, id }));

describe('a five-row valid CSV', () => {
  it('becomes exactly five correct people in the canonical contacts collection, listed in My People', async () => {
    const onImported = await importCsv(FIVE);
    expect(within(screen.getByTestId('tile-ready')).getByText('5')).toBeInTheDocument();
    const result = await confirmImport(5, onImported);

    expect(result.created).toHaveLength(5);
    expect(result.updated).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(importSummary(result)).toBe('5 people added.');

    // Every write went to users/{uid}/contacts, the collection My People and Scout read.
    expect(store.paths.size).toBe(5);
    for (const path of store.paths) expect(path).toMatch(/^users\/u1\/contacts\/[^/]+$/);

    const byEmail = Object.fromEntries(records().map((c) => [c.email, c]));
    expect(byEmail['ana@example.test']).toMatchObject({ first_name: 'Ana', last_name: 'Lopez', phone: '801-555-0101', company_name: 'Acme', title: 'CEO' });
    expect(byEmail['cara@example.test'].phone ?? null).toBeFalsy();
    expect(byEmail['dev@example.test']).toMatchObject({ first_name: 'Dev', title: 'Engineer' });
    expect(listMyPeople(records())).toHaveLength(5);
  });
});

describe('duplicates and existing people', () => {
  beforeEach(() => {
    store.contacts.set('ana', {
      name: 'Ana Lopez', first_name: 'Ana', last_name: 'Lopez', title: 'Founder', email: 'ana@example.test', email_normalized: 'ana@example.test',
      notes: [{ id: 'n1', text: 'Met at the gala' }], sticker_ids: ['st_friends'], is_archived: false,
    });
  });

  it('a person already in My People is matched, not duplicated, and keeps their title, notes and stickers', async () => {
    const onImported = await importCsv(FIVE);
    expect(screen.getByTestId('tile-ready')).toHaveTextContent('4 new · 1 already in IDYNIFY');
    const result = await confirmImport(5, onImported);

    expect(result.created).toHaveLength(4);
    expect(result.updated.map((c) => c.id)).toEqual(['ana']);
    expect(store.contacts.size).toBe(5);
    const ana = store.contacts.get('ana');
    expect(ana.title).toBe('Founder');
    expect(ana.notes).toEqual([{ id: 'n1', text: 'Met at the gala' }]);
    expect(ana.sticker_ids).toEqual(['st_friends']);
    expect(importSummary(result)).toBe('4 people added, 1 person already in My People.');
  });

  it('a person repeated inside the file is imported once', async () => {
    const onImported = await importCsv(`${FIVE}\nBen,Okafor,BEN@example.test,,Globex,CTO`);
    expect(within(screen.getByTestId('tile-duplicates')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-ready')).getByText('5')).toBeInTheDocument();
    const result = await confirmImport(5, onImported);
    // Ana is already in My People (this block's setup): four are new, one is matched.
    expect(result.created).toHaveLength(4);
    expect(result.updated.map((c) => c.id)).toEqual(['ana']);
    expect(store.contacts.size).toBe(5);
    expect(records().filter((c) => c.email === 'ben@example.test')).toHaveLength(1);
  });
});

describe('errors are reported by row, and counts are exact', () => {
  it('invalid and incomplete rows are listed and not imported; the valid rows are', async () => {
    const csv = `${FIVE}\nBad,Email,not-an-email,,,\n,,,,Initech,`;
    const onImported = await importCsv(csv);
    expect(within(screen.getByTestId('tile-ready')).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-invalid')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-missing')).getByText('1')).toBeInTheDocument();
    const attention = screen.getByTestId('csv-attention');
    expect(attention).toHaveTextContent('Row 7: Invalid email address: not-an-email');
    expect(attention).toHaveTextContent('Row 8: Needs a name or an email address');

    const result = await confirmImport(5, onImported);
    expect(result.created).toHaveLength(5);
    expect(store.contacts.size).toBe(5);
  });
});

describe("Contact Hub's words", () => {
  it('speaks of My People and cards, never of Scout pages or cadences', async () => {
    // An email-only row brings up the "incomplete" wording too.
    await importCsv(`${FIVE}\n,,mia@example.test,,,`);
    expect(screen.getByText(HUB_IMPORT_COPY.incompleteNote)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Import People' })).toBeInTheDocument();
    expect(screen.getByText(HUB_IMPORT_COPY.title)).toBeInTheDocument();
    expect(screen.queryByText(/Change Type/)).toBeNull();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toMatch(/cadence/i);
    expect(dialog.textContent).not.toMatch(/\bin People\b/);
  });

  it('importSummary counts people, singular and plural', () => {
    expect(importSummary({ created: [1], updated: [] })).toBe('1 person added.');
    expect(importSummary({ created: [], updated: [1, 2] })).toBe('2 people already in My People.');
    expect(importSummary({ created: [], updated: [] })).toBe('');
  });
});
