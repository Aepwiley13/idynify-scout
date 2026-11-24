/**
 * M0 — characterisation of the Contact Profile Stickers row (ContactStickersRow).
 *
 * WHAT THIS IS. contactStickersRow.test.jsx (AT-5-xx) is the row's acceptance suite. This file adds what it
 * does not pin, so that the sticker behaviour can later be moved into a shared hook (M1) with a net under it:
 * availability and loading, read-only and not-enrolled answers, the picker's roles, keyboard and focus,
 * pending states, the 50-sticker limit with pending adds, denied writes, Undo and Retry, and, above all,
 * switching between contacts (a stale pending action must never touch the wrong contact).
 *
 * It describes what the code does TODAY. Where today's behaviour is questionable it is still pinned, and the
 * test says so ("KNOWN:" in its name); nothing here asks for the production code to change. If an M1 refactor
 * changes one of those on purpose, that test is the place to see it and decide.
 *
 * Assertions are about behaviour (what is shown, what is written, where focus is), not about markup.
 *
 * The real StickersProvider, row, picker, chip and toast; the services and the stickersConfig call are fakes
 * (helpers/stickersUi.js), as in the other sticker suites.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor, act, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker, sid, config, stickerError } from './helpers/stickersUi';
import { setViewportWidth } from './helpers/matchMedia';

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

configure({ asyncUtilTimeout: 5000 });

const BOARD = sticker('Board', { color: 'blue' });
const DONOR = sticker('Donor', { color: 'amber' });
const GALA = sticker('Gala');

const PAT = (ids = [], extra = {}) => ({ id: 'c1', name: 'Pat', sticker_ids: ids, tags: ['gala-2024'], ...extra });
const SAM = (ids = [], extra = {}) => ({ id: 'c2', name: 'Sam', sticker_ids: ids, tags: [], ...extra });

/** The row as a host page has it: one contact, updates flow back in. `onChange` sees every update the row sends. */
function Host({ initial, onChange }) {
  const [contact, setContact] = useState(initial);
  return (
    <StickersProvider uid="u1">
      <ContactStickersRow contact={contact} onUpdate={(next) => { setContact(next); onChange?.(next); }} />
    </StickersProvider>
  );
}

/**
 * The full-page profile: the SAME row component stays mounted while the route moves from contact to contact.
 * Each contact's latest state is held here, as a page would, and the page applies whatever the row reports.
 */
function Switching({ contacts, onChange }) {
  const [byId, setById] = useState(() => Object.fromEntries(contacts.map((c) => [c.id, c])));
  const [current, setCurrent] = useState(contacts[0].id);
  return (
    <StickersProvider uid="u1">
      <ContactStickersRow contact={byId[current]} onUpdate={(next) => { setById((prev) => ({ ...prev, [next.id]: next })); onChange?.(next); }} />
      {contacts.map((c) => <button key={c.id} type="button" onClick={() => setCurrent(c.id)}>{`Open ${c.name}`}</button>)}
      <div data-testid="outside">elsewhere on the page</div>
    </StickersProvider>
  );
}

async function renderRow(contact, { registry = [BOARD, DONOR, GALA], answer = config() } = {}) {
  fake.current.state.registry = registry;
  fake.current.state.config = answer;
  const changes = [];
  const user = userEvent.setup();
  const view = render(<Host initial={contact} onChange={(c) => changes.push(c)} />);
  await screen.findByRole('list', { name: 'Stickers' });
  return { ...view, user, changes };
}

async function renderSwitching(contacts, { registry = [BOARD, DONOR, GALA] } = {}) {
  fake.current.state.registry = registry;
  fake.current.state.config = config();
  const changes = [];
  const user = userEvent.setup();
  const view = render(<Switching contacts={contacts} onChange={(c) => changes.push(c)} />);
  await screen.findByRole('list', { name: 'Stickers' });
  return { ...view, user, changes };
}

const addButton = () => screen.getByRole('button', { name: 'Add sticker' });
const chipNames = () => within(screen.getByRole('list', { name: 'Stickers' }))
  .queryAllByRole('listitem')
  .map((li) => li.querySelector('.stk-name')?.textContent)
  .filter(Boolean);
const chip = (name) => screen.getByText(name, { selector: '.stk-name' }).closest('.stk-chip');
const rowIsShown = () => document.querySelector('[data-testid="contact-stickers"]') !== null;
const pickOption = async (user, name) => {
  await user.click(addButton());
  await user.click(screen.getByRole('option', { name }));
};
const LIMIT_LINE = 'This contact has 50 stickers. Remove one to add another.';
const many = (n, prefix = 'Many') => Array.from({ length: n }, (_, i) => sticker(`${prefix}${i}`));

let logs;
beforeEach(() => {
  fake.current = createFakeStickers();
  viewer.value = { uid: 'u1' };
  logs = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => logs.push(JSON.stringify(args)));
  window.localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); setViewportWidth(1024); });

// ─── Availability, loading and read-only ─────────────────────────────────────

describe('availability and loading', () => {
  it.each([
    ['read-only (an admin viewing as the user)', config({ enabled: true, mode: 'beta', readOnly: true })],
    ['not enrolled (beta, not in it)', config({ enabled: false, mode: 'beta', readOnly: false })],
    ['disabled', config({ enabled: false, mode: 'off', readOnly: false })],
    ['a server error', { status: 500, body: null }],
    ['an unauthorised answer', { status: 401, body: { error: 'unauthorized' } }],
    ['an answer that is not understood', { status: 200, body: { enabled: 'yes' } }],
    ['an answer with no body', { status: 200, body: null }],
  ])('draws nothing for %s, subscribes to nothing, and leaves the page as it was', async (_label, answer) => {
    fake.current.state.config = answer;
    const { container } = render(<Host initial={PAT([BOARD.id])} />);
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    await act(async () => {});
    expect(rowIsShown()).toBe(false);
    expect(container.querySelector('.stk-chip')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add sticker' })).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);
    expect(fake.current.callsOf('addSticker')).toEqual([]);
  });

  it('draws nothing while the server has not answered, then draws the row', async () => {
    let answer;
    fake.current.services.fetchStickersConfig = () => new Promise((resolve) => { answer = resolve; });
    fake.current.state.registry = [BOARD];
    render(<Host initial={PAT([BOARD.id])} />);
    await act(async () => {});
    expect(rowIsShown()).toBe(false);
    expect(fake.current.state.subscriptions).toBe(0);
    await act(async () => answer(config()));
    expect(await screen.findByRole('list', { name: 'Stickers' })).toBeInTheDocument();
    expect(chipNames()).toEqual(['Board']);
  });

  it('is available but not ready until the registry has arrived: nothing is drawn, then the row appears with the contact\'s stickers', async () => {
    let deliver;
    fake.current.services.subscribeStickers = (uid, onNext) => {
      fake.current.state.subscriptions += 1;
      deliver = onNext;
      return () => {};
    };
    render(<Host initial={PAT([BOARD.id])} />);
    await waitFor(() => expect(fake.current.state.subscriptions).toBe(1));
    await act(async () => {});
    expect(rowIsShown()).toBe(false);
    expect(screen.queryByText('Board')).toBeNull();
    await act(async () => deliver([BOARD, DONOR]));
    expect(await screen.findByRole('list', { name: 'Stickers' })).toBeInTheDocument();
    expect(chipNames()).toEqual(['Board']);
  });

  it('draws nothing for a contact with no id, and draws the row for one with an id', async () => {
    fake.current.state.registry = [BOARD];
    const { rerender } = render(<StickersProvider uid="u1"><ContactStickersRow contact={{ name: 'No id', sticker_ids: [BOARD.id] }} /></StickersProvider>);
    await waitFor(() => expect(fake.current.state.subscriptions).toBe(1));
    await act(async () => {});
    expect(rowIsShown()).toBe(false);
    rerender(<StickersProvider uid="u1"><ContactStickersRow contact={PAT([BOARD.id])} /></StickersProvider>);
    expect(await screen.findByRole('list', { name: 'Stickers' })).toBeInTheDocument();
  });

  it('works without an onUpdate callback: the write is made, and nothing throws', async () => {
    fake.current.state.registry = [BOARD];
    const user = userEvent.setup();
    render(<StickersProvider uid="u1"><ContactStickersRow contact={PAT([])} /></StickersProvider>);
    await screen.findByRole('list', { name: 'Stickers' });
    await pickOption(user, 'Board');
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]));
  });

  it('goes away when access is revoked mid-session, and comes back if it is granted again on the next check', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user } = await renderRow(PAT([]));
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    await pickOption(user, 'Board');
    await waitFor(() => expect(rowIsShown()).toBe(false));
    expect(fake.current.state.unsubscribed).toBe(1);
  });
});

// ─── The add control and the picker: roles, keyboard and focus ───────────────

describe('the add control and its picker', () => {
  it('is a button that says it opens a listbox, and says whether it is open', async () => {
    const { user } = await renderRow(PAT([]));
    const add = addButton();
    expect(add).toHaveAttribute('aria-haspopup', 'listbox');
    expect(add).toHaveAttribute('aria-expanded', 'false');
    await user.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Add a sticker' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Stickers' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(add).toHaveAttribute('aria-expanded', 'false');
  });

  it('puts the picker inside the add control\'s own list item: the popover places itself against its parent', async () => {
    const { user } = await renderRow(PAT([]));
    await user.click(addButton());
    const picker = screen.getByRole('combobox').closest('.stk-picker');
    expect(picker).not.toBeNull();
    // StickerPicker measures popover.parentElement as its anchor, and the stylesheet positions it against that element.
    expect(picker.parentElement).toBe(addButton().parentElement);
    expect(picker.parentElement).toHaveClass('stk-add-item');
  });

  it('opens from the keyboard with Enter and with Space, with focus in the search box', async () => {
    const { user } = await renderRow(PAT([]));
    addButton().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(addButton()).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('chooses with the arrow keys and Enter, adds that sticker, and returns focus to the add button', async () => {
    const { user } = await renderRow(PAT([]));
    addButton().focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(addButton()).toHaveFocus();
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('returns focus to the add button after Escape, after a pick with the mouse, and after creating', async () => {
    const { user } = await renderRow(PAT([]));
    await user.click(addButton());
    await user.keyboard('{Escape}');
    expect(addButton()).toHaveFocus();

    await user.click(addButton());
    await user.click(screen.getByRole('option', { name: 'Donor' }));
    expect(addButton()).toHaveFocus();
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));

    await user.click(addButton());
    await user.type(screen.getByRole('combobox'), 'Volunteer');
    await user.keyboard('{Enter}');
    expect(addButton()).toHaveFocus();
    await waitFor(() => expect(chipNames()).toEqual(['Donor', 'Volunteer']));
  });

  it('closes on a second press of the add button, and does not close and reopen in one press', async () => {
    const { user } = await renderRow(PAT([]));
    await user.click(addButton());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    await user.click(addButton());
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(addButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when something outside it is pressed, and the add control says it is closed', async () => {
    const { user } = await renderSwitching([PAT([])]);
    await user.click(addButton());
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(addButton()).toHaveAttribute('aria-expanded', 'false');
    expect(fake.current.callsOf('addSticker')).toEqual([]);
  });

  it('closes on Tab, without choosing or writing anything', async () => {
    const { user } = await renderSwitching([PAT([BOARD.id]), SAM([])]);
    await user.click(addButton());
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(addButton()).toHaveAttribute('aria-expanded', 'false');
    expect(fake.current.callsOf('addSticker')).toEqual([]);
    // Where focus goes next is the browser's: the picker puts it on the add button (closePicker) and Tab moves on from there.
    // jsdom's user-event drops it to the page instead, so that part is checked in a real browser (an M1 verification), not here.
  });

  it('does not close while typing in the search box, and a press inside the picker does not close it', async () => {
    const { user } = await renderRow(PAT([]));
    await user.click(addButton());
    await user.type(screen.getByRole('combobox'), 'Do');
    expect(screen.getByRole('option', { name: 'Donor' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Board' })).toBeNull();
    await user.click(screen.getByRole('listbox'));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows the stickers the contact already has as selected and not choosable again', async () => {
    const { user } = await renderRow(PAT([BOARD.id]));
    await user.click(addButton());
    const board = screen.getByRole('option', { name: 'Board' });
    expect(board).toHaveAttribute('aria-selected', 'true');
    expect(board).toHaveAttribute('aria-disabled', 'true');
    await user.click(board);
    expect(fake.current.callsOf('addSticker')).toEqual([]);
    expect(screen.getByRole('option', { name: 'Gala' })).toHaveAttribute('aria-selected', 'false');
  });
});

// ─── Pending states and the 50-sticker limit ─────────────────────────────────

describe('pending states', () => {
  it('a remove is pending until it resolves: the chip is busy, its remove control is off, and a second press writes nothing more', async () => {
    let resolve;
    fake.current.state.impl.remove = () => new Promise((r) => { resolve = r; });
    const { user } = await renderRow(PAT([BOARD.id]));
    const remove = within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' });
    await user.click(remove);
    expect(chip('Board')).toHaveAttribute('aria-busy', 'true');
    expect(remove).toBeDisabled();
    await user.click(remove);
    expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    // Nothing is optimistic: the chip is still there, and the Undo offer waits for the write.
    expect(chipNames()).toEqual(['Board']);
    expect(screen.queryByText('Removed Board')).toBeNull();
    await act(async () => resolve({ status: 'removed' }));
    await waitFor(() => expect(chipNames()).toEqual([]));
    expect(await screen.findByText('Removed Board')).toBeInTheDocument();
  });

  it('a pending add shows as a busy chip before it is on the contact, and the contact is not updated until the write resolves', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, changes } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    expect(chipNames()).toEqual(['Board']);
    expect(chip('Board')).toHaveAttribute('aria-busy', 'true');
    expect(changes).toEqual([]);
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0].sticker_ids).toEqual([BOARD.id]);
    expect(chip('Board')).not.toHaveAttribute('aria-busy');
  });

  it('a failed add leaves no busy chip behind and the sticker can be chosen again', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('write_failed'); };
    const { user, changes } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(chipNames()).toEqual([]);
    expect(changes).toEqual([]);
    await user.click(addButton());
    expect(screen.getByRole('option', { name: 'Board' })).not.toHaveAttribute('aria-disabled');
  });

  it('a creation shows the new sticker busy while its add is in flight, and writes one create and one add', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user } = await renderRow(PAT([]), { registry: [BOARD] });
    await user.click(addButton());
    await user.type(screen.getByRole('combobox'), 'Volunteer');
    await user.click(screen.getByRole('option', { name: 'Create sticker “Volunteer”' }));
    await waitFor(() => expect(chip('Volunteer')).toHaveAttribute('aria-busy', 'true'));
    expect(fake.current.callsOf('createSticker')).toHaveLength(1);
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', sid('Volunteer')]]);
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(chip('Volunteer')).not.toHaveAttribute('aria-busy'));
  });

  it('a failed creation writes no add, says so, and offers Retry which creates once more', async () => {
    let first = true;
    fake.current.state.impl.create = async (_uid, { name }) => { if (first) { first = false; throw stickerError('write_failed'); } return { id: sid(name) }; };
    const { user } = await renderRow(PAT([]), { registry: [BOARD] });
    await user.click(addButton());
    await user.type(screen.getByRole('combobox'), 'Volunteer');
    await user.keyboard('{Enter}');
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(fake.current.callsOf('addSticker')).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames()).toEqual(['Volunteer']));
    expect(fake.current.callsOf('createSticker')).toHaveLength(2);
    expect(fake.current.callsOf('addSticker')).toHaveLength(1);
  });

  // M2-A: a second identical add while the first is in flight is refused (this used to be a KNOWN duplicate write;
  // the People card has always refused it).
  it('M2-A: a sticker whose add is still pending is disabled in the picker', async () => {
    // The picker marks only the stickers already on the contact as chosen; a pending add is not on the contact yet.
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    await user.click(addButton());
    expect(screen.getByRole('option', { name: 'Board' })).toHaveAttribute('aria-selected', 'false');
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    expect(chip('Board')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('combobox')).toBeVisible();
    expect(screen.getByRole('option', { name: 'Board' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('M2-A: two rapid picks of the same sticker, made before React re-renders, still send one add', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderRow(PAT([]));
    await user.click(addButton());
    const option = screen.getByRole('option', { name: 'Board' });
    await act(async () => { option.click(); option.click(); });
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('M2-A: different stickers are added independently while another add is pending', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    await pickOption(user, 'Donor');
    await pickOption(user, 'Gala');
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id], ['u1', 'c1', DONOR.id], ['u1', 'c1', GALA.id]]);
    expect(chipNames()).toEqual(['Board', 'Donor', 'Gala']);
  });

  it('M2-A: once the first add has finished, the same sticker is not re-added (it is on the contact, and the picker marks it chosen)', async () => {
    const { user } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    await waitFor(() => expect(chip('Board')).not.toHaveAttribute('aria-busy'));
    await user.click(addButton());
    expect(screen.getByRole('option', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('M2-A: a failed add can be tried again, by Retry and by choosing the sticker again, and each is one write', async () => {
    let attempts = 0;
    fake.current.state.impl.add = async () => { attempts += 1; if (attempts <= 2) throw stickerError('write_failed'); return { status: 'added' }; };
    const { user } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(chipNames()).toEqual([]);
    await pickOption(user, 'Board');
    await waitFor(() => expect(attempts).toBe(2));
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toHaveLength(3);
  });

  it('M2-A: an Undo (an add) is refused while an add of that same sticker is still pending, and works once it is not', async () => {
    const { user } = await renderRow(PAT([BOARD.id]));
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    fake.current.state.impl.add = () => new Promise(() => {});
    await user.click(undo);
    await user.click(addButton());
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('M2-A: a pending add for one contact does not stop the same sticker being added to the next contact', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderSwitching([PAT([]), SAM([])]);
    await pickOption(user, 'Board');
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await waitFor(() => expect(chipNames()).toEqual([]));
    await pickOption(user, 'Board');
    await pickOption(user, 'Board');
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id], ['u1', 'c2', BOARD.id]]);
    // Back on the first contact the add is STILL in flight: the guard is the page's, so the fresh row knows (this used to send a third write).
    await user.click(screen.getByRole('button', { name: 'Open Pat' }));
    await pickOption(user, 'Board');
    expect(fake.current.callsOf('addSticker')).toHaveLength(2);
  });
});

describe('the 50-sticker limit', () => {
  it('counts an add that is still pending: 49 stickers and one add in flight is the limit', async () => {
    const stored = many(49);
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderRow(PAT(stored.map((s) => s.id)), { registry: [...stored, GALA, DONOR] });
    await pickOption(user, 'Gala');
    await user.click(addButton());
    expect(screen.getByText(LIMIT_LINE)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Donor' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'Donor' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', GALA.id]]);
  }, 90000);

  it('is not reached at 49: adding is allowed and no limit line is shown', async () => {
    const stored = many(49);
    const { user } = await renderRow(PAT(stored.map((s) => s.id)), { registry: [...stored, GALA] });
    await user.click(addButton());
    expect(screen.queryByText(LIMIT_LINE)).toBeNull();
    expect(screen.getByRole('option', { name: 'Gala' })).not.toHaveAttribute('aria-disabled');
  }, 90000);

  it('is lifted by removing one: remove stays possible at 50, and then the picker allows adding again', async () => {
    const stored = many(50);
    const { user } = await renderRow(PAT(stored.map((s) => s.id)), { registry: [...stored, GALA] });
    await user.click(addButton());
    expect(screen.getByText(LIMIT_LINE)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(within(chip('Many0')).getByRole('button', { name: 'Remove sticker Many0' }));
    await waitFor(() => expect(chipNames()).not.toContain('Many0'));
    expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'c1', stored[0].id]]);
    await user.click(addButton());
    expect(screen.queryByText(LIMIT_LINE)).toBeNull();
    expect(screen.getByRole('option', { name: 'Gala' })).not.toHaveAttribute('aria-disabled');
  }, 90000);

  it('refuses to create at the limit without any write, and says why', async () => {
    const stored = many(50);
    const { user } = await renderRow(PAT(stored.map((s) => s.id)), { registry: stored });
    await user.click(addButton());
    await user.type(screen.getByRole('combobox'), 'Brand new');
    await user.keyboard('{Enter}');
    expect(fake.current.callsOf('createSticker')).toEqual([]);
    expect(fake.current.callsOf('addSticker')).toEqual([]);
    expect(screen.getByText(LIMIT_LINE)).toBeInTheDocument();
  }, 90000);
});

// ─── Denied writes ───────────────────────────────────────────────────────────

describe('denied writes', () => {
  it('a write_denied on a REMOVE says so, re-checks, and leaves the sticker on the contact and nothing updated', async () => {
    fake.current.state.impl.remove = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user, changes } = await renderRow(PAT([BOARD.id]));
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    expect(await screen.findByText("Stickers can't be changed right now.")).toBeInTheDocument();
    await waitFor(() => expect(fake.current.state.configFetches).toBe(2));
    expect(chipNames()).toEqual(['Board']);
    expect(chip('Board')).not.toHaveAttribute('aria-busy');
    expect(changes).toEqual([]);
    // A denied removal offers no Undo and no Retry: there is nothing to undo, and nothing to retry.
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a denied write that the re-check does not confirm leaves the row where it is', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    await waitFor(() => expect(fake.current.state.configFetches).toBe(2));
    expect(rowIsShown()).toBe(true);
    expect(screen.getByRole('button', { name: 'Add sticker' })).toBeInTheDocument();
  });

  it('a read_denied says so, does NOT re-check, and offers no Retry', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'read_denied'); };
    const { user } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    expect(await screen.findByText("You can't change stickers on this contact.")).toBeInTheDocument();
    expect(fake.current.state.configFetches).toBe(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a denial is logged as codes only, whichever action was refused', async () => {
    fake.current.state.impl.remove = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user } = await renderRow(PAT([BOARD.id]));
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await screen.findByText("Stickers can't be changed right now.");
    const text = logs.join('\n');
    expect(text).toContain('permission_denied');
    for (const secret of ['Board', 'Pat', 'c1', BOARD.id, 'u1']) expect(text).not.toContain(secret);
  });
});

// ─── Undo and Retry ──────────────────────────────────────────────────────────

describe('Undo and Retry', () => {
  it('offers no Undo after an add, only after a removal', async () => {
    const { user } = await renderRow(PAT([]));
    await pickOption(user, 'Board');
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByText(/^Removed/)).toBeNull();
  });

  it('KNOWN: only the latest removal can be undone; a second removal replaces the first offer', async () => {
    const { user } = await renderRow(PAT([BOARD.id, DONOR.id]));
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await screen.findByText('Removed Board');
    await user.click(within(chip('Donor')).getByRole('button', { name: 'Remove sticker Donor' }));
    await screen.findByText('Removed Donor');
    expect(screen.queryByText('Removed Board')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', DONOR.id]]);
  });

  it('an Undo that fails says so with a Retry, and the Retry adds it back', async () => {
    let failOnce = true;
    fake.current.state.impl.add = async () => { if (failOnce) { failOnce = false; throw stickerError('write_failed'); } return { status: 'added' }; };
    const { user } = await renderRow(PAT([BOARD.id]));
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(chipNames()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id], ['u1', 'c1', BOARD.id]]);
  });

  it('a failed removal offers Retry, which removes once more', async () => {
    let failOnce = true;
    fake.current.state.impl.remove = async () => { if (failOnce) { failOnce = false; throw stickerError('write_failed'); } return { status: 'removed' }; };
    const { user } = await renderRow(PAT([BOARD.id]));
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames()).toEqual([]));
    expect(fake.current.callsOf('removeSticker')).toHaveLength(2);
  });
});

// ─── Switching between contacts ──────────────────────────────────────────────

describe('switching between contacts: a stale action never touches the wrong contact', () => {
  it('a Retry pressed after moving to another contact writes to the contact it was raised for', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('write_failed'); };
    const { user } = await renderSwitching([PAT([]), SAM([DONOR.id])]);
    await pickOption(user, 'Board');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));
    fake.current.state.impl.add = async () => ({ status: 'added' });
    await user.click(retry);
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toHaveLength(2));
    expect(fake.current.callsOf('addSticker')[1]).toEqual(['u1', 'c1', BOARD.id]);
    expect(chipNames()).toEqual(['Donor']);
  });

  it('a pending add for one contact does not show on the next, and its late result does not change the next', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, changes } = await renderSwitching([PAT([]), SAM([DONOR.id])]);
    await pickOption(user, 'Board');
    expect(chip('Board')).toHaveAttribute('aria-busy', 'true');
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));
    expect(document.querySelector('.stk-chip[aria-busy="true"]')).toBeNull();
    await act(async () => resolve({ status: 'added' }));
    expect(chipNames()).toEqual(['Donor']);
    expect(changes).toEqual([]);
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('KNOWN (a caller with no onLateUpdate; see contactStickersLateUpdate.test.jsx for the callback that fixes it): a result that arrives after the person has moved on is written but is not reported to the page, so the first contact looks unchanged until it is reloaded', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, changes } = await renderSwitching([PAT([]), SAM([DONOR.id])]);
    await pickOption(user, 'Board');
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await act(async () => resolve({ status: 'added' }));
    await user.click(screen.getByRole('button', { name: 'Open Pat' }));
    await screen.findByRole('list', { name: 'Stickers' });
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]); // it was saved...
    expect(changes).toEqual([]);                                                    // ...but the page was never told,
    expect(chipNames()).toEqual([]);                                                // so Pat shows no Board until a reload.
  });

  it('closes an open picker when the contact changes, and the new contact starts with a closed one', async () => {
    const { user } = await renderSwitching([PAT([]), SAM([])]);
    await user.click(addButton());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(addButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('KNOWN: a creation still in flight when the person moves on creates the sticker but never adds it to either contact', async () => {
    let finishCreate;
    fake.current.state.impl.create = (_uid, { name }) => new Promise((r) => { finishCreate = () => r({ id: sid(name) }); });
    const { user, changes } = await renderSwitching([PAT([]), SAM([])], { registry: [BOARD] });
    await user.click(addButton());
    await user.type(screen.getByRole('combobox'), 'Volunteer');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(fake.current.callsOf('createSticker')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await act(async () => finishCreate());
    await act(async () => {});
    expect(fake.current.callsOf('createSticker')).toHaveLength(1);
    expect(fake.current.callsOf('addSticker')).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('every update the row reports belongs to the contact the action was started on, across several switches', async () => {
    const { user, changes } = await renderSwitching([PAT([BOARD.id]), SAM([DONOR.id])]);
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await waitFor(() => expect(chipNames()).toEqual([]));
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));
    await pickOption(user, 'Gala');
    await waitFor(() => expect(chipNames()).toEqual(['Donor', 'Gala']));
    await user.click(screen.getByRole('button', { name: 'Open Pat' }));
    await waitFor(() => expect(chipNames()).toEqual([]));
    await pickOption(user, 'Board');
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(changes.map((c) => c.id)).toEqual(['c1', 'c2', 'c1']);
    expect(changes[0].sticker_ids).toEqual([]);
    expect(changes[1].sticker_ids).toEqual([DONOR.id, GALA.id]);
    expect(changes[2].sticker_ids).toEqual([BOARD.id]);
    expect(fake.current.state.calls.map(([name, , id]) => `${name}:${id}`)).toEqual(['removeSticker:c1', 'addSticker:c2', 'addSticker:c1']);
  });

  it('returning restores the pending chip and starts with the picker closed', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderSwitching([PAT([]), SAM([])]);
    await pickOption(user, 'Board');
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    await user.click(screen.getByRole('button', { name: 'Open Pat' }));
    await screen.findByRole('list', { name: 'Stickers' });
    expect(chipNames()).toEqual(['Board']);
    expect(chip('Board')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('keeps a contact\'s tags and other fields exactly as they were on every update', async () => {
    const { user, changes } = await renderSwitching([PAT([BOARD.id], { company_name: 'Acme', phones: [{ value: '1' }] }), SAM([])]);
    await user.click(within(chip('Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0]).toEqual({ ...PAT([], { company_name: 'Acme', phones: [{ value: '1' }] }) });
  });
});

// ─── On a phone, the picker is a bottom sheet ────────────────────────────────

describe('on a phone-sized screen', () => {
  it('opens the picker as a modal sheet outside the page, and a pick adds the sticker, closes the sheet and returns focus to the add button', async () => {
    setViewportWidth(390);
    const { user } = await renderRow(PAT([]));
    await user.click(addButton());
    const sheet = screen.getByRole('dialog', { name: 'Add a sticker' });
    expect(sheet.parentElement).toBe(document.body);
    expect(addButton()).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(sheet).getByRole('option', { name: 'Board' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(addButton()).toHaveFocus();
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('closes with Escape, with its Close button and with its backdrop, each returning focus to the add button and writing nothing', async () => {
    setViewportWidth(390);
    const { user } = await renderRow(PAT([]));
    await user.click(addButton());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(addButton()).toHaveFocus();

    await user.click(addButton());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(addButton()).toHaveFocus();

    await user.click(addButton());
    const backdrop = document.body.querySelector(':scope > .stk-sheet-backdrop');
    expect(backdrop).not.toBeNull();
    await user.pointer({ keys: '[MouseLeft]', target: backdrop });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.current.callsOf('addSticker')).toEqual([]);
  });

  it('removes the sheet when the contact changes, so a sheet opened for one contact cannot add to the next', async () => {
    setViewportWidth(390);
    const { user } = await renderSwitching([PAT([]), SAM([])]);
    await user.click(addButton());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Sam' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.current.callsOf('addSticker')).toEqual([]);
  });
});
