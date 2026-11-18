/**
 * Contact Hub's entries in the application sidebar (Milestone 2A).
 *
 * The real Sidebar beside the real Contact Hub, with the switch on. The
 * sidebar draws one empty element under "Contact Hub" while that module is
 * active and the sidebar is wide; Contact Hub draws My People, the Sticker
 * Wall, its sticker filters and New sticker into it, from the people and the
 * one sticker registry the page already has.
 *
 * Switch off: contactHubSidebarNavOff.test.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, within, waitFor, configure, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';
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
const shell = vi.hoisted(() => ({ mode: 'wide', entities: [] }));
// The switch ON, before the navigation model reads it.
vi.mock('../constants/contactHub', async (importOriginal) => ({
  ...(await importOriginal()),
  CONTACT_HUB: Object.freeze({ enabled: true }),
}));
vi.mock('../context/ShellContext', () => ({
  useShell: () => ({ openBarry() {}, sidebarMode: shell.mode, toggleSidebar() {}, isFirstExperience: false }),
  // What a screen tells the shell about who is open (the person page does).
  useShellEntity: (entity) => { if (entity?.id) shell.entities.push(entity); },
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

import ContactHubMain from '../pages/ContactHub/ContactHubMain';
import HubPeople from '../pages/ContactHub/HubPeople';
import HubPerson from '../pages/ContactHub/HubPerson';
import Sidebar from '../components/layout/Sidebar';
import BottomNav from '../components/layout/BottomNav';
import { sidebarDestinations } from '../constants/navigationModel';

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
afterEach(() => { setViewportWidth(1024); shell.mode = 'wide'; shell.entities.length = 0; vi.restoreAllMocks(); });


// The address the app is at, and its history, as a test can see and drive them.
const router = { at: '', navigate: null };
function RouterProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    router.at = location.pathname + location.search;
    router.navigate = navigate;
  }, [location, navigate]);
  return null;
}
const goBack = () => act(() => { router.navigate(-1); });

function renderApp(url = '/contact-hub') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <RouterProbe />
      <Sidebar user={{ email: 'aaron@example.test' }} onLogout={() => {}} />
      <main>
        <Routes>
          <Route path="/contact-hub" element={<ContactHubMain />}>
            <Route index element={<HubPeople />} />
            <Route path="stickers" element={<HubPeople />} />
            <Route path="person/:contactId" element={<HubPerson />} />
          </Route>
          <Route path="/scout" element={<div data-testid="scout" />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}

const names = () => [...screen.getByRole('list', { name: 'My People' }).querySelectorAll('a.hub-row-link')].map((a) => a.textContent);
const globalNav = () => screen.getByRole('navigation', { name: 'Global navigation' });
const hubNav = () => within(globalNav()).findByRole('navigation', { name: 'Contact Hub sections' });
const noHubNav = () => expect(screen.queryByRole('navigation', { name: 'Contact Hub sections' })).toBeNull();
const slot = () => document.querySelector('.sidebar-subnav');
/** The module buttons, in order: the global list, which must not change. */
const moduleLabels = () => [...globalNav().querySelectorAll('.sidebar-modules > li > .sidebar-module')].map((b) => b.getAttribute('aria-label'));
const said = (nav) => within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.replace(/\d+$/, ''));
const failRegistry = () => {
  fake.current.services.subscribeStickers = (_uid, _onNext, onError) => {
    fake.current.state.subscriptions += 1;
    Promise.resolve().then(() => onError(Object.assign(new Error('unavailable'), { code: 'unavailable' })));
    return () => {};
  };
};

describe('under Contact Hub, while it is the active module', () => {
  it('lists My People with its count, the Sticker Wall, each sticker with its count, and New sticker', async () => {
    renderApp();
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'New sticker' });
    expect(said(nav)).toEqual(['My Card', 'My People', 'Sticker Wall', 'Partner, 1 person', 'VIP, 1 person', 'New sticker']);
    expect(within(nav).getByLabelText('4 people')).toHaveTextContent('4');
    expect(within(nav).getByRole('button', { name: /My People/ })).toHaveAttribute('aria-current', 'page');
    // It sits directly under the Contact Hub item, inside the global navigation.
    expect(slot().previousElementSibling).toHaveAccessibleName('Contact Hub');
    expect(slot()).toContainElement(nav);
  });

  it('the sticker navigation is never duplicated: with the entries here, the page has no chip row and no panel', async () => {
    renderApp();
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'VIP, 1 person' });
    await screen.findByRole('list', { name: 'My People' });
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(document.querySelector('.hub-panel')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'VIP, 1 person' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Sticker Wall' })).toHaveLength(1);
    expect(screen.getAllByRole('list', { name: 'Filter by sticker' })).toHaveLength(1);
    // The page keeps its own title and heading.
    expect(screen.getAllByRole('heading', { level: 1, name: 'Contact Hub' })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toHaveTextContent('(4)');
  });

  it('the count is everyone, not the number drawn on the page', async () => {
    contactsData.list = Array.from({ length: 120 }, (_, i) => person(`m${i}`, `Person ${i + 1}`));
    renderApp();
    const nav = await hubNav();
    expect(await within(nav).findByLabelText('120 people')).toHaveTextContent('120');
    expect(names()).toHaveLength(50);
  });

  it('the global list of modules is exactly what it was', async () => {
    renderApp();
    await hubNav();
    expect(moduleLabels()).toEqual(sidebarDestinations().map((d) => d.label));
    expect(within(globalNav()).getByRole('button', { name: 'Contact Hub' })).toHaveAttribute('aria-current', 'page');
  });

  it('uses the page\'s people and its one sticker registry: nothing is loaded or listened to twice', async () => {
    renderApp();
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'New sticker' });
    await screen.findByRole('list', { name: 'My People' });
    expect(contactsData.loads).toBe(1);
    expect(fake.current.state.subscriptions).toBe(1);
    expect(fake.current.state.configFetches).toBe(1);
  });

  it('a sticker filters My People and is in the address; pressing it again clears it; Back steps through', async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = await hubNav();
    await user.click(await within(nav).findByRole('button', { name: 'Partner, 1 person' }));
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(names()).toEqual(['Wes Clark']);
    expect(within(nav).getByRole('button', { name: 'Partner, 1 person' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: /My People/ })).not.toHaveAttribute('aria-current');

    await user.click(within(nav).getByRole('button', { name: 'VIP, 1 person' }));
    expect(names()).toEqual(['Nakaiya Wiley']);
    await goBack();
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(within(await hubNav()).getByRole('button', { name: 'Partner, 1 person' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(await hubNav()).getByRole('button', { name: 'Partner, 1 person' }));
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
  });

  it('Sticker Wall opens the wall; My People returns to everyone', async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = await hubNav();
    await user.click(await within(nav).findByRole('button', { name: 'Sticker Wall' }));
    expect(router.at).toBe('/contact-hub/stickers');
    expect(await screen.findByTestId('stickers-wall')).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Sticker Wall' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: /My People/ })).not.toHaveAttribute('aria-current');
    // The page is named for where you are, with its own link back, and offers
    // nothing that belongs to My People.
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My People' })).toHaveAttribute('href', '/contact-hub');
    expect(screen.queryByRole('button', { name: 'Add Person' })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search people' })).toBeNull();

    await user.click(within(nav).getByRole('button', { name: /My People/ }));
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
  });

  it('the counts follow the page: removing a sticker from a row, and adding a person', async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'VIP, 1 person' });
    await user.click(screen.getByRole('button', { name: 'Remove sticker VIP' }));
    expect(await within(nav).findByRole('button', { name: 'VIP, 0 people' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add Person' }));
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(await within(nav).findByLabelText('5 people')).toBeInTheDocument();
  });

  it('New sticker opens the existing dialog, outside the sidebar, and creates through the existing service', async () => {
    const user = userEvent.setup();
    renderApp();
    const nav = await hubNav();
    await user.click(await within(nav).findByRole('button', { name: 'New sticker' }));
    const dialog = screen.getByRole('dialog', { name: 'New sticker' });
    expect(document.querySelector('.sidebar')).not.toContainElement(dialog);
    await user.type(within(dialog).getByLabelText('Name'), 'Neighbours');
    await user.click(within(dialog).getByRole('button', { name: /create|save|add/i }));
    await waitFor(() => expect(fake.current.callsOf('createSticker')).toHaveLength(1));
    expect(fake.current.callsOf('createSticker')[0][0]).toBe('u1');
    expect(fake.current.callsOf('createSticker')[0][1]).toMatchObject({ name: 'Neighbours' });
    expect(await within(nav).findByRole('button', { name: 'Neighbours, 0 people' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New sticker' })).toBeNull();
  });

  it('open on a person, My People is still marked as where you are, and its entries still work', async () => {
    const user = userEvent.setup();
    renderApp('/contact-hub/person/p2');
    const nav = await hubNav();
    expect(within(nav).getByRole('button', { name: /My People/ })).toHaveAttribute('aria-current', 'true');
    // The shell is told who is open (in full, against the real shell: contactHubPage.test.jsx).
    await screen.findByTestId('notes');
    expect(shell.entities.at(-1)).toEqual({ type: 'contact', id: 'p2', stage: null, label: 'Wes Clark' });
    await user.click(await within(nav).findByRole('button', { name: 'VIP, 1 person' }));
    expect(router.at).toBe(`/contact-hub?sticker=${VIP.id}`);
    expect(names()).toEqual(['Nakaiya Wiley']);
  });
});

describe('sticker permissions and states', () => {
  it.each([
    ['switched off for the user', { enabled: false, mode: 'off', readOnly: false }],
    ['read-only (an admin viewing as the user)', { enabled: true, mode: 'beta', readOnly: true }],
  ])('stickers %s: My People with its count and nothing else, and nothing is subscribed', async (_label, body) => {
    fake.current.state.config = config(body);
    renderApp();
    await screen.findByRole('list', { name: 'My People' });
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    const nav = await hubNav();
    expect(said(nav)).toEqual(['My Card', 'My People']);
    expect(within(nav).getByLabelText('4 people')).toHaveTextContent('4');
    expect(within(nav).getByRole('button', { name: /My People/ })).toHaveAttribute('aria-current', 'page');
    expect(within(globalNav()).queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);
    expect(moduleLabels()).toEqual(sidebarDestinations().map((d) => d.label));
    // The page itself has no sticker controls either.
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
  });

  it('while availability is still being checked: My People only, nothing that would write', async () => {
    let answer;
    fake.current.services.fetchStickersConfig = () => new Promise((resolve) => { answer = resolve; });
    renderApp();
    const nav = await hubNav();
    expect(said(nav)).toEqual(['My Card', 'My People']);
    answer(config());
    expect(await within(nav).findByRole('button', { name: 'New sticker' })).toBeInTheDocument();
  });

  it('the sticker list failed to load: a plain message, the Sticker Wall (its own page says what it can show), no New sticker', async () => {
    failRegistry();
    renderApp();
    const nav = await hubNav();
    expect(await within(nav).findByText(/Your stickers could not be loaded\. They have not been changed\./)).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /My People/ })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: 'New sticker' })).toBeNull();
    // Stickers are available to this person: the destination is still there, as it is on the phone.
    expect(within(nav).getByRole('button', { name: 'Sticker Wall' })).toBeInTheDocument();
  });

  it('no stickers yet: My People, Sticker Wall and New sticker, with no empty list', async () => {
    fake.current.state.registry = [];
    renderApp();
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'New sticker' });
    expect(said(nav)).toEqual(['My Card', 'My People', 'Sticker Wall', 'New sticker']);
    expect(within(nav).queryByRole('list')).toBeNull();
  });

  it('nobody in My People yet: My People (0) and the Sticker Wall, but no filters and no New sticker; the page is the one invitation', async () => {
    contactsData.list = [];
    renderApp();
    await screen.findByText('Start with one person');
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    const nav = await hubNav();
    // Stickers are on and loaded, but there is nobody for them to act on yet: the destination is there, the filters are not.
    await waitFor(() => expect(fake.current.state.subscriptions).toBe(1));
    expect(said(nav)).toEqual(['My Card', 'My People', 'Sticker Wall']);
    expect(within(nav).getByLabelText('0 people')).toHaveTextContent('0');
    expect(within(nav).getByRole('button', { name: /My People/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
  });

  it('while the people are still loading: My People with no count yet, and the Sticker Wall once stickers are known to be available', async () => {
    let finish;
    const { getDocs } = await import('firebase/firestore');
    getDocs.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderApp();
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'Sticker Wall' });
    expect(said(nav)).toEqual(['My Card', 'My People', 'Sticker Wall']);
    expect(within(nav).queryByLabelText(/people|person/)).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'New sticker' })).toBeNull();
    finish({ docs: contactsData.list.map((d) => ({ id: d.id, data: () => d })) });
    expect(await within(nav).findByLabelText('4 people')).toBeInTheDocument();
    expect(await within(nav).findByRole('button', { name: 'New sticker' })).toBeInTheDocument();
  });

  it('the people could not be loaded: My People with no count, the Sticker Wall (lit, on its own page), and My People still leads back', async () => {
    const user = userEvent.setup();
    contactsData.fail = true;
    renderApp('/contact-hub/stickers');
    await screen.findByText('Your people could not be loaded.');
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'Sticker Wall' });
    expect(said(nav)).toEqual(['My Card', 'My People', 'Sticker Wall']);
    expect(within(nav).getByRole('button', { name: 'Sticker Wall' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByLabelText(/people|person/)).toBeNull();
    await user.click(within(nav).getByRole('button', { name: /My People/ }));
    expect(router.at).toBe('/contact-hub');
    expect(screen.getByText('Your people could not be loaded.')).toBeInTheDocument();
  });
});

describe('the Sticker Wall in the sidebar: the same destinations as the phone, on every Contact Hub page', () => {
  const states = {
    enabled: config(),
    disabled: config({ enabled: false, mode: 'off', readOnly: false }),
    'not enrolled (beta, not in it)': config({ enabled: false, mode: 'beta', readOnly: false }),
    'read-only (an admin viewing as the user)': config({ enabled: true, mode: 'beta', readOnly: true }),
    'an error from the server': { status: 500, body: null },
    'an answer that is not understood': { status: 200, body: { enabled: 'yes' } },
  };

  /** The sidebar's Contact Hub entries, and the phone bar's, from one render of both. */
  function renderBoth(url) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <RouterProbe />
        <Sidebar user={{ email: 'aaron@example.test' }} onLogout={() => {}} />
        <main>
          <Routes>
            <Route path="/contact-hub" element={<ContactHubMain />}>
              <Route index element={<HubPeople />} />
              <Route path="stickers" element={<HubPeople />} />
              <Route path="person/:contactId" element={<HubPerson />} />
            </Route>
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </main>
        <BottomNav onOpenMore={() => {}} />
      </MemoryRouter>,
    );
  }
  const sidebarNav = () => within(globalNav()).queryByRole('navigation', { name: 'Contact Hub sections' });
  const barNav = () => screen.getAllByRole('navigation', { name: 'Contact Hub sections' }).find((nav) => !globalNav().contains(nav));
  const labelsOf = (nav) => within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.replace(/\d+$/, '').trim());
  /** Presses each entry and waits for the address it should reach; true for each that got there. */
  async function reaches(navOf, expected, user, from) {
    const got = {};
    for (const [name, path] of Object.entries(expected)) {
      // Found afresh each time: going to My Card takes the sidebar's entries away, and coming back draws new ones.
      const nav = await waitFor(() => { const found = navOf(); expect(found).toBeTruthy(); return found; });
      await user.click(await within(nav).findByRole('button', { name: new RegExp(`^${name}`) }));
      try { await waitFor(() => expect(router.at).toBe(path), { timeout: 1500 }); got[name] = path; } catch { got[name] = router.at; }
      act(() => { router.navigate(from); });
      await waitFor(() => expect(router.at).toBe(from));
    }
    return got;
  }

  it.each([['My People', '/contact-hub'], ['the Sticker Wall', '/contact-hub/stickers'], ['a person', '/contact-hub/person/p1']])('enabled, on %s: the sidebar and the phone bar offer the same three destinations, and each goes to the same place', async (_page, url) => {
    const user = userEvent.setup();
    renderBoth(url);
    await within(globalNav()).findByRole('navigation', { name: 'Contact Hub sections' });
    await within(sidebarNav()).findByRole('button', { name: 'Sticker Wall' });
    expect(labelsOf(sidebarNav()).filter((l) => ['My Card', 'My People', 'Sticker Wall'].includes(l))).toEqual(['My Card', 'My People', 'Sticker Wall']);
    expect(labelsOf(barNav())).toEqual(['My Card', 'My People', 'Sticker Wall']);
    const expected = { 'My Card': '/contact-hub/my-card', 'My People': '/contact-hub', 'Sticker Wall': '/contact-hub/stickers' };
    // Each entry, in the sidebar and on the phone, goes to the same place.
    expect(await reaches(sidebarNav, expected, user, url)).toEqual(expected);
    expect(await reaches(barNav, expected, user, url)).toEqual(expected);
  });

  it('enabled: the Sticker Wall is lit on its own page, and only there', async () => {
    renderApp('/contact-hub/stickers');
    const nav = await hubNav();
    const wall = await within(nav).findByRole('button', { name: 'Sticker Wall' });
    expect(wall).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: /My People/ })).not.toHaveAttribute('aria-current', 'page');
  });

  it('enabled: it is a place to go, and it goes to the wall', async () => {
    const user = userEvent.setup();
    renderApp('/contact-hub');
    const nav = await hubNav();
    await user.click(await within(nav).findByRole('button', { name: 'Sticker Wall' }));
    await waitFor(() => expect(router.at).toBe('/contact-hub/stickers'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
  });

  it.each(Object.entries(states).filter(([name]) => name !== 'enabled'))('%s: no Sticker Wall in the sidebar, on any Contact Hub page, and nothing is subscribed', async (_label, answer) => {
    fake.current.state.config = answer;
    for (const url of ['/contact-hub', '/contact-hub/stickers']) {
      const before = fake.current.state.configFetches;
      const { unmount } = renderApp(url);
      const nav = await hubNav();
      await waitFor(() => expect(fake.current.state.configFetches).toBeGreaterThan(before));
      await waitFor(() => expect(within(nav).getByRole('button', { name: /My People/ })).toBeInTheDocument());
      expect(said(nav)).toEqual(['My Card', 'My People']);
      expect(within(globalNav()).queryByRole('button', { name: /sticker/i })).toBeNull();
      unmount();
    }
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('checking: no Sticker Wall until the server has answered, then it appears, without any reload of the people', async () => {
    let answer;
    fake.current.services.fetchStickersConfig = () => new Promise((resolve) => { answer = resolve; });
    renderApp();
    const nav = await hubNav();
    await screen.findByRole('list', { name: 'My People' });
    expect(within(nav).queryByRole('button', { name: 'Sticker Wall' })).toBeNull();
    const loadsBefore = contactsData.loads;
    answer(config());
    expect(await within(nav).findByRole('button', { name: 'Sticker Wall' })).toBeInTheDocument();
    expect(contactsData.loads).toBe(loadsBefore);
  });
});

describe('where there is no room, or it is not Contact Hub', () => {
  it('another module: no place is drawn and nothing of Contact Hub is in the sidebar', async () => {
    renderApp('/scout');
    expect(screen.getByTestId('scout')).toBeInTheDocument();
    expect(slot()).toBeNull();
    noHubNav();
    expect(moduleLabels()).toEqual(sidebarDestinations().map((d) => d.label));
    expect(within(globalNav()).getByRole('button', { name: 'Scout' })).toHaveAttribute('aria-current', 'page');
    expect(contactsData.loads).toBe(0);
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('leaving for another module removes the entries; coming back draws them again', async () => {
    const user = userEvent.setup();
    renderApp();
    await hubNav();
    await user.click(within(globalNav()).getByRole('button', { name: 'Scout' }));
    expect(router.at).toBe('/scout');
    expect(slot()).toBeNull();
    noHubNav();
    await user.click(within(globalNav()).getByRole('button', { name: 'Contact Hub' }));
    expect(router.at).toBe('/contact-hub');
    expect(await hubNav()).toBeInTheDocument();
  });

  it('compact sidebar: no place and no entries; the page\'s own sticker chips are the navigation', async () => {
    shell.mode = 'compact';
    renderApp();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(slot()).toBeNull();
    noHubNav();
    expect(within(chips).getByRole('button', { name: 'Sticker Wall' })).toBeInTheDocument();
    expect(moduleLabels()).toEqual(sidebarDestinations().map((d) => d.label));
  });

  it('a phone: the drawer has no nested entries; the page\'s chips are the navigation', async () => {
    setViewportWidth(375);
    renderApp();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(slot()).toBeNull();
    noHubNav();
    expect(within(globalNav()).getByRole('button', { name: 'Contact Hub' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Partner, 1 person' })).toBeInTheDocument();
  });

  it('Contact Hub rendered with no sidebar at all draws nothing extra and works', async () => {
    render(
      <MemoryRouter initialEntries={['/contact-hub']}>
        <Routes>
          <Route path="/contact-hub" element={<ContactHubMain />}>
            <Route index element={<HubPeople />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('list', { name: 'My People' });
    noHubNav();
    expect(names()).toHaveLength(4);
  });
});

// A phone: the shell's own bottom bar, the real one, beside the real Contact
// Hub. It is the phone's way between My People and the Sticker Wall, so the
// page's chips are filters only.
describe('a phone: the shell\'s bottom bar is My People · Sticker Wall', () => {
  beforeEach(() => { setViewportWidth(375); });

  function renderPhone(url = '/contact-hub') {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <RouterProbe />
        <main>
          <Routes>
            <Route path="/contact-hub" element={<ContactHubMain />}>
              <Route index element={<HubPeople />} />
              <Route path="stickers" element={<HubPeople />} />
              <Route path="person/:contactId" element={<HubPerson />} />
            </Route>
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </main>
        <BottomNav onOpenMore={() => {}} />
      </MemoryRouter>,
    );
  }
  const bar = () => screen.getByRole('navigation', { name: 'Contact Hub sections' });
  const cell = (name) => within(bar()).getByRole('button', { name });
  const lit = () => within(bar()).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.getAttribute('aria-label'));

  it('has two cells and nothing else: no More, no Import, no modules', async () => {
    renderPhone();
    await screen.findByRole('list', { name: 'My People' });
    expect(within(bar()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['My Card', 'My People', 'Sticker Wall']);
    expect(lit()).toEqual(['My People']);
    expect(within(bar()).queryByText(/import|more|scout|hunter/i)).toBeNull();
  });

  it('Sticker Wall opens the wall under its own name; My People returns to the list', async () => {
    const user = userEvent.setup();
    renderPhone();
    await screen.findByRole('list', { name: 'My People' });
    await user.click(cell('Sticker Wall'));
    expect(router.at).toBe('/contact-hub/stickers');
    expect(await screen.findByTestId('stickers-wall')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sticker Wall' })).toBeInTheDocument();
    expect(lit()).toEqual(['Sticker Wall']);

    await user.click(cell('My People'));
    expect(router.at).toBe('/contact-hub');
    expect(lit()).toEqual(['My People']);
    expect(names()).toHaveLength(4);
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toHaveTextContent('(4)');
  });

  it('the sticker navigation is not duplicated: the chips have no Sticker Wall, and there are no sidebar entries', async () => {
    renderPhone();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(within(chips).queryByRole('button', { name: 'Sticker Wall' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Sticker Wall' })).toHaveLength(1);
    // No sidebar entries on a phone. (The bar and those entries share the name
    // "Contact Hub sections", so this looks for the entries themselves.)
    expect(document.querySelector('.hub-sidenav')).toBeNull();
    expect(document.querySelector('.sidebar-subnav')).toBeNull();
  });

  it('a tile on the wall goes to My People filtered; the bar and the page both say so', async () => {
    const user = userEvent.setup();
    renderPhone('/contact-hub/stickers');
    const wall = await screen.findByTestId('stickers-wall');
    await user.click(within(wall).getByRole('button', { name: 'Partner, 1 person' }));
    expect(router.at).toBe(`/contact-hub?sticker=${PARTNER.id}`);
    expect(lit()).toEqual(['My People']);
    expect(screen.getByText('1 person with the Partner sticker')).toBeInTheDocument();
    expect(names()).toEqual(['Wes Clark']);
    // The bar's My People is My People itself: everyone.
    await user.click(cell('My People'));
    expect(router.at).toBe('/contact-hub');
    expect(names()).toHaveLength(4);
  });

  it('a person keeps My People lit, and the bar still leads to the wall and back', async () => {
    const user = userEvent.setup();
    renderPhone('/contact-hub/person/p2');
    await screen.findByTestId('notes');
    expect(lit()).toEqual(['My People']);
    await user.click(cell('Sticker Wall'));
    expect(await screen.findByTestId('stickers-wall')).toBeInTheDocument();
    await goBack();
    expect(router.at).toBe('/contact-hub/person/p2');
    expect(lit()).toEqual(['My People']);
  });

  it('with stickers unavailable the Sticker Wall cell leads to a plain statement, not to My People', async () => {
    const user = userEvent.setup();
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    renderPhone();
    await screen.findByRole('list', { name: 'My People' });
    await user.click(cell('Sticker Wall'));
    expect(await screen.findByText('Stickers are not available for this account yet.')).toBeInTheDocument();
    expect(lit()).toEqual(['Sticker Wall']);
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
    await user.click(cell('My People'));
    expect(names()).toHaveLength(4);
  });

  it('leaving Contact Hub, the bar is no longer Contact Hub\'s', async () => {
    renderPhone('/somewhere-else');
    expect(screen.getByTestId('elsewhere')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Contact Hub sections' })).toBeNull();
  });
});
