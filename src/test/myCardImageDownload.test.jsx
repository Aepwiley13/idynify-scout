/**
 * "Download card image": the button under the preview, and what it does.
 *
 * What is held here: the picture is made by the card's own renderer from the card
 * as it is now (an unsaved draft included) and only ever from what is Shared; on a
 * phone that can share a file it goes to the share sheet, otherwise it is
 * downloaded, and where the browser will not download it is shown on the page;
 * closing the share sheet is not an error; one picture is made at a time; the
 * person is told what is happening, what happened and what went wrong; nothing is
 * saved, requested or logged; the file name is safe; and Download contact is
 * untouched and independent. The renderer itself is tested (myCardImage.test.js)
 * and looked at in real Chrome; jsdom has no canvas, so here it is a stand-in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => {
  const auth = { currentUser: { uid: 'U' }, listeners: new Set() };
  auth.onAuthStateChanged = (callback) => {
    auth.listeners.add(callback);
    callback(auth.currentUser);
    return () => auth.listeners.delete(callback);
  };
  return { auth, service: {}, impersonation: { isImpersonating: false }, renderCardImage: vi.fn() };
});
vi.mock('../firebase/config', () => ({ db: {}, auth: mocks.auth }));
vi.mock('../services/myCardService', () => ({ myCardService: mocks.service }));
vi.mock('../context/ImpersonationContext', () => ({ useImpersonation: () => mocks.impersonation }));
// The renderer is stood in for (no canvas in jsdom); everything else, the page, draft, buttons and delivery, is real.
vi.mock('../pages/ContactHub/myCard/cardImage', async (importOriginal) => ({ ...(await importOriginal()), renderCardImage: mocks.renderCardImage }));

import MyCardPage from '../pages/ContactHub/MyCardPage';
import { useCardImageDownload } from '../pages/ContactHub/myCard/useCardImageDownload';
import { DOWNLOAD_IMAGE, currentCardTheme, downloadCardImage, imageDownloadState } from '../pages/ContactHub/myCard/cardImageDownload';
import { newCard, normalizeCard } from '../utils/myCardRules';

const savedCard = (extra = {}) => ({ ...newCard(), firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', ...extra });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const pngBlob = () => new Blob(['png-bytes'], { type: 'image/png' });
const made = (fileName = 'Ada_Lovelace_card.png') => ({ ok: true, blob: pngBlob(), fileName, width: 1080, height: 1500, photo: false });

function installService(card = savedCard()) {
  mocks.service.loadMyCard = vi.fn(async () => ({ status: 'ok', card, revision: 3 }));
  mocks.service.loadCardSuggestions = vi.fn(async () => ({ suggestions: {}, unavailable: [] }));
  mocks.service.saveMyCard = vi.fn(async (c, { expectedRevision }) => ({ status: 'saved', card: { ...normalizeCard(c).card, sharingEnabled: false }, revision: (expectedRevision ?? 0) + 1 }));
}
const open = async (card) => {
  installService(card);
  render(<MemoryRouter><MyCardPage /></MemoryRouter>);
  await screen.findByRole('form', { name: 'Edit your card' });
};
const imageButton = () => screen.getByRole('button', { name: 'Download card image' });
const contactButton = () => screen.getByRole('button', { name: 'Download contact' });
const field = (label) => screen.getByLabelText(label);
const toggle = (label) => screen.getByRole('switch', { name: `${label} on your card` });

/** Downloads: what was given to a link, and what it was called. */
function stubDownloads({ failClick = false, prefix = 'blob:test' } = {}) {
  const seen = { blobs: [], clicks: [], revoked: [] };
  window.URL.createObjectURL = vi.fn((blob) => { seen.blobs.push(blob); return `${prefix}-${seen.blobs.length}`; });
  window.URL.revokeObjectURL = vi.fn((url) => { seen.revoked.push(url); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    if (failClick) throw new Error('blocked');
    seen.clicks.push(this.download);
  });
  return seen;
}

/** A phone: a coarse pointer, and (or not) a share sheet that takes files. */
function stubPhone({ share = true, shareImpl } = {}) {
  window.matchMedia = vi.fn((query) => ({ matches: query === '(pointer: coarse)', media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  const shared = [];
  if (share) {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn((data) => Boolean(data?.files?.length)) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(shareImpl ?? (async (data) => { shared.push(data); })) });
  }
  return shared;
}
function stubDesktop({ canShare = false } = {}) {
  window.matchMedia = vi.fn((query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  if (canShare) {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => true) });
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async () => {}) });
  }
}

beforeEach(() => {
  globalThis.sessionStorage.clear();
  mocks.auth.currentUser = { uid: 'U' };
  mocks.auth.listeners.clear();
  mocks.impersonation.isImpersonating = false;
  mocks.renderCardImage.mockReset();
  mocks.renderCardImage.mockImplementation(async () => made());
  stubDesktop();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete navigator.canShare;
  delete navigator.share;
  delete window.matchMedia;
  globalThis.sessionStorage.clear();
});

// ─── On the page ─────────────────────────────────────────────────────────────

describe('the button and its words', () => {
  it('sits with Download contact under the preview, and says that it does not save anything to IDYNIFY', async () => {
    await open();
    const section = contactButton().closest('.mycard-download');
    expect(within(section).getByRole('button', { name: 'Download card image' })).toBeInTheDocument();
    expect(contactButton().parentElement).toBe(imageButton().parentElement);
    expect(screen.getByText(DOWNLOAD_IMAGE.note)).toBeInTheDocument();
    expect(imageButton()).toHaveAccessibleDescription(/does not save your changes to IDYNIFY/);
    expect(contactButton()).toHaveAccessibleDescription(/does not save your changes to IDYNIFY/);
    expect(screen.getByRole('heading', { name: 'Download your card', hidden: true })).toBeInTheDocument();
  });

  it('is off, with the reason, while the card has no name, and on once it has one', async () => {
    const user = userEvent.setup();
    await open(savedCard({ firstName: '', lastName: '' }));
    expect(imageButton()).toBeDisabled();
    expect(imageButton()).toHaveAccessibleDescription(/Add your name to download your contact/);
    await user.type(field('First name'), 'Ada');
    expect(imageButton()).toBeEnabled();
  });
});

describe('making and downloading the picture (a computer)', () => {
  it('makes the picture from the card as it is now, unsaved edits included, and downloads it by its safe name', async () => {
    const downloads = stubDownloads();
    await open(savedCard({ email: 'ada@example.com' }));
    const user = userEvent.setup();
    await user.clear(field('Title'));
    await user.type(field('Title'), 'Typed, not saved');
    await user.click(imageButton());
    expect(await screen.findByText('Card image downloaded.')).toBeInTheDocument();
    expect(mocks.renderCardImage).toHaveBeenCalledTimes(1);
    const [cardGiven, options] = mocks.renderCardImage.mock.calls[0];
    expect(cardGiven.title).toBe('Typed, not saved');
    expect(options.theme).toBe('light');
    expect(downloads.clicks).toEqual(['Ada_Lovelace_card.png']);
    expect(downloads.blobs).toHaveLength(1);
    expect(downloads.blobs[0].type).toBe('image/png');
    // The picture is not the way a card is saved.
    expect(mocks.service.saveMyCard).not.toHaveBeenCalled();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  });

  it('follows the Shared / Private switches through the renderer, which is given the switches', async () => {
    stubDownloads();
    await open(savedCard({ email: 'ada@example.com' }));
    const user = userEvent.setup();
    await user.click(toggle('Email'));
    await user.click(imageButton());
    await screen.findByText('Card image downloaded.');
    expect(mocks.renderCardImage.mock.calls[0][0].share.email).toBe(true);
    await user.click(toggle('Email'));
    await user.click(imageButton());
    await waitFor(() => expect(mocks.renderCardImage).toHaveBeenCalledTimes(2));
    expect(mocks.renderCardImage.mock.calls[1][0].share.email).toBe(false);
  });

  it('is drawn in the dark card when the app is in a dark theme', async () => {
    stubDownloads();
    document.documentElement.setAttribute('data-theme', 'mission');
    await open();
    await userEvent.setup().click(imageButton());
    await screen.findByText('Card image downloaded.');
    expect(mocks.renderCardImage.mock.calls[0][1].theme).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
  });

  it('goes to a computer\'s download, not a share sheet, even where the browser can share files', async () => {
    const downloads = stubDownloads();
    stubDesktop({ canShare: true });
    await open();
    await userEvent.setup().click(imageButton());
    expect(await screen.findByText('Card image downloaded.')).toBeInTheDocument();
    expect(navigator.share).not.toHaveBeenCalled();
    expect(downloads.clicks).toHaveLength(1);
  });

  it('lets go of the temporary address after the click', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const downloads = stubDownloads({ prefix: 'blob:only-this-test' });
    await open();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(imageButton());
    await screen.findByText('Card image downloaded.');
    expect(downloads.revoked).not.toContain('blob:only-this-test-1');
    act(() => { vi.advanceTimersByTime(1500); });
    // (An earlier test's own timer may let go of its own address meanwhile; this test's address is the one asked about.)
    expect(downloads.revoked).toContain('blob:only-this-test-1');
    vi.useRealTimers();
  });
});

describe('a phone', () => {
  it('offers the picture to the share sheet, as a PNG file with its safe name and nothing else, and does not also download it', async () => {
    const downloads = stubDownloads();
    const shared = stubPhone();
    await open(savedCard({ email: 'ada@example.com' }));
    await userEvent.setup().click(imageButton());
    expect(await screen.findByText('Card image shared.')).toBeInTheDocument();
    expect(shared).toHaveLength(1);
    expect(Object.keys(shared[0])).toEqual(['files']);
    expect(shared[0].files).toHaveLength(1);
    expect(shared[0].files[0]).toMatchObject({ name: 'Ada_Lovelace_card.png', type: 'image/png' });
    expect(downloads.clicks).toHaveLength(0);
  });

  it('says nothing, and shows no error, when the share sheet is closed without choosing', async () => {
    const downloads = stubDownloads();
    stubPhone({ shareImpl: async () => { throw new DOMException('closed', 'AbortError'); } });
    await open();
    await userEvent.setup().click(imageButton());
    await waitFor(() => expect(navigator.share).toHaveBeenCalled());
    await waitFor(() => expect(imageButton()).toBeEnabled());
    expect(screen.queryByText(/Card image (shared|downloaded)/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(downloads.clicks).toHaveLength(0);
  });

  it('downloads instead when the share sheet is refused for any other reason, such as a tap that has gone stale', async () => {
    const downloads = stubDownloads();
    stubPhone({ shareImpl: async () => { throw new DOMException('needs a fresh tap', 'NotAllowedError'); } });
    await open();
    await userEvent.setup().click(imageButton());
    expect(await screen.findByText('Card image downloaded.')).toBeInTheDocument();
    expect(downloads.clicks).toEqual(['Ada_Lovelace_card.png']);
  });

  it('downloads where the phone cannot share a file', async () => {
    const downloads = stubDownloads();
    stubPhone({ share: false });
    await open();
    await userEvent.setup().click(imageButton());
    expect(await screen.findByText('Card image downloaded.')).toBeInTheDocument();
    expect(downloads.clicks).toHaveLength(1);
  });

  it('shows the picture itself, with the words for saving it by hand, when the browser will not start the download, and lets it go when closed', async () => {
    const downloads = stubDownloads({ failClick: true });
    stubPhone({ share: false });
    await open();
    const user = userEvent.setup();
    await user.click(imageButton());
    expect(await screen.findByText(DOWNLOAD_IMAGE.fallback)).toBeInTheDocument();
    const picture = screen.getByRole('img', { name: 'Your card image' });
    expect(picture.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.queryByText('Card image downloaded.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close picture' }));
    expect(screen.queryByRole('img', { name: 'Your card image' })).toBeNull();
    expect(downloads.revoked).toContain(picture.getAttribute('src'));
  });
});

describe('one picture at a time, and the person is told', () => {
  it('says it is preparing, turns the button off while it works, and makes one picture for two quick taps', async () => {
    const downloads = stubDownloads();
    const gate = deferred();
    mocks.renderCardImage.mockImplementation(async () => { await gate.promise; return made(); });
    await open();
    const user = userEvent.setup();
    await user.click(imageButton());
    expect(await screen.findByText(DOWNLOAD_IMAGE.preparing)).toBeInTheDocument();
    expect(imageButton()).toBeDisabled();
    expect(imageButton()).toHaveAttribute('aria-busy', 'true');
    await user.click(imageButton());
    await user.click(imageButton());
    await act(async () => { gate.resolve(); });
    expect(await screen.findByText('Card image downloaded.')).toBeInTheDocument();
    expect(mocks.renderCardImage).toHaveBeenCalledTimes(1);
    expect(downloads.clicks).toHaveLength(1);
    expect(screen.queryByText(DOWNLOAD_IMAGE.preparing)).toBeNull();
    expect(imageButton()).toBeEnabled();
    expect(imageButton()).not.toHaveAttribute('aria-busy');
  });

  it('makes one picture even for two requests in the same instant, before the button has had time to turn off', async () => {
    const gate = deferred();
    const run = vi.fn(async () => { await gate.promise; return { status: 'downloaded', fileName: 'x.png', message: 'Card image downloaded.' }; });
    const card = savedCard();
    const { result } = renderHook(() => useCardImageDownload(card, { run }));
    await act(async () => { result.current.download(); result.current.download(); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => { gate.resolve(); });
    expect(result.current.busy).toBe(false);
    expect(result.current.feedback).toMatchObject({ status: 'downloaded' });
    await act(async () => { await result.current.download(); });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('holds the button until the share sheet is done', async () => {
    stubDownloads();
    const gate = deferred();
    stubPhone({ shareImpl: async () => { await gate.promise; } });
    await open();
    const user = userEvent.setup();
    await user.click(imageButton());
    await waitFor(() => expect(navigator.share).toHaveBeenCalledTimes(1));
    expect(imageButton()).toBeDisabled();
    await user.click(imageButton());
    expect(navigator.share).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(imageButton()).toBeEnabled());
  });

  it.each([
    ['the renderer says it could not', async () => ({ ok: false, reason: 'render-failed' })],
    ['the renderer throws', async () => { throw new Error('canvas exploded'); }],
  ])('says so in words, and can be tried again, when %s', async (_label, implementation) => {
    const downloads = stubDownloads();
    mocks.renderCardImage.mockImplementation(implementation);
    await open();
    const user = userEvent.setup();
    await user.click(imageButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn\'t make the card image. Try again.');
    expect(downloads.clicks).toHaveLength(0);
    expect(imageButton()).toBeEnabled();
    mocks.renderCardImage.mockImplementation(async () => made());
    await user.click(imageButton());
    expect(await screen.findByText('Card image downloaded.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(downloads.clicks).toHaveLength(1);
  });

  it('shows the answer only while the card is as it was: an edit takes it away', async () => {
    stubDownloads();
    await open();
    const user = userEvent.setup();
    await user.click(imageButton());
    await screen.findByText('Card image downloaded.');
    await user.type(field('Title'), '!');
    expect(screen.queryByText('Card image downloaded.')).toBeNull();
  });
});

describe('privacy and independence', () => {
  it('makes no request, writes nothing, stores nothing and logs nothing, and the card is untouched', async () => {
    stubDownloads();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await open(savedCard({ email: 'ada@example.com', phone: '+1 555 010 2000' }));
    setItem.mockClear();
    const user = userEvent.setup();
    await user.click(imageButton());
    await screen.findByText('Card image downloaded.');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.service.saveMyCard).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    const written = logs.flatMap((s) => s.mock.calls).flat().map(String).join('\n');
    expect(written).not.toMatch(/ada@example|555|Lovelace/);
    expect(field('Title')).toHaveValue('Analyst');
  });

  it('puts nothing but the picture and its safe name in the download and in the share', async () => {
    const downloads = stubDownloads();
    const shared = stubPhone();
    mocks.renderCardImage.mockImplementation(async () => made('Ada_Lovelace_card.png'));
    await open(savedCard({ email: 'ada@example.com', phone: '+1 555 010 2000' }));
    await userEvent.setup().click(imageButton());
    await screen.findByText('Card image shared.');
    expect(JSON.stringify(Object.keys(shared[0]))).toBe('["files"]');
    expect(shared[0].files[0].name).not.toMatch(/ada@|555/);
    expect(downloads.clicks).toHaveLength(0);
  });

  it('leaves Download contact exactly as it was, and each works without the other', async () => {
    const downloads = stubDownloads();
    await open(savedCard({ email: 'ada@example.com' }));
    const user = userEvent.setup();
    // The contact file, with a picture being made at the same time.
    const gate = deferred();
    mocks.renderCardImage.mockImplementation(async () => { await gate.promise; return made(); });
    await user.click(imageButton());
    await screen.findByText(DOWNLOAD_IMAGE.preparing);
    expect(contactButton()).toBeEnabled();
    await user.click(contactButton());
    expect(await screen.findByText('Contact file downloaded.')).toBeInTheDocument();
    expect(downloads.clicks).toEqual(['Ada_Lovelace.vcf']);
    await act(async () => { gate.resolve(); });
    expect(await screen.findByText('Card image downloaded.')).toBeInTheDocument();
    expect(downloads.clicks).toEqual(['Ada_Lovelace.vcf', 'Ada_Lovelace_card.png']);
    // A failing picture does not take the contact file with it.
    mocks.renderCardImage.mockImplementation(async () => ({ ok: false, reason: 'render-failed' }));
    await user.click(imageButton());
    await screen.findByRole('alert');
    await user.click(contactButton());
    expect(downloads.clicks.at(-1)).toBe('Ada_Lovelace.vcf');
  });

  it('is not offered while an admin is viewing as someone else: there is no card to show', async () => {
    mocks.impersonation.isImpersonating = true;
    installService();
    render(<MemoryRouter><MyCardPage /></MemoryRouter>);
    await screen.findAllByText(/viewing|someone else|isn.t available/i);
    expect(screen.queryByRole('button', { name: 'Download card image' })).toBeNull();
  });
});

// ─── The logic alone ─────────────────────────────────────────────────────────

describe('downloadCardImage', () => {
  const delivery = (over = {}) => ({
    makeFile: (blob, name) => ({ blob, name }),
    prefersShareSheet: () => false,
    canShareFile: () => false,
    share: vi.fn(async () => {}),
    saveBlob: vi.fn(),
    ...over,
  });

  it('answers without making anything for a card with no name', async () => {
    const render = vi.fn();
    expect(imageDownloadState({ ...newCard() }).available).toBe(false);
    expect(await downloadCardImage({ ...newCard() }, { render, delivery: delivery() })).toEqual({ status: 'unavailable', message: DOWNLOAD_IMAGE.noName });
    expect(render).not.toHaveBeenCalled();
  });

  it('hands the renderer the card and the theme, and the file to the right place', async () => {
    const d = delivery();
    const render = vi.fn(async () => made());
    const result = await downloadCardImage(savedCard(), { theme: 'dark', render, delivery: d });
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Ada' }), { theme: 'dark' });
    expect(d.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'Ada_Lovelace_card.png');
    expect(result).toMatchObject({ status: 'downloaded', fileName: 'Ada_Lovelace_card.png' });
  });

  it('never rejects: whatever goes wrong is an answer', async () => {
    const boom = () => { throw new Error('boom'); };
    for (const d of [delivery({ makeFile: boom }), delivery({ prefersShareSheet: boom }), delivery({ saveBlob: boom })]) {
      const result = await downloadCardImage(savedCard(), { render: async () => made(), delivery: d });
      expect(['downloaded', 'fallback']).toContain(result.status);
    }
    expect((await downloadCardImage(savedCard(), { render: async () => { throw new Error('x'); }, delivery: delivery() })).status).toBe('failed');
    expect((await downloadCardImage(savedCard(), { render: async () => null, delivery: delivery() })).status).toBe('failed');
  });

  it('returns the picture itself for the page to show when the download cannot start', async () => {
    const result = await downloadCardImage(savedCard(), { render: async () => made(), delivery: delivery({ saveBlob: () => { throw new Error('blocked'); } }) });
    expect(result).toMatchObject({ status: 'fallback', fileName: 'Ada_Lovelace_card.png', message: DOWNLOAD_IMAGE.fallback });
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('reads the theme from the page: the dark themes are dark, the others and none are light', () => {
    const doc = (id) => ({ documentElement: { getAttribute: () => id } });
    expect(currentCardTheme(doc('mission'))).toBe('dark');
    expect(currentCardTheme(doc('workspace'))).toBe('light');
    expect(currentCardTheme(doc(null))).toBe('light');
    expect(currentCardTheme(doc('not-a-theme'))).toBe('light');
    expect(currentCardTheme(null)).toBe('light');
  });
});
