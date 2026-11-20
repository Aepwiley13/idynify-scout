/* global process *//**
 * My Card in Contact Hub's navigation (Commit 5).
 *
 * The real application Sidebar, the real ContactHubMain and the real My Card
 * page, with the switch on. Only Firebase, the card service, the sticker
 * services and the shell's own state are stand-ins. What is proved here:
 * My Card is the first entry and the lit one on its own address; opening it
 * loads none of the user's people; going to My People and back keeps a draft
 * that was not saved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeStickers, config } from './helpers/stickersUi';

const people = vi.hoisted(() => ({ loads: 0 }));
const fake = vi.hoisted(() => ({ current: null }));
const mocks = vi.hoisted(() => {
  const auth = { currentUser: { uid: 'u1' } };
  auth.onAuthStateChanged = (callback) => { callback(auth.currentUser); return () => {}; };
  return { auth, service: {} };
});

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  collection: vi.fn((_db, ...path) => path.join('/')),
  getDocs: vi.fn(async () => {
    people.loads += 1;
    return { docs: [{ id: 'p1', data: () => ({ id: 'p1', name: 'Nakaiya Wiley', addedAt: '2026-11-12T12:00:00Z' }) }] };
  }),
}));
vi.mock('../constants/contactHub', async (importOriginal) => ({
  ...(await importOriginal()),
  CONTACT_HUB: Object.freeze({ enabled: true }),
}));
vi.mock('../context/ShellContext', () => ({
  useShell: () => ({ openBarry() {}, sidebarMode: 'wide', toggleSidebar() {}, isFirstExperience: false }),
  useShellEntity: () => {},
}));
vi.mock('../firebase/config', () => ({ db: {}, auth: mocks.auth }));
vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'u1',
  getEffectiveUser: () => ({ uid: 'u1' }),
  useImpersonation: () => ({ isImpersonating: false, isReadOnly: false }),
}));
vi.mock('../services/myCardService', () => ({ myCardService: mocks.service }));
vi.mock('../theme/ThemeContext', () => ({ useT: () => new Proxy({}, { get: () => '#888' }) }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
  updateSticker: (...a) => fake.current.services.updateSticker(...a),
  archiveSticker: (...a) => fake.current.services.archiveSticker(...a),
  restoreSticker: (...a) => fake.current.services.restoreSticker(...a),
}));

import ContactHubMain from '../pages/ContactHub/ContactHubMain';
import MyCardPage from '../pages/ContactHub/MyCardPage';
import Sidebar from '../components/layout/Sidebar';
import { bottomNavFor } from '../constants/mobileNavigation';
import { newCard, normalizeCard } from '../utils/myCardRules';

vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 5000 });

function Where() {
  const location = useLocation();
  return <span data-testid="at">{location.pathname}{location.search}</span>;
}

function renderApp(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Sidebar user={{ email: 'aaron@example.test' }} onLogout={() => {}} />
      <main>
        <Routes>
          <Route path="/contact-hub/my-card" element={<MyCardPage />} />
          <Route path="/contact-hub" element={<ContactHubMain />}>
            <Route index element={<div data-testid="people-page" />} />
            <Route path="stickers" element={<div data-testid="wall-page" />} />
          </Route>
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </main>
    </MemoryRouter>,
  );
}

const globalNav = () => screen.getByRole('navigation', { name: 'Global navigation' });
const hubNav = () => within(screen.getByRole('navigation', { name: 'Global navigation' })).findByRole('navigation', { name: 'Contact Hub sections' });
const entries = (nav) => within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent.replace(/\d+$/, ''));
const lit = (nav) => within(nav).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.textContent.replace(/\d+$/, ''));

beforeEach(() => {
  fake.current = createFakeStickers();
  people.loads = 0;
  globalThis.sessionStorage.clear();
  mocks.auth.currentUser = { uid: 'u1' };
  const card = { ...newCard(), firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst' };
  mocks.service.loadMyCard = vi.fn(async () => ({ status: 'ok', card, revision: 3 }));
  mocks.service.loadCardSuggestions = vi.fn(async () => ({ suggestions: {}, unavailable: [] }));
  mocks.service.saveMyCard = vi.fn(async (value, { expectedRevision }) => ({
    status: 'saved', card: { ...normalizeCard(value).card, sharingEnabled: false }, revision: expectedRevision + 1,
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); globalThis.sessionStorage.clear(); });

describe('My Card in the sidebar', () => {
  it('on My Card: My Card first and lit, then My People (not lit), then the Sticker Wall', async () => {
    renderApp('/contact-hub/my-card');
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'Sticker Wall' });
    expect(entries(nav)).toEqual(['My Card', 'My People', 'Sticker Wall']);
    expect(lit(nav)).toEqual(['My Card']);
    expect(within(nav).getByRole('button', { name: 'My People' })).not.toHaveAttribute('aria-current');
    await screen.findByRole('form', { name: 'Edit your card' });
  });

  it('opening My Card does not load the user\'s people or the sticker registry: no count, no sticker filters, no New sticker', async () => {
    renderApp('/contact-hub/my-card');
    const nav = await hubNav();
    await screen.findByRole('form', { name: 'Edit your card' });
    await within(nav).findByRole('button', { name: 'Sticker Wall' });
    expect(people.loads).toBe(0);
    // The Sticker Wall needs only the server's answer: nothing is subscribed, and nothing of the people is read.
    expect(fake.current.state.subscriptions).toBe(0);
    expect(within(nav).queryByLabelText(/\bpeople?\b/)).toBeNull();
    expect(within(nav).queryByRole('list', { name: 'Filter by sticker' })).toBeNull();
    expect(within(nav).queryByRole('button', { name: 'New sticker' })).toBeNull();
  });

  it('on My People: My Card is first and not lit, and My People is lit', async () => {
    renderApp('/contact-hub');
    const nav = await hubNav();
    await waitFor(() => expect(within(nav).getByLabelText('1 person')).toBeInTheDocument());
    expect(entries(nav)[0]).toBe('My Card');
    expect(lit(nav)).toEqual(['My People']);
  });

  it('goes from My People to My Card and back, moving the light, and loads the people only for My People', async () => {
    const user = userEvent.setup();
    renderApp('/contact-hub');
    let nav = await hubNav();
    await waitFor(() => expect(people.loads).toBe(1));

    await user.click(within(nav).getByRole('button', { name: 'My Card' }));
    expect(screen.getByTestId('at')).toHaveTextContent('/contact-hub/my-card');
    await screen.findByRole('form', { name: 'Edit your card' });
    nav = await hubNav();
    expect(lit(nav)).toEqual(['My Card']);
    expect(people.loads).toBe(1);

    await user.click(within(nav).getByRole('button', { name: 'My People' }));
    expect(screen.getByTestId('at').textContent).toBe('/contact-hub');
    await screen.findByTestId('people-page');
    nav = await hubNav();
    expect(lit(nav)).toEqual(['My People']);
  });

  it('keeps a draft that was not saved when going to My People and back, and says it restored it', async () => {
    const user = userEvent.setup();
    renderApp('/contact-hub/my-card');
    let nav = await hubNav();
    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Director of Mathematics');
    expect(mocks.service.saveMyCard).not.toHaveBeenCalled();

    await user.click(within(nav).getByRole('button', { name: 'My People' }));
    await screen.findByTestId('people-page');
    nav = await hubNav();
    await user.click(within(nav).getByRole('button', { name: 'My Card' }));

    expect(await screen.findByText('We restored the changes you hadn\'t saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Director of Mathematics');
    expect(mocks.service.saveMyCard).not.toHaveBeenCalled();
  });

  it('leaves the other modules\' entries and the Contact Hub item as they were', async () => {
    renderApp('/contact-hub/my-card');
    await hubNav();
    const global = screen.getByRole('navigation', { name: 'Global navigation' });
    expect(within(global).getByRole('button', { name: 'Contact Hub' })).toBeInTheDocument();
    expect(document.querySelectorAll('.sidebar-subnav')).toHaveLength(1);
  });
});

describe('the Sticker Wall in the sidebar, from My Card', () => {
  const answers = {
    disabled: config({ enabled: false, mode: 'off', readOnly: false }),
    'not enrolled': config({ enabled: false, mode: 'beta', readOnly: false }),
    'read-only (an admin viewing as the user)': config({ enabled: true, mode: 'beta', readOnly: true }),
    'an error from the server': { status: 500, body: null },
    'an answer that is not understood': { status: 200, body: { enabled: 'yes' } },
  };

  it('enabled: it is offered, and it goes to the wall', async () => {
    const user = userEvent.setup();
    renderApp('/contact-hub/my-card');
    const nav = await hubNav();
    await user.click(await within(nav).findByRole('button', { name: 'Sticker Wall' }));
    expect(await screen.findByTestId('wall-page')).toBeInTheDocument();
    expect(screen.getByTestId('at')).toHaveTextContent('/contact-hub/stickers');
  });

  it('enabled: it is the same three destinations, in the same order, as My People\'s sidebar and the phone', async () => {
    renderApp('/contact-hub/my-card');
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'Sticker Wall' });
    expect(entries(nav)).toEqual(['My Card', 'My People', 'Sticker Wall']);
    expect(bottomNavFor('contact-hub').primary.map((cell) => cell.label)).toEqual(entries(nav));
  });

  it.each(Object.entries(answers))('%s: no Sticker Wall, and nothing is subscribed or loaded', async (_label, answer) => {
    fake.current.state.config = answer;
    renderApp('/contact-hub/my-card');
    const nav = await hubNav();
    await screen.findByRole('form', { name: 'Edit your card' });
    await waitFor(() => expect(fake.current.state.configFetches).toBeGreaterThan(0));
    expect(entries(nav)).toEqual(['My Card', 'My People']);
    expect(within(globalNav()).queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);
    expect(people.loads).toBe(0);
  });

  it('still checking: no Sticker Wall until the server has answered, then it appears; the card is not held up', async () => {
    let answer;
    fake.current.services.fetchStickersConfig = () => new Promise((resolve) => { answer = resolve; });
    renderApp('/contact-hub/my-card');
    const nav = await hubNav();
    await screen.findByRole('form', { name: 'Edit your card' });
    expect(entries(nav)).toEqual(['My Card', 'My People']);
    answer(config());
    expect(await within(nav).findByRole('button', { name: 'Sticker Wall' })).toBeInTheDocument();
  });

  it('is asked once for the page, not once for each thing that redraws', async () => {
    renderApp('/contact-hub/my-card');
    const nav = await hubNav();
    await within(nav).findByRole('button', { name: 'Sticker Wall' });
    await userEvent.type(await screen.findByLabelText('Title'), ' lead');
    expect(fake.current.state.configFetches).toBe(1);
  });
});

describe('what keeps the sidebar entries looking right', () => {
  it('HubSidebarNav brings its own stylesheet: it is also drawn by a page that is not inside ContactHubMain', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/ContactHub/HubSidebarNav.jsx'), 'utf8');
    expect(source).toMatch(/^import '\.\/ContactHub\.css';$/m);
  });
});
