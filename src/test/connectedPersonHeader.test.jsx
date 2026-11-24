/* global process */
/**
 * ConnectedPersonHeader: the redesigned profile's header on the REAL controllers (identity editing, photo editing,
 * the shared sticker behaviour), the real photo viewer, the real picker and the real StickersProvider. Only the
 * persistence is a stand-in: Firestore (settled by the test) and the sticker services (the fake backend).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, useCallback } from 'react';
import { render, screen, act, waitFor, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeStickers, sticker, config } from './helpers/stickersUi';

const fb = vi.hoisted(() => ({ writes: [] }));
const fake = vi.hoisted(() => ({ current: null }));
const viewer = vi.hoisted(() => ({ value: { uid: 'u1' } }));
vi.mock('../firebase/config', () => ({ db: { __db: true }, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db, ...segments) => ({ path: segments.join('/') }),
  updateDoc: (ref, data) => new Promise((resolveWrite, rejectWrite) => { fb.writes.push({ path: ref.path, data, resolve: resolveWrite, reject: rejectWrite }); }),
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => viewer.value,
  useImpersonation: () => ({ isImpersonating: Boolean(viewer.value?._isImpersonated) }),
}));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
}));

import ConnectedPersonHeader from '../components/contacts/personHeader/ConnectedPersonHeader';
import { StickersProvider } from '../components/stickers/StickersContext';
import { withMembershipChange } from '../services/stickers/stickerCore';

configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 20000 });

const BOARD = sticker('Board', { color: 'blue' });
const DONOR = sticker('Donor', { color: 'amber' });
const WITH_PHOTO = { id: 'c1', name: 'Jordan Lee', title: 'Partner', company_name: 'Acme', photo_url: 'https://images.example.com/jordan.jpg', photo_source: 'apollo', sticker_ids: [DONOR.id], emails: [{ id: '0', value: 'j@acme.test' }] };
const NO_PHOTO = { id: 'c2', name: 'Avery Quinn', title: 'Director', sticker_ids: [] };
const CSV = { id: 'c3', first_name: 'Morgan', last_name: 'Ellis' };

let patches;
let lates;
function Page({ contacts }) {
  const [byId, setById] = useState(() => Object.fromEntries(contacts.map((c) => [c.id, c])));
  const [currentId, setCurrentId] = useState(contacts[0].id);
  const onPatch = useCallback((id, fields) => { patches.push([id, { ...fields }]); setById((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } })); }, []);
  const onLate = useCallback((id, stickerId, op) => { lates.push([id, stickerId, op]); setById((prev) => ({ ...prev, [id]: withMembershipChange(prev[id], stickerId, op) })); }, []);
  return (
    <StickersProvider uid="u1">
      <ConnectedPersonHeader contact={byId[currentId]} onPatch={onPatch} onLateStickerChange={onLate} />
      {contacts.map((c) => <button key={c.id} type="button" onClick={() => setCurrentId(c.id)}>{`Open ${c.id}`}</button>)}
      <button type="button">Elsewhere</button>
    </StickersProvider>
  );
}

async function draw(contacts, { registry = [BOARD, DONOR], answer = config(), waitForStickers = true } = {}) {
  fake.current.state.registry = registry;
  fake.current.state.config = answer;
  const user = userEvent.setup();
  const view = render(<Page contacts={contacts} />);
  await screen.findByRole('article');
  if (waitForStickers) await screen.findByRole('list', { name: 'Stickers' });
  return { ...view, user };
}
const ok = (i) => act(async () => { fb.writes[i].resolve(); });
const fail = (i, code = 'unavailable') => act(async () => { const e = new Error('x'); e.code = code; fb.writes[i].reject(e); });
const pillNames = () => [...document.querySelectorAll('.ph-sticker-name')].map((n) => n.textContent);

beforeEach(() => {
  fake.current = createFakeStickers();
  fb.writes = [];
  patches = [];
  lates = [];
  viewer.value = { uid: 'u1' };
  window.localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('the header', () => {
  it('shows the contact: the name as the page heading, the subtitle, the stickers and the contact details', async () => {
    await draw([WITH_PHOTO]);
    expect(screen.getByRole('heading', { level: 1, name: 'Jordan Lee' })).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(pillNames()).toEqual(['Donor']);
    expect(screen.getByRole('link', { name: 'Email j@acme.test' })).toBeInTheDocument();
  });

  it('shows a CSV contact by its first and last name', async () => {
    await draw([CSV]);
    expect(screen.getByRole('heading', { name: 'Morgan Ellis' })).toBeInTheDocument();
  });
});

describe('editing name, title and organization', () => {
  it('saves a title once, to the contact\'s own document, and shows it at once; the parent is told only that field', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Chief of Staff{Enter}');
    expect(fb.writes).toHaveLength(1);
    expect(fb.writes[0].path).toBe('users/u1/contacts/c1');
    expect(Object.keys(fb.writes[0].data).sort()).toEqual(['title', 'updated_at']);
    expect(screen.getByText('Chief of Staff')).toBeInTheDocument();
    expect(patches).toEqual([['c1', { title: 'Chief of Staff' }]]);
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveFocus();
    await ok(0);
    expect(screen.getByText('Chief of Staff')).toBeInTheDocument();
  });

  it('a CSV contact\'s name is edited from the name it is shown with, and only name is written', async () => {
    const { user } = await draw([CSV]);
    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Morgan Ellis');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Jr.{Enter}');
    expect(Object.keys(fb.writes[0].data).sort()).toEqual(['name', 'updated_at']);
    expect(screen.getByRole('heading', { name: 'Morgan Ellis Jr.' })).toBeInTheDocument();
  });

  it('says "Name can\'t be empty." for a blank name, keeps the box open, and writes nothing', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Edit name' }));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.keyboard('{Enter}');
    expect(screen.getByText("Name can't be empty.", { selector: '.ph-editor-msg' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(fb.writes).toEqual([]);
  });

  it('a failed save restores the old text, gives back what was typed with a clear message and a Try again, which writes it again', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'VP{Enter}');
    await fail(0, 'unavailable');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('VP');
    expect(screen.getByText(/Couldn't save the title\. Check your connection/, { selector: '.ph-editor-msg' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fb.writes).toHaveLength(2);
    expect(fb.writes[1].data.title).toBe('VP');
    await ok(1);
    expect(screen.getByText('VP')).toBeInTheDocument();
  });

  it('a permission failure says so in plain words', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'x{Enter}');
    await fail(0, 'permission-denied');
    expect(screen.getByText("You don't have permission to change this contact.", { selector: '.ph-editor-msg' })).toBeInTheDocument();
  });

  it('Cancel after a failure clears the message, and the old title stays', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'x{Enter}');
    await fail(0);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Couldn't save/, { selector: '.ph-editor-msg, .ph-field-msg' })).toBeNull();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveFocus();
  });

  it('offers no edit control in an impersonated session, and writes nothing', async () => {
    viewer.value = { uid: 'target', _isImpersonated: true };
    await draw([WITH_PHOTO], { waitForStickers: false });
    expect(screen.queryByRole('button', { name: /^(Edit|Add) / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull();
    expect(fb.writes).toEqual([]);
  });
});

describe('the photo', () => {
  it('opens the existing viewer from the photo, and Escape returns focus to the photo button', async () => {
    const { user } = await draw([WITH_PHOTO]);
    const button = screen.getByRole('button', { name: 'View photo of Jordan Lee' });
    await user.click(button);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(button).toHaveFocus();
  });

  it('adds a photo: refuses a link that is not https with a message, then saves one and shows it', async () => {
    const { user } = await draw([NO_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Add photo for Avery Quinn' }));
    const box = screen.getByRole('textbox', { name: 'Link to a photo (https)' });
    expect(box).toHaveFocus();
    await user.type(box, 'http://images.example.com/a.jpg');
    await user.click(screen.getByRole('button', { name: 'Add photo' }));
    expect(screen.getByText('Use a link that starts with https://', { selector: '.ph-editor-msg' })).toBeInTheDocument();
    expect(fb.writes).toEqual([]);
    await user.clear(box);
    await user.type(box, 'https://images.example.com/a.jpg{Enter}');
    expect(fb.writes).toHaveLength(1);
    expect(fb.writes[0].path).toBe('users/u1/contacts/c2');
    expect(fb.writes[0].data).toMatchObject({ photo_url: 'https://images.example.com/a.jpg', photo_source: 'manual_url' });
    await ok(0);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Add photo' })).toBeNull());
    expect(screen.getByRole('button', { name: 'View photo of Avery Quinn' })).toBeInTheDocument();
    expect(patches.at(-1)).toEqual(['c2', { photo_url: 'https://images.example.com/a.jpg', photo_source: 'manual_url' }]);
  });

  it('replaces a photo from Change photo, and Cancel returns focus to Change photo', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Change photo' }));
    expect(screen.getByRole('group', { name: 'Change photo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Change photo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change photo' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Change photo' }));
    await user.type(screen.getByRole('textbox', { name: 'Link to a photo (https)' }), 'https://images.example.com/new.jpg');
    await user.click(screen.getByRole('button', { name: 'Replace photo' }));
    expect(fb.writes[0].data).toMatchObject({ photo_url: 'https://images.example.com/new.jpg', photo_source: 'manual_url' });
    await ok(0);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Change photo' })).toBeNull());
  });

  it('removes a photo only after one more confirmation, writing an empty address and leaving the rest alone', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Change photo' }));
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(fb.writes).toEqual([]);
    expect(screen.getByText(/Remove this photo\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(Object.keys(fb.writes[0].data).sort()).toEqual(['photo_url', 'updated_at']);
    expect(fb.writes[0].data.photo_url).toBe('');
    await ok(0);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Add photo for Jordan Lee' })).toBeInTheDocument();
  });

  it('a failed photo save keeps the panel open with the typed link and says why; the old photo is back', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Change photo' }));
    await user.type(screen.getByRole('textbox', { name: 'Link to a photo (https)' }), 'https://images.example.com/new.jpg{Enter}');
    await fail(0, 'unavailable');
    expect(screen.getByRole('textbox', { name: 'Link to a photo (https)' })).toHaveValue('https://images.example.com/new.jpg');
    expect(screen.getByText(/Couldn't save the photo/, { selector: '.ph-editor-msg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View photo of Jordan Lee' })).toBeInTheDocument();
  });

  it('a read-only session may view a photo but not change it, and a contact with no photo has no add control', async () => {
    viewer.value = { uid: 'target', _isImpersonated: true };
    const { user, unmount } = await draw([WITH_PHOTO], { waitForStickers: false });
    await user.click(screen.getByRole('button', { name: 'View photo of Jordan Lee' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull();
    unmount();
    await draw([NO_PHOTO], { waitForStickers: false });
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull();
  });

  it('closes the photo panel when the person leaves it', async () => {
    const { user } = await draw([NO_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Add photo for Avery Quinn' }));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('group', { name: 'Add photo' })).toBeNull();
  });
});

describe('stickers', () => {
  it('adds one through the shared picker: it opens beside the chip, a pick writes once, the pill is busy until it lands, then the chip has focus', async () => {
    const { user } = await draw([WITH_PHOTO]);
    const add = screen.getByRole('button', { name: 'Add sticker' });
    await user.click(add);
    const picker = document.querySelector('.stk-picker');
    expect(picker.parentElement).toBe(add.parentElement);
    let finish;
    fake.current.state.impl.add = () => new Promise((r) => { finish = r; });
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    expect(screen.getByText('Board', { selector: '.ph-sticker-name' }).closest('li')).toHaveAttribute('aria-busy', 'true');
    expect(add).toHaveFocus();
    await act(async () => finish({ status: 'added' }));
    await waitFor(() => expect(screen.getByText('Board', { selector: '.ph-sticker-name' }).closest('li')).not.toHaveAttribute('aria-busy'));
    expect(patches.at(-1)).toEqual(['c1', { sticker_ids: [DONOR.id, BOARD.id] }]);
  });

  it('refuses a second add of the same sticker while the first is pending (one write)', async () => {
    const { user } = await draw([WITH_PHOTO]);
    fake.current.state.impl.add = () => new Promise(() => {});
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('removes one with an accessible button, offers Undo, and Undo adds it back', async () => {
    const { user } = await draw([WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Remove sticker Donor' }));
    expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'c1', DONOR.id]]);
    expect(await screen.findByText('Removed Donor')).toBeInTheDocument();
    expect(pillNames()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(pillNames()).toEqual(['Donor']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', DONOR.id]]);
  });

  it('removes the sticker that was pressed, not just the first one', async () => {
    const { user } = await draw([{ ...WITH_PHOTO, sticker_ids: [BOARD.id, DONOR.id] }]);
    expect(pillNames()).toEqual(['Board', 'Donor']);
    await user.click(screen.getByRole('button', { name: 'Remove sticker Donor' }));
    expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'c1', DONOR.id]]);
    await waitFor(() => expect(pillNames()).toEqual(['Board']));
  });

  it('reports a sticker change under the id of the contact on screen, whichever contact that is', async () => {
    const { user } = await draw([WITH_PHOTO, NO_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Open c2' }));
    await screen.findByRole('heading', { name: 'Avery Quinn' });
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c2', BOARD.id]]);
    await waitFor(() => expect(patches.at(-1)).toEqual(['c2', { sticker_ids: [BOARD.id] }]));
  });

  it('a failed add says so, offers Retry, and Retry adds it', async () => {
    const { user } = await draw([WITH_PHOTO]);
    let first = true;
    fake.current.state.impl.add = async () => { if (first) { first = false; const { stickerError } = await import('./helpers/stickersUi'); throw stickerError('write_failed'); } return { status: 'added' }; };
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(pillNames()).toContain('Board'));
    expect(fake.current.callsOf('addSticker')).toHaveLength(2);
  });

  it('draws no sticker area, and no controls, where stickers are unavailable, and identity editing still works', async () => {
    const { user } = await draw([WITH_PHOTO], { answer: config({ enabled: false, mode: 'off', readOnly: false }), waitForStickers: false });
    await act(async () => {});
    expect(screen.queryByRole('list', { name: 'Stickers' })).toBeNull();
    expect(screen.queryByRole('button', { name: /sticker/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  });

  it('draws no sticker controls for a read-only sticker answer (an admin viewing as the user)', async () => {
    await draw([WITH_PHOTO], { answer: config({ enabled: true, mode: 'beta', readOnly: true }), waitForStickers: false });
    await act(async () => {});
    expect(screen.queryByRole('list', { name: 'Stickers' })).toBeNull();
  });

  it('a result that arrives after moving to another contact goes to the contact it was for, by id, and shows when the person comes back', async () => {
    const { user } = await draw([WITH_PHOTO, NO_PHOTO]);
    let finish;
    fake.current.state.impl.add = () => new Promise((r) => { finish = r; });
    await user.click(screen.getByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await user.click(screen.getByRole('button', { name: 'Open c2' }));
    await screen.findByRole('heading', { name: 'Avery Quinn' });
    expect(document.querySelector('.ph-sticker[aria-busy="true"]')).toBeNull();
    await act(async () => finish({ status: 'added' }));
    await waitFor(() => expect(lates).toEqual([['c1', BOARD.id, 'add']]));
    expect(pillNames()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Open c1' }));
    await waitFor(() => expect(pillNames().sort()).toEqual(['Board', 'Donor']));
  });
});

describe('one contact at a time', () => {
  it('moving to another contact leaves the open box (which saves it, as leaving always does) to the contact it was typed on, and the next contact starts with nothing open', async () => {
    const { user } = await draw([NO_PHOTO, WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), ' of Sales');
    await user.click(screen.getByRole('button', { name: 'Open c1' }));
    await screen.findByRole('heading', { name: 'Jordan Lee' });
    expect(fb.writes).toHaveLength(1);
    expect(fb.writes[0].path).toBe('users/u1/contacts/c2');
    expect(fb.writes[0].data.title).toBe('Director of Sales');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(patches.every(([id]) => id === 'c2')).toBe(true);
  });

  it('moving to another contact closes an open photo panel', async () => {
    const { user } = await draw([NO_PHOTO, WITH_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Add photo for Avery Quinn' }));
    expect(screen.getByRole('group', { name: 'Add photo' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open c1' }));
    await screen.findByRole('heading', { name: 'Jordan Lee' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(fb.writes).toEqual([]);
  });

  it('a failed save that arrives after moving on restores the contact it was for and touches no other', async () => {
    const { user } = await draw([WITH_PHOTO, NO_PHOTO]);
    await user.click(screen.getByRole('button', { name: 'Edit title' }));
    await user.clear(screen.getByRole('textbox', { name: 'Title' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'VP{Enter}');
    await user.click(screen.getByRole('button', { name: 'Open c2' }));
    await fail(0);
    expect(patches.at(-1)).toEqual(['c1', { title: 'Partner' }]);
    expect(screen.getByText('Director')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't save/)).toBeNull();
  });
});

it('shows the pending add after remount, counts it toward the limit, and allows another add after removal', async () => {
  const stored = Array.from({ length: 49 }, (_, i) => sticker(`Stored ${i}`));
  let settle;
  fake.current.state.impl.add = () => new Promise((resolveAdd) => { settle = resolveAdd; });
  const { user } = await draw(
    [{ ...WITH_PHOTO, sticker_ids: stored.map(({ id }) => id) }, NO_PHOTO],
    { registry: [...stored, BOARD, DONOR] },
  );
  const openPicker = () => user.click(screen.getByRole('button', { name: 'Add sticker' }));
  const board = () => screen.getByRole('option', { name: 'Board' });
  await openPicker();
  await user.click(board());
  await user.click(screen.getByRole('button', { name: 'Open c2' }));
  expect(pillNames()).not.toContain('Board');
  await user.click(screen.getByRole('button', { name: 'Open c1' }));
  expect(screen.getByText('Board', { selector: '.ph-sticker-name' }).closest('li')).toHaveAttribute('aria-busy', 'true');
  await openPicker();
  expect(board()).toHaveAttribute('aria-busy', 'true');
  expect(board()).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('option', { name: 'Donor' })).toHaveAttribute('aria-disabled', 'true');
  await user.click(board());
  expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);

  await act(async () => settle({ status: 'added' }));
  expect(board()).toHaveAttribute('aria-selected', 'true');
  expect(board()).not.toHaveAttribute('aria-busy');
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Remove sticker Board' }));
  await user.click(await screen.findByRole('button', { name: 'Undo' }));
  expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id], ['u1', 'c1', BOARD.id]]);
  await act(async () => settle({ status: 'added' }));
});

describe('ConnectedPersonHeader stays thin', () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const source = strip(readFileSync(resolve(process.cwd(), 'src/components/contacts/personHeader/ConnectedPersonHeader.jsx'), 'utf8'));

  it('imports the controllers and the existing viewer and picker, and no Firebase, service or account module of its own', () => {
    const imports = [...source.matchAll(/(?:^|\n)\s*import\b[^'"]*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const from of imports) expect(from, from).not.toMatch(/firebase|services\/|ImpersonationContext|contactFields|contactStickers|stickerService/);
    expect(source).not.toMatch(/updateDoc|getEffectiveUser|saveContactFields|addSticker\(|removeSticker\(/);
  });

  it('never spells the sticker membership field itself (only stickerCore does)', () => {
    expect(source).not.toMatch(/sticker_ids|sticker_assignments|sticker_change/);
  });
});
