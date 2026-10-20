/**
 * Scan Business Card: match and save (src/components/capture/captureSave.js).
 *
 * The REAL shared paths run here, against a small in-memory Firestore: the
 * write guard and identity engine for the person, the company resolver for the
 * company, the user-added contact builder for the document. These tests pin:
 *   - what a new person's document holds, typed phones and legacy fields in step;
 *   - that retries, a second tap and two taps at once never make a second person;
 *   - an existing match is updated additively and never overwritten;
 *   - the merged phone rules: only a mobile, direct or home number matches a
 *     person, so two coworkers sharing a main line stay two people;
 *   - a possible (name + company) match needs the user's answer, and a
 *     conflict is never saved;
 *   - save looks again and writes nothing when the match moved;
 *   - companies are matched, linked, or created only from a printed name,
 *     and no company phone is ever written;
 *   - nothing touches capture_operations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory Firestore (paths → documents) ─────────────────────────────────
const store = vi.hoisted(() => ({ docs: new Map(), versions: new Map(), writes: [], autoId: 0 }));

vi.mock('firebase/firestore', async (importOriginal) => {
  const real = await importOriginal();
  const parentOf = path => path.split('/').slice(0, -1).join('/');
  const collection = (_db, ...segments) => ({ kind: 'collection', path: segments.join('/') });
  const doc = (first, ...rest) => {
    if (first?.kind === 'collection') {
      if (rest.length === 0) { store.autoId += 1; rest = [`auto_${store.autoId}`]; }
      const path = `${first.path}/${rest.join('/')}`;
      return { kind: 'doc', path, id: path.split('/').pop() };
    }
    const path = rest.join('/');
    return { kind: 'doc', path, id: rest[rest.length - 1] };
  };
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
  const write = (kind, ref, data) => {
    store.writes.push({ kind, path: ref.path, data: structuredClone(data) });
    store.versions.set(ref.path, (store.versions.get(ref.path) ?? 0) + 1);
  };
  const setDoc = async (ref, data, options = {}) => {
    write('set', ref, data);
    store.docs.set(ref.path, options.merge ? { ...(store.docs.get(ref.path) ?? {}), ...data } : { ...data });
  };
  const updateDoc = async (ref, data) => {
    if (!store.docs.has(ref.path)) throw new Error(`No document to update: ${ref.path}`);
    write('update', ref, data);
    store.docs.set(ref.path, { ...store.docs.get(ref.path), ...data });
  };
  // Optimistic, as Firestore's is: if a document the transaction read was
  // written before it commits, the transaction runs again.
  const runTransaction = async (_db, fn) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pending = [];
      const reads = new Map();
      const tx = {
        get: async (ref) => { reads.set(ref.path, store.versions.get(ref.path) ?? 0); return snapshot(ref.path); },
        set: (ref, data) => { pending.push(() => { write('tx.set', ref, data); store.docs.set(ref.path, { ...data }); }); return tx; },
      };
      const result = await fn(tx);
      if ([...reads].some(([path, version]) => (store.versions.get(path) ?? 0) !== version)) continue;
      pending.forEach(apply => apply());
      return result;
    }
    throw new Error('transaction contention');
  };
  return { ...real, collection, doc, where, limit, query, getDoc, getDocs, setDoc, updateDoc, runTransaction };
});
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));

import { previewCapturePerson, saveCapturePerson, captureContactId, CAPTURE_SOURCE } from '../components/capture/captureSave.js';
import { makePhone } from '../utils/contactPhones';

const UID = 'u1';
const OP = 'cap_3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const OP2 = 'cap_9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const contactPath = id => `users/${UID}/contacts/${id}`;
const companyPath = id => `users/${UID}/companies/${id}`;
const contacts = () => [...store.docs.entries()].filter(([p]) => p.startsWith(`users/${UID}/contacts/`)).map(([p, d]) => ({ id: p.split('/').pop(), ...d }));
const companies = () => [...store.docs.entries()].filter(([p]) => p.startsWith(`users/${UID}/companies/`)).map(([p, d]) => ({ id: p.split('/').pop(), ...d }));
const putContact = (id, data) => store.docs.set(contactPath(id), data);
const putCompany = (id, data) => store.docs.set(companyPath(id), data);

const phone = (n, value, label, observedLabel = null) => makePhone({ id: `card-${n}`, value, label, labelSource: 'card', observedLabel });

/** A reviewed draft, as the review screen holds it. */
const draft = (over = {}) => ({
  key: 'person-1',
  name: 'Avery Quinn',
  title: 'Director of Partnerships',
  company: 'Example Robotics',
  email: 'avery.quinn@example.com',
  otherEmails: [],
  linkedinUrl: 'linkedin.com/in/avery-quinn-example',
  website: 'www.example.com',
  phones: [phone(1, '415-555-0142', 'mobile', 'C'), phone(2, '415-555-0100', 'main', 'Main'), phone(3, '415-555-0101', 'fax', 'F')],
  toCheck: [],
  ...over,
});

/** Look, then save what was shown, as the screen does. */
async function lookAndSave(d, { op = OP, index = 0, choices } = {}) {
  const shown = await previewCapturePerson(UID, { operationId: op, index, draft: d });
  const result = await saveCapturePerson(UID, { operationId: op, index, draft: d, shown: shown.person, choices });
  return { shown, result };
}

beforeEach(() => {
  store.docs.clear();
  store.versions.clear();
  store.writes.length = 0;
  store.autoId = 0;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── A new person ───────────────────────────────────────────────────────────

describe('a new person', () => {
  it('is shown as new, with a new company, and saved with every reviewed detail and typed phone', async () => {
    const { shown, result } = await lookAndSave(draft());
    expect(shown.person).toEqual({ status: 'new' });
    expect(shown.company).toEqual({ status: 'new', name: 'Example Robotics' });
    expect(result).toMatchObject({ status: 'saved', contactId: captureContactId(OP, 0), outcome: 'created' });

    const [person] = contacts();
    expect(person.id).toBe(`${OP}_p1`);
    expect(person).toMatchObject({
      name: 'Avery Quinn',
      title: 'Director of Partnerships',
      email: 'avery.quinn@example.com',
      email_normalized: 'avery.quinn@example.com',
      linkedin_url: 'linkedin.com/in/avery-quinn-example',
      website: 'www.example.com',
      company: 'Example Robotics',
      company_name: 'Example Robotics',
      company_id: result.companyId,
      source: CAPTURE_SOURCE,
      addedFrom: CAPTURE_SOURCE,
      identity_sources: [CAPTURE_SOURCE],
      capture_operation_id: OP,
      is_archived: false,
      // Typed phones, and the single fields derived from them.
      phone: '415-555-0142',
      phone_mobile: '415-555-0142',
      phone_direct: null,
      phone_work: null,
      phone_home: null,
      phone_normalized: '4155550142',            // the mobile: a person-level number
    });
    expect(person.phones.map(p => [p.label, p.value, p.labelSource, p.observedLabel])).toEqual([
      ['mobile', '415-555-0142', 'card', 'C'],
      ['main', '415-555-0100', 'card', 'Main'],
      ['fax', '415-555-0101', 'card', 'F'],
    ]);
    expect(person.identity_review_required).toBeUndefined();

    const [company] = companies();
    expect(company).toMatchObject({ name: 'Example Robotics', name_source: 'user', source: CAPTURE_SOURCE, status: 'accepted', domain: 'example.com' });
    expect(Object.keys(company).filter(k => /phone|fax/i.test(k))).toEqual([]);   // no company phone from the card
  });

  it('a card with only a main line saves no identity number: a main line never identifies a person', async () => {
    await lookAndSave(draft({ email: '', linkedinUrl: '', phones: [phone(1, '415-555-0100', 'main', 'Main')] }));
    const [person] = contacts();
    expect(person).toMatchObject({ phone: '415-555-0100', phone_normalized: null });
  });

  it('a type the card did not state stays "Type not set"', async () => {
    await lookAndSave(draft({ phones: [makePhone({ id: 'card-1', value: '415-555-0100', label: 'unknown', observedLabel: 'Tel' })] }));
    const [person] = contacts();
    expect(person.phones[0]).toMatchObject({ label: 'unknown', labelSource: null, observedLabel: 'Tel' });
    expect(person.phone_normalized).toBeNull();
  });

  it('needs a name; nothing is written without one', async () => {
    const result = await saveCapturePerson(UID, { operationId: OP, index: 0, draft: draft({ name: '  ' }), shown: { status: 'new' } });
    expect(result).toEqual({ status: 'invalid', reason: 'name_required' });
    expect(store.writes).toEqual([]);
  });
});

// ─── Retries ────────────────────────────────────────────────────────────────

describe('retries never make a second person', () => {
  it('saving the same scan again returns the same contact and writes nothing', async () => {
    const { result } = await lookAndSave(draft());
    const writes = store.writes.length;
    const again = await saveCapturePerson(UID, { operationId: OP, index: 0, draft: draft(), shown: { status: 'new' } });
    expect(again).toMatchObject({ status: 'saved', contactId: result.contactId, outcome: 'already_saved' });
    expect(store.writes.length).toBe(writes);
    expect(contacts()).toHaveLength(1);
    expect(companies()).toHaveLength(1);
  });

  it('after a save, looking again says "already saved from this scan"', async () => {
    await lookAndSave(draft());
    const shown = await previewCapturePerson(UID, { operationId: OP, index: 0, draft: draft() });
    expect(shown.person).toMatchObject({ status: 'saved', contactId: `${OP}_p1`, name: 'Avery Quinn' });
  });

  it('two taps at once: one person, created once and never overwritten', async () => {
    const d = draft({ email: '', linkedinUrl: '', phones: [] });          // nothing exact to match on
    const shown = await previewCapturePerson(UID, { operationId: OP, index: 0, draft: d });
    const results = await Promise.all([1, 2].map(() => saveCapturePerson(UID, { operationId: OP, index: 0, draft: d, shown: shown.person })));
    expect(results.map(r => r.contactId)).toEqual([`${OP}_p1`, `${OP}_p1`]);
    expect(results.map(r => r.outcome).sort()).toEqual(['already_saved', 'created']);
    expect(contacts()).toHaveLength(1);
    expect(store.writes.filter(w => w.path === contactPath(`${OP}_p1`))).toHaveLength(1);
  });

  it('a failed first attempt (company written, person not) is completed by the retry, with the same company', async () => {
    const d = draft();
    const shown = await previewCapturePerson(UID, { operationId: OP, index: 0, draft: d });
    const real = store.docs.set.bind(store.docs);
    let failed = false;
    store.docs.set = (path, data) => {
      if (!failed && path.includes('/contacts/')) { failed = true; throw new Error('network'); }
      return real(path, data);
    };
    await expect(saveCapturePerson(UID, { operationId: OP, index: 0, draft: d, shown: shown.person })).rejects.toThrow('network');
    store.docs.set = real;
    expect(companies()).toHaveLength(1);
    expect(contacts()).toHaveLength(0);

    const retry = await saveCapturePerson(UID, { operationId: OP, index: 0, draft: d, shown: shown.person });
    expect(retry).toMatchObject({ status: 'saved', outcome: 'created' });
    expect(companies()).toHaveLength(1);
    expect(contacts()[0].company_id).toBe(companies()[0].id);
  });

  it('a different scan of the same card finds the person it already saved', async () => {
    await lookAndSave(draft());
    const { shown, result } = await lookAndSave(draft(), { op: OP2 });
    expect(shown.person).toMatchObject({ status: 'existing', contactId: `${OP}_p1`, matchedOn: 'email' });
    expect(result).toMatchObject({ status: 'saved', contactId: `${OP}_p1`, outcome: 'updated' });
    expect(contacts()).toHaveLength(1);
  });
});

// ─── An existing person ─────────────────────────────────────────────────────

describe('an existing person', () => {
  it('matched on email: filled in where empty, numbers added, nothing overwritten; repeating writes nothing new', async () => {
    putCompany('co_1', { name: 'Example Robotics', status: 'accepted' });
    putContact('c_1', {
      name: 'Avery Q.', title: '', email: 'Avery.Quinn@example.com', email_normalized: 'avery.quinn@example.com',
      company_id: 'co_1', company_name: 'Example Robotics', phone: '415-555-0199',
    });
    const { shown, result } = await lookAndSave(draft());
    expect(shown.person).toMatchObject({ status: 'existing', contactId: 'c_1', name: 'Avery Q.', company: 'Example Robotics', matchedOn: 'email' });
    expect(result).toMatchObject({ status: 'saved', contactId: 'c_1', companyId: 'co_1', outcome: 'updated' });

    const saved = contacts().find(c => c.id === 'c_1');
    expect(saved.name).toBe('Avery Q.');                                  // the record's own name stays
    expect(saved.email).toBe('Avery.Quinn@example.com');
    expect(saved.title).toBe('Director of Partnerships');                // was empty: filled
    expect(saved.linkedin_url).toBe('linkedin.com/in/avery-quinn-example');
    expect(saved.phones.map(p => [p.label, p.value])).toEqual([
      ['unknown', '415-555-0199'],                                         // the record's own number, kept
      ['mobile', '415-555-0142'], ['main', '415-555-0100'], ['fax', '415-555-0101'],
    ]);
    expect(saved.phone).toBe('415-555-0142');
    expect(saved.identity_sources).toEqual([CAPTURE_SOURCE]);
    expect(contacts()).toHaveLength(1);
    expect(companies()).toHaveLength(1);                                   // the person keeps their company

    const writes = store.writes.length;
    await lookAndSave(draft(), { op: OP2 });
    expect(store.writes.length).toBe(writes);                             // nothing new to add
  });

  it('numbers added by a later scan get ids of their own, so each stays editable on the profile', async () => {
    await lookAndSave(draft());
    await lookAndSave(draft({ phones: [phone(1, '415-555-0177', 'direct', 'D')] }), { op: OP2 });
    const [person] = contacts();
    expect(person.phones.map(p => [p.id, p.value])).toEqual([
      ['card-1', '415-555-0142'], ['card-2', '415-555-0100'], ['card-3', '415-555-0101'], ['card-1-2', '415-555-0177'],
    ]);
    expect(new Set(person.phones.map(p => p.id)).size).toBe(person.phones.length);
    expect(person.phone_direct).toBe('415-555-0177');
  });

  it('a title the record already has is not replaced', async () => {
    putContact('c_1', { name: 'Avery Quinn', title: 'CEO', email: 'avery.quinn@example.com' });
    await lookAndSave(draft());
    expect(contacts()[0].title).toBe('CEO');
  });

  it('matched on a typed mobile number', async () => {
    putContact('c_1', { name: 'Avery Quinn', phones: [makePhone({ id: '1', value: '415-555-0142', label: 'mobile', labelSource: 'user' })], phone_normalized: '4155550142' });
    const { shown } = await lookAndSave(draft({ email: '', linkedinUrl: '' }));
    expect(shown.person).toMatchObject({ status: 'existing', contactId: 'c_1', matchedOn: 'phone' });
  });
});

// ─── Shared lines (ADR-002, merged phone rules) ─────────────────────────────

describe('two coworkers who share a main line stay two people', () => {
  it.each(['main', 'work', 'fax', 'unknown'])('a shared %s line does not match the coworker already saved', async (label) => {
    putContact('c_coworker', {
      name: 'Blair Stone', company_name: 'Example Robotics',
      phones: [makePhone({ id: '1', value: '415-555-0100', label, labelSource: 'user' })], phone: '415-555-0100', phone_normalized: null,
    });
    const card = draft({ email: 'avery.quinn@example.com', linkedinUrl: '', phones: [phone(1, '415-555-0100', label === 'unknown' ? 'main' : label)] });
    const { shown, result } = await lookAndSave(card);
    expect(shown.person).toEqual({ status: 'new' });
    expect(result).toMatchObject({ status: 'saved', outcome: 'created' });
    expect(contacts().map(c => c.name).sort()).toEqual(['Avery Quinn', 'Blair Stone']);
    expect(contacts().find(c => c.id === 'c_coworker').phones).toHaveLength(1);    // untouched
  });

  it('an older coworker record (no types yet) holding the main line in `phone`: still a new person', async () => {
    putContact('c_legacy', { name: 'Blair Stone', company_name: 'Example Robotics', phone: '415-555-0100', phone_normalized: '4155550100' });
    const { shown } = await lookAndSave(draft({ email: 'avery.quinn@example.com', linkedinUrl: '', phones: [phone(1, '415-555-0100', 'main', 'Main')] }));
    expect(shown.person).toEqual({ status: 'new' });
    expect(contacts().find(c => c.id === 'c_legacy')).toEqual({ id: 'c_legacy', name: 'Blair Stone', company_name: 'Example Robotics', phone: '415-555-0100', phone_normalized: '4155550100' });
  });

  it('a card whose only number is the main line saved on a coworker: still a new person', async () => {
    await lookAndSave(draft({ name: 'Blair Stone', email: 'blair@example.com', linkedinUrl: '', phones: [phone(1, '415-555-0100', 'main', 'Main')] }));
    const { shown } = await lookAndSave(draft({ email: 'avery.quinn@example.com', linkedinUrl: '', phones: [phone(1, '415-555-0100', 'main', 'Main')] }), { op: OP2 });
    expect(shown.person).toEqual({ status: 'new' });
    expect(contacts()).toHaveLength(2);
  });
});

// ─── Possible matches and conflicts ─────────────────────────────────────────

describe('a possible match (same name and company) is the user\'s call', () => {
  const nameOnly = () => draft({ email: '', linkedinUrl: '', phones: [] });
  beforeEach(() => putContact('c_weak', { name: 'Avery Quinn', company_name: 'Example Robotics' }));

  it('is shown with the candidate; saving without an answer writes nothing', async () => {
    const shown = await previewCapturePerson(UID, { operationId: OP, index: 0, draft: nameOnly() });
    expect(shown.person).toEqual({
      status: 'review', matchedOn: 'name_company',
      candidates: [{ contactId: 'c_weak', name: 'Avery Quinn', company: 'Example Robotics' }],
    });
    const result = await saveCapturePerson(UID, { operationId: OP, index: 0, draft: nameOnly(), shown: shown.person });
    expect(result.status).toBe('needs_choice');
    expect(store.writes).toEqual([]);
  });

  it('"Same person" updates that contact', async () => {
    const { result } = await lookAndSave(nameOnly(), { choices: { person: 'c_weak' } });
    expect(result).toMatchObject({ status: 'saved', contactId: 'c_weak', outcome: 'updated' });
    expect(contacts()).toHaveLength(1);
    expect(contacts()[0].title).toBe('Director of Partnerships');
  });

  it('"Different person" adds a new contact, not flagged for a review the user already did', async () => {
    const { result } = await lookAndSave(nameOnly(), { choices: { person: 'new' } });
    expect(result).toMatchObject({ status: 'saved', contactId: `${OP}_p1`, outcome: 'created' });
    expect(contacts()).toHaveLength(2);
    expect(Object.keys(contacts().find(c => c.id === `${OP}_p1`)).filter(k => k.startsWith('identity_review_'))).toEqual([]);
  });

  it('an answer naming a contact the resolver did not offer is refused', async () => {
    putContact('c_other', { name: 'Someone Else' });
    const { result } = await lookAndSave(nameOnly(), { choices: { person: 'c_other' } });
    expect(result.status).toBe('changed');
    expect(store.writes).toEqual([]);
  });
});

describe('a conflict is never saved', () => {
  it('two existing contacts share the email: "conflict" shown, save refused, nothing written', async () => {
    putContact('c_a', { name: 'A', email_normalized: 'avery.quinn@example.com' });
    putContact('c_b', { name: 'B', email_normalized: 'avery.quinn@example.com' });
    const { shown, result } = await lookAndSave(draft());
    expect(shown.person).toEqual({ status: 'conflict', matchedOn: 'email', count: 2 });
    expect(result).toEqual({ status: 'refused', person: { status: 'conflict', matchedOn: 'email', count: 2 } });
    expect(store.writes).toEqual([]);
  });
});

describe('save looks again', () => {
  it('shown as new, but the person was added meanwhile: nothing written, the new match returned', async () => {
    const d = draft();
    const shown = await previewCapturePerson(UID, { operationId: OP, index: 0, draft: d });
    putContact('c_meanwhile', { name: 'Avery Quinn', email_normalized: 'avery.quinn@example.com' });
    const result = await saveCapturePerson(UID, { operationId: OP, index: 0, draft: d, shown: shown.person });
    expect(result).toEqual({ status: 'changed', person: expect.objectContaining({ status: 'existing', contactId: 'c_meanwhile' }) });
    expect(store.writes).toEqual([]);
  });
});

// ─── Companies ──────────────────────────────────────────────────────────────

describe('companies', () => {
  it('an existing company by name is linked, not duplicated', async () => {
    putCompany('co_1', { name: 'Example Robotics', status: 'accepted' });
    const { shown, result } = await lookAndSave(draft());
    expect(shown.company).toEqual({ status: 'existing', companyId: 'co_1', name: 'Example Robotics' });
    expect(result.companyId).toBe('co_1');
    expect(companies()).toHaveLength(1);
  });

  it('a pending (un-swiped) company is linked and accepted, as every add path does', async () => {
    putCompany('co_1', { name: 'Example Robotics', status: 'pending' });
    await lookAndSave(draft());
    expect(companies()[0]).toMatchObject({ status: 'accepted', accepted_via: CAPTURE_SOURCE });
  });

  it('same website, different printed name: a possible match; linked when chosen, left out when not', async () => {
    putCompany('co_1', { name: 'Example Corp', domain: 'example.com', status: 'accepted' });
    const { shown, result } = await lookAndSave(draft());
    expect(shown.company).toEqual({ status: 'possible', companyId: 'co_1', name: 'Example Corp' });
    expect(result.companyId).toBe('co_1');
    expect(companies()).toHaveLength(1);

    const { result: unlinked } = await lookAndSave(draft({ name: 'Jordan Lee', email: 'jordan@example.com', linkedinUrl: '', phones: [] }), { op: OP2, choices: { company: 'none' } });
    expect(unlinked.companyId).toBeNull();
    expect(contacts().find(c => c.id === `${OP2}_p1`).company_id).toBeNull();
    expect(companies()).toHaveLength(1);
  });

  it('no printed company name: linked only to a company that already has that website; never invented from a domain', async () => {
    const noName = () => draft({ company: '' });
    const { shown, result } = await lookAndSave(noName());
    expect(shown.company).toEqual({ status: 'none' });
    expect(result.companyId).toBeNull();
    expect(companies()).toEqual([]);

    putCompany('co_1', { name: 'Example Robotics', domain: 'example.com', status: 'accepted' });
    const { shown: again, result: linked } = await lookAndSave(noName(), { op: OP2 });
    expect(again.company).toEqual({ status: 'existing', companyId: 'co_1', name: 'Example Robotics' });
    expect(linked.companyId).toBe('co_1');
  });
});

describe('what a save writes', () => {
  it('only the contact and its company: nothing under capture_operations, no other collection', async () => {
    await lookAndSave(draft());
    const paths = [...new Set(store.writes.map(w => w.path.split('/').slice(0, 3).join('/')))].sort();
    expect(paths).toEqual([`users/${UID}/companies`, `users/${UID}/contacts`]);
    expect(store.writes.some(w => w.path.includes('capture_operations'))).toBe(false);
  });
});

describe('it decides nothing on its own', () => {
  it('saves only through the shared paths every add-contact screen uses', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const src = readFileSync(resolve(repo, 'src/components/capture/captureSave.js'), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]).sort();
    expect(imports).toEqual([
      '../../firebase/config',
      '../../schemas/userAddedContact',
      '../../services/companyIdentityService',
      '../../services/contactIdentityService',
      '../../services/contactWriteGuard',
      '../../utils/contactPhones',
      '../../utils/identityResolution',
      'firebase/firestore',
    ]);
    expect(src).not.toMatch(/capture_operations|addDoc|setDoc|deleteDoc|writeBatch/);
  });
});
