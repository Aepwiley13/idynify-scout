/**
 * Stickers on a People card or list row, with add and remove in place
 * (ContactCardStickersInteractive). It behaves like the Contact Profile row
 * (contactStickersRow.test.jsx): same picker, nothing optimistic, remove with
 * Undo, same messages.
 *
 * The real StickersProvider, component, picker, chip and toast; the services
 * and the stickersConfig call are fakes (helpers/stickersUi.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor, configure } from '@testing-library/react';
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
const OLD = sticker('Old', { status: 'archived' });

/**
 * A card as People hosts it: the page owns the contacts, applies each
 * confirmed change by id, and can hide a card (a sticker filter).
 */
function Page({ initial, max = 2, filterId = null, onOpen }) {
  const [contacts, setContacts] = useState(initial);
  const apply = (contactId, stickerId, op) =>
    setContacts((prev) => prev.map((c) => (c.id === contactId ? withMembershipChange(c, stickerId, op) : c)));
  const shown = filterId ? contacts.filter((c) => (c.sticker_ids ?? []).includes(filterId)) : contacts;
  return (
    <StickersProvider uid="u1">
      {shown.map((c) => (
        <div key={c.id} data-testid={`card-${c.id}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen?.()}>
          <span>{c.name}</span>
          <ContactCardStickersInteractive contact={c} max={max} onUpdate={apply} />
        </div>
      ))}
      <div data-testid="ids">{contacts.map((c) => `${c.id}:${(c.sticker_ids ?? []).join('+')}`).join(' ')}</div>
    </StickersProvider>
  );
}

const pat = (ids, extra = {}) => ({ id: 'c1', name: 'Pat', sticker_ids: ids, tags: ['gala-2024'], ...extra });

async function renderCard(contacts, { registry = [BOARD, DONOR, GALA], answer = config(), ...props } = {}) {
  fake.current.state.registry = registry;
  fake.current.state.config = answer;
  const user = userEvent.setup();
  const onOpen = vi.fn();
  const view = render(<Page initial={contacts} onOpen={onOpen} {...props} />);
  if (answer.body?.enabled && answer.body?.readOnly === false) {
    await screen.findAllByTestId('card-stickers-interactive');
  }
  return { ...view, user, onOpen };
}

const chipNames = (scope = document.body) => [...scope.querySelectorAll('[data-testid="card-stickers"] .stk-name')].map((n) => n.textContent);

beforeEach(() => {
  fake.current = createFakeStickers();
  viewer.value = { uid: 'u1' };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('Card and list-row stickers: add and remove in place', () => {
  it('renders nothing while unavailable', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    const { container } = render(<Page initial={[pat([BOARD.id])]} />);
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    expect(container.querySelector('[data-testid="card-stickers-interactive"]')).toBeNull();
  });

  it('renders nothing while an admin views as another user', async () => {
    viewer.value = { uid: 'u1', _isImpersonated: true };
    const { container } = render(<Page initial={[pat([BOARD.id])]} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[data-testid="card-stickers-interactive"]')).toBeNull();
  });

  it('shows up to max active stickers; "+n" counts active ones only, never archived or unknown', async () => {
    await renderCard([pat([BOARD.id, DONOR.id, GALA.id, OLD.id, 'Sgone00000000000000'])], { registry: [BOARD, DONOR, GALA, OLD] });
    expect(chipNames()).toEqual(['Board', 'Donor']);
    expect(screen.getByLabelText('1 more sticker')).toHaveTextContent('+1');
  });

  it('with only archived stickers, no chips and no "+n", but the add button', async () => {
    await renderCard([pat([OLD.id])], { registry: [BOARD, OLD] });
    expect(screen.queryByTestId('card-stickers')).toBeNull();
    expect(screen.queryByText(/^\+\d/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add sticker to Pat' })).toBeInTheDocument();
  });

  it('a list row (max 1) shows one chip and "+n" for the rest', async () => {
    await renderCard([pat([BOARD.id, DONOR.id, GALA.id])], { max: 1 });
    expect(chipNames()).toEqual(['Board']);
    expect(screen.getByLabelText('2 more stickers')).toHaveTextContent('+2');
  });

  it('adds from the card through the picker, without opening the contact', async () => {
    const { user, onOpen } = await renderCard([pat([])]);
    const add = screen.getByRole('button', { name: 'Add sticker to Pat' });
    expect(add).toHaveAttribute('aria-expanded', 'false');
    await user.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('option', { name: 'Donor' }));
    await waitFor(() => expect(chipNames()).toEqual(['Donor']));
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', DONOR.id]]);
    expect(screen.getByTestId('ids')).toHaveTextContent(`c1:${DONOR.id}`);
    expect(add).toHaveFocus();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keyboard: Enter opens the picker (not the card), Escape closes it and focus returns', async () => {
    const { user, onOpen } = await renderCard([pat([])]);
    screen.getByRole('button', { name: 'Add sticker to Pat' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Add a sticker' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add sticker to Pat' })).toHaveFocus();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('creates a sticker inline and adds it, once each', async () => {
    const { user } = await renderCard([pat([])], { registry: [BOARD] });
    await user.click(screen.getByRole('button', { name: 'Add sticker to Pat' }));
    await user.type(screen.getByRole('combobox'), 'Volunteer');
    await user.click(screen.getByRole('option', { name: 'Create sticker “Volunteer”' }));
    await waitFor(() => expect(chipNames()).toEqual(['Volunteer']));
    expect(fake.current.callsOf('createSticker')).toHaveLength(1);
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', sid('Volunteer')]]);
  });

  it('an add is pending until it resolves; nothing optimistic', async () => {
    let finish;
    fake.current.state.impl.add = () => new Promise((r) => { finish = r; });
    const { user } = await renderCard([pat([])]);
    await user.click(screen.getByRole('button', { name: 'Add sticker to Pat' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    const chip = await screen.findByText('Board', { selector: '.stk-name' });
    expect(chip.closest('.stk-chip')).toHaveAttribute('data-pending', 'true');
    expect(screen.getByTestId('ids')).toHaveTextContent(/^c1:$/);
    finish({ status: 'added' });
    await waitFor(() => expect(screen.getByTestId('ids')).toHaveTextContent(`c1:${BOARD.id}`));
    await waitFor(() => expect(chip.closest('.stk-chip')).not.toHaveAttribute('data-pending'));
  });

  it('removes from the card with Undo, like the profile; Undo adds it back', async () => {
    const { user, onOpen } = await renderCard([pat([BOARD.id])]);
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
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('Undo works after a sticker filter hid the card: the card comes back', async () => {
    const { user } = await renderCard([pat([BOARD.id]), { id: 'c2', name: 'Sam', sticker_ids: [BOARD.id] }], { filterId: BOARD.id });
    await user.click(within(screen.getByTestId('card-c1')).getByRole('button', { name: 'Remove sticker Board' }));
    await waitFor(() => expect(screen.queryByTestId('card-c1')).toBeNull());
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByTestId('card-c1')).toBeInTheDocument());
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c1', BOARD.id]]);
    expect(fake.current.callsOf('removeSticker')).toEqual([['u1', 'c1', BOARD.id]]);
  });

  it('each card writes to its own contact', async () => {
    const { user } = await renderCard([pat([]), { id: 'c2', name: 'Sam', sticker_ids: [] }]);
    await user.click(screen.getByRole('button', { name: 'Add sticker to Sam' }));
    await user.click(screen.getByRole('option', { name: 'Gala' }));
    await waitFor(() => expect(chipNames(screen.getByTestId('card-c2'))).toEqual(['Gala']));
    expect(chipNames(screen.getByTestId('card-c1'))).toEqual([]);
    expect(fake.current.callsOf('addSticker')).toEqual([['u1', 'c2', GALA.id]]);
  });

  it('a write_denied refusal says so and re-checks; when access is gone the controls disappear', async () => {
    fake.current.state.impl.add = async () => { throw stickerError('permission_denied', 'write_denied'); };
    const { user, container } = await renderCard([pat([])]);
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    await user.click(screen.getByRole('button', { name: 'Add sticker to Pat' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await waitFor(() => expect(fake.current.state.configFetches).toBe(2));
    await waitFor(() => expect(container.querySelector('[data-testid="card-stickers-interactive"]')).toBeNull());
    expect(screen.getByTestId('ids')).toHaveTextContent(/^c1:$/);
  });

  it('a failed write offers Retry, which tries once more', async () => {
    let attempts = 0;
    fake.current.state.impl.add = async () => { attempts += 1; if (attempts === 1) throw stickerError('write_failed'); return { status: 'added' }; };
    const { user } = await renderCard([pat([])]);
    await user.click(screen.getByRole('button', { name: 'Add sticker to Pat' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(chipNames()).toEqual(['Board']));
    expect(fake.current.callsOf('addSticker')).toHaveLength(2);
  });
});
