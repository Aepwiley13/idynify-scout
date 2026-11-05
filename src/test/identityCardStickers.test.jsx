/**
 * S5 placement: in the real IdentityCard, the Stickers row sits directly
 * above the Tags section when stickers are available, and nothing at all is
 * added when they are not. The Tags section itself is unchanged (U6).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';

const fake = vi.hoisted(() => ({ current: null }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal()),
  doc: (_db, ...path) => ({ path: path.join('/') }),
  updateDoc: async () => {},
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('../services/peopleService', () => ({ getUniqueTags: async () => [] }));
vi.mock('../components/scout/CompanyDetailModal', () => ({ default: () => null }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
}));

import IdentityCard from '../components/contacts/IdentityCard';
import { StickersProvider } from '../components/stickers/StickersContext';

const BOARD = sticker('Board');
const contact = { id: 'c1', name: 'Avery Quinn', tags: ['gala-2024'], sticker_ids: [BOARD.id] };

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [BOARD];
});

describe('IdentityCard with stickers', () => {
  it('available: the Stickers row is the element right before the Tags section', async () => {
    const { container } = render(<StickersProvider uid="u1"><IdentityCard contact={contact} onUpdate={() => {}} /></StickersProvider>);
    const row = await screen.findByTestId('contact-stickers');
    expect(row.nextElementSibling).toHaveClass('idc-tags-section');
    expect(screen.getByText('Board').closest('.stk-chip')).not.toBeNull();
    // The tag keeps its own pill and remove button.
    expect(container.querySelector('.idc-tag-pill')).toHaveTextContent('gala-2024');
    expect(screen.getByTitle('Remove tag "gala-2024"')).toBeInTheDocument();
  });

  it('unavailable: nothing is added before the Tags section', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    const { container } = render(<StickersProvider uid="u1"><IdentityCard contact={contact} onUpdate={() => {}} /></StickersProvider>);
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    await act(async () => {});
    expect(screen.queryByTestId('contact-stickers')).toBeNull();
    expect(screen.queryByText('Board')).toBeNull();
    const tags = container.querySelector('.idc-tags-section');
    expect(tags.previousElementSibling).not.toHaveAttribute('data-testid', 'contact-stickers');
  });

  it('without a provider (every other place IdentityCard could render): nothing, and no server call', async () => {
    render(<IdentityCard contact={contact} onUpdate={() => {}} />);
    await act(async () => {});
    expect(screen.queryByTestId('contact-stickers')).toBeNull();
    expect(fake.current.state.configFetches).toBe(0);
  });
});
