/**
 * "Download contact": the file a person's own My Card becomes on their device.
 *
 * What is held here: it is made from the draft as it is now and from what the
 * preview shows, so private and invalid fields never get in; it touches no
 * database and no network, saves nothing and cannot turn sharing on; a name
 * the card does not have, or a browser that refuses, is an answer and not a
 * crash; the file name is safe whatever the name is; and Scout's own
 * download, which shares the same helper, is exactly what it was.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildMyCardVCard, downloadMyCardVCard, downloadVCard, myCardVCardFileName, VCARD_MIME_TYPE,
} from '../utils/vcard';
import { DOWNLOAD_CONTACT, contactDownloadState, downloadContact } from '../pages/ContactHub/myCard/downloadContact';
import { previewOf } from '../pages/ContactHub/myCard/cardDraft';
import { DEFAULT_SHARE, SHAREABLE_FIELDS, newCard } from '../utils/myCardRules';

const ALL_OFF = Object.fromEntries(SHAREABLE_FIELDS.map((field) => [field, false]));
const ALL_ON = Object.fromEntries(SHAREABLE_FIELDS.map((field) => [field, true]));

const draft = (extra = {}) => ({
  ...newCard(),
  firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', organization: 'Analytical Engines',
  email: 'ada@example.com', phone: '+1 (555) 010-2000', linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
  instagram: 'ada.l', website: 'https://ada.example.com/', photoUrl: 'https://images.example.com/ada.jpg',
  share: { ...DEFAULT_SHARE },
  ...extra,
});

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

/** Replaces the browser's download machinery with something a test can look at. */
function stubBrowser({ failClick = false } = {}) {
  const seen = { blob: null, clicks: [], revoked: [], created: 0 };
  window.URL.createObjectURL = vi.fn((blob) => { seen.blob = blob; seen.created += 1; return 'blob:test'; });
  window.URL.revokeObjectURL = vi.fn((url) => { seen.revoked.push(url); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
    if (failClick) throw new Error('blocked by the browser');
    seen.clicks.push({ download: this.download, href: this.href, attached: document.body.contains(this) });
  });
  seen.text = () => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(seen.blob);
  });
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the words', () => {
  it('names the action "Download contact"', () => {
    expect(DOWNLOAD_CONTACT.label).toBe('Download contact');
  });

  it('says that downloading does not save changes to IDYNIFY, and that it is the card in the preview', () => {
    expect(DOWNLOAD_CONTACT.note).toBe('Downloads the card shown in the preview. This does not save your changes to IDYNIFY.');
  });

  it('has plain words for the two things that can go wrong, and for what was left out', () => {
    expect(DOWNLOAD_CONTACT.noName).toMatch(/name/i);
    expect(DOWNLOAD_CONTACT.failed).toMatch(/browser/i);
    expect(DOWNLOAD_CONTACT.omitted(['Email'])).toBe('Not included, because it isn\'t valid yet: Email.');
    expect(DOWNLOAD_CONTACT.omitted(['Email', 'Website'])).toBe('Not included, because they aren\'t valid yet: Email, Website.');
  });

  it('cannot be changed by the page: the copy is frozen', () => {
    expect(Object.isFrozen(DOWNLOAD_CONTACT)).toBe(true);
  });
});

describe('downloading the draft', () => {
  it('hands the browser a .vcf named for the person, made from exactly what buildMyCardVCard makes', async () => {
    const browser = stubBrowser();
    const card = draft({ share: { ...DEFAULT_SHARE, email: true } });
    const result = downloadMyCardVCard(card);
    expect(result).toEqual({ status: 'downloaded', fileName: 'Ada_Lovelace.vcf' });
    expect(browser.blob.type).toBe(VCARD_MIME_TYPE);
    expect(await browser.text()).toBe(buildMyCardVCard(card));
    expect(browser.clicks).toEqual([{ download: 'Ada_Lovelace.vcf', href: 'blob:test', attached: true }]);
  });

  it('is made from the card as it is now: an unsaved draft is what is downloaded', async () => {
    const browser = stubBrowser();
    downloadMyCardVCard(draft({ title: 'Typed a second ago, not saved' }));
    expect(await browser.text()).toContain('TITLE:Typed a second ago\\, not saved');
  });

  it('leaves nothing behind: the link is removed at once and the address is let go after a moment', () => {
    const browser = stubBrowser();
    downloadMyCardVCard(draft());
    expect(document.querySelector('a[download]')).toBeNull();
    expect(browser.revoked).toEqual([]);
    vi.advanceTimersByTime(999);
    expect(browser.revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(browser.revoked).toEqual(['blob:test']);
  });

  it('can let the address go at once, if asked', () => {
    const browser = stubBrowser();
    downloadMyCardVCard(draft(), { revokeAfterMs: 0 });
    expect(browser.revoked).toEqual(['blob:test']);
  });

  it('does not log the person\'s name or anything else', () => {
    stubBrowser();
    downloadMyCardVCard(draft());
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('only what the preview shows', () => {
  const textOf = (card) => buildMyCardVCard(card);

  it('leaves out every private field, filled in or not', () => {
    const text = textOf(draft({ share: { ...ALL_OFF } }));
    for (const secret of ['ada@example.com', '555', 'linkedin.com', 'instagram', 'ada.example.com', 'images.example.com', 'Analyst', 'Analytical Engines']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('FN:Ada Lovelace');
  });

  it('starts with email, phone, Instagram and website private, and photo, title, organization and LinkedIn shared', () => {
    const text = textOf(draft());
    for (const secret of ['ada@example.com', '555', 'instagram', 'ada.example.com']) expect(text, secret).not.toContain(secret);
    for (const shown of ['Analyst', 'Analytical Engines', 'linkedin.com/in/ada-lovelace', 'images.example.com/ada.jpg']) expect(text, shown).toContain(shown);
  });

  it('is exactly the preview, for every one of the 256 ways the eight switches can be set', () => {
    for (let mask = 0; mask < 256; mask += 1) {
      const share = Object.fromEntries(SHAREABLE_FIELDS.map((field, index) => [field, Boolean(mask & (1 << index))]));
      const card = draft({ share });
      const view = previewOf(card);
      const text = textOf(card);
      const expected = {
        photoUrl: 'https://images.example.com/ada.jpg', title: 'Analyst', organization: 'Analytical Engines', email: 'ada@example.com',
        phone: '+1 (555) 010-2000', linkedinUrl: 'linkedin.com/in/ada-lovelace', instagram: 'instagram.com/ada.l', website: 'ada.example.com',
      };
      for (const field of SHAREABLE_FIELDS) {
        // In the file if and only if it is in the preview (and so only if it is switched on).
        expect(text.includes(expected[field]), `mask ${mask}, ${field}`).toBe(field in view);
        expect(field in view, `mask ${mask}, ${field} in the preview`).toBe(share[field]);
      }
    }
  });

  it('leaves out a shared field that is not valid, rather than putting what was typed in the file', () => {
    const text = textOf(draft({
      share: { ...ALL_ON }, email: 'not-an-email', phone: 'call me', website: 'javascript:alert(1)',
      photoUrl: 'http://images.example.com/insecure.jpg', linkedinUrl: 'https://evil.example.com/in/ada', instagram: 'two words',
    }));
    for (const typed of ['not-an-email', 'call me', 'javascript', 'insecure', 'evil.example', 'two words']) expect(text, typed).not.toContain(typed);
    expect(text).toContain('FN:Ada Lovelace');
  });

  it('carries no note, no source, and nothing that is not a field of the card', () => {
    const text = textOf(draft({
      share: { ...ALL_ON }, notes: 'private notes', source: 'apollo', uid: 'u-123', revision: 9, createdAt: 'x', token: 'tok_secret', suggestions: { title: 'x' },
    }));
    expect(text).not.toMatch(/NOTE|private notes|apollo|u-123|tok_secret|createdAt|revision|suggest/i);
  });

  it('ignores a sharing setting on the draft: it is no part of the file, and downloading does not change it', async () => {
    const browser = stubBrowser();
    const card = deepFreeze(draft({ sharingEnabled: true }));
    expect(() => downloadMyCardVCard(card)).not.toThrow();
    expect(card.sharingEnabled).toBe(true);
    expect(await browser.text()).not.toMatch(/sharing/i);
  });

  it('does not change the draft it is given', () => {
    stubBrowser();
    const card = deepFreeze(draft({ share: { ...ALL_ON } }));
    const before = JSON.stringify(card);
    downloadMyCardVCard(card);
    downloadContact(card);
    expect(JSON.stringify(card)).toBe(before);
  });
});

describe('a card with no name', () => {
  it('makes no file: no blob, no address, no click', () => {
    const browser = stubBrowser();
    for (const bad of [draft({ firstName: '', lastName: '' }), draft({ firstName: '   ', lastName: null }), newCard()]) {
      expect(downloadMyCardVCard(bad)).toEqual({ status: 'no-name' });
    }
    expect(browser.created).toBe(0);
    expect(browser.clicks).toEqual([]);
  });

  it('makes no file when the name is only made of values the card refuses', () => {
    const browser = stubBrowser();
    expect(downloadMyCardVCard(draft({ firstName: 'a'.repeat(61), lastName: 'b'.repeat(61) }))).toEqual({ status: 'no-name' });
    expect(browser.created).toBe(0);
  });

  it('answers for things that are not cards at all', () => {
    const browser = stubBrowser();
    for (const bad of [null, undefined, '', 'Ada', 7, true, [], [draft()], () => draft()]) {
      expect(downloadMyCardVCard(bad), String(bad)).toEqual({ status: 'no-name' });
    }
    expect(browser.created).toBe(0);
  });
});

describe('when the browser refuses', () => {
  it('says so when it cannot make an address, and leaves nothing behind', () => {
    stubBrowser();
    window.URL.createObjectURL = vi.fn(() => { throw new Error('no blob urls'); });
    expect(downloadMyCardVCard(draft())).toEqual({ status: 'failed', fileName: 'Ada_Lovelace.vcf' });
    expect(document.querySelector('a[download]')).toBeNull();
    expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('says so when there is no way to make an address at all', () => {
    stubBrowser();
    window.URL.createObjectURL = undefined;
    expect(downloadMyCardVCard(draft()).status).toBe('failed');
  });

  it('says so when a file cannot be made', () => {
    stubBrowser();
    vi.stubGlobal('Blob', function FailingBlob() { throw new Error('no blobs'); });
    expect(downloadMyCardVCard(draft()).status).toBe('failed');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('says so when the click is blocked, and still removes the link and lets the address go', () => {
    const browser = stubBrowser({ failClick: true });
    expect(downloadMyCardVCard(draft())).toEqual({ status: 'failed', fileName: 'Ada_Lovelace.vcf' });
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(browser.revoked).toEqual(['blob:test']);
  });

  it('can be tried again after a failure', () => {
    const browser = stubBrowser({ failClick: true });
    expect(downloadMyCardVCard(draft()).status).toBe('failed');
    browser.clicks.length = 0;
    vi.restoreAllMocks();
    const second = stubBrowser();
    expect(downloadMyCardVCard(draft()).status).toBe('downloaded');
    expect(second.clicks).toHaveLength(1);
  });
});

describe('a file name that is safe whatever the name is', () => {
  const nameOf = (firstName, lastName = '') => myCardVCardFileName(draft({ firstName, lastName }));

  it('is the name with underscores, in any script', () => {
    expect(nameOf('Ada', 'Lovelace')).toBe('Ada_Lovelace.vcf');
    expect(nameOf('José', '李小龍')).toBe('José_李小龍.vcf');
    expect(nameOf('Мария', 'Иванова')).toBe('Мария_Иванова.vcf');
  });

  it('can carry no path, no extension of its own, no control or invisible character, no quote', () => {
    for (const bad of ['../../etc/passwd', '..\\windows\\system32', 'a/b', 'name.exe', 'a\u0000b', 'a‮b', 'a\nb', 'a"b', "a'b", 'a;b', 'a:b', '<script>', 'a b c', 'ａｄａ', '😀 smile']) {
      const name = nameOf(bad, 'Smith');
      expect(name, JSON.stringify(bad)).toMatch(/^[\p{L}\p{N}_]+\.vcf$/u);
      expect(name.match(/\./g), JSON.stringify(bad)).toHaveLength(1);
      expect(name).not.toMatch(/^_|_\.vcf$/);
    }
  });

  it('is cut to 60 characters, on a whole character, and not left ending in an underscore', () => {
    const name = nameOf('A'.repeat(40), 'B'.repeat(40));
    expect(Array.from(name.replace(/\.vcf$/, '')).length).toBeLessThanOrEqual(60);
    expect(name).not.toMatch(/_\.vcf$/);
    const wide = nameOf('李'.repeat(60), '龍'.repeat(30));
    expect(Array.from(wide.replace(/\.vcf$/, '')).length).toBeLessThanOrEqual(60);
    expect(wide).toMatch(/^李+\.vcf$/u);
    // A cut that lands just after the space between the names does not leave a dangling underscore.
    expect(nameOf('a'.repeat(59), 'zzz')).toBe(`${'a'.repeat(59)}.vcf`);
  });

  it('is never a name a computer keeps for itself', () => {
    for (const reserved of ['CON', 'prn', 'Aux', 'NUL', 'COM1', 'lpt9']) {
      const name = nameOf(reserved);
      expect(name.toLowerCase(), reserved).not.toBe(`${reserved.toLowerCase()}.vcf`);
      expect(name).toBe(`${reserved}_contact.vcf`);
    }
    expect(nameOf('Connor')).toBe('Connor.vcf');
  });

  it('falls back to "contact" when nothing is left of the name, or there is no card', () => {
    expect(nameOf('!!!', '???')).toBe('contact.vcf');
    expect(nameOf('', '')).toBe('contact.vcf');
    expect(myCardVCardFileName(null)).toBe('contact.vcf');
  });

  it('is the name the browser is given', () => {
    const browser = stubBrowser();
    downloadMyCardVCard(draft({ firstName: '../Ada', lastName: 'Lovelace.exe' }));
    expect(browser.clicks[0].download).toBe('Ada_Lovelace_exe.vcf');
  });
});

describe('what the page is told: contactDownloadState', () => {
  it('is available for a card with a name, with nothing omitted', () => {
    expect(contactDownloadState(draft())).toEqual({ available: true, reason: null, omitted: [] });
  });

  it('is not available without a usable name', () => {
    for (const bad of [newCard(), draft({ firstName: '', lastName: '' }), null, undefined, 'x', 7, []]) {
      expect(contactDownloadState(bad), JSON.stringify(bad)).toMatchObject({ available: false, reason: 'no-name' });
    }
  });

  it('lists a shared field that is not valid, by the name a person knows it by', () => {
    const state = contactDownloadState(draft({ share: { ...DEFAULT_SHARE, email: true, website: true }, email: 'nope', website: 'not a web address', photoUrl: 'http://x.example.com/a.jpg' }));
    expect(state.omitted).toEqual(['Photo', 'Email', 'Website']);
    expect(state.available).toBe(true);
  });

  it('does not list a private field that is not valid: it would not be in the file either way', () => {
    expect(contactDownloadState(draft({ email: 'nope', phone: 'call me', instagram: 'two words' })).omitted).toEqual([]);
  });

  it('lists a part of the name that is not valid, shared or not', () => {
    const state = contactDownloadState(draft({ firstName: 'a'.repeat(61) }));
    expect(state).toMatchObject({ available: true, omitted: ['First name'] });
  });

  it('does not list a field that is empty or only spaces', () => {
    expect(contactDownloadState(draft({ share: { ...ALL_ON }, email: '   ', phone: '', website: null })).omitted).toEqual([]);
  });
});

describe('downloadContact: the click', () => {
  it('downloads, and says nothing when nothing was left out', () => {
    const browser = stubBrowser();
    const result = downloadContact(draft());
    expect(result).toEqual({ status: 'downloaded', fileName: 'Ada_Lovelace.vcf', omitted: [], message: null });
    expect(browser.clicks).toHaveLength(1);
  });

  it('downloads, and says what was left out because it is not valid', () => {
    stubBrowser();
    const result = downloadContact(draft({ share: { ...DEFAULT_SHARE, email: true }, email: 'ada@' }));
    expect(result.status).toBe('downloaded');
    expect(result.omitted).toEqual(['Email']);
    expect(result.message).toBe('Not included, because it isn\'t valid yet: Email.');
  });

  it('says there is no name, and makes no file', () => {
    const browser = stubBrowser();
    expect(downloadContact(newCard())).toEqual({ status: 'unavailable', reason: 'no-name', message: DOWNLOAD_CONTACT.noName });
    expect(browser.created).toBe(0);
  });

  it('says so, in words, when the browser refuses', () => {
    stubBrowser({ failClick: true });
    expect(downloadContact(draft())).toEqual({ status: 'failed', fileName: 'Ada_Lovelace.vcf', message: DOWNLOAD_CONTACT.failed });
  });

  it('passes the revoke delay on', () => {
    const browser = stubBrowser();
    downloadContact(draft(), { revokeAfterMs: 0 });
    expect(browser.revoked).toEqual(['blob:test']);
  });

  it('never throws, whatever it is given', () => {
    stubBrowser();
    for (const bad of [null, undefined, 'x', 7, [], {}, { firstName: 7 }, { share: 'all' }, Object.create({ firstName: 'Inherited' })]) {
      expect(() => downloadContact(bad), JSON.stringify(bad)).not.toThrow();
    }
  });
});

describe('it saves nothing, reads nothing and shares nothing', () => {
  it('makes no network call, on success or failure', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const beacon = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    stubBrowser();
    downloadContact(draft());
    downloadContact(newCard());
    vi.restoreAllMocks();
    stubBrowser({ failClick: true });
    downloadContact(draft());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('touches no browser storage', () => {
    globalThis.sessionStorage.clear();
    globalThis.localStorage.clear();
    stubBrowser();
    downloadContact(draft({ share: { ...ALL_ON } }));
    expect(globalThis.sessionStorage.length).toBe(0);
    expect(globalThis.localStorage.length).toBe(0);
  });

  it('is a function of the draft alone: the same draft gives the same file, however often', async () => {
    const browser = stubBrowser();
    const card = draft({ share: { ...ALL_ON } });
    downloadContact(card);
    const first = await browser.text();
    downloadContact(card);
    expect(await browser.text()).toBe(first);
  });
});

describe('Scout\'s download, which shares the helper, is what it was', () => {
  const scout = { name: 'Ada  Augusta Lovelace', company_name: 'Analytical Engines', email: 'ada@example.com', source: 'apollo' };

  it('downloads the same file, named as before, and logs as before', async () => {
    const browser = stubBrowser();
    downloadVCard(scout);
    expect(browser.clicks[0].download).toBe('Ada_Augusta_Lovelace.vcf');
    expect(await browser.text()).toContain('NOTE:Source: Found via Search');
    expect(console.log).toHaveBeenCalledWith('📱 vCard downloaded:', 'Ada_Augusta_Lovelace.vcf');
  });

  it('lets the address go at once, as before (not after a delay)', () => {
    const browser = stubBrowser();
    downloadVCard(scout);
    expect(browser.revoked).toEqual(['blob:test']);
  });

  it('is still named contact.vcf without a name', () => {
    const browser = stubBrowser();
    downloadVCard({ email: 'x@example.com' });
    expect(browser.clicks[0].download).toBe('contact.vcf');
  });

  it('still throws when the browser refuses, as before, now with the link and address cleaned up', () => {
    const browser = stubBrowser({ failClick: true });
    expect(() => downloadVCard(scout)).toThrow('blocked by the browser');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(browser.revoked).toEqual(['blob:test']);
  });

  it('keeps the source note and sales fields that My Card never has', async () => {
    const browser = stubBrowser();
    downloadVCard(scout);
    const text = await browser.text();
    expect(text).toContain('NOTE:');
    stubBrowser();
    const mine = buildMyCardVCard(draft({ share: { ...ALL_ON }, source: 'apollo' }));
    expect(mine).not.toContain('NOTE');
    expect(mine).not.toMatch(/apollo|Found via/);
  });
});
