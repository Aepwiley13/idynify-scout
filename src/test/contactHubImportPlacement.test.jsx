/**
 * W2 placement: My People offers Import beside Add Person. After an import the list is read
 * again from users/{uid}/contacts (an import can update people already here) and the status
 * line says what happened. The importer itself is tested in contactHubImport.test.jsx.
 *
 * Harness copied from contactHubPage.test.jsx (the Contact Hub team's), with the import dialog
 * replaced by a probe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, configure, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createFakeStickers, sticker } from './helpers/stickersUi';
import { setViewportWidth } from './helpers/matchMedia';

const contactsData = vi.hoisted(() => ({ list: [], fail: false, loads: 0, paths: [] }));
const fake = vi.hoisted(() => ({ current: null }));
const seen = vi.hoisted(() => ({ card: null, notes: null, form: null }));

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  collection: vi.fn((_db, ...path) => path.join('/')),
  getDocs: vi.fn(async (path) => {
    contactsData.loads += 1;
    contactsData.paths.push(String(path));
    if (contactsData.fail) throw Object.assign(new Error('nope'), { code: 'unavailable' });
    return { docs: contactsData.list.map((d) => ({ id: d.id, data: () => d })) };
  }),
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: { uid: 'u1' } } }));
vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'u1',
  getEffectiveUser: () => ({ uid: 'u1' }),
  useImpersonation: () => ({ isImpersonating: false, isReadOnly: false }),
}));
vi.mock('../theme/ThemeContext', () => ({ useT: () => new Proxy({}, { get: () => '#888' }) }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
  updateSticker: (...a) => fake.current.services.updateSticker(...a),
  archiveSticker: (...a) => fake.current.services.archiveSticker(...a),
  restoreSticker: (...a) => fake.current.services.restoreSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
}));
vi.mock('../components/contacts/IdentityCard', () => ({
  default: (props) => {
    seen.card = props;
    return (
      <div data-testid="identity-card" data-variant={props.variant}>
        {props.contact.name}
        <button type="button" onClick={() => props.onUpdate({ ...props.contact, name: 'Renamed Person' })}>rename</button>
      </div>
    );
  },
}));
vi.mock('../components/contacts/StickyNotes', () => ({
  default: (props) => { seen.notes = props; return <div data-testid="notes">{(props.contact.notes ?? []).length} notes</div>; },
}));
vi.mock('../components/scout/ManualContactForm', () => ({
  default: (props) => {
    seen.form = props;
    return (
      <div data-testid="manual-form">
        <input aria-label="Full Name" />
        <button type="button" onClick={() => props.onContactAdded([{ id: 'new1', name: 'Nova Added', addedAt: '2026-11-14T12:00:00Z' }])}>save</button>
        <button type="button" onClick={props.onCancel}>cancel</button>
      </div>
    );
  },
}));

vi.mock('../components/contactImport/ImportPeopleDialog', () => ({
  default: (props) => (
    <div role="dialog" aria-label="Import Contacts">
      <button type="button" onClick={() => {
        // What the real importer does: write people to users/{uid}/contacts, then report.
        contactsData.list.push(
          { id: 'i1', name: 'Imported One', addedAt: '2026-11-15T12:00:00Z' },
          { id: 'i2', name: 'Imported Two', addedAt: '2026-11-15T12:00:00Z' },
        );
        props.onImported({ created: [{ id: 'i1' }, { id: 'i2' }], updated: [{ id: 'p2' }], failed: [] });
      }}>finish import</button>
      <button type="button" onClick={props.onClose}>close</button>
    </div>
  ),
}));

import ContactHubMain from '../pages/ContactHub/ContactHubMain';
import HubPeople from '../pages/ContactHub/HubPeople';
import HubPerson from '../pages/ContactHub/HubPerson';

// These render whole screens and type into them. On a loaded machine that can
// pass the 5s default without anything being wrong (the suite's other
// full-page tests allow 20s for the same reason).
vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 5000 });

const VIP = sticker('VIP', { color: 'amber' });
const PARTNER = sticker('Partner', { color: 'purple' });
const FRIEND = sticker('Friend', { color: 'green' });
const person = (id, name, extra = {}) => ({ id, name, addedAt: '2026-11-01T12:00:00Z', ...extra });

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [VIP, PARTNER];
  contactsData.fail = false;
  contactsData.loads = 0;
  contactsData.paths = [];
  contactsData.list = [
    person('p1', 'Nakaiya Wiley', { title: 'Community Leader', email: 'nakaiya@x.test', phone_mobile: '+1 555 010 0001', addedAt: '2026-11-12T12:00:00Z', sticker_ids: [VIP.id] }),
    person('p2', 'Wes Clark', { title: 'Program Director', company_name: 'UAC', email: 'wes@uac.test', addedAt: '2026-11-10T12:00:00Z', sticker_ids: [PARTNER.id] }),
    person('p3', 'Tom Green', { company_name: 'Field Committee', addedAt: '2026-11-05T12:00:00Z' }),
    person('p4', 'Old Archived', { is_archived: true, addedAt: '2026-11-13T12:00:00Z', sticker_ids: [VIP.id] }),
    person('p5', 'Hunter Stage', { hunter_status: 'active_mission', stage: 'hunter', addedAt: '2026-11-02T12:00:00Z' }),
  ];
  seen.card = null; seen.notes = null; seen.form = null;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { setViewportWidth(1024); vi.restoreAllMocks(); });

function renderHub(url = '/contact-hub') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/contact-hub" element={<ContactHubMain />}>
          <Route index element={<HubPeople />} />
          <Route path="person/:contactId" element={<HubPerson />} />
        </Route>
        <Route path="/contact/:contactId" element={<div data-testid="full-profile" />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const peopleTableOrList = () => screen.queryByRole('table', { name: 'My People' })
  ?? screen.queryByRole('list', { name: 'My People' });
const names = () => [...(peopleTableOrList()?.querySelectorAll('a.hub-row-link') ?? [])].map((a) => a.textContent);

describe('Import in My People', () => {
  it('opens the importer, then reloads the canonical list and reports the counts', async () => {
    renderHub();
    await waitFor(() => expect(peopleTableOrList()).not.toBeNull());
    expect(contactsData.loads).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Import Contacts' }));
    expect(screen.getByRole('dialog', { name: 'Import Contacts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'finish import' }));

    await waitFor(() => expect(contactsData.loads).toBe(2));
    expect(contactsData.paths).toEqual(['users/u1/contacts', 'users/u1/contacts']);
    await waitFor(() => expect(names()).toEqual(expect.arrayContaining(['Imported One', 'Imported Two'])));
    expect(screen.queryByRole('dialog', { name: 'Import Contacts' })).toBeNull();
    expect(screen.getByText('2 people added, 1 person already in My People.')).toHaveClass('hub-status');
  });

  it('a brand-new account with no one yet can import straight away, from the first screen', async () => {
    contactsData.list = [];
    renderHub();
    await screen.findByText('Start with one person');
    fireEvent.click(screen.getByRole('button', { name: 'Import Contacts' }));
    fireEvent.click(screen.getByRole('button', { name: 'finish import' }));
    await waitFor(() => expect(names()).toEqual(expect.arrayContaining(['Imported One', 'Imported Two'])));
    expect(screen.queryByText('Start with one person')).toBeNull();
  });

  it('closing the importer changes nothing', async () => {
    renderHub();
    await waitFor(() => expect(peopleTableOrList()).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Import Contacts' }));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByRole('dialog', { name: 'Import Contacts' })).toBeNull();
    expect(contactsData.loads).toBe(1);
  });
});
