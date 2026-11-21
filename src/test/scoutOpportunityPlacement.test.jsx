/**
 * W1 placement: the Contact Hub person page shows the Scout preview below the person's card.
 * Harness copied from contactHubPage.test.jsx (the Contact Hub team's). The preview itself is
 * tested in scoutUpgradeJourney.test.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, configure } from '@testing-library/react';
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

import { AccountPlanContext } from '../components/billing/accountPlanContext';
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

function renderHub(url = '/contact-hub', plan) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/contact-hub" element={<ContactHubMain />}>
          <Route index element={<HubPeople />} />
          <Route path="person/:contactId" element={<HubPerson />} />
        </Route>
        <Route path="/contact/:contactId" element={<div data-testid="full-profile" />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>
  );
  return render(plan ? <AccountPlanContext.Provider value={plan}>{tree}</AccountPlanContext.Provider> : tree);
}

describe('the person page', () => {
  it('a Free account sees what Scout would add, between the profile header and Action Center', async () => {
    renderHub('/contact-hub/person/p3', 'free');
    const upgrade = await screen.findByRole('button', { name: 'Upgrade to Scout' });
    const card = screen.getByRole('heading', { name: 'Tom Green', level: 1 });
    const actionCenter = screen.getByRole('tab', { name: 'Action Center' });
    expect(card.compareDocumentPosition(upgrade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(upgrade.compareDocumentPosition(actionCenter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Tom Green has no email/)).toBeInTheDocument();
  });

  it('a paid account gets Open in Scout for the same person', async () => {
    renderHub('/contact-hub/person/p3', 'pro');
    expect(await screen.findByRole('link', { name: 'Open in Scout' })).toHaveAttribute('href', '/contact/p3');
  });

  it('with no plan known (as in the existing page tests) nothing is added', async () => {
    renderHub('/contact-hub/person/p3');
    await screen.findByRole('heading', { name: 'Tom Green', level: 1 });
    expect(screen.queryByRole('button', { name: 'Upgrade to Scout' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open in Scout' })).toBeNull();
  });
});
