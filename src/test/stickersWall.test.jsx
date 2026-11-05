/**
 * S7 — the Stickers view (UI spec §3.2, AT-7-02 … AT-7-09), on its own:
 * tiles and counts, edit, archive with confirm, restore, create, errors,
 * keyboard and dialog focus. Services are fakes (helpers/stickersUi.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker, stickerError, config } from './helpers/stickersUi';

const fake = vi.hoisted(() => ({ current: null }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
  updateSticker: (...a) => fake.current.services.updateSticker(...a),
  archiveSticker: (...a) => fake.current.services.archiveSticker(...a),
  restoreSticker: (...a) => fake.current.services.restoreSticker(...a),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));

import { StickersProvider } from '../components/stickers/StickersContext';
import StickersWall from '../components/stickers/StickersWall';
import { validateStickerValues } from '../components/stickers/stickerForm';

const BOARD = sticker('Board', { color: 'blue', emoji: '🏛️', description: 'Board members' });
const DONOR = sticker('Donor', { color: 'amber' });
const GALA = sticker('Gala', { color: 'green' });
const OLD = sticker('Old list', { status: 'archived' });
const contacts = [
  { id: 'a', sticker_ids: [BOARD.id, DONOR.id] },
  { id: 'b', sticker_ids: [BOARD.id, OLD.id] },
  { id: 'c', sticker_ids: [BOARD.id] },
];

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [DONOR, BOARD, GALA, OLD];
  // Archive and restore change the registry, as onSnapshot would report.
  fake.current.state.impl.archive = async (_uid, id) => fake.current.publish(fake.current.state.registry.map((s) => (s.id === id ? { ...s, status: 'archived' } : s)));
  fake.current.state.impl.restore = async (_uid, id) => fake.current.publish(fake.current.state.registry.map((s) => (s.id === id ? { ...s, status: 'active' } : s)));
  fake.current.state.impl.update = async (_uid, id, changes) => fake.current.publish(fake.current.state.registry.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function renderWall({ onOpen = vi.fn(), list = contacts } = {}) {
  const user = userEvent.setup();
  render(<StickersProvider uid="u1"><StickersWall contacts={list} onOpenSticker={onOpen} /></StickersProvider>);
  await screen.findByTestId('stickers-wall');
  return { user, onOpen };
}
const tileNames = () => within(screen.getByRole('list', { name: 'Stickers' })).getAllByRole('listitem').map((li) => li.querySelector('.stk-tile-name').textContent);

describe('S7 Stickers view', () => {
  it('AT-7-02: one tile per active sticker, in name order, each with its count', async () => {
    await renderWall();
    expect(tileNames()).toEqual(['Board', 'Donor', 'Gala']);
    expect(screen.getByRole('button', { name: 'Board, 3 people' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Donor, 1 person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gala, 0 people' })).toBeInTheDocument();
    expect(screen.getByText('Board members')).toBeInTheDocument();
  });

  it('AT-7-03: a tile opens People filtered by that sticker', async () => {
    const { user, onOpen } = await renderWall();
    await user.click(screen.getByRole('button', { name: 'Board, 3 people' }));
    expect(onOpen).toHaveBeenCalledWith(BOARD.id);
  });

  it('AT-7-04: an empty or 61-character name is refused in the dialog; nothing is sent', async () => {
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: 'Gala options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit “Gala”' });
    const name = within(dialog).getByLabelText('Name');
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('A sticker name needs 1–60 characters.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    await user.type(name, 'x'.repeat(61));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('A sticker name needs 1–60 characters.');
    expect(fake.current.callsOf('updateSticker')).toEqual([]);
  });

  it('AT-7-05: changing only the color sends only the color; the tile updates from the registry', async () => {
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: 'Gala options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Pink' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.current.callsOf('updateSticker')).toEqual([['u1', GALA.id, { color: 'pink' }]]);
    expect(screen.getByRole('button', { name: 'Gala options' })).toHaveFocus();
  });

  it('AT-7-06: Archive asks first, then archives; the tile moves to Archived', async () => {
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: 'Board options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Archive Board?' });
    expect(confirm).toHaveTextContent('It disappears from pickers and filters. 3 people keep it, and it comes back if you restore it.');
    expect(fake.current.callsOf('archiveSticker')).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(tileNames()).toEqual(['Donor', 'Gala']));
    expect(fake.current.callsOf('archiveSticker')).toEqual([['u1', BOARD.id]]);
    expect(screen.getByRole('button', { name: 'Archived (2)' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Archived Board');
  });

  it('AT-7-06: Cancel archives nothing', async () => {
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: 'Board options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(fake.current.callsOf('archiveSticker')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Board options' })).toHaveFocus();
  });

  it('AT-7-07: Restore brings it back with no membership write', async () => {
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));
    await user.click(screen.getByRole('button', { name: 'Restore Old list' }));
    await waitFor(() => expect(tileNames()).toEqual(['Board', 'Donor', 'Gala', 'Old list']));
    expect(fake.current.callsOf('restoreSticker')).toEqual([['u1', OLD.id]]);
    expect(fake.current.callsOf('addSticker')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Old list, 1 person' })).toBeInTheDocument();
  });

  it('AT-7-08: a write_denied refusal says so and re-checks availability', async () => {
    fake.current.state.impl.archive = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user } = await renderWall();
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    await user.click(screen.getByRole('button', { name: 'Board options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(fake.current.state.configFetches).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('stickers-wall')).toBeNull());
  });

  it('AT-7-08: an edit refused by the service shows the message in the dialog and keeps it open', async () => {
    fake.current.state.impl.update = async () => { throw stickerError('write_failed'); };
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: 'Gala options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), ' night');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't save. Try again.");
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('AT-7-09: no stickers yet shows the empty state with New sticker', async () => {
    fake.current.state.registry = [];
    await renderWall();
    expect(screen.getByText('No stickers yet. Create one to start grouping people.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New sticker/ })).toBeInTheDocument();
  });

  it('New sticker creates with the chosen values; a repeated name is allowed but called out', async () => {
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: /New sticker/ }));
    const dialog = screen.getByRole('dialog', { name: 'New sticker' });
    await user.type(within(dialog).getByLabelText('Name'), 'board');
    expect(within(dialog).getByText(/Another sticker is already called “Board”/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Coral' }));
    await user.type(within(dialog).getByLabelText(/Emoji/), '🎤');
    await user.type(within(dialog).getByLabelText(/Description/), '  Speakers bureau  ');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.current.callsOf('createSticker')).toEqual([['u1', { name: 'board', color: 'coral', emoji: '🎤', description: 'Speakers bureau' }]]);
    expect(screen.getByRole('button', { name: /New sticker/ })).toHaveFocus();
  });

  it('keyboard: the tile menu opens on its button, arrows move, Escape returns focus', async () => {
    const { user } = await renderWall();
    screen.getByRole('button', { name: 'Donor options' }).focus();
    await user.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'Donor options' });
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: 'Donor options' })).toHaveFocus();
  });

  it('the dialog keeps focus inside it and Escape closes it', async () => {
    const { user } = await renderWall();
    await user.click(screen.getByRole('button', { name: /New sticker/ }));
    const dialog = screen.getByRole('dialog');
    const create = within(dialog).getByRole('button', { name: 'Create' });
    create.focus();
    await user.keyboard('{Tab}');
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(create).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nothing renders while stickers are unavailable', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    render(<StickersProvider uid="u1"><StickersWall contacts={contacts} onOpenSticker={() => {}} /></StickersProvider>);
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    await act(async () => {});
    expect(screen.queryByTestId('stickers-wall')).toBeNull();
  });
});

describe('sticker form checks match the service', () => {
  it.each([
    [{ name: '' }, 'invalid_name'],
    [{ name: '   ' }, 'invalid_name'],
    [{ name: 'x'.repeat(61) }, 'invalid_name'],
    [{ name: '  ' + 'x'.repeat(60) + '  ' }, null],
    [{ name: 'Ok', emoji: '12345678901234567' }, 'invalid_emoji'],
    [{ name: 'Ok', emoji: ' 🎤 ' }, null],
    [{ name: 'Ok', description: 'x'.repeat(281) }, 'invalid_description'],
    [{ name: 'Ok', description: ' ' + 'x'.repeat(280) + ' ' }, null],
  ])('%o → %s', (values, code) => {
    expect(validateStickerValues(values)?.code ?? null).toBe(code);
  });
});
