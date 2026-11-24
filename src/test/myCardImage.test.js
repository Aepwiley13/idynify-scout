/**
 * The My Card image: the card as a PNG.
 *
 * What is held here: only what the card shares is ever drawn (a private field,
 * even one filled in and unsaved, is nowhere in the layout, the drawing or the
 * file name); the layout follows the preview (organization or the neutral
 * header, then photo, name, title, details, and the attribution at the bottom);
 * long, CJK and missing content is handled; a photo is drawn only when it is a
 * picture kept in the card, and a link is never fetched; nothing is requested,
 * saved or stored; and the file name is safe whatever the name is.
 *
 * There is no canvas in jsdom, so layout is tested with a stand-in ruler and the
 * drawing with a stand-in context that records what it is told. How it looks is
 * checked in real Chrome (scripts/visual/my-card).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  CARD_IMAGE_ERRORS, HEADER_FALLBACK, IMAGE_WIDTH, MIN_IMAGE_HEIGHT, cardImageFileName, detailRows, drawCardImage,
  layoutCardImage, renderCardImage, wrapText,
} from '../pages/ContactHub/myCard/cardImage';
import { DEFAULT_SHARE, SHAREABLE_FIELDS, newCard, publicCardView } from '../utils/myCardRules';
import { photoDataUrl, fingerprintOf } from './helpers/photoFixtures';

// ─── Stand-ins ───────────────────────────────────────────────────────────────

const CJK = /[぀-ヿ一-鿿가-힯]/u;
/** A ruler: a CJK character is as wide as the font is tall, any other 0.55 of it. */
const measure = (text, spec) => {
  const size = Number(/(\d+)px/.exec(spec)[1]);
  return Array.from(text).reduce((sum, g) => sum + (CJK.test(g) ? size : size * 0.55), 0);
};

const card = (extra = {}) => ({
  ...newCard(),
  firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', organization: 'Analytical Engines',
  email: 'ada@example.com', phone: '+1 (555) 010-2000', linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
  instagram: 'ada.l', website: 'https://ada.example.com/', photoUrl: '',
  share: { ...DEFAULT_SHARE },
  ...extra,
});
const sharing = (...on) => Object.fromEntries(SHAREABLE_FIELDS.map((field) => [field, on.includes(field)]));
const everything = (extra = {}) => card({ share: sharing(...SHAREABLE_FIELDS), ...extra });

const layoutOf = (c, options = {}) => layoutCardImage(publicCardView(c), { measure, ...options });
const texts = (layout, role) => layout.ops.filter((op) => op.type === 'text' && (!role || op.role === role)).map((op) => op.text);
const allText = (layout) => texts(layout).join('\n');

/** A context that records what it is asked to draw. */
function fakeContext() {
  const drawn = { texts: [], images: 0, fonts: new Set(), calls: 0 };
  const gradient = { addColorStop() {} };
  const handler = {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'fillText') return (text) => { drawn.texts.push(text); };
      if (prop === 'drawImage') return () => { drawn.images += 1; };
      if (prop === 'measureText') return (text) => ({ width: measure(text, target.font ?? '10px x') });
      return () => { drawn.calls += 1; };
    },
    set(target, prop, value) { target[prop] = value; if (prop === 'font') drawn.fonts.add(value); return true; },
  };
  return { ctx: new Proxy({ font: '10px x' }, handler), drawn };
}

/** A platform whose canvases are the stand-in above, and which counts every use. */
function fakePlatform({ photoFails = false } = {}) {
  const seen = { loaded: [], canvases: [], released: 0, fontsAwaited: 0, drawn: [] };
  return {
    seen,
    platform: {
      createCanvas(width, height) {
        const { ctx, drawn } = fakeContext();
        const canvas = { width, height, getContext: () => ctx };
        seen.canvases.push(canvas);
        seen.drawn.push(drawn);
        return canvas;
      },
      async loadImage(url) {
        seen.loaded.push(url);
        if (photoFails) throw new Error('cannot decode');
        return { source: {}, width: 320, height: 320 };
      },
      async fontsReady() { seen.fontsAwaited += 1; },
      async toBlob() { return new Blob(['png'], { type: 'image/png' }); },
      release() { seen.released += 1; },
    },
  };
}

// jsdom has no Path2D; the stand-in context ignores what is drawn with it.
beforeAll(() => { vi.stubGlobal('Path2D', class Path2D {}); });
afterAll(() => { vi.unstubAllGlobals(); });

// ─── Privacy ─────────────────────────────────────────────────────────────────

describe('only what is shared is drawn', () => {
  const SECRETS = ['ada@example.com', '+1 (555) 010-2000', 'ada.l', 'ada.example.com', 'ada-lovelace', 'Analyst', 'Analytical Engines'];

  it('draws nothing but the name when every switch is off, though every field is filled in', () => {
    const layout = layoutOf(card({ share: sharing() }));
    expect(allText(layout)).not.toMatch(/ada@|555|ada\.l|ada\.example|linkedin|Analyst|Analytical/);
    expect(texts(layout, 'name')).toEqual(['Ada Lovelace']);
    expect(texts(layout, 'header')).toEqual([HEADER_FALLBACK]);
    expect(layout.ops.some((op) => op.type === 'icon')).toBe(false);
    expect(layout.ops.some((op) => op.type === 'rule')).toBe(false);
  });

  it.each(SHAREABLE_FIELDS.filter((field) => field !== 'photoUrl'))('keeps %s off the image when only its switch is off, and puts it on when it is on', (field) => {
    const on = SHAREABLE_FIELDS.filter((f) => f !== field);
    const without = allText(layoutOf(card({ share: sharing(...on) })));
    const withIt = allText(layoutOf(card({ share: sharing(field) })));
    const value = { title: 'Analyst', organization: 'Analytical Engines', email: 'ada@example.com', phone: '555', linkedinUrl: 'ada-lovelace', instagram: 'ada.l', website: 'ada.example.com' }[field];
    expect(without).not.toContain(value);
    expect(withIt).toContain(value);
  });

  it('draws the same, through the real drawing, whatever the private fields hold', async () => {
    const privateSide = (extra) => card({ share: sharing('title'), ...extra });
    const run = async (c) => {
      const { platform, seen } = fakePlatform();
      await renderCardImage(c, { platform });
      return seen.drawn.flatMap((d) => d.texts);
    };
    const a = await run(privateSide());
    const b = await run(privateSide({ email: 'someone.else@elsewhere.test', phone: '+44 20 7946 0000', instagram: 'other', website: 'https://other.example.org', organization: 'Another Co' }));
    expect(b).toEqual(a);
    for (const secret of SECRETS.filter((s) => s !== 'Analyst')) expect(a.join('\n')).not.toContain(secret);
  });

  it('never loads a private photo, and draws the initials', async () => {
    const photo = photoDataUrl(320, 9000);
    const { platform, seen } = fakePlatform();
    const result = await renderCardImage(card({ photoUrl: photo, share: sharing('title') }), { platform });
    expect(result.ok).toBe(true);
    expect(result.photo).toBe(false);
    expect(seen.loaded).toEqual([]);
    expect(seen.drawn.flatMap((d) => d.texts)).toContain('AL');
    expect(JSON.stringify(seen.drawn)).not.toContain(fingerprintOf(photo));
  });

  it('reads the view and nothing else: a card that is not shared at all draws only its name', async () => {
    const { platform, seen } = fakePlatform();
    const result = await renderCardImage({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', share: { email: false } }, { platform });
    expect(result.ok).toBe(true);
    expect(seen.drawn.flatMap((d) => d.texts).join('|')).not.toContain('ada@');
  });

  it('is named from the shared name only', () => {
    expect(cardImageFileName(card({ email: 'a@b.c' }))).toBe('Ada_Lovelace_card.png');
  });
});

// ─── Layout ──────────────────────────────────────────────────────────────────

describe('the layout follows the preview', () => {
  it('is 1080 wide and at least square', () => {
    const layout = layoutOf(everything());
    expect(layout.width).toBe(1080);
    expect(layout.width).toBe(IMAGE_WIDTH);
    expect(layout.height).toBeGreaterThanOrEqual(MIN_IMAGE_HEIGHT);
    expect(layoutOf(card({ share: sharing() })).height).toBe(MIN_IMAGE_HEIGHT);
  });

  it('puts the organization in the header, the photo (or initials), name, title, details and the attribution in that order, top to bottom', () => {
    const layout = layoutOf(everything());
    const y = (predicate) => layout.ops.find(predicate).y ?? layout.ops.find(predicate).cy;
    const order = [
      y((op) => op.role === 'header'),
      y((op) => op.type === 'avatar'),
      y((op) => op.role === 'name'),
      y((op) => op.role === 'title'),
      y((op) => op.type === 'rule'),
      y((op) => op.role === 'detail'),
      y((op) => op.role === 'attribution'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
    expect(texts(layout, 'header')).toEqual(['Analytical Engines']);
    expect(texts(layout, 'attribution')).toEqual(['Made with IDYNIFY']);
  });

  it('draws the details in the preview\'s order, as the preview reads them', () => {
    expect(detailRows(publicCardView(everything()))).toEqual([
      { icon: 'email', text: 'ada@example.com' },
      { icon: 'phone', text: '+1 (555) 010-2000' },
      { icon: 'linkedinUrl', text: 'linkedin.com/in/ada-lovelace' },
      { icon: 'instagram', text: '@ada.l' },
      { icon: 'website', text: 'ada.example.com' },
    ]);
    expect(layoutOf(everything()).ops.filter((op) => op.type === 'icon').map((op) => op.name)).toEqual(['email', 'phone', 'linkedinUrl', 'instagram', 'website']);
  });

  it('uses the neutral header, and no wordmark, when there is no organization', () => {
    const layout = layoutOf(card({ organization: '', share: sharing('title') }));
    expect(texts(layout, 'header')).toEqual(['Contact card']);
    expect(allText(layout).match(/IDYNIFY/g)).toHaveLength(1);
  });

  it('omits the rule and rows when there are no details, and the title when there is none', () => {
    const layout = layoutOf(card({ title: '', share: sharing() }));
    expect(layout.ops.some((op) => op.type === 'rule' || op.type === 'icon')).toBe(false);
    expect(texts(layout, 'title')).toEqual([]);
  });

  it('keeps the attribution at the bottom edge, with room, on a short card and on a tall one', () => {
    for (const c of [card({ share: sharing() }), everything()]) {
      const layout = layoutOf(c);
      const made = layout.ops.find((op) => op.role === 'attribution');
      expect(made.y).toBeLessThan(layout.height);
      expect(layout.height - made.y).toBeLessThan(120);
      expect(made.y).toBeGreaterThan(layout.ops.filter((op) => op.role === 'detail' || op.role === 'title').reduce((m, op) => Math.max(m, op.y), 0));
    }
  });

  it('draws the initials of the card when there is no photo, and the photo when there is one', () => {
    expect(layoutOf(everything()).ops.find((op) => op.type === 'avatar')).toMatchObject({ photo: false, initials: 'AL' });
    expect(layoutOf(everything(), { photo: true }).ops.find((op) => op.type === 'avatar')).toMatchObject({ photo: true });
  });

  it('is drawn in the theme asked for: the card\'s own surface and text follow it, the brand does not', () => {
    const light = layoutOf(everything(), { theme: 'light' });
    const dark = layoutOf(everything(), { theme: 'dark' });
    expect(light.background).not.toBe(dark.background);
    expect(light.ops.find((op) => op.role === 'name').color).not.toBe(dark.ops.find((op) => op.role === 'name').color);
    expect(light.ops.find((op) => op.role === 'header').color).toBe(dark.ops.find((op) => op.role === 'header').color);
    expect(layoutOf(everything(), { theme: 'nonsense' }).background).toBe(light.background);
  });
});

// ─── Text ────────────────────────────────────────────────────────────────────

describe('long, unusual and missing text', () => {
  const widest = (layout, role) => Math.max(0, ...layout.ops.filter((op) => op.type === 'text' && op.role === role).map((op) => measure(op.text, op.font)));

  it('wraps a long name in whole words, and makes it smaller before it cuts it', () => {
    const name = 'Bartholomew-Alexandrovich Featherstonehaugh-Cholmondeley';
    const layout = layoutOf(card({ firstName: name.split(' ')[0], lastName: name.split(' ')[1], share: sharing() }));
    const lines = texts(layout, 'name');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join('')).toBe(name.replace(' ', '')) ;
    expect(widest(layout, 'name')).toBeLessThanOrEqual(IMAGE_WIDTH - 130);
  });

  it('draws a short name at the full size, and a long one smaller, uncut, before it cuts anything', () => {
    const sizeOf = (layout) => Number(/(\d+)px/.exec(layout.ops.find((op) => op.role === 'name').font)[1]);
    expect(sizeOf(layoutOf(card({ share: sharing() })))).toBe(76);
    const long = layoutOf(card({ firstName: 'Bartholomew-Alexandrovich', lastName: 'Featherstonehaugh-Cholmondeley', share: sharing() }));
    expect(sizeOf(long)).toBeLessThan(76);
    expect(texts(long, 'name').some((line) => line.endsWith('…'))).toBe(false);
  });

  it('cuts an enormous name with an ellipsis, in three lines, and the image stays a sane height', () => {
    // The longest name the card takes (60 + 60 characters), on a ruler twice as wide as the stand-in's.
    const view = publicCardView(card({ firstName: 'W'.repeat(60), lastName: 'Z'.repeat(60), share: sharing() }));
    const layout = layoutCardImage(view, { measure: (text, spec) => measure(text, spec) * 2 });
    const lines = texts(layout, 'name');
    expect(lines).toHaveLength(3);
    expect(lines[2].endsWith('…')).toBe(true);
    expect(layout.height).toBeLessThan(2400);
  });

  it('keeps the organization to two lines in the header, with an ellipsis, and inside its width', () => {
    const org = 'The International Association of Analytical Engine Manufacturers and Allied Trades of the Northern Hemisphere';
    const layout = layoutOf(card({ organization: org, share: sharing('organization') }));
    const lines = texts(layout, 'header');
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(widest(layout, 'header')).toBeLessThanOrEqual(IMAGE_WIDTH - 259);
  });

  it('breaks a long email at / @ . - _ and not in the middle of a word, when it can', () => {
    const email = 'bartholomew.featherstonehaugh-cholmondeley@internationalassociation-analyticalengines.example';
    const layout = layoutOf(card({ email, share: sharing('email') }));
    const lines = texts(layout, 'detail');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(email);
    for (const line of lines.slice(0, -1)) expect(/[/@.\-_]$/.test(line)).toBe(true);
  });

  it('cuts a single unbroken word wider than a line between characters, losing none of it', () => {
    const { lines, truncated } = wrapText('W'.repeat(60), 400, '800 50px x', measure, 10);
    expect(truncated).toBe(false);
    expect(lines.join('')).toBe('W'.repeat(60));
    for (const line of lines) expect(measure(line, '800 50px x')).toBeLessThanOrEqual(400);
  });

  it('wraps CJK text between characters, within the width, and draws every character', () => {
    const name = '李小龍';
    const title = '創辦人兼執行長、首席策略官兼全球合作夥伴關係與生態系統發展負責人';
    const layout = layoutOf(card({ firstName: '小龍', lastName: '李', title, organization: 'カフェ・ユニコード株式会社', share: sharing('title', 'organization') }));
    expect(texts(layout, 'name').join('')).toBe('小龍 李');
    expect(texts(layout, 'title').join('').replace('…', '')).toBe(title.slice(0, texts(layout, 'title').join('').replace('…', '').length));
    expect(widest(layout, 'title')).toBeLessThanOrEqual(IMAGE_WIDTH - 130);
    expect(texts(layout, 'header').join('')).toBe('カフェ・ユニコード株式会社');
    expect(name).toBe('李小龍');
  });

  it('keeps accented letters, emoji and combining marks whole', () => {
    // 'e' + a combining accent, and an emoji with a skin tone: each is one character to a reader, and is never split.
    const first = 'Zoe\u0301'.repeat(8);
    const layout = layoutOf(card({ firstName: first, lastName: '👩🏽'.repeat(14), share: sharing() }));
    const lines = texts(layout, 'name');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('').replace(/\s/gu, '')).toBe(`${first}${'👩🏽'.repeat(14)}`);
    for (const line of lines) {
      expect(line.startsWith('\u0301')).toBe(false);
      expect(line.startsWith('\u{1F3FD}')).toBe(false);
    }
  });

  it('handles every field absent but the name', () => {
    const layout = layoutOf({ ...newCard(), firstName: 'Ada', share: sharing() });
    expect(texts(layout)).toEqual(['Contact card', 'Ada', 'Made with IDYNIFY']);
  });

  it('gives a wrapped detail row room for every line', () => {
    const one = layoutOf(card({ email: 'a@b.co', share: sharing('email', 'phone') }));
    const many = layoutOf(card({ email: `${'very-long-address'.repeat(8)}@example.com`, share: sharing('email', 'phone') }));
    expect(many.height).toBeGreaterThan(one.height);
    const phoneY = (layout) => layout.ops.find((op) => op.role === 'detail' && op.text.startsWith('+1')).y;
    const lastEmailY = many.ops.filter((op) => op.role === 'detail' && !op.text.startsWith('+1')).reduce((m, op) => Math.max(m, op.y), 0);
    expect(phoneY(many)).toBeGreaterThan(lastEmailY);
  });
});

// ─── Drawing ─────────────────────────────────────────────────────────────────

describe('drawing', () => {
  it('draws exactly the layout\'s text, and the photo only when there is one', () => {
    const layout = layoutOf(everything(), { photo: true });
    const withPhoto = fakeContext();
    drawCardImage(withPhoto.ctx, layout, { source: {}, width: 320, height: 320 });
    expect(withPhoto.drawn.texts).toEqual(texts(layout));
    expect(withPhoto.drawn.images).toBe(1);

    const without = fakeContext();
    drawCardImage(without.ctx, layoutOf(everything()), null);
    expect(without.drawn.images).toBe(0);
    expect(without.drawn.texts).toContain('AL');
  });

  it('uses the page\'s font stack, with a system fallback', () => {
    const { ctx, drawn } = fakeContext();
    drawCardImage(ctx, layoutOf(everything()), null);
    for (const font of drawn.fonts) expect(font).toMatch(/Inter, -apple-system.*sans-serif$/);
  });
});

// ─── Rendering ───────────────────────────────────────────────────────────────

describe('renderCardImage', () => {
  it('makes a PNG, named safely, of the layout\'s size, and releases every canvas', async () => {
    const { platform, seen } = fakePlatform();
    const result = await renderCardImage(everything(), { platform });
    expect(result).toMatchObject({ ok: true, fileName: 'Ada_Lovelace_card.png', width: 1080, photo: false });
    expect(result.blob.type).toBe('image/png');
    expect(result.height).toBeGreaterThanOrEqual(1080);
    expect(seen.canvases.at(-1)).toMatchObject({ width: 1080, height: result.height });
    expect(seen.released).toBe(seen.canvases.length);
    expect(seen.fontsAwaited).toBe(1);
  });

  it('draws a photo kept in the card, loaded from its own data, and says so', async () => {
    const photo = photoDataUrl(320, 9000);
    const { platform, seen } = fakePlatform();
    const result = await renderCardImage(everything({ photoUrl: photo }), { platform });
    expect(result.photo).toBe(true);
    expect(seen.loaded).toEqual([photo]);
    expect(seen.drawn.at(-1).images).toBe(1);
  });

  it('draws the initials, and loads nothing, for a photo that is a link', async () => {
    const { platform, seen } = fakePlatform();
    const result = await renderCardImage(everything({ photoUrl: 'https://images.example.com/ada.jpg' }), { platform });
    expect(result).toMatchObject({ ok: true, photo: false });
    expect(seen.loaded).toEqual([]);
    expect(seen.drawn.flatMap((d) => d.texts)).toContain('AL');
  });

  it('draws the initials for a picture that is not a finished profile photo', async () => {
    const { platform, seen } = fakePlatform();
    const notOurs = `data:image/png;base64,${'A'.repeat(900)}`;
    const wrongSize = photoDataUrl(1000, 9000);
    for (const bad of [notOurs, wrongSize]) {
      const result = await renderCardImage(everything({ photoUrl: bad }), { platform });
      expect(result.photo).toBe(false);
    }
    expect(seen.loaded).toEqual([]);
  });

  it('falls back to the initials when the photo will not decode, and still makes the image', async () => {
    const { platform } = fakePlatform({ photoFails: true });
    const result = await renderCardImage(everything({ photoUrl: photoDataUrl(320, 9000) }), { platform });
    expect(result).toMatchObject({ ok: true, photo: false });
  });

  it('answers, and draws nothing, for a card with no name', async () => {
    const { platform, seen } = fakePlatform();
    expect(await renderCardImage({ ...newCard() }, { platform })).toEqual({ ok: false, reason: CARD_IMAGE_ERRORS.NO_NAME });
    expect(await renderCardImage(null, { platform })).toEqual({ ok: false, reason: CARD_IMAGE_ERRORS.NO_NAME });
    expect(seen.canvases).toHaveLength(0);
  });

  it('answers rather than throws when the browser cannot encode, and still releases', async () => {
    const { platform, seen } = fakePlatform();
    platform.toBlob = async () => { throw new Error('encode_failed'); };
    expect(await renderCardImage(everything(), { platform })).toEqual({ ok: false, reason: CARD_IMAGE_ERRORS.RENDER_FAILED });
    expect(seen.released).toBe(seen.canvases.length);
  });

  it('does not change the card it is given, and does not save, store or request anything', async () => {
    const original = Object.freeze({ ...everything({ photoUrl: photoDataUrl(320, 9000) }), share: Object.freeze({ ...sharing(...SHAREABLE_FIELDS) }) });
    const snapshot = JSON.stringify(original);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { platform } = fakePlatform();
    const result = await renderCardImage(original, { platform });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    setItem.mockRestore();
  });

  it('never writes the picture or the card to the console', async () => {
    const photo = photoDataUrl(320, 9000);
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { platform } = fakePlatform({ photoFails: true });
    await renderCardImage(everything({ photoUrl: photo }), { platform });
    const written = spies.flatMap((s) => s.mock.calls).flat().map(String).join('\n');
    expect(written).not.toContain(fingerprintOf(photo));
    expect(written).not.toContain('ada@example.com');
    spies.forEach((s) => s.mockRestore());
  });
});

// ─── The file name ───────────────────────────────────────────────────────────

describe('the file name', () => {
  it.each([
    [{ firstName: 'Ada', lastName: 'Lovelace' }, 'Ada_Lovelace_card.png'],
    [{ firstName: 'José', lastName: "O'Brien-Smith" }, 'José_O_Brien_Smith_card.png'],
    [{ firstName: '李', lastName: '小龍' }, '李_小龍_card.png'],
    [{ firstName: '!!!' }, 'IDYNIFY_card.png'],
    [{}, 'IDYNIFY_card.png'],
    [null, 'IDYNIFY_card.png'],
  ])('%j is %s', (input, expected) => {
    expect(cardImageFileName(input)).toBe(expected);
  });

  it('cannot hold a path, an extension of its own, a control character or a reserved name', () => {
    for (const first of ['../../etc/passwd', 'a/b\\c', 'x\u0000y', '.exe', 'con', 'NUL', 'COM1', 'name.png.exe', 'a'.repeat(200)]) {
      const name = cardImageFileName({ firstName: first });
      expect(name, first).not.toMatch(/[/\\\p{Cc}]/u);
      expect(name.match(/\./g), first).toHaveLength(1);
      expect(name.endsWith('_card.png'), first).toBe(true);
      expect(name.length, first).toBeLessThanOrEqual(60 + '_card.png'.length);
      expect(name.replace(/_card\.png$/, ''), first).not.toMatch(/^(?:con|prn|aux|nul|com\d|lpt\d)$/i);
    }
  });

  it('is the contact file\'s name with another ending', async () => {
    const { myCardVCardFileName } = await import('../utils/vcard');
    const c = card({ firstName: 'Zoë', lastName: 'Ng' });
    expect(cardImageFileName(c)).toBe(myCardVCardFileName(c).replace(/\.vcf$/, '_card.png'));
  });
});
