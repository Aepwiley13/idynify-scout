/**
 * StickerPicker: options, keyboard, the combobox pattern, and the desktop
 * popover vs the phone bottom sheet (UI spec §1.2, §5).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setViewportWidth } from './helpers/matchMedia';
import { sticker } from './helpers/stickersUi';
import StickerPicker from '../components/stickers/StickerPicker';
import { buildPickerOptions } from '../components/stickers/stickerPickerOptions';

const BOARD = sticker('Board');
const DONOR = sticker('Donor');
const GALA = sticker('Gala');
const ALL = [BOARD, DONOR, GALA];

afterEach(() => setViewportWidth(1024));

function renderPicker(props = {}) {
  const handlers = { onPick: vi.fn(), onCreate: vi.fn(), onClose: vi.fn() };
  const user = userEvent.setup();
  render(<StickerPicker stickers={ALL} {...handlers} {...props} />);
  return { user, ...handlers };
}

describe('buildPickerOptions', () => {
  it('lists recent stickers first, then the rest, with no duplicates', () => {
    const options = buildPickerOptions({ stickers: ALL, recentIds: [GALA.id, 'missing'] });
    expect(options.map((o) => [o.group, o.sticker.name])).toEqual([['recent', 'Gala'], ['all', 'Board'], ['all', 'Donor']]);
  });

  it('offers Create only when no sticker has that name, and "use it" when one does', () => {
    expect(buildPickerOptions({ stickers: ALL, query: '  New   one ' }).at(-1)).toMatchObject({ kind: 'create', name: 'New one' });
    expect(buildPickerOptions({ stickers: ALL, query: 'gala' }).at(-1)).toMatchObject({ kind: 'existing', sticker: GALA });
    expect(buildPickerOptions({ stickers: ALL, query: 'x', allowCreate: false }).some((o) => o.kind === 'create')).toBe(false);
  });

  it('marks assigned stickers selected and disabled, and everything disabled at the limit', () => {
    const assigned = buildPickerOptions({ stickers: ALL, assignedIds: new Set([BOARD.id]) });
    expect(assigned.find((o) => o.sticker.id === BOARD.id)).toMatchObject({ assigned: true, disabled: true });
    expect(buildPickerOptions({ stickers: ALL, atLimit: true, query: 'zz' }).every((o) => o.disabled)).toBe(true);
  });

  it('does not offer "use it" for a sticker the contact already has', () => {
    const options = buildPickerOptions({ stickers: ALL, assignedIds: new Set([GALA.id]), query: 'Gala' });
    expect(options.map((o) => o.kind)).toEqual(['sticker']);
  });
});

describe('StickerPicker, keyboard and roles', () => {
  it('is a combobox controlling a multi-select listbox, focused on open', () => {
    renderPicker({ assignedIds: new Set([DONOR.id]) });
    const box = screen.getByRole('combobox', { name: 'Add a sticker' });
    expect(box).toHaveFocus();
    const listbox = screen.getByRole('listbox', { name: 'Stickers' });
    expect(box).toHaveAttribute('aria-controls', listbox.id);
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true');
    expect(screen.getByRole('option', { name: 'Donor' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Donor' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('arrows skip disabled options, Home and End jump, Enter picks', async () => {
    const { user, onPick } = renderPicker({ assignedIds: new Set([DONOR.id]) });
    const box = screen.getByRole('combobox');
    await user.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Board' }).id);
    await user.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Gala' }).id);
    await user.keyboard('{Home}');
    expect(box).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Board' }).id);
    await user.keyboard('{End}{Enter}');
    expect(onPick).toHaveBeenCalledWith(GALA);
  });

  it('Enter with no active option creates what was typed', async () => {
    const { user, onCreate, onPick } = renderPicker();
    await user.type(screen.getByRole('combobox'), 'Volunteers{Enter}');
    expect(onCreate).toHaveBeenCalledWith('Volunteers');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Escape closes', async () => {
    const { user, onClose } = renderPicker();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('a click outside closes the popover', async () => {
    const { user, onClose } = renderPicker();
    await user.click(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an empty state when there are no stickers yet', () => {
    renderPicker({ stickers: [] });
    expect(screen.getByText('No stickers yet. Type a name to create one.')).toBeInTheDocument();
  });
});

describe('StickerPicker, desktop and phone', () => {
  it('desktop: a popover, not a dialog', () => {
    setViewportWidth(1280);
    renderPicker();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.stk-picker--popover')).not.toBeNull();
  });

  it('phone: a modal bottom sheet that keeps focus inside it', async () => {
    setViewportWidth(390);
    const { user, onClose } = renderPicker();
    const sheet = screen.getByRole('dialog', { name: 'Add a sticker' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveClass('stk-picker--sheet');
    const box = within(sheet).getByRole('combobox');
    const close = within(sheet).getByRole('button', { name: 'Close' });
    expect(box).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(close).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(box).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(sheet.contains(document.activeElement)).toBe(true);
    await user.click(close);
    expect(onClose).toHaveBeenCalled();
  });
});
