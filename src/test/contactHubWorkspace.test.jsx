/**
 * Contact Hub's workspace: the page's own sticker navigation (the chip row
 * and the Sticker Wall), the List / Table choice, and Show more.
 *
 * Rendered here with no application sidebar. Contact Hub's entries in the
 * sidebar itself are in contactHubSidebarNav.test.jsx.
 *
 * Three things these tests hold in place:
 *   - with no place in the sidebar the chip row is the sticker navigation at
 *     every width, once, and there is no inner panel;
 *   - every sticker control follows the existing availability switch, and a
 *     failed sticker load never looks like an account with no stickers;
 *   - Show more only limits what is drawn. Everyone is loaded once and
 *     searched whether drawn or not.
 *
 * Same fakes at the module boundary as contactHubPage.test.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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
import HubPeople, { TABLE_MIN_WIDTH, TABLE_FULL_WIDTH, VIEW_STORAGE_KEY } from '../pages/ContactHub/HubPeople';
import { PAGE_SIZE } from '../pages/ContactHub/peopleRules';
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
  // jsdom has no layout: give Contact Hub's content area the width a test asks for.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function measure() {
    const width = this.classList?.contains('hub-workspace') ? contentWidth : 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() {} };
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { setViewportWidth(1024); contentWidth = 0; window.localStorage.clear(); vi.restoreAllMocks(); });

function renderHub(url = '/contact-hub') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/contact-hub" element={<ContactHubMain />}>
          <Route index element={<HubPeople />} />
          <Route path="stickers" element={<HubPeople />} />
          <Route path="person/:contactId" element={<HubPerson />} />
        </Route>
        <Route path="/contact/:contactId" element={<div data-testid="full-profile" />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
    </MemoryRouter>,
  );
}


/** The width of Contact Hub's content area, as the page will measure it. */
let contentWidth = 0;
const WIDE = 1100;   // room for every table column
const NARROW = 700;  // a small window beside the wide sidebar

const names = () => [...document.querySelectorAll('.hub-list a.hub-row-link, .hub-table a.hub-row-link')].map((a) => a.textContent);
/**
 * The "Showing 50 of 120 people / Show 50 more" control. Tests that draw more
 * than one page look for its button inside it: a role query over the whole
 * page costs seconds in jsdom once 100 rows are drawn, and milliseconds here.
 */
const pagingControl = async (statusText) => (await screen.findByText(statusText)).parentElement;
const many = (n) => Array.from({ length: n }, (_, i) => person(`m${i}`, `Person ${String(i + 1).padStart(3, '0')}`, {
  email: `p${i}@x.test`, addedAt: new Date(Date.UTC(2026, 10, 12) - i * 86400000).toISOString(),
}));

// Contact Hub's own entries (My People, Sticker Wall, the sticker filters, New
// sticker) are in the application sidebar where it offers a place for them:
// contactHubSidebarNav.test.jsx. This file renders Contact Hub with no
// sidebar, as on a phone or beside the compact sidebar, where the page's own
// chip row is the sticker navigation. There is no inner panel at any width.
describe('with no place in the sidebar, the chip row is the sticker navigation', () => {
  beforeEach(() => { contentWidth = WIDE; });

  it('shows how many people there are, All, each sticker with its count, and the Sticker Wall', async () => {
    renderHub();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toHaveTextContent('(4)');
    expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    // The archived person also holds VIP and is not counted.
    expect(within(chips).getByRole('button', { name: 'VIP, 1 person' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Partner, 1 person' })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: 'Sticker Wall' })).toBeInTheDocument();
  });

  it('the sticker navigation is in the page once, and there is no inner panel at any width', async () => {
    renderHub();
    await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.getAllByRole('group', { name: 'Filter by sticker' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'VIP, 1 person' })).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: /Contact Hub/ })).toBeNull();
    expect(document.querySelector('.hub-panel')).toBeNull();
  });

  it('the page title is above the people, once', async () => {
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Contact Hub' })).toBeInTheDocument();
  });

  it('a sticker filters the people; pressing it again, or All, clears it', async () => {
    const user = userEvent.setup();
    renderHub();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    const vip = within(chips).getByRole('button', { name: 'VIP, 1 person' });
    await user.click(vip);
    expect(vip).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    expect(names()).toEqual(['Nakaiya Wiley']);
    expect(screen.getByText('People with the VIP sticker')).toBeInTheDocument();
    // The count beside My People is everyone, not the filtered few.
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toHaveTextContent('(4)');
    await user.click(vip);
    expect(names()).toHaveLength(4);
    await user.click(within(chips).getByRole('button', { name: 'Partner, 1 person' }));
    expect(names()).toEqual(['Wes Clark']);
    await user.click(within(chips).getByRole('button', { name: 'All' }));
    expect(names()).toHaveLength(4);
    expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Sticker Wall opens the existing wall, and a tile returns to the people filtered by it', async () => {
    const user = userEvent.setup();
    renderHub();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    const wallChip = within(chips).getByRole('button', { name: 'Sticker Wall' });
    await user.click(wallChip);
    expect(wallChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
    const wall = await screen.findByTestId('stickers-wall');
    await user.click(within(wall).getByRole('button', { name: 'Partner, 1 person' }));
    expect(names()).toEqual(['Wes Clark']);
    expect(within(chips).getByRole('button', { name: 'Sticker Wall' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(chips).getByRole('button', { name: 'Partner, 1 person' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('New sticker, on the Sticker Wall, opens the existing dialog and creates through the existing service', async () => {
    const user = userEvent.setup();
    renderHub();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    await user.click(within(chips).getByRole('button', { name: 'Sticker Wall' }));
    const wall = await screen.findByTestId('stickers-wall');
    await user.click(within(wall).getByRole('button', { name: /New sticker/ }));
    const dialog = screen.getByRole('dialog', { name: 'New sticker' });
    await user.type(within(dialog).getByLabelText('Name'), 'Neighbours');
    await user.click(within(dialog).getByRole('button', { name: /create|save|add/i }));
    await waitFor(() => expect(fake.current.callsOf('createSticker')).toHaveLength(1));
    expect(fake.current.callsOf('createSticker')[0][0]).toBe('u1');
    expect(fake.current.callsOf('createSticker')[0][1]).toMatchObject({ name: 'Neighbours' });
    expect(await within(chips).findByRole('button', { name: 'Neighbours, 0 people' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New sticker' })).toBeNull();
  });

  it('with no one in My People yet: one message, one action, and no sticker navigation', async () => {
    contactsData.list = [];
    renderHub();
    await screen.findByText('Start with one person');
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: /Contact Hub/ })).toBeNull();
  });
});

describe('the chip row is the same at every width when the sidebar carries no entries', () => {
  it('a wide window with a narrow content area gets the chip row, not the panel', async () => {
    setViewportWidth(1280);
    contentWidth = NARROW;
    renderHub();
    expect(await screen.findByRole('group', { name: 'Filter by sticker' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Contact Hub' })).toBeNull();
    // The title is above the people, as before.
    expect(screen.getByRole('heading', { level: 1, name: 'Contact Hub' })).toBeInTheDocument();
  });

  it('the same window with a wide content area (the compact sidebar) gets the chip row too, not a panel', async () => {
    setViewportWidth(1280);
    contentWidth = WIDE;
    renderHub();
    expect(await screen.findByRole('group', { name: 'Filter by sticker' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Contact Hub/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Contact Hub' })).toBeInTheDocument();
  });

  // 980px is where the inner panel used to open. Nothing changes there now.
  it.each([[979], [980], [1400]])('a content area of %ipx gets the same page: the chip row, and no panel', async (width) => {
    contentWidth = width;
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(await screen.findByRole('group', { name: 'Filter by sticker' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Contact Hub/ })).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('a phone has the chip row and never a panel, whatever is measured', async () => {
    setViewportWidth(390);
    contentWidth = WIDE;
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(await screen.findByRole('group', { name: 'Filter by sticker' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /Contact Hub/ })).toBeNull();
  });

  it('where the width cannot be measured, the page falls back to the chip row', async () => {
    contentWidth = 0;
    renderHub();
    expect(await screen.findByRole('group', { name: 'Filter by sticker' })).toBeInTheDocument();
  });
});

describe('sticker states', () => {
  const failRegistry = () => {
    fake.current.services.subscribeStickers = (_uid, _onNext, onError) => {
      fake.current.state.subscriptions += 1;
      Promise.resolve().then(() => onError(Object.assign(new Error('unavailable'), { code: 'unavailable' })));
      return () => {};
    };
  };

  it.each([
    ['switched off for the user', { enabled: false, mode: 'off', readOnly: false }],
    ['read-only (an admin viewing as the user)', { enabled: true, mode: 'beta', readOnly: true }],
  ])('%s: no panel, no chips, no Stickers column, no sticker control anywhere', async (_label, body) => {
    contentWidth = WIDE;
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    fake.current.state.config = config(body);
    renderHub();
    const table = await screen.findByRole('table', { name: 'My People' });
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Contact Hub' })).toBeNull());
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Email', 'Phone', 'Added']);
    expect(screen.queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);
    expect(names()).toHaveLength(4);
  });

  it('on, with none yet: the way into the Sticker Wall, where New sticker is, and no empty Stickers heading', async () => {
    const user = userEvent.setup();
    contentWidth = WIDE;
    fake.current.state.registry = [];
    renderHub();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['Sticker Wall']);
    expect(screen.queryByRole('heading', { name: 'Stickers' })).toBeNull();
    expect(names()).toHaveLength(4);
    await user.click(within(chips).getByRole('button', { name: 'Sticker Wall' }));
    const wall = await screen.findByTestId('stickers-wall');
    expect(within(wall).getByRole('button', { name: /New sticker/ })).toBeInTheDocument();
  });

  it('the sticker list failed to load, wide: says so, and does not look like an account with no stickers', async () => {
    contentWidth = WIDE;
    failRegistry();
    renderHub();
    expect(await screen.findByText(/Your stickers could not be loaded\. They have not been changed\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toHaveTextContent('(4)');
    // Nothing that reads as "you have no stickers", and nothing that would write.
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(screen.queryByRole('button', { name: /New sticker/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sticker Wall' })).toBeNull();
    expect(screen.queryByText(/No stickers yet/i)).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('the sticker list failed to load, narrow: the same message where the chips would be', async () => {
    contentWidth = NARROW;
    failRegistry();
    renderHub();
    expect(await screen.findByText(/Your stickers could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(names()).toHaveLength(4);
  });

  it('while availability is still being checked: the people, no sticker controls yet, and nothing that looks like an error', async () => {
    contentWidth = WIDE;
    let answer;
    fake.current.services.fetchStickersConfig = () => new Promise((resolve) => { answer = resolve; });
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(names()).toHaveLength(4);
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(screen.queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
    answer(config());
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(within(chips).getByRole('button', { name: 'Sticker Wall' })).toBeInTheDocument();
  });
});

describe('List and Table', () => {
  beforeEach(() => { contentWidth = WIDE; });
  const toggle = () => screen.findByRole('group', { name: 'View' });

  it('List is the default', async () => {
    renderHub();
    const group = await toggle();
    expect(within(group).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('list', { name: 'My People' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('Table shows the same people in the same order, with Name, Email, Phone, Stickers and Added', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    const inList = names();
    await user.click(within(await toggle()).getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'My People' });
    await waitFor(() => expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Email', 'Phone', 'Stickers', 'Added']));
    expect(names()).toEqual(inList);
    expect(within(table).getAllByRole('row')).toHaveLength(inList.length + 1);
    expect(screen.queryByRole('list', { name: 'My People' })).toBeNull();
  });

  it('has no sales columns', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    const table = await screen.findByRole('table', { name: 'My People' });
    // The headers and the cells that are not a person's own name or details.
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent).join(' ');
    expect(headers).not.toMatch(/status|stage|source|pipeline|hunter|engag|mission|credit|enrich|company|title/i);
    // A person in a sales stage is listed like anyone else, with nothing saying so.
    const row = within(table).getByRole('link', { name: 'Hunter Stage' }).closest('[role="row"]');
    expect(row.textContent.replace('Hunter Stage', '')).not.toMatch(/hunter|active_mission|stage/i);
  });

  it('email and phone are real links that say what they do; a missing one is read out as missing', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    const table = await screen.findByRole('table', { name: 'My People' });
    const email = within(table).getByRole('link', { name: 'Email Nakaiya Wiley, nakaiya@x.test' });
    expect(email).toHaveAttribute('href', 'mailto:nakaiya@x.test');
    expect(email).toHaveTextContent('nakaiya@x.test');
    expect(within(table).getByRole('link', { name: /^Call Nakaiya Wiley, / })).toHaveAttribute('href', expect.stringMatching(/^tel:/));
    // Tom Green has neither.
    const tom = within(table).getByRole('link', { name: 'Tom Green' }).closest('[role="row"]');
    expect(within(tom).getByText('No email')).toBeInTheDocument();
    expect(within(tom).getByText('No phone')).toBeInTheDocument();
    // Name, email and phone are never shortened behind a hover tooltip.
    expect(table.querySelectorAll('.hub-td--name [title], .hub-td--wrap [title], .hub-td-link[title]')).toHaveLength(0);
  });

  it('a name opens the person inside Contact Hub', async () => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    const table = await screen.findByRole('table', { name: 'My People' });
    expect(within(table).getByRole('link', { name: 'Wes Clark' })).toHaveAttribute('href', '/contact-hub/person/p2');
  });

  it('search and the sticker filter apply to the table as they do to the list', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    await screen.findByRole('table', { name: 'My People' });
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'wes');
    expect(names()).toEqual(['Wes Clark']);
    await user.clear(screen.getByRole('searchbox', { name: 'Search people' }));
    await user.click(await screen.findByRole('button', { name: 'VIP, 1 person' }));
    expect(names()).toEqual(['Nakaiya Wiley']);
  });

  it('stickers in a table row are the same in-place controls; removing one updates the row and the count', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    const table = await screen.findByRole('table', { name: 'My People' });
    await user.click(await within(table).findByRole('button', { name: 'Remove sticker VIP' }));
    await waitFor(() => expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'p1', VIP.id]]));
    await screen.findByRole('button', { name: 'VIP, 0 people' });
  });

  it('the choice is remembered in this browser, and nothing is saved to the account', async () => {
    const user = userEvent.setup();
    const first = renderHub();
    await user.click(within(await toggle()).getByRole('button', { name: 'Table' }));
    expect(window.localStorage.getItem(VIEW_STORAGE_KEY)).toBe('table');
    first.unmount();
    renderHub();
    expect(await screen.findByRole('table', { name: 'My People' })).toBeInTheDocument();
    expect(contactsData.paths.every((path) => path === 'users/u1/contacts')).toBe(true);
  });

  it('still switches when browser storage is blocked', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    await user.click(within(await toggle()).getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table', { name: 'My People' })).toBeInTheDocument();
  });

  it('a phone has the list and no choice, even if Table was chosen on a desktop', async () => {
    setViewportWidth(390);
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    expect(await screen.findByRole('list', { name: 'My People' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('a content area too narrow for the columns gets the list and no choice', async () => {
    contentWidth = TABLE_MIN_WIDTH - 1;
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    expect(await screen.findByRole('list', { name: 'My People' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });

  it('a tight content area keeps Name, Email, Phone and Stickers and leaves out Added', async () => {
    contentWidth = TABLE_FULL_WIDTH - 1;
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    const table = await screen.findByRole('table', { name: 'My People' });
    await waitFor(() => expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Email', 'Phone', 'Stickers']));
  });

  it('the choice is not offered on the Sticker Wall', async () => {
    const user = userEvent.setup();
    renderHub();
    const chips = await screen.findByRole('group', { name: 'Filter by sticker' });
    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
    await user.click(within(chips).getByRole('button', { name: 'Sticker Wall' }));
    await screen.findByTestId('stickers-wall');
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });
});

describe('Show more is display paging only', () => {
  beforeEach(() => { contentWidth = WIDE; contactsData.list = many(120); });

  it('draws the first 50 and says how many there are', async () => {
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(names()).toHaveLength(PAGE_SIZE);
    expect(screen.getByText('Showing 50 of 120 people')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 50 more' })).toBeInTheDocument();
  });

  it('each press draws 50 more, the last press draws the rest, and the control goes away', async () => {
    const user = userEvent.setup();
    renderHub();
    const more = await pagingControl('Showing 50 of 120 people');
    await user.click(within(more).getByRole('button', { name: 'Show 50 more' }));
    expect(names()).toHaveLength(100);
    expect(within(more).getByRole('status')).toHaveTextContent('Showing 100 of 120 people');
    await user.click(within(more).getByRole('button', { name: 'Show 20 more' }));
    expect(names()).toHaveLength(120);
    // The whole control is gone, and no button anywhere on the page offers more.
    expect(more).not.toBeInTheDocument();
    const offersMore = [...document.querySelectorAll('button')].filter((b) => /^Show \d+ more$/.test(b.textContent.trim()));
    expect(offersMore).toHaveLength(0);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });

  it('everyone was loaded once, up front: showing more reads nothing', async () => {
    const user = userEvent.setup();
    renderHub();
    const more = await pagingControl('Showing 50 of 120 people');
    await user.click(within(more).getByRole('button', { name: 'Show 50 more' }));
    await user.click(within(more).getByRole('button', { name: 'Show 20 more' }));
    expect(names()).toHaveLength(120);
    expect(contactsData.loads).toBe(1);
    expect(contactsData.paths).toEqual(['users/u1/contacts']);
  });

  it('search finds someone who has not been drawn yet', async () => {
    const user = userEvent.setup();
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(names()).not.toContain('Person 117');
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'Person 117');
    expect(names()).toEqual(['Person 117']);
    expect(contactsData.loads).toBe(1);
  });

  // The same count in the application sidebar: contactHubSidebarNav.test.jsx.
  it('the count beside My People is everyone, not the number drawn', async () => {
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(names()).toHaveLength(PAGE_SIZE);
    expect(screen.getByRole('heading', { level: 2, name: /My People/ })).toHaveTextContent('(120)');
  });

  it('a new search starts from the first page again', async () => {
    const user = userEvent.setup();
    renderHub();
    await user.click(await screen.findByRole('button', { name: 'Show 50 more' }));
    expect(names()).toHaveLength(100);
    await user.type(screen.getByRole('searchbox', { name: 'Search people' }), 'Person');
    expect(names()).toHaveLength(PAGE_SIZE);
    // And clearing it does not bring back the 100 that had been drawn.
    await user.clear(screen.getByRole('searchbox', { name: 'Search people' }));
    expect(names()).toHaveLength(PAGE_SIZE);
  });

  it('pages the table the same way', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(VIEW_STORAGE_KEY, 'table');
    renderHub();
    const table = await screen.findByRole('table', { name: 'My People' });
    expect(within(table).getAllByRole('row')).toHaveLength(PAGE_SIZE + 1);
    await user.click(screen.getByRole('button', { name: 'Show 50 more' }));
    expect(within(table).getAllByRole('row')).toHaveLength(101);
  });

  it('a short list has no paging control at all', async () => {
    contactsData.list = many(8);
    renderHub();
    await screen.findByRole('list', { name: 'My People' });
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });
});
