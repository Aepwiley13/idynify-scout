/**
 * M0 — characterisation of the sticker controls on a People card or list row (ContactCardStickersInteractive).
 *
 * contactCardStickersInteractive.test.jsx is this component's acceptance suite. This file adds what it does not
 * pin, in the same spirit as contactStickersRowCharacterization.test.jsx for the profile row: availability and
 * loading, pending states, the 50-sticker limit, denied writes, Undo and Retry, and a card that is hidden or
 * replaced while a write is in flight.
 *
 * The card holds its own copy of the add, remove, create and undo logic, and the two copies are NOT identical.
 * Where they differ, the test says so ("KNOWN DIFFERENCE from the profile row"), so that a shared hook has to
 * choose on purpose rather than by accident. Nothing here asks for production code to change.
 *
 * Assertions are about behaviour: what is shown, what is written, what the page is told, where focus is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor, act, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker, sid, config, stickerError } from './helpers/stickersUi';
import { withMembershipChange } from '../services/stickers/stickerCore';

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
import ContactCardStickersInteractive from '../components/stickers/ContactCardStickersInteractive';

configure({ asyncUtilTimeout: 5000 });

const BOARD = sticker('Board', { color: 'blue' });
const DONOR = sticker('Donor', { color: 'amber' });
const GALA = sticker('Gala');

const pat = (ids = [], extra = {}) => ({ id: 'c1', name: 'Pat', sticker_ids: ids, tags: [], ...extra });
const sam = (ids = [], extra = {}) => ({ id: 'c2', name: 'Sam', sticker_ids: ids, tags: [], ...extra });

/**
 * A People page: it owns the contacts, applies every confirmed change BY ID (as the real page does), and can hide a
 * card (a sticker filter) and show it again. `onApply` sees each change the page is told about.
 */
function Page({ initial, max = 2, onApply }) {
  const [contacts, setContacts] = useState(initial);
  const [hidden, setHidden] = useState(() => new Set());
  const apply = (contactId, stickerId, op) => {
    onApply?.([contactId, stickerId, op]);
    setContacts((prev) => prev.map((c) => (c.id === contactId ? withMembershipChange(c, stickerId, op) : c)));
  };
  const toggle = (id) => setHidden((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <StickersProvider uid="u1">
      {contacts.filter((c) => !hidden.has(c.id)).map((c) => (
        <div key={c.id} data-testid={`card-${c.id}`}>
          <span>{c.name}</span>
          <ContactCardStickersInteractive contact={c} max={max} onUpdate={apply} />
        </div>
      ))}
      {contacts.map((c) => <button key={c.id} type="button" onClick={() => toggle(c.id)}>{`Toggle ${c.name}`}</button>)}
      <div data-testid="ids">{contacts.map((c) => `${c.id}:${(c.sticker_ids ?? []).join('+')}`).join(' ')}</div>
    </StickersProvider>
  );
}

async function renderCards(contacts, { registry = [BOARD, DONOR, GALA], max = 2 } = {}) {
  fake.current.state.registry = registry;
  fake.current.state.config = config();
  const applied = [];
  const user = userEvent.setup();
  const view = render(<Page initial={contacts} max={max} onApply={(a) => applied.push(a)} />);
  await screen.findAllByTestId('card-stickers-interactive');
  return { ...view, user, applied };
}

const addFor = (name) => screen.getByRole('button', { name: `Add sticker to ${name}` });
const chipNames = (id) => [...screen.getByTestId(`card-${id}`).querySelectorAll('.stk-name')].map((n) => n.textContent);
const chipOf = (id, name) => within(screen.getByTestId(`card-${id}`)).getByText(name, { selector: '.stk-name' }).closest('.stk-chip');
const anyCard = () => document.querySelector('[data-testid="card-stickers-interactive"]');
const LIMIT_LINE = 'This contact has 50 stickers. Remove one to add another.';
const many = (n, prefix = 'Many') => Array.from({ length: n }, (_, i) => sticker(`${prefix}${i}`));
const pickFor = async (user, who, option) => {
  await user.click(addFor(who));
  await user.click(screen.getByRole('option', { name: option }));
};

beforeEach(() => {
  fake.current = createFakeStickers();
  viewer.value = { uid: 'u1' };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('availability and loading', () => {
  it.each([
    ['read-only (an admin viewing as the user)', config({ enabled: true, mode: 'beta', readOnly: true })],
    ['not enrolled (beta, not in it)', config({ enabled: false, mode: 'beta', readOnly: false })],
    ['disabled', config({ enabled: false, mode: 'off', readOnly: false })],
    ['a server error', { status: 500, body: null }],
    ['an answer that is not understood', { status: 200, body: { enabled: 'yes' } }],
  ])('draws nothing for %s, and subscribes to nothing', async (_label, answer) => {
    fake.current.state.config = answer;
    render(<Page initial={[pat([BOARD.id])]} />);
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    await act(async () => {});
    expect(anyCard()).toBeNull();
    expect(screen.queryByRole('button', { name: /Add sticker/ })).toBeNull();
    expect(fake.current.state.subscriptions).toBe(0);
  });

  it('draws nothing until the registry has arrived, then draws the controls with the stickers', async () => {
    let deliver;
    fake.current.services.subscribeStickers = (uid, onNext) => {
      fake.current.state.subscriptions += 1;
      deliver = onNext;
      return () => {};
    };
    render(<Page initial={[pat([BOARD.id])]} />);
    await waitFor(() => expect(fake.current.state.subscriptions).toBe(1));
    await act(async () => {});
    expect(anyCard()).toBeNull();
    await act(async () => deliver([BOARD, DONOR]));
    await screen.findAllByTestId('card-stickers-interactive');
    expect(chipNames('c1')).toEqual(['Board']);
  });

  it('draws nothing for a contact with no id', async () => {
    fake.current.state.registry = [BOARD];
    render(<StickersProvider uid="u1"><ContactCardStickersInteractive contact={{ name: 'No id', sticker_ids: [BOARD.id] }} onUpdate={() => {}} /></StickersProvider>);
    await waitFor(() => expect(fake.current.state.subscriptions).toBe(1));
    await act(async () => {});
    expect(anyCard()).toBeNull();
  });
});

describe('pending states', () => {
  it('a remove is pending until it resolves: busy chip, remove control off, one write however many presses', async () => {
    let resolve;
    fake.current.state.impl.remove = () => new Promise((r) => { resolve = r; });
    const { user, applied } = await renderCards([pat([BOARD.id])]);
    const remove = within(chipOf('c1', 'Board')).getByRole('button', { name: 'Remove sticker Board' });
    await user.click(remove);
    expect(chipOf('c1', 'Board')).toHaveAttribute('aria-busy', 'true');
    expect(remove).toBeDisabled();
    await user.click(remove);
    expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    expect(applied).toEqual([]);
    await act(async () => resolve({ status: 'removed' }));
    await waitFor(() => expect(applied).toEqual([['c1', BOARD.id, 'remove']]));
    expect(await screen.findByText('Removed Board')).toBeInTheDocument();
  });

  it('a pending add shows as a busy chip before the page has been told, and the page is told once it resolves', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, applied } = await renderCards([pat([])]);
    await pickFor(user, 'Pat', 'Board');
    expect(chipNames('c1')).toEqual(['Board']);
    expect(chipOf('c1', 'Board')).toHaveAttribute('aria-busy', 'true');
    expect(applied).toEqual([]);
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(applied).toEqual([['c1', BOARD.id, 'add']]));
    expect(chipOf('c1', 'Board')).not.toHaveAttribute('aria-busy');
  });

  it('a second identical write while one is in flight is refused (the profile row does the same since M2-A)', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderCards([pat([])]);
    await pickFor(user, 'Pat', 'Board');
    await pickFor(user, 'Pat', 'Board');
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('a failed add leaves no busy chip behind, tells the page nothing, and offers Retry', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('write_failed'); };
    const { user, applied } = await renderCards([pat([])]);
    await pickFor(user, 'Pat', 'Board');
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(chipNames('c1')).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('counts a pending add in the "+n" of a card that shows two chips', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderCards([pat([BOARD.id, DONOR.id])], { max: 2 });
    await pickFor(user, 'Pat', 'Gala');
    expect(chipNames('c1')).toEqual(['Board', 'Donor']);
    expect(within(screen.getByTestId('card-c1')).getByLabelText('1 more sticker')).toBeInTheDocument();
  });

  it('pending work on one card does not show on another', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderCards([pat([]), sam([DONOR.id])]);
    await pickFor(user, 'Pat', 'Board');
    expect(chipOf('c1', 'Board')).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('[data-testid="card-c2"] .stk-chip[aria-busy="true"]')).toBeNull();
    expect(chipNames('c2')).toEqual(['Donor']);
  });
});

describe('the 50-sticker limit', () => {
  it('counts a pending add: 49 stickers and one add in flight is the limit, and nothing more is written', async () => {
    const stored = many(49);
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderCards([pat(stored.map((s) => s.id))], { registry: [...stored, GALA, DONOR] });
    await pickFor(user, 'Pat', 'Gala');
    await user.click(addFor('Pat'));
    expect(screen.getByText(LIMIT_LINE)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Donor' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'Donor' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', GALA.id]]);
  }, 90000);

  it('is lifted by removing one, and removal is possible at 50', async () => {
    const stored = many(50);
    const { user } = await renderCards([pat(stored.map((s) => s.id))], { registry: [...stored, GALA], max: 50 });
    await user.click(addFor('Pat'));
    expect(screen.getByText(LIMIT_LINE)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(within(chipOf('c1', 'Many0')).getByRole('button', { name: 'Remove sticker Many0' }));
    await waitFor(() => expect(chipNames('c1')).not.toContain('Many0'));
    await user.click(addFor('Pat'));
    expect(screen.queryByText(LIMIT_LINE)).toBeNull();
    expect(screen.getByRole('option', { name: 'Gala' })).not.toHaveAttribute('aria-disabled');
  }, 90000);
});

describe('denied writes', () => {
  it('a write_denied on a REMOVE says so, re-checks, and leaves the sticker and the page untouched', async () => {
    fake.current.state.impl.remove = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user, applied } = await renderCards([pat([BOARD.id])]);
    await user.click(within(chipOf('c1', 'Board')).getByRole('button', { name: 'Remove sticker Board' }));
    expect(await screen.findByText("Stickers can't be changed right now.")).toBeInTheDocument();
    await waitFor(() => expect(fake.current.state.configFetches).toBe(2));
    expect(chipNames('c1')).toEqual(['Board']);
    expect(applied).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('a read_denied says so, does not re-check, and offers no Retry', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'read_denied'); };
    const { user } = await renderCards([pat([])]);
    await pickFor(user, 'Pat', 'Board');
    expect(await screen.findByText("You can't change stickers on this contact.")).toBeInTheDocument();
    expect(fake.current.state.configFetches).toBe(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('when a denied write is followed by a "no longer available" answer, every card\'s controls go and the explanation stays', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user } = await renderCards([pat([]), sam([])]);
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    await pickFor(user, 'Pat', 'Board');
    await waitFor(() => expect(anyCard()).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent("Stickers can't be changed right now.");
  });
});

describe('Undo and Retry', () => {
  it('KNOWN (same as the row): only the latest removal can be undone', async () => {
    const { user } = await renderCards([pat([BOARD.id, DONOR.id])], { max: 5 });
    await user.click(within(chipOf('c1', 'Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await screen.findByText('Removed Board');
    await user.click(within(chipOf('c1', 'Donor')).getByRole('button', { name: 'Remove sticker Donor' }));
    await screen.findByText('Removed Donor');
    expect(screen.queryByText('Removed Board')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(chipNames('c1')).toEqual(['Donor']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', DONOR.id]]);
  });

  it('an Undo that fails says so with a Retry, and the Retry adds it back', async () => {
    let failOnce = true;
    fake.current.state.impl.add = async () => { if (failOnce) { failOnce = false; throw stickerError('write_failed'); } return { status: 'added' }; };
    const { user } = await renderCards([pat([BOARD.id])]);
    await user.click(within(chipOf('c1', 'Board')).getByRole('button', { name: 'Remove sticker Board' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames('c1')).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toHaveLength(2);
  });

  it('offers no Undo after an add', async () => {
    const { user } = await renderCards([pat([])]);
    await pickFor(user, 'Pat', 'Board');
    await waitFor(() => expect(chipNames('c1')).toEqual(['Board']));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('a card that is hidden or replaced while a write is in flight', () => {
  it('a Retry pressed after the card was hidden writes to the contact it was raised for, and the page applies it by id', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('write_failed'); };
    const { user, applied } = await renderCards([pat([]), sam([DONOR.id])]);
    await pickFor(user, 'Pat', 'Board');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    await user.click(screen.getByRole('button', { name: 'Toggle Pat' }));
    expect(screen.queryByTestId('card-c1')).toBeNull();
    fake.current.state.impl.add = async () => ({ status: 'added' });
    await user.click(retry);
    await waitFor(() => expect(applied).toEqual([['c1', BOARD.id, 'add']]));
    expect(fake.current.callsOf('addSticker')[1]).toEqual(['u1', 'c1', BOARD.id]);
    expect(chipNames('c2')).toEqual(['Donor']);
    await user.click(screen.getByRole('button', { name: 'Toggle Pat' }));
    await waitFor(() => expect(chipNames('c1')).toEqual(['Board']));
  });

  it('KNOWN DIFFERENCE from the profile row: an add that resolves after the card was hidden IS reported to the page, so the card comes back correct', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, applied } = await renderCards([pat([]), sam([])]);
    await pickFor(user, 'Pat', 'Board');
    await user.click(screen.getByRole('button', { name: 'Toggle Pat' }));
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(applied).toEqual([['c1', BOARD.id, 'add']]));
    await user.click(screen.getByRole('button', { name: 'Toggle Pat' }));
    await waitFor(() => expect(chipNames('c1')).toEqual(['Board']));
    expect(chipNames('c2')).toEqual([]);
  });

  it('KNOWN DIFFERENCE from the profile row: a creation in flight when the card is hidden still adds the new sticker to its contact', async () => {
    let finishCreate;
    fake.current.state.impl.create = (_uid, { name }) => new Promise((r) => { finishCreate = () => r({ id: sid(name) }); });
    const { user, applied } = await renderCards([pat([]), sam([])], { registry: [BOARD] });
    await user.click(addFor('Pat'));
    await user.type(screen.getByRole('combobox'), 'Volunteer');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(fake.current.callsOf('createSticker')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Toggle Pat' }));
    await act(async () => finishCreate());
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', sid('Volunteer')]]));
    await waitFor(() => expect(applied).toEqual([['c1', sid('Volunteer'), 'add']]));
  });

  it('each card writes only to its own contact, whichever order the writes finish in', async () => {
    const resolvers = {};
    fake.current.state.impl.add = (_uid, contactId) => new Promise((r) => { resolvers[contactId] = r; });
    const { user, applied } = await renderCards([pat([]), sam([])]);
    await pickFor(user, 'Pat', 'Board');
    await pickFor(user, 'Sam', 'Gala');
    await act(async () => resolvers.c2({ status: 'added' }));
    await act(async () => resolvers.c1({ status: 'added' }));
    await waitFor(() => expect(applied).toHaveLength(2));
    expect(applied).toEqual([['c2', GALA.id, 'add'], ['c1', BOARD.id, 'add']]);
    expect(chipNames('c1')).toEqual(['Board']);
    expect(chipNames('c2')).toEqual(['Gala']);
  });

  it('closes an open picker when its card is hidden, and the card comes back closed', async () => {
    const { user } = await renderCards([pat([])]);
    await user.click(addFor('Pat'));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Toggle Pat' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Toggle Pat' }));
    expect(addFor('Pat')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the add control, keyboard and focus', () => {
  it('opens with Space as well as Enter, closes with Tab, and is named for its contact', async () => {
    const { user } = await renderCards([pat([])]);
    const add = addFor('Pat');
    expect(add).toHaveAttribute('aria-haspopup', 'listbox');
    add.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(addFor('Pat')).toHaveAttribute('aria-expanded', 'false');
    expect(fake.current.callsOf('addSticker')).toEqual([]);
  });

  it('closes on a second press of the add control, and returns focus to it after a creation', async () => {
    const { user } = await renderCards([pat([])], { registry: [BOARD] });
    await user.click(addFor('Pat'));
    await user.click(addFor('Pat'));
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(addFor('Pat'));
    await user.type(screen.getByRole('combobox'), 'Volunteer');
    await user.keyboard('{Enter}');
    expect(addFor('Pat')).toHaveFocus();
    await waitFor(() => expect(chipNames('c1')).toEqual(['Volunteer']));
  });

  it('puts the picker inside the add control\'s own wrapper, which is what the popover places itself against', async () => {
    const { user } = await renderCards([pat([])]);
    await user.click(addFor('Pat'));
    const picker = screen.getByRole('combobox').closest('.stk-picker');
    expect(picker.parentElement).toBe(addFor('Pat').parentElement);
    expect(picker.parentElement).toHaveClass('stk-add-item');
  });
});
