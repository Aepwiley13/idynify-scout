/**
 * S6 components on their own: the Sticker filter chip (counts, choose,
 * clear, keyboard) and the bulk "Add sticker" action (progress, summary,
 * details, retry for the failed only, revoked access).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeStickers, sticker, config, stickerError } from './helpers/stickersUi';

const fake = vi.hoisted(() => ({ current: null }));
vi.mock('../components/stickers/stickersApi.js', () => ({ fetchStickersConfig: (...a) => fake.current.services.fetchStickersConfig(...a) }));
vi.mock('../services/stickerService', () => ({
  subscribeStickers: (...a) => fake.current.services.subscribeStickers(...a),
  createSticker: (...a) => fake.current.services.createSticker(...a),
}));
vi.mock('../services/contactStickers', () => ({
  addSticker: (...a) => fake.current.services.addSticker(...a),
  removeSticker: (...a) => fake.current.services.removeSticker(...a),
  addStickerToContacts: (...a) => fake.current.services.addStickerToContacts(...a),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));

import { StickersProvider } from '../components/stickers/StickersContext';
import { useStickers } from '../components/stickers/stickersRegistry';
import StickerFilterChip from '../components/stickers/StickerFilterChip';
import BulkStickerAction from '../components/stickers/BulkStickerAction';

const BOARD = sticker('Board', { color: 'blue' });
const DONOR = sticker('Donor', { color: 'amber' });

beforeEach(() => {
  fake.current = createFakeStickers();
  fake.current.state.registry = [BOARD, DONOR];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function Ready({ children }) {
  const { ready } = useStickers();
  return ready ? children : <span>loading</span>;
}

describe('StickerFilterChip', () => {
  function Host({ contacts, onSelect = () => {} }) {
    const [selectedId, setSelectedId] = useState(null);
    return (
      <StickersProvider uid="u1">
        <Ready>
          <Picker contacts={contacts} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); onSelect(id); }} />
        </Ready>
      </StickersProvider>
    );
  }
  function Picker({ contacts, selectedId, onSelect }) {
    const { byId } = useStickers();
    return <StickerFilterChip selected={selectedId ? byId.get(selectedId) : null} contacts={contacts} onSelect={onSelect} />;
  }

  it('lists active stickers with how many of the given people have each', async () => {
    const user = userEvent.setup();
    render(<Host contacts={[{ id: 'a', sticker_ids: [BOARD.id] }, { id: 'b', sticker_ids: [BOARD.id, DONOR.id] }, { id: 'c' }]} />);
    await user.click(await screen.findByRole('button', { name: 'Filter by sticker' }));
    const group = screen.getByRole('group', { name: 'Filter by sticker' });
    expect(within(group).getByRole('button', { name: 'Board, 2 people' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Donor, 1 person' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Board, 2 people' })).toHaveFocus();
  });

  it('choosing filters by that sticker; the clear button clears it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Host contacts={[]} onSelect={onSelect} />);
    await user.click(await screen.findByRole('button', { name: 'Filter by sticker' }));
    await user.click(screen.getByRole('button', { name: /^Donor/ }));
    expect(onSelect).toHaveBeenLastCalledWith(DONOR.id);
    expect(screen.getByRole('button', { name: 'Sticker filter: Donor' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Clear sticker filter' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('keyboard: arrows move, Escape closes and returns focus', async () => {
    const user = userEvent.setup();
    render(<Host contacts={[]} />);
    await user.click(await screen.findByRole('button', { name: 'Filter by sticker' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^Donor/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: /^Board/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Filter by sticker' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter by sticker' })).toHaveFocus();
  });

  it('renders nothing when stickers are unavailable', async () => {
    fake.current.state.config = config({ enabled: false, mode: 'off', readOnly: false });
    render(<StickersProvider uid="u1"><StickerFilterChip selected={null} contacts={[]} onSelect={() => {}} /></StickersProvider>);
    await waitFor(() => expect(fake.current.state.configFetches).toBe(1));
    expect(screen.queryByRole('button', { name: 'Filter by sticker' })).toBeNull();
  });
});

describe('BulkStickerAction', () => {
  const names = { k1: 'Ana', k2: 'Ben', k3: 'Cy', k4: 'Dee' };
  function Host({ initial = ['k1', 'k2', 'k3', 'k4'], spy }) {
    const [selected, setSelected] = useState(new Set(initial));
    const [running, setRunning] = useState(false);
    return (
      <StickersProvider uid="u1">
        <Ready>
          <BulkStickerAction
            selectedIds={selected}
            nameOf={(id) => names[id]}
            onApplied={(...a) => spy.applied.push(a)}
            onReduceSelection={(ids) => setSelected(new Set(ids))}
            onRunningChange={setRunning}
          />
          <button type="button" disabled={running}>Export</button>
          <span data-testid="selected">{[...selected].join(',')}</span>
        </Ready>
      </StickersProvider>
    );
  }

  it('AT-6-07: one call for the selection; a summary with details naming each failure', async () => {
    const user = userEvent.setup();
    const spy = { applied: [] };
    fake.current.state.impl.bulk = async () => ({ added: ['k1'], already: ['k2', 'k3'], failed: [{ contactId: 'k4', code: 'limit_reached', reason: null }] });
    render(<Host spy={spy} />);
    await user.click(await screen.findByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    const region = await screen.findByRole('region', { name: 'Sticker results' });
    expect(fake.current.callsOf('addStickerToContacts')).toHaveLength(1);
    expect(fake.current.callsOf('addStickerToContacts')[0].slice(0, 3)).toEqual(['u1', ['k1', 'k2', 'k3', 'k4'], BOARD.id]);
    expect(region).toHaveTextContent('Board: Added to 1 · 2 already had it · 1 not changed');
    await user.click(within(region).getByRole('button', { name: 'Details' }));
    expect(within(region).getByText('Dee')).toBeInTheDocument();
    expect(region).toHaveTextContent('This contact has 50 stickers. Remove one to add another.');
    expect(spy.applied).toEqual([[BOARD.id, ['k1', 'k2', 'k3']]]);
    expect(screen.getByTestId('selected')).toHaveTextContent('k4');
  });

  it('AT-6-08: Retry runs for the failed contacts only', async () => {
    const user = userEvent.setup();
    let first = true;
    fake.current.state.impl.bulk = async (_uid, ids) => {
      if (first) { first = false; return { added: ['k1', 'k2'], already: [], failed: [{ contactId: 'k3', code: 'write_failed', reason: null }, { contactId: 'k4', code: 'write_failed', reason: null }] }; }
      return { added: ids, already: [], failed: [] };
    };
    render(<Host spy={{ applied: [] }} />);
    await user.click(await screen.findByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Donor' }));
    await user.click(within(await screen.findByRole('region', { name: 'Sticker results' })).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fake.current.callsOf('addStickerToContacts')).toHaveLength(2));
    expect(fake.current.callsOf('addStickerToContacts')[1][1]).toEqual(['k3', 'k4']);
    expect(await screen.findByText('Donor: Added to 2')).toBeInTheDocument();
  });

  it('AT-6-09: while it runs, the button shows progress and the other bulk actions are disabled', async () => {
    const user = userEvent.setup();
    let finish;
    fake.current.state.impl.bulk = (_uid, ids, _id, { onProgress }) => new Promise((resolve) => {
      onProgress(1, ids.length);
      finish = () => resolve({ added: ids, already: [], failed: [] });
    });
    render(<Host spy={{ applied: [] }} />);
    await user.click(await screen.findByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    const busy = await screen.findByRole('button', { name: 'Adding… 1 of 4' });
    expect(busy).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add sticker' })).toBeEnabled();
  });

  it('revoked access: the failures say so and availability is checked again', async () => {
    const user = userEvent.setup();
    fake.current.state.impl.bulk = async (_uid, ids) => ({ added: [], already: [], failed: ids.map((contactId) => ({ contactId, code: 'permission_denied', reason: 'write_denied' })) });
    render(<Host initial={['k1']} spy={{ applied: [] }} />);
    await user.click(await screen.findByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    const region = await screen.findByRole('region', { name: 'Sticker results' });
    await user.click(within(region).getByRole('button', { name: 'Details' }));
    expect(region).toHaveTextContent("Stickers can't be changed right now.");
    await waitFor(() => expect(fake.current.state.configFetches).toBe(2));
  });

  it('create inline makes the sticker, then adds it to the selection', async () => {
    const user = userEvent.setup();
    render(<Host initial={['k1', 'k2']} spy={{ applied: [] }} />);
    await user.click(await screen.findByRole('button', { name: 'Add sticker' }));
    await user.type(screen.getByRole('combobox'), 'Gala 2026');
    await user.click(screen.getByRole('option', { name: 'Create sticker “Gala 2026”' }));
    await screen.findByText('Gala 2026: Added to 2');
    expect(fake.current.callsOf('createSticker')).toEqual([['u1', { name: 'Gala 2026', color: 'purple' }]]);
    expect(fake.current.callsOf('addStickerToContacts')[0][1]).toEqual(['k1', 'k2']);
  });

  it('a failure log carries codes only', async () => {
    const user = userEvent.setup();
    const logs = [];
    console.warn.mockImplementation((...a) => logs.push(JSON.stringify(a)));
    fake.current.state.impl.bulk = async () => { throw stickerError('write_failed'); };
    render(<Host initial={['k1']} spy={{ applied: [] }} />);
    await user.click(await screen.findByRole('button', { name: 'Add sticker' }));
    await user.click(screen.getByRole('option', { name: 'Board' }));
    await screen.findByRole('region', { name: 'Sticker results' });
    expect(logs.join('')).toContain('write_failed');
    for (const secret of ['Ana', 'k1', 'Board', BOARD.id]) expect(logs.join('')).not.toContain(secret);
  });
});
