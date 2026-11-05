/**
 * S5 — the Contact Profile Stickers row (UI spec §1.3, AT-5-01 … AT-5-15).
 *
 * The real StickersProvider, row, picker, chip and toast; the services and
 * the stickersConfig call are fakes (helpers/stickersUi.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor, act, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker, sid, config, stickerError } from './helpers/stickersUi';

const fake = vi.hoisted(() => ({ current: null }));
const viewer = vi.hoisted(() => ({ value: { uid: 'u1' } }));

vi.mock('../components/stickers/stickersApi.js', () => ({
  fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a),
}));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => viewer.value,
  useImpersonation: () => ({ isImpersonating: Boolean(viewer.value?._isImpersonated) }),
}));

import { StickersProvider } from '../components/stickers/StickersContext';
import ContactStickersRow from '../components/stickers/ContactStickersRow';

// The row waits on a config answer and a registry snapshot; give slow CI
// machines room rather than racing the 1s default.
configure({ asyncUtilTimeout: 5000 });

const BOARD = sticker('Board', { color: 'blue' });
const DONOR = sticker('Donor', { color: 'amber' });
const GALA = sticker('Gala');

/** The row as ContactProfile hosts it: updates flow back into the contact. */
function Host({ initial, onChange }) {
  const [contact, setContact] = useState(initial);
  return (
    <StickersProvider uid="u1">
      <ContactStickersRow contact={contact} onUpdate={(next) => { setContact(next); onChange?.(next); }} />
      <div data-testid="tags">{(contact.tags ?? []).join(',')}</div>
    </StickersProvider>
  );
}

const contactWith = (ids, extra = {}) => ({ id: 'c1', name: 'Pat', sticker_ids: ids, tags: ['gala-2024'], ...extra });

async function renderRow(contact, { registry = [BOARD, DONOR], answer = config() } = {}) {
  fake.current.state.registry = registry;
  fake.current.state.config = answer;
  const changes = [];
  const user = userEvent.setup();
  const view = render(<Host initial={contact} onChange={(c) => changes.push(c)} />);
  if (answer.body?.enabled && answer.body?.readOnly === false && !viewer.value?._isImpersonated) {
    await screen.findByRole('list', { name: 'Stickers' });
  }
  return { ...view, user, changes };
}

const chipNames = () => within(screen.getByRole('list', { name: 'Stickers' }))
  .queryAllByRole('listitem')
  .map((li) => li.querySelector('.stk-name')?.textContent)
  .filter(Boolean);

let logs;
beforeEach(() => {
  fake.current = createFakeStickers();
  viewer.value = { uid: 'u1' };
  logs = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => logs.push(JSON.stringify(args)));
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('S5 Stickers row', () => {
  it('AT-5-01: renders nothing while checking or unavailable, and the tags stay where they were', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    const { container } = render(<Host initial={contactWith([BOARD.id])} />);
    expect(container.querySelector('[data-testid="contact-stickers"]')).toBeNull();
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    expect(container.querySelector('[data-testid="contact-stickers"]')).toBeNull();
    expect(container.firstElementChild.getAttribute('data-testid')).toBe('tags');
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('AT-5-02: shows the contact’s stickers in name order, then + Sticker', async () => {
    await renderRow(contactWith([BOARD.id, DONOR.id]));
    expect(chipNames()).toEqual(['Board', 'Donor']);
    expect(screen.getByRole('button', { name: 'Add sticker' })).toBeInTheDocument();
  });

  it('AT-5-03: the picker filters by name, case-insensitive, with Recent above All', async () => {
    window.localStorage.setItem('idynify.stickers.recent.u1', JSON.stringify([sid('Bowling')]));
    const BOWLING = sticker('Bowling');
    const { user } = await renderRow(contactWith([]), { registry: [BOARD, BOWLING, DONOR] });
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    const box = screen.getByRole('combobox', { name: 'Add a sticker' });
    expect(box).toHaveFocus();
    await user.type(box, 'BO');
    const listbox = screen.getByRole('listbox', { name: 'Stickers' });
    const options = within(listbox).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Bowling', 'Board', 'Create sticker “BO”']);
    const groups = [...listbox.querySelectorAll('.stk-picker-group')].map((g) => g.textContent);
    expect(groups).toEqual(['Recent', 'All stickers']);
  });

  it('AT-5-04: Create makes the sticker, then adds it, once each', async () => {
    const { user } = await renderRow(contactWith([]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.type(screen.getByRole('combobox'), 'Gala');
    await user.click(screen.getByRole('option', { name: 'Create sticker “Gala”' }));
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toHaveLength(1));
    expect(fake.current.callsOf('createSticker')).toEqual([['u1', { name: 'Gala', color: 'purple' }]]);
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', sid('Gala')]]);
    await waitFor(() => expect(chipNames()).toEqual(['Gala']));
    expect(screen.getByRole('button', { name: 'Add sticker' })).toHaveFocus();
  });

  it('AT-5-05: a name that already exists offers that sticker instead of creating one', async () => {
    const { user } = await renderRow(contactWith([]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.type(screen.getByRole('combobox'), 'board ');
    const reuse = screen.getByRole('option', { name: '“Board” already exists — use it' });
    expect(screen.queryByRole('option', { name: /Create sticker/ })).toBeNull();
    await user.click(reuse);
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]));
    expect(fake.current.callsOf('createSticker')).toEqual([]);
  });

  it('AT-5-06: an archived sticker and an unknown id are not shown, and never removed', async () => {
    const OLD = sticker('Old', { status: 'archived' });
    await renderRow(contactWith([BOARD.id, OLD.id, sid('Ghost')]), { registry: [BOARD, OLD] });
    expect(chipNames()).toEqual(['Board']);
    expect(fake.current.callsOf('removeSticker')).toEqual([]);
  });

  it('AT-5-07: an add is pending until it resolves, with its remove disabled', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user } = await renderRow(contactWith([]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    const chip = screen.getByText('Board').closest('.stk-chip');
    expect(chip).toHaveAttribute('aria-busy', 'true');
    expect(within(chip).getByRole('button', { name: 'Remove sticker Board' })).toBeDisabled();
    await act(async () => resolve({ status: 'added' }));
    expect(screen.getByText('Board').closest('.stk-chip')).not.toHaveAttribute('aria-busy');
    expect(within(screen.getByText('Board').closest('.stk-chip')).getByRole('button', { name: 'Remove sticker Board' })).toBeEnabled();
  });

  it('AT-5-08: an add refused as archived adds nothing and says so; the picker drops it once the registry updates', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('sticker_archived'); };
    const { user } = await renderRow(contactWith([]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(await screen.findByText('That sticker was archived. Restore it from Stickers to use it.')).toBeInTheDocument();
    expect(chipNames()).toEqual([]);
    act(() => fake.current.publish([{ ...BOARD, status: 'archived' }, DONOR]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    expect(screen.queryByRole('option', { name: 'Board' })).toBeNull();
  });

  it('AT-5-09: at 50 stickers, adding and creating are disabled with the limit line; a direct refusal shows the same line', { timeout: 20000 }, async () => {
    const many = Array.from({ length: 50 }, (_, i) => sticker(`Many${i}`));
    const { user } = await renderRow(contactWith(many.map((s) => s.id)), { registry: [...many, GALA] });
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    expect(screen.getByText('This contact has 50 stickers. Remove one to add another.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gala' })).toHaveAttribute('aria-disabled', 'true');
    await user.type(screen.getByRole('combobox'), 'New one');
    expect(screen.getByRole('option', { name: 'Create sticker “New one”' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'Create sticker “New one”' }));
    expect(fake.current.callsOf('createSticker')).toEqual([]);
    expect(fake.current.callsOf('addSticker')).toEqual([]);
  });

  it('AT-5-09: a limit_reached refusal from the service shows the same line', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('limit_reached'); };
    const { user } = await renderRow(contactWith([]), { registry: [GALA] });
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Gala' }));
    expect(await screen.findByText('This contact has 50 stickers. Remove one to add another.')).toBeInTheDocument();
    expect(chipNames()).toEqual([]);
  });

  it('AT-5-10: a write_denied refusal says so and re-checks; when access is gone the row disappears', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user, container } = await renderRow(contactWith([]));
    expect(fake.current.state.configFetches).toBe(1);
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await waitFor(() => expect(fake.current.state.configFetches).toBe(2));
    await waitFor(() => expect(container.querySelector('[data-testid="contact-stickers"]')).toBeNull());
    expect(fake.current.state.unsubscribed).toBe(1);
  });

  it.each([
    ['contention_exhausted', stickerError('permission_denied', 'contention_exhausted')],
    ['write_failed', stickerError('write_failed')],
  ])('AT-5-11: %s says "Couldn’t save" with a Retry that adds once more', async (_label, error) => {
    let first = true;
    fake.current.state.impl.add = async () => { if (first) { first = false; throw error; } return { status: 'added' }; };
    const { user } = await renderRow(contactWith([]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toHaveLength(2);
  });

  it('AT-5-12: a failure is logged as codes only: no sticker name, contact name or id', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'read_denied'); };
    const { user } = await renderRow(contactWith([]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(await screen.findByText("You can't change stickers on this contact.")).toBeInTheDocument();
    const text = logs.join('\n');
    expect(text).toContain('permission_denied');
    for (const secret of ['Board', 'Pat', 'c1', BOARD.id, 'u1']) expect(text).not.toContain(secret);
  });

  it('AT-5-13: removing shows Undo for 6 seconds; Undo adds it back', async () => {
    const { user } = await renderRow(contactWith([BOARD.id]));
    await user.click(screen.getByRole('button', { name: 'Remove sticker Board' }));
    await waitFor(() => expect(chipNames()).toEqual([]));
    expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    const status = screen.getByRole('status');
    expect(within(status).getByText('Removed Board')).toBeInTheDocument();
    const undo = within(status).getByRole('button', { name: 'Undo' });
    expect(undo).toHaveAccessibleDescription('Undo adds it again, dated now.');
    await user.click(undo);
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('AT-5-13: the Undo toast goes away after 6 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = await renderRow(contactWith([BOARD.id]));
      await user.click(screen.getByRole('button', { name: 'Remove sticker Board' }));
      await screen.findByText('Removed Board');
      act(() => { vi.advanceTimersByTime(5900); });
      expect(screen.getByText('Removed Board')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.queryByText('Removed Board')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AT-5-14: tags are never touched by adds and removes', async () => {
    const { user, changes } = await renderRow(contactWith([BOARD.id]));
    await user.click(screen.getByRole('button', { name: 'Remove sticker Board' }));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Donor' }));
    await waitFor(() => expect(changes).toHaveLength(2));
    for (const c of changes) expect(c.tags).toEqual(['gala-2024']);
    expect(screen.getByTestId('tags')).toHaveTextContent('gala-2024');
  });

  it('AT-5-15: while an admin views as another user, nothing renders and the server is never asked', async () => {
    viewer.value = { uid: 'u1', _isImpersonated: true };
    const { container } = render(<Host initial={contactWith([BOARD.id])} />);
    await act(async () => {});
    expect(container.querySelector('[data-testid="contact-stickers"]')).toBeNull();
    expect(fake.current.state.configFetches).toBe(0);
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('two adds that resolve together both show (no lost local update)', async () => {
    const resolvers = [];
    fake.current.state.impl.add = () => new Promise((r) => resolvers.push(r));
    const { user } = await renderRow(contactWith([]));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Donor' }));
    await act(async () => { resolvers.forEach((r) => r({ status: 'added' })); });
    await waitFor(() => expect(chipNames()).toEqual(['Board', 'Donor']));
  });

  it('QA review: Undo pressed after moving to another contact re-adds to the contact it was removed from', async () => {
    // The full-page profile keeps the same component when the route changes contact.
    fake.current.state.registry = [BOARD, DONOR];
    fake.current.state.config = config();
    const user = userEvent.setup();
    const pat = contactWith([BOARD.id]);
    const sam = { id: 'c2', name: 'Sam', sticker_ids: [DONOR.id], tags: [] };
    function SwitchingHost() {
      const [contact, setContact] = useState(pat);
      return (
        <StickersProvider uid="u1">
          <ContactStickersRow contact={contact} onUpdate={setContact} />
          <button type="button" onClick={() => setContact(sam)}>Open Sam</button>
        </StickersProvider>
      );
    }
    render(<SwitchingHost />);
    await screen.findByRole('list', { name: 'Stickers' });
    await user.click(screen.getByRole('button', { name: 'Remove sticker Board' }));
    const undo = await within(screen.getByRole('status')).findByRole('button', { name: 'Undo' });
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));
    await user.click(undo);
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toHaveLength(1));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    expect(chipNames()).toEqual(['Donor']);
  });

  it('QA D-1: when access is revoked, the row disappears but the explanation stays on screen', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user, container } = await renderRow(contactWith([]));
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await waitFor(() => expect(container.querySelector('[data-testid="contact-stickers"]')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent("Stickers can't be changed right now.");
  });
});
