/**
 * Share, Scan, Save: the owner's action area, the link helpers and the additional-links draft.
 * The real component and helpers run; the clipboard, share sheet and QR maker are stand-ins.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../pages/ContactHub/myCard/cardQr', () => ({
  qrPngDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
  qrFileName: () => 'Ada_QR.png',
  QR_SURFACE: {},
}));

import MyCardShare from '../pages/ContactHub/myCard/MyCardShare';
import { cardLinkUrl, shareCard, copyText } from '../pages/ContactHub/myCard/shareLink';
import { cardDraftReducer, createDraft, isDirty } from '../pages/ContactHub/myCard/cardDraft';
import {
  newCard, newPublicId, isValidPublicId, normalizeLink, normalizeCard, publishGate, publicCardDoc, publicCardView,
} from '../utils/myCardRules';
import { buildMyCardVCard } from '../utils/vcard';
import { isOn } from '../config/featureFlags';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const ORIGIN = 'https://app.example.com';
const ada = (extra = {}) => ({
  ...newCard(), firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', share: { ...newCard().share, email: true }, ...extra,
});

describe('the link', () => {
  it('is https://<domain>/c/<id>, and only for a real ID on an https origin', () => {
    expect(cardLinkUrl(ID, ORIGIN)).toBe(`${ORIGIN}/c/${ID}`);
    expect(cardLinkUrl('short', ORIGIN)).toBeNull();
    expect(cardLinkUrl(ID, 'http://evil.example.com')).toBeNull();
    expect(cardLinkUrl(ID, 'not a url')).toBeNull();
    expect(cardLinkUrl(ID, 'http://localhost:5173')).toBe(`http://localhost:5173/c/${ID}`);
  });
  it('makes public IDs of 22 random base64url characters', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPublicId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isValidPublicId(id)).toBe(true);
  });
});

describe('Share My Card and Copy Link', () => {
  it('uses the share sheet with the name and link, and nothing else', async () => {
    const share = vi.fn(async () => {});
    const result = await shareCard({ url: `${ORIGIN}/c/${ID}`, name: 'Ada Lovelace' }, { navigator: { share }, copy: vi.fn() });
    expect(result.status).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: expect.any(String), text: expect.any(String), url: `${ORIGIN}/c/${ID}` });
  });
  it('treats closing the sheet as nothing happening, and copies instead where there is no sheet', async () => {
    const copy = vi.fn(async () => true);
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    expect((await shareCard({ url: 'u', name: 'n' }, { navigator: { share: async () => { throw abort; } }, copy })).status).toBe('cancelled');
    expect(copy).not.toHaveBeenCalled();
    expect((await shareCard({ url: 'u', name: 'n' }, { navigator: {}, copy })).status).toBe('copied');
  });
  it('copies through the clipboard, and says when it cannot', async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyText('x', { clipboard: { writeText }, document: undefined })).toBe(true);
    expect(await copyText('x', { clipboard: { writeText: async () => { throw new Error('no'); } }, document: undefined })).toBe(false);
  });
});

describe('the action area', () => {
  const props = (extra = {}) => ({
    card: ada(), sharing: { live: false, publicId: null }, busy: null, error: null, dirty: false,
    onPublish: vi.fn(async () => ({ status: 'saved' })), onUnpublish: vi.fn(async () => ({ status: 'saved' })), onReset: vi.fn(async () => ({ status: 'saved' })),
    onTurnOn: vi.fn(), onEditCard: vi.fn(), origin: ORIGIN, ...extra,
  });

  it('offers only Turn on sharing before the card is live, and publishes only on the explicit button', async () => {
    const p = props();
    render(<MyCardShare {...p} />);
    expect(screen.queryByRole('button', { name: 'Share My Card' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sharing' }));
    expect(p.onPublish).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Turn on sharing' })).toBeInTheDocument();
    expect(screen.getByText(/Kept private/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish my card' }));
    expect(p.onPublish).toHaveBeenCalledTimes(1);
  });

  it('offers one-tap fixes, and will not publish a card with no shared contact method', async () => {
    const p = props({ card: ada({ phone: '+1 555 010 0000', share: { ...newCard().share, email: false } }) });
    render(<MyCardShare {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Turn on sharing' }));
    expect(screen.getByRole('button', { name: 'Publish my card' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on phone number' }));
    expect(p.onTurnOn).toHaveBeenCalledWith('phone');
  });

  it('shows Share, Show QR, Copy Link and Edit when live, with the QR full screen and named for the owner', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const p = props({ sharing: { live: true, publicId: ID } });
    render(<MyCardShare {...p} />);
    expect(screen.getByText('Your card is live')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View my card' })).toHaveAttribute('href', `${ORIGIN}/c/${ID}`);
    await userEvent.click(screen.getByRole('button', { name: 'Copy Link' }));
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/c/${ID}`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show QR' }));
    const qr = await screen.findByRole('dialog', { name: 'QR code for Ada Lovelace' });
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(qr).toHaveTextContent('Ada Lovelace');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /QR code/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Card' }));
    expect(p.onEditCard).toHaveBeenCalled();
  });

  it('confirms Reset link and turning sharing off before doing either', async () => {
    const p = props({ sharing: { live: true, publicId: ID } });
    render(<MyCardShare {...p} />);
    await userEvent.click(screen.getByText('Manage sharing'));
    await userEvent.click(screen.getByRole('button', { name: 'Reset link' }));
    expect(p.onReset).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Reset your link?' })).toHaveTextContent(/stop working for good/);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn sharing off' }));
    expect(p.onUnpublish).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn sharing off' }));
    expect(p.onUnpublish).toHaveBeenCalledTimes(1);
  });
});
import { within } from '@testing-library/react';

describe('additional links', () => {
  it('need a name and an https address, with specific messages', () => {
    expect(normalizeLink({ label: '', url: '' })).toEqual({ value: null, error: null });
    expect(normalizeLink({ label: 'Book', url: 'http://x.example.com' }).error).toBe('Links must start with https://');
    expect(normalizeLink({ label: 'Book', url: 'https://user@x.example.com' }).error).toBeTruthy();
    expect(normalizeLink({ label: 'Book', url: 'javascript:alert(1)' }).error).toBeTruthy();
    expect(normalizeLink({ label: '', url: 'https://x.example.com' }).error).toMatch(/name/);
    expect(normalizeLink({ label: 'Book', url: 'https://x.example.com/a' }).value).toEqual({ label: 'Book', url: 'https://x.example.com/a' });
  });

  it('close up when one is removed, each keeping its own switch, so Private never becomes Shared', () => {
    let state = createDraft(ada());
    for (let i = 0; i < 3; i += 1) state = cardDraftReducer(state, { type: 'addLink' });
    const set = (slot, label, url) => {
      state = cardDraftReducer(state, { type: 'editLink', slot, part: 'label', value: label });
      state = cardDraftReducer(state, { type: 'editLink', slot, part: 'url', value: url });
    };
    set('link1', 'One', 'https://one.example.com/');
    set('link2', 'Two', 'https://two.example.com/');
    set('link3', 'Three', 'https://three.example.com/');
    state = cardDraftReducer(state, { type: 'share', field: 'link1', value: true });
    state = cardDraftReducer(state, { type: 'share', field: 'link3', value: true });
    state = cardDraftReducer(state, { type: 'removeLink', slot: 'link1' });
    expect(state.card.link1.label).toBe('Two');
    expect(state.card.share).toMatchObject({ link1: false, link2: true, link3: false });
    expect(state.card.link3).toBeUndefined();
    const view = publicCardView(state.card);
    expect(view.link1).toBeUndefined();
    expect(view.link2.label).toBe('Three');
    expect(isDirty(state)).toBe(true);
  });

  it('are at most five, and only Shared ones reach the public copy and the contact file', () => {
    let state = createDraft(ada());
    for (let i = 0; i < 8; i += 1) state = cardDraftReducer(state, { type: 'addLink' });
    expect(['link1', 'link2', 'link3', 'link4', 'link5'].every((s) => state.card[s])).toBe(true);
    expect(state.card.link6).toBeUndefined();
    const card = normalizeCard({
      ...ada(), link1: { label: 'Public', url: 'https://p.example.com/' }, link2: { label: 'Hidden', url: 'https://h.example.com/' },
      share: { ...ada().share, link1: true, link2: false },
    }).card;
    const doc = publicCardDoc(card, { revision: 2, updatedAt: '2026-11-28T10:00:00.000Z' });
    expect(doc.link1.label).toBe('Public');
    expect(JSON.stringify(doc)).not.toMatch(/Hidden|h\.example/);
    const vcf = buildMyCardVCard(card);
    expect(vcf).toMatch(/item1\.URL:https:\/\/p\.example\.com\//);
    expect(vcf).toMatch(/item1\.X-ABLabel:Public/);
    expect(vcf).not.toMatch(/Hidden|h\.example/);
  });

  it('do not count toward the publish gate', () => {
    const card = { ...newCard(), firstName: 'Ada', link1: { label: 'Book', url: 'https://c.example.com/' }, share: { ...newCard().share, link1: true } };
    expect(publishGate(card).ok).toBe(false);
  });
});

describe('the feature flag', () => {
  it('is on only for an explicit on, and off for anything else', () => {
    for (const on of ['on', 'ON', 'true', '1']) expect(isOn(on)).toBe(true);
    for (const off of [undefined, '', 'off', 'false', '0', 'maybe']) expect(isOn(off)).toBe(false);
  });
});
