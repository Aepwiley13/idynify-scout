/* global process */
/**
 * H3 and H2-3 presentation: PersonHeader's photo button, its "change photo" control and panel slot, the
 * "Add sticker" chip with its picker slot, and the sticker remove controls. All of it is drawn only from callbacks
 * the parent supplies; the header reads and writes nothing. How it looks is checked in real Chrome.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PersonHeader from '../components/contacts/personHeader/PersonHeader';
import { buildPersonHeaderModel } from '../components/contacts/personHeader/personHeaderModel';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const REG = new Map([
  ['p', { id: 'p', name: 'Partner', color: 'purple', emoji: '🤝', status: 'active' }],
  ['e', { id: 'e', name: 'Education', color: 'blue', emoji: null, status: 'active' }],
]);
const WITH_PHOTO = { id: 'c1', name: 'Jordan Lee', title: 'Partner', photo_url: 'https://images.example.com/jordan.jpg', sticker_ids: ['p', 'e'] };
const NO_PHOTO = { id: 'c2', name: 'Avery Quinn', sticker_ids: ['p'] };
const model = (contact, registry = REG) => buildPersonHeaderModel(contact, { stickersById: registry, now: NOW });
const css = readFileSync(resolve(process.cwd(), 'src/components/contacts/personHeader/PersonHeader.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|[};{])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
};

describe('the photo', () => {
  it('is a picture, not a button, without onPhotoClick', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is a button that views the photo when there is one, and says so', async () => {
    const onPhotoClick = vi.fn();
    const photoButtonRef = createRef();
    const user = userEvent.setup();
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onPhotoClick }} photoButtonRef={photoButtonRef} />);
    const button = screen.getByRole('button', { name: 'View photo of Jordan Lee' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(photoButtonRef.current).toBe(button);
    await user.click(button);
    expect(onPhotoClick).toHaveBeenCalledTimes(1);
  });

  it('is a button that adds a photo when there is none', () => {
    render(<PersonHeader person={model(NO_PHOTO)} actions={{ onPhotoClick() {} }} />);
    expect(screen.getByRole('button', { name: 'Add photo for Avery Quinn' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View photo/ })).toBeNull();
  });

  it('says "add" again if the photo cannot be loaded and the initials are showing', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onPhotoClick() {} }} />);
    const img = document.querySelector('.ph-avatar-img');
    img.dispatchEvent(new Event('error'));
    return screen.findByRole('button', { name: 'Add photo for Jordan Lee' });
  });

  it('has a Change photo control only when there is a photo and the parent can edit it, which calls the parent', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onPhotoClick() {} }} photoEdit={{ onEdit }} />);
    await user.click(screen.getByRole('button', { name: 'Change photo' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    unmount();
    render(<PersonHeader person={model(NO_PHOTO)} actions={{ onPhotoClick() {} }} photoEdit={{ onEdit }} />);
    expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull();
  });

  it('draws no Change photo control without onEdit', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onPhotoClick() {} }} photoEdit={{ panel: null }} />);
    expect(screen.queryByRole('button', { name: 'Change photo' })).toBeNull();
  });

  it('draws the panel the parent hands it, inside the photo\'s own box', () => {
    render(<PersonHeader person={model(NO_PHOTO)} actions={{ onPhotoClick() {} }} photoEdit={{ panel: <div data-testid="panel">URL form</div> }} />);
    expect(document.querySelector('.ph-avatar-wrap')).toContainElement(screen.getByTestId('panel'));
  });

  it('a busy Change photo control is marked busy', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onPhotoClick() {} }} photoEdit={{ onEdit() {}, saving: true }} />);
    expect(screen.getByRole('button', { name: 'Change photo' })).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Add sticker', () => {
  it('draws nothing without onAddSticker (the existing pills only)', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} />);
    expect(screen.queryByRole('button', { name: 'Add sticker' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Stickers' })).toBeInTheDocument();
  });

  it('is the last item of the sticker list, a real button, wired for a listbox popup', async () => {
    const onAddSticker = vi.fn();
    const addStickerRef = createRef();
    const user = userEvent.setup();
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onAddSticker }} addStickerRef={addStickerRef} addStickerOpen={false} />);
    const button = screen.getByRole('button', { name: 'Add sticker' });
    expect(button).toHaveAttribute('aria-haspopup', 'listbox');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(addStickerRef.current).toBe(button);
    const items = within(screen.getByRole('list', { name: 'Stickers' })).getAllByRole('listitem');
    expect(items.at(-1)).toContainElement(button);
    await user.click(button);
    expect(onAddSticker).toHaveBeenCalledTimes(1);
  });

  it('follows addStickerOpen in aria-expanded', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onAddSticker() {} }} addStickerOpen />);
    expect(screen.getByRole('button', { name: 'Add sticker' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('draws the picker the parent hands it inside the SAME list item as the button (the picker places itself against its parent)', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onAddSticker() {} }} addStickerOpen addStickerPanel={<div data-testid="picker">picker</div>} />);
    const button = screen.getByRole('button', { name: 'Add sticker' });
    expect(screen.getByTestId('picker').parentElement).toBe(button.parentElement);
    expect(button.parentElement.tagName).toBe('LI');
    expect(button.parentElement).toHaveClass('ph-add-sticker-item');
  });

  it('is the whole sticker area when there are no pills yet', () => {
    render(<PersonHeader person={model({ id: 'c3', name: 'No Stickers', sticker_ids: [] })} actions={{ onAddSticker() {} }} />);
    expect(screen.getByRole('list', { name: 'Stickers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sticker' })).toBeInTheDocument();
  });

  it('is not drawn where stickers are not available, whatever the parent supplies', () => {
    render(<PersonHeader person={model(WITH_PHOTO, null)} actions={{ onAddSticker() {}, onRemoveSticker() {} }} />);
    expect(screen.queryByRole('button', { name: /sticker/i })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Stickers' })).toBeNull();
  });
});

describe('removing a sticker', () => {
  it('draws a Remove button on every pill, and tells the parent which sticker', async () => {
    const onRemoveSticker = vi.fn();
    const user = userEvent.setup();
    render(<PersonHeader person={model(WITH_PHOTO)} actions={{ onRemoveSticker }} />);
    expect(screen.getAllByRole('button', { name: /^Remove sticker / })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Remove sticker Education' }));
    expect(onRemoveSticker).toHaveBeenCalledTimes(1);
    expect(onRemoveSticker).toHaveBeenCalledWith(expect.objectContaining({ id: 'e', name: 'Education' }));
  });

  it('draws none without onRemoveSticker', () => {
    render(<PersonHeader person={model(WITH_PHOTO)} />);
    expect(screen.queryByRole('button', { name: /Remove sticker/ })).toBeNull();
  });

  it('a pending sticker is marked busy and cannot be removed again', () => {
    const base = model(WITH_PHOTO);
    const person = { ...base, stickers: base.stickers.map((s) => (s.id === 'p' ? { ...s, busy: true } : s)) };
    render(<PersonHeader person={person} actions={{ onRemoveSticker() {} }} />);
    const pill = screen.getByText('Partner', { selector: '.ph-sticker-name' }).closest('li');
    expect(pill).toHaveAttribute('aria-busy', 'true');
    expect(within(pill).getByRole('button', { name: 'Remove sticker Partner' })).toBeDisabled();
    expect(within(screen.getByText('Education', { selector: '.ph-sticker-name' }).closest('li')).getByRole('button', { name: 'Remove sticker Education' })).toBeEnabled();
  });

  it('a pill\'s name stays whole for a screen reader and its title, whatever is drawn', () => {
    const long = { id: 'l', name: 'Community partner, school fundraiser and annual gala volunteer committee', color: 'teal', emoji: null, status: 'active' };
    render(<PersonHeader person={model({ id: 'c4', name: 'X', sticker_ids: ['l'] }, new Map([['l', long]]))} actions={{ onRemoveSticker() {} }} />);
    expect(screen.getByRole('button', { name: `Remove sticker ${long.name}` })).toBeInTheDocument();
    expect(screen.getByText(long.name).closest('li')).toHaveAttribute('title', long.name);
  });
});

describe('the stylesheet for photo and stickers', () => {
  it('the photo button, Change photo, Remove and Add sticker are each 44px to hit', () => {
    expect(rule('.ph-photo-edit')).toMatch(/width:\s*44px/);
    expect(rule('.ph-photo-edit')).toMatch(/height:\s*44px/);
    expect(rule('.ph-avatar-btn')).toMatch(/width:\s*var\(--ph-avatar\)/);
    // The remove button is 32px with a pseudo-element that makes the touch area 44px each way.
    expect(rule('.ph-sticker-remove')).toMatch(/width:\s*32px/);
    expect(rule('.ph-sticker-remove::after')).toMatch(/inset:\s*-6px/);
    // Add sticker is a 36px chip whose touch area is 44px high.
    expect(rule('.ph-add-sticker')).toMatch(/min-height:\s*36px/);
    expect(rule('.ph-add-sticker::after')).toMatch(/inset:\s*-4px\s+0/);
  });

  it('touch areas of neighbouring rows never overlap: a 12px row gap when stickers can be changed', () => {
    expect(rule('.ph-stickers--editable')).toMatch(/row-gap:\s*12px/);
  });

  it('every focused control has a visible outline', () => {
    for (const s of ['.ph-avatar-btn:focus-visible', '.ph-photo-edit:focus-visible', '.ph-sticker-remove:focus-visible', '.ph-add-sticker:focus-visible']) {
      expect(rule(s), s).toMatch(/outline:\s*2px solid/);
    }
  });

  it('the picker opens right-aligned from the desktop layout, where the stickers are at the top right', () => {
    const start = css.indexOf('@container ph (min-width: 820px)');
    expect(css.slice(start)).toMatch(/\.ph-add-sticker-item \.stk-picker--popover\s*\{[^}]*right:\s*0[^}]*left:\s*auto/);
  });

  it('the item that holds an open picker is raised above what follows it', () => {
    expect(css).toMatch(/\.ph-add-sticker-item:has\(\.stk-picker--popover\)\s*\{[^}]*z-index/);
  });

  it('the photo panel is a floating panel under the photo, no wider than the card', () => {
    expect(rule('.ph-photo-panel')).toMatch(/position:\s*absolute/);
    expect(rule('.ph-photo-panel')).toMatch(/max-width:/);
  });
});
