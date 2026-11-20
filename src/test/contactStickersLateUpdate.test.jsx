/**
 * M2-B1 — a write that finishes after its row was replaced is reported, by contact id, through the optional
 * onLateUpdate(contactId, stickerId, op).
 *
 * Why a separate callback: onUpdate(next) hands the parent a whole contact, and some parents (Scout's profile) keep
 * one piece of "the contact on screen" state and store whatever they are given. A late onUpdate(next) would put the
 * first contact on the second contact's page. onUpdate is therefore NEVER called for a stale completion; the late
 * callback names its contact, so a parent can apply it by id (as Contact Hub's applyStickerChange does).
 *
 * Account safety: the late callback is delivered only if the account that made the write is still the effective
 * account when it settles (getEffectiveUser, read at that moment, not a captured value).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, renderHook, screen, within, waitFor, act, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker, config, stickerError } from './helpers/stickersUi';
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
import ContactStickersRow from '../components/stickers/ContactStickersRow';
import { useContactStickers } from '../components/stickers/useContactStickers';

configure({ asyncUtilTimeout: 5000 });

const BOARD = sticker('Board');
const DONOR = sticker('Donor');
const GALA = sticker('Gala');
const PAT = (ids = []) => ({ id: 'c1', name: 'Pat', sticker_ids: ids, tags: [] });
const SAM = (ids = []) => ({ id: 'c2', name: 'Sam', sticker_ids: ids, tags: [] });

/**
 * A full-page profile: the same row stays mounted while the route moves between contacts. Like Scout's profile, ONE
 * piece of state holds "the contact on screen" and onUpdate stores whatever it is given (that is the hazard).
 * Like Contact Hub's list, `byId` holds every contact and a late change is applied to the contact it names.
 */
function Page({ contacts, onUpdate, onLateUpdate, withLate = true }) {
  const [byId, setById] = useState(() => Object.fromEntries(contacts.map((c) => [c.id, c])));
  const [currentId, setCurrentId] = useState(contacts[0].id);
  const [shown, setShown] = useState(contacts[0]);
  const show = (id) => { setCurrentId(id); setShown(byId[id]); };
  return (
    <StickersProvider uid="u1">
      <div data-testid="shown">{shown.name}</div>
      <ContactStickersRow
        contact={byId[currentId]}
        onUpdate={(next) => { onUpdate?.(next); setShown(next); setById((prev) => ({ ...prev, [next.id]: next })); }}
        onLateUpdate={withLate ? (id, stickerId, op) => {
          onLateUpdate?.(id, stickerId, op);
          setById((prev) => ({ ...prev, [id]: withMembershipChange(prev[id], stickerId, op) }));
        } : undefined}
      />
      {contacts.map((c) => <button key={c.id} type="button" onClick={() => show(c.id)}>{`Open ${c.name}`}</button>)}
    </StickersProvider>
  );
}

async function renderPage(contacts, opts = {}) {
  fake.current.state.registry = [BOARD, DONOR, GALA];
  fake.current.state.config = config();
  const updates = [];
  const lates = [];
  const user = userEvent.setup();
  const view = render(<Page contacts={contacts} onUpdate={(n) => updates.push(n)} onLateUpdate={(...a) => lates.push(a)} {...opts} />);
  await screen.findByRole('list', { name: 'Stickers' });
  return { ...view, user, updates, lates };
}

const addButton = () => screen.getByRole('button', { name: 'Add sticker' });
const chipNames = () => within(screen.getByRole('list', { name: 'Stickers' })).queryAllByRole('listitem')
  .map((li) => li.querySelector('.stk-name')?.textContent).filter(Boolean);
const pick = async (user, name) => { await user.click(addButton()); await user.click(screen.getByRole('option', { name })); };
const open = (user, name) => user.click(screen.getByRole('button', { name: `Open ${name}` }));
const removeChip = (user, name) => user.click(screen.getByRole('button', { name: `Remove sticker ${name}` }));

let errors;
beforeEach(() => {
  fake.current = createFakeStickers();
  viewer.value = { uid: 'u1' };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('a write that finishes after the person moved to another contact', () => {
  it('a successful ADD is reported by contact id and sticker id, once, and onUpdate(next) is never called for it', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, updates, lates } = await renderPage([PAT(), SAM([DONOR.id])]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(lates).toEqual([['c1', BOARD.id, 'add']]));
    expect(updates).toEqual([]);
    expect(screen.getByTestId('shown')).toHaveTextContent('Sam');
    expect(chipNames()).toEqual(['Donor']);
  });

  it('coming back to the first contact shows the saved sticker without a reload', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await act(async () => resolve({ status: 'added' }));
    await open(user, 'Pat');
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
  });

  it('a successful REMOVE is reported the same way, offers no Undo for a contact that is no longer on screen, and shows on return', async () => {
    let resolve;
    fake.current.state.impl.remove = () => new Promise((r) => { resolve = r; });
    const { user, updates, lates } = await renderPage([PAT([BOARD.id]), SAM([DONOR.id])]);
    await removeChip(user, 'Board');
    await open(user, 'Sam');
    await act(async () => resolve({ status: 'removed' }));
    await waitFor(() => expect(lates).toEqual([['c1', BOARD.id, 'remove']]));
    expect(updates).toEqual([]);
    expect(screen.queryByText('Removed Board')).toBeNull();
    await open(user, 'Pat');
    await waitFor(() => expect(chipNames()).toEqual([]));
  });

  it('two contacts finishing out of order are each reported under their own contact', async () => {
    const resolvers = {};
    fake.current.state.impl.add = (_uid, contactId) => new Promise((r) => { resolvers[contactId] = r; });
    const { user, updates, lates } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await pick(user, 'Gala');
    await open(user, 'Pat');
    await act(async () => resolvers.c2({ status: 'added' }));
    await act(async () => resolvers.c1({ status: 'added' }));
    await waitFor(() => expect(lates).toHaveLength(2));
    expect(lates).toEqual([['c2', GALA.id, 'add'], ['c1', BOARD.id, 'add']]);
    expect(updates).toEqual([]);
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    await open(user, 'Sam');
    await waitFor(() => expect(chipNames()).toEqual(['Gala']));
  });

  it('a failed write after moving on is not reported as a success, and shows no notice', async () => {
    let release;
    fake.current.state.impl.add = () => new Promise((_r, reject) => { release = () => reject(stickerError('write_failed')); });
    const { user, updates, lates } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await act(async () => release());
    await act(async () => {});
    expect(lates).toEqual([]);
    expect(updates).toEqual([]);
    expect(screen.queryByText("Couldn't save. Try again.")).toBeNull();
  });

  it('a caller that passes no onLateUpdate behaves exactly as before: written, nothing reported, nothing breaks', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, updates } = await renderPage([PAT(), SAM([DONOR.id])], { withLate: false });
    await pick(user, 'Board');
    await open(user, 'Sam');
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]));
    expect(updates).toEqual([]);
    expect(chipNames()).toEqual(['Donor']);
    await open(user, 'Pat');
    await waitFor(() => expect(chipNames()).toEqual([]));
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('a write that finishes while its row is still on screen', () => {
  it('is reported through onUpdate(next) as always, and never through onLateUpdate', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, updates, lates } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ id: 'c1', sticker_ids: [BOARD.id] });
    expect(lates).toEqual([]);
  });

  it('Retry and Undo keep working: Undo after a removal writes once and reports through onUpdate', async () => {
    const { user, updates, lates } = await renderPage([PAT([BOARD.id])]);
    await removeChip(user, 'Board');
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('removeSticker')).toHaveLength(1);
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    expect(updates).toHaveLength(2);
    expect(lates).toEqual([]);
  });

  it('a failed add keeps its Retry, and the Retry is one more write', async () => {
    let first = true;
    fake.current.state.impl.add = async () => { if (first) { first = false; throw stickerError('write_failed'); } return { status: 'added' }; };
    const { user, lates } = await renderPage([PAT()]);
    await pick(user, 'Board');
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toHaveLength(2);
    expect(lates).toEqual([]);
  });
});

describe('the M2-A duplicate-write guard', () => {
  it('still refuses a second add of the same sticker while the first is pending', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderPage([PAT()]);
    await pick(user, 'Board');
    await pick(user, 'Board');
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  // The guard is held by the page's StickersProvider (one per account and page), not by a row, so a row that
  // is made fresh (the person left the contact and came back) still knows an add is in flight.
  it('refuses the same sticker again after leaving the contact and coming back while the first add is still in flight', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await open(user, 'Pat');
    await pick(user, 'Board');
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('lets the same sticker be sent again once the first add has failed, from a fresh row', async () => {
    let first = true;
    let reject;
    fake.current.state.impl.add = () => (first ? new Promise((_r, rej) => { first = false; reject = rej; }) : Promise.resolve({ status: 'added' }));
    const { user } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await open(user, 'Pat');
    await act(async () => reject(stickerError('write_failed')));
    await pick(user, 'Board');
    expect(fake.current.callsOf('addSticker')).toHaveLength(2);
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
  });

  it('frees the guard when the first add succeeds after the row was gone (the sticker is on the contact, so it is shown as chosen)', async () => {
    let finish;
    fake.current.state.impl.add = () => new Promise((r) => { finish = r; });
    const { user } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await act(async () => finish({ status: 'added' }));
    await open(user, 'Pat');
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    await user.click(addButton());
    expect(screen.getByRole('option', { name: 'Board' })).toHaveAttribute('aria-selected', 'true');
    expect(fake.current.callsOf('addSticker')).toHaveLength(1);
  });

  it('does not stop the same sticker being added to a DIFFERENT contact while the first is in flight', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const { user } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    await open(user, 'Sam');
    await pick(user, 'Board');
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id], ['u1', 'c2', BOARD.id]]);
  });

  it('is per account: another account\'s page (its own provider) is not held up by this one\'s pending add', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    fake.current.state.registry = [BOARD, DONOR, GALA];
    fake.current.state.config = config();
    const user = userEvent.setup();
    const both = render(
      <>
        <div data-testid="a"><StickersProvider uid="u1"><ContactStickersRow contact={PAT()} /></StickersProvider></div>
        <div data-testid="b"><StickersProvider uid="u2"><ContactStickersRow contact={PAT()} /></StickersProvider></div>
      </>,
    );
    const first = await within(both.getByTestId('a')).findByRole('button', { name: 'Add sticker' });
    await user.click(first);
    await user.click(screen.getByRole('option', { name: 'Board' }));
    const second = await within(both.getByTestId('b')).findByRole('button', { name: 'Add sticker' });
    await user.click(second);
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id], ['u2', 'c1', BOARD.id]]);
  });

  it('with a sticker value that carries no registry of its own (no provider), the guard is still per instance', async () => {
    fake.current.state.impl.add = () => new Promise(() => {});
    const bare = { uid: 'u1', byId: new Map(), active: [], all: [], recheck() {}, notify() {} };
    const { result } = renderHook(() => useContactStickers({ contact: PAT(), stickers: bare }));
    await act(async () => { result.current.change('add', BOARD); result.current.change('add', BOARD); });
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });
});

describe('account safety: the late report is for the account that made the write', () => {
  const runLate = async (change) => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const view = await renderPage([PAT(), SAM()]);
    await pick(view.user, 'Board');
    await open(view.user, 'Sam');
    change();
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(fake.current.callsOf('addSticker')).toHaveLength(1));
    await act(async () => {});
    return view;
  };

  it('is delivered when the same account is still the effective one', async () => {
    const { lates } = await runLate(() => { viewer.value = { uid: 'u1' }; });
    expect(lates).toEqual([['c1', BOARD.id, 'add']]);
  });

  it('is suppressed when another account is now the effective one (an account switch)', async () => {
    const { lates, updates } = await runLate(() => { viewer.value = { uid: 'u2' }; });
    expect(lates).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('is suppressed when the effective account became an impersonated one', async () => {
    const { lates } = await runLate(() => { viewer.value = { uid: 'target', _isImpersonated: true }; });
    expect(lates).toEqual([]);
  });

  it('is suppressed after sign-out', async () => {
    const { lates } = await runLate(() => { viewer.value = null; });
    expect(lates).toEqual([]);
  });

  it('is suppressed if the account lookup itself fails', async () => {
    const { lates } = await runLate(() => { viewer.value = { get uid() { throw new Error('no session'); } }; });
    expect(lates).toEqual([]);
  });
});

describe('the whole page going away while a write is pending', () => {
  it('still reports the finished write by id (the parent chose to be told), and React has nothing to warn about', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, unmount, updates, lates } = await renderPage([PAT(), SAM()]);
    await pick(user, 'Board');
    unmount();
    await act(async () => resolve({ status: 'added' }));
    await waitFor(() => expect(lates).toEqual([['c1', BOARD.id, 'add']]));
    expect(updates).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it('reports nothing when the account changed before the page went away', async () => {
    let resolve;
    fake.current.state.impl.add = () => new Promise((r) => { resolve = r; });
    const { user, unmount, lates } = await renderPage([PAT()]);
    await pick(user, 'Board');
    unmount();
    viewer.value = { uid: 'u2' };
    await act(async () => resolve({ status: 'added' }));
    await act(async () => {});
    expect(lates).toEqual([]);
  });
});
