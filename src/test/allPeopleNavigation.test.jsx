/**
 * Regression test: All People button navigation and filter clearing
 *
 * User scenario:
 * 1. Open VIP sticker from Stickers wall
 * 2. View contacts assigned to VIP (filtered view)
 * 3. Click "All People" button
 * 4. Verify all 24 staging contacts become visible in Cards or List view
 * 5. Switch to List and back to Cards successfully
 * 6. Verify sticker filter is cleared and not persisted
 */

import { render, screen, waitFor, configure } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';

const contactsData = vi.hoisted(() => ({ list: [] }));
const fake = vi.hoisted(() => ({ current: null }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...path) => path.join('/')),
  getDocs: vi.fn(async (path) => ({
    docs: String(path).endsWith('/contacts') ? contactsData.list.map((d) => ({ id: d.id, data: () => d })) : [],
  })),
  doc: vi.fn(() => ({})),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(() => Promise.resolve()),
  deleteField: vi.fn(() => 'DELETE_FIELD_SENTINEL'),
  runTransaction: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => vi.fn()),
  arrayUnion: vi.fn((...v) => v),
  arrayRemove: vi.fn((...v) => v),
  addDoc: vi.fn(async () => ({ id: 'x' })),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDoc: vi.fn(() => Promise.resolve({ exists: false })),
  setDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('../firebase/config', () => ({
  db: {},
  auth: {
    currentUser: { uid: 'test-user-123' },
    onAuthStateChanged: (cb) => {
      cb({ uid: 'test-user-123' });
      return () => {};
    },
  },
}));

vi.mock('../context/ImpersonationContext', () => ({
  useActiveUserId: () => 'test-user-123',
  useActiveUser: () => ({ uid: 'test-user-123' }),
  useImpersonation: () => ({ isImpersonating: false, isReadOnly: false }),
  getEffectiveUser: () => ({ uid: 'test-user-123' }),
}));

vi.mock('../theme/ThemeContext', () => ({
  useT: () => new Proxy({}, { get: () => '#888' }),
  useThemeCtx: () => ({ themeId: 'light' }),
}));

vi.mock('../hooks/useSubscription', () => ({
  useSubscription: () => ({ isProTier: true, loading: false }),
}));

vi.mock('../pages/Scout/ContactProfile', () => ({ default: () => null }));
vi.mock('../components/scout/LinkedInLinkSearch', () => ({ default: () => null }));
vi.mock('../components/firstTouch/FirstTouchModal', () => ({ default: () => null }));
vi.mock('../components/scout/BulkComposeModal', () => ({ default: () => null }));
vi.mock('../services/peopleService', () => ({ archivePerson: vi.fn() }));
vi.mock('../services/sniperWriteGuard', () => ({ createSniperRecord: vi.fn() }));
vi.mock('../utils/loadIntoHunter', () => ({ loadIntoHunter: vi.fn() }));

vi.mock('../components/stickers/stickersApi.js', () => ({
  fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a),
}));

vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
  updateSticker: (...a) => fake.current.services.updateSticker(...a),
  archiveSticker: (...a) => fake.current.services.archiveSticker(...a),
  restoreSticker: (...a) => fake.current.services.restoreSticker(...a),
}));

vi.mock('../services/contactStickers', async () => {
  const { storedStickerIds, withMembershipChange, STICKER_LIMIT } = await vi.importActual('../services/stickers/stickerCore');
  return {
    addSticker: (...a) => fake.current.services.addSticker(...a),
    removeSticker: (...a) => fake.current.services.removeSticker(...a),
    addStickerToContacts: (...a) => fake.current.services.addStickerToContacts(...a),
    storedStickerIds,
    withMembershipChange,
    STICKER_LIMIT,
  };
});

import AllLeads from '../pages/Scout/AllLeads';

configure({ asyncUtilTimeout: 5000 });

describe('All People Navigation', () => {
  const VIP = sticker('VIP', { color: 'pink' });
  const PARTNER = sticker('Partner', { color: 'blue' });

  const person = (id, name, stickerIds = []) => ({
    id,
    name,
    email: `${id}@example.com`,
    company_name: `Company ${id}`,
    title: 'Sales Manager',
    sticker_ids: stickerIds,
    tags: [],
    is_archived: false,
    saved_at: new Date(Date.now() - parseInt(id.replace(/\D/g, '')) * 86400000).toISOString(),
  });

  beforeEach(() => {
    fake.current = createFakeStickers();
    fake.current.state.registry = [VIP, PARTNER];
    fake.current.state.config = config();

    // Create 24 contacts: first 3 have VIP sticker
    contactsData.list = Array.from({ length: 24 }, (_, i) =>
      person(`contact-${i}`, `Contact ${i}`, i < 3 ? [VIP.id] : [])
    );

    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  function renderPeople(url = '/command-center?tab=people') {
    window.history.replaceState(null, '', url);
    return render(
      <MemoryRouter>
        <AllLeads mode="people" />
      </MemoryRouter>
    );
  }

  it('clears sticker filter and returns to Cards view when clicking All People', async () => {
    const user = userEvent.setup();
    const { container } = renderPeople('/command-center?tab=people&sticker=' + VIP.id);

    // Wait for page to load by checking contact appears
    await screen.findByText('Contact 0');

    // Verify sticker configuration was fetched and subscription established
    await waitFor(() => {
      expect(fake.current.state.configFetches).toBeGreaterThanOrEqual(1);
      expect(fake.current.state.subscriptions).toBeGreaterThanOrEqual(1);
    });

    // Wait for stickers to be ready by checking Stickers button appears
    await screen.findByRole('button', { name: /◈ Stickers/ });

    // Wait for filtered contacts to load (3 VIP contacts)
    await waitFor(() => {
      const cards = container.querySelectorAll('[data-testid="card-stickers-interactive"]');
      expect(cards.length).toBe(3);
    });

    // Verify URL has sticker parameter
    expect(window.location.search).toContain(`sticker=${VIP.id}`);

    // Find All People button (required - test fails if missing)
    const allPeopleButton = await screen.findByTitle(/all people/i);

    // Click All People
    await user.click(allPeopleButton);

    // Verify URL sticker parameter is cleared
    await waitFor(() => {
      expect(window.location.search).not.toContain('sticker=');
    });

    // Verify all 24 contacts are now visible
    await waitFor(() => {
      const allCards = container.querySelectorAll('[data-testid="card-stickers-interactive"]');
      expect(allCards.length).toBe(24);
    });
  });

  it('exits Stickers wall view and returns to last used list view', async () => {
    const user = userEvent.setup();
    renderPeople();

    // Wait for page to load
    await screen.findByText('Contact 0');

    // Switch to Stickers view - wait for button to appear (confirms stickers ready)
    const stickersButton = await screen.findByRole('button', { name: /◈ Stickers/ });
    await user.click(stickersButton);

    // Verify Stickers wall is visible
    await screen.findByTestId('stickers-wall');

    // Click All People to exit Stickers wall
    const allPeopleButton = screen.getByTitle(/all people/i);
    await user.click(allPeopleButton);

    // Verify returned to Cards view
    await waitFor(() => {
      const cardsButton = screen.getByRole('button', { name: /Cards/ });
      expect(cardsButton).toHaveAttribute('aria-pressed', 'true');
    });

    // Verify Stickers wall is gone
    expect(screen.queryByTestId('stickers-wall')).toBeNull();
  });

  it('shows badge count when filters are active', async () => {
    renderPeople('/command-center?tab=people&sticker=' + VIP.id);

    // Wait for page to load
    await screen.findByText('Contact 0');

    // Wait for stickers to be ready
    await screen.findByRole('button', { name: /◈ Stickers/ });

    // Wait for filtered view
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="card-stickers-interactive"]').length).toBe(3);
    });

    // All People button must show badge with count "1" (required)
    const allPeopleButton = await screen.findByTitle(/all people/i);
    const badge = allPeopleButton.querySelector('span');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('1');
  });

  it('allows switching between List and Cards after clearing filters', async () => {
    const user = userEvent.setup();
    const { container } = renderPeople('/command-center?tab=people&sticker=' + VIP.id);

    // Wait for page to load
    await screen.findByText('Contact 0');

    // Wait for stickers to be ready
    await screen.findByRole('button', { name: /◈ Stickers/ });

    // Wait for filtered view (3 contacts)
    await waitFor(() => {
      expect(container.querySelectorAll('[data-testid="card-stickers-interactive"]').length).toBe(3);
    });

    // Clear filter by clicking All People
    const allPeopleButton = await screen.findByTitle(/all people/i);
    await user.click(allPeopleButton);

    // Wait for all contacts to appear
    await waitFor(() => {
      expect(container.querySelectorAll('[data-testid="card-stickers-interactive"]').length).toBe(24);
    });

    // Switch to List view
    const listButton = await screen.findByRole('button', { name: /List/ });
    await user.click(listButton);

    await waitFor(() => {
      expect(listButton).toHaveAttribute('aria-pressed', 'true');
    });

    // Switch back to Cards
    const cardsButton = await screen.findByRole('button', { name: /Cards/ });
    await user.click(cardsButton);

    await waitFor(() => {
      expect(cardsButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('preserves existing contacts and sticker assignments', async () => {
    const user = userEvent.setup();
    const { container } = renderPeople('/command-center?tab=people&sticker=' + VIP.id);

    // Wait for page to load
    await screen.findByText('Contact 0');

    // Wait for stickers to be ready
    await screen.findByRole('button', { name: /◈ Stickers/ });

    // Wait for filtered view (3 VIP contacts visible)
    await waitFor(() => {
      expect(container.querySelectorAll('[data-testid="card-stickers-interactive"]').length).toBe(3);
    });

    // Click All People
    const allPeopleButton = screen.getByTitle(/all people/i);
    await user.click(allPeopleButton);

    // Wait for all 24 contacts to be visible
    await waitFor(() => {
      expect(container.querySelectorAll('[data-testid="card-stickers-interactive"]').length).toBe(24);
    });

    // Verify mock data wasn't mutated
    expect(contactsData.list[0].sticker_ids).toContain(VIP.id);
    expect(contactsData.list[1].sticker_ids).toContain(VIP.id);
    expect(contactsData.list[2].sticker_ids).toContain(VIP.id);
    expect(contactsData.list[3].sticker_ids).toEqual([]);

    // Verify first 3 contacts still render their VIP sticker chips
    const allCards = container.querySelectorAll('[data-testid="card-stickers-interactive"]');
    const firstThreeCards = Array.from(allCards).slice(0, 3);
    firstThreeCards.forEach((card) => {
      expect(card.textContent).toContain('VIP');
    });
  });
});
