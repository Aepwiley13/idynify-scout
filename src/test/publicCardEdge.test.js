// The public card edge function (netlify/edge-functions/public-card.js): page, .vcf, photo, previews,
// escaping, headers, flag. Plain Request/Response with a mocked fetch; no network, no emulator.
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { handle } from '../../netlify/edge-functions/public-card.js';
import { escapeAttr, escapeText } from '../../netlify/edge-functions/lib/escape.js';
import { buildPublicVCard } from '../../netlify/edge-functions/lib/vcard.js';
import { parsePublicCard, safeHttpsUrl, BACK_SCRIPT, BACK_SCRIPT_HASH } from '../../netlify/edge-functions/lib/publicCard.js';
import { buildMyCardVCard } from '../utils/vcard.js';
import { photoDataUrl } from './helpers/photoFixtures.js';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const ORIGIN = 'https://staging.example.com';
const ENV = { MY_CARD_SHARING_ENABLED: 'true', MY_CARD_FIREBASE_PROJECT_ID: 'demo-project' };
const getEnv = (extra = {}) => (name) => ({ ...ENV, ...extra })[name] || '';

const str = (stringValue) => ({ stringValue });
const typed = (obj) => {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (v && typeof v === 'object') fields[k] = { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([a, b]) => [a, str(b)])) } };
    else fields[k] = str(v);
  }
  return fields;
};
const base = { firstName: 'Ada', lastName: 'Lovelace', revision: 3, schemaVersion: 2, updatedAt: '2026-11-28T10:00:00.000Z' };
const docResponse = (obj, init = {}) => new Response(JSON.stringify({ name: 'x', fields: typed(obj) }), { status: 200, ...init });
const notFound = () => new Response('{"error":{"code":404}}', { status: 404 });
const fetchOf = (response) => async () => (typeof response === 'function' ? response() : response);

const get = (path, doc, env = {}) => handle(new Request(`${ORIGIN}${path}`), {
  getEnv: getEnv(env), fetchImpl: fetchOf(() => (doc === null ? notFound() : docResponse(doc))),
});
const page = async (doc, env) => { const r = await get(`/c/${ID}`, doc, env); return { r, html: await r.text() }; };

const REQUIRED = {
  'cache-control': 'no-store', 'netlify-cdn-cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer',
};
const expectHeaders = (response) => { for (const [k, v] of Object.entries(REQUIRED)) expect(response.headers.get(k), k).toBe(v); };

describe('the recipient page', () => {
  it('shows the shared fields, the Save to Contacts button and the footer, from the public copy alone', async () => {
    const { r, html } = await page({
      ...base, title: 'Analyst', organization: 'Analytical Engines', email: 'ada@example.com', phone: '+1 555 010 0000',
      linkedinUrl: 'https://www.linkedin.com/in/ada', instagram: 'ada_l', website: 'https://example.com/',
      link1: { label: 'Book a meeting', url: 'https://calendly.com/ada' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expectHeaders(r);
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Analyst');
    expect(html).toContain(`href="/c/${ID}/contact.vcf"`);
    expect(html).toContain('href="tel:+15550100000"');
    expect(html).toContain('href="sms:+15550100000"');
    expect(html).toContain('href="mailto:ada&#64;example.com"'.replace('&#64;', '@'));
    expect(html).toContain('Book a meeting');
    expect(html).toContain('calendly.com');
    expect(html).toContain('href="/signup?ref=card"');
    expect(html).toContain('Create your free digital business card');
    expect(html).toContain('src="/assets/Idynify_logo1.png" alt="IDYNIFY"');
    expect(html).not.toContain('Made with IDYNIFY');
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html).toContain(`<script>${BACK_SCRIPT}</script>`);
  });

  it('a card with only a name and one method shows only those', async () => {
    const { html } = await page({ ...base, email: 'ada@example.com' });
    expect(html).toContain('mailto:');
    expect(html).not.toContain('tel:');
    expect(html).not.toContain('LinkedIn');
    expect(html).not.toContain('Instagram');
  });

  it('external links open safely and carry the destination host under the label', async () => {
    const { html } = await page({ ...base, email: 'a@b.co', link1: { label: 'Talk', url: 'https://cal.example.org/me' }, website: 'https://example.com/x' });
    for (const m of html.match(/<a [^>]*target="_blank"[^>]*>/g)) expect(m).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).toMatch(/cal\.example\.org<\/span><span class="v">Talk/);
  });

  it('uses initials with no photo, and the embedded photo through /photo.jpg', async () => {
    expect((await page({ ...base, email: 'a@b.co' })).html).toContain('>AL<');
    const photo = photoDataUrl();
    const { html } = await page({ ...base, email: 'a@b.co', photoUrl: photo });
    expect(html).toContain(`src="/c/${ID}/photo.jpg"`);
    expect(html).not.toContain('base64');
  });

  it('has a Done button that is hidden until its script runs, and goes back, closes or goes home', async () => {
    const { html } = await page({ ...base, email: 'a@b.co' });
    expect(html).toMatch(/<button type="button" id="back" class="back" hidden[^>]*>\u2039 Done<\/button>/);
    expect(BACK_SCRIPT).toContain('history.back()');
    expect(BACK_SCRIPT).toContain('window.close()');
    expect(BACK_SCRIPT).toContain("location.href='/'");
    expect(BACK_SCRIPT).not.toMatch(/fetch|XMLHttp|eval|document\.write|innerHTML/);
  });

  it('wording: View LinkedIn, Visit website, and a calendar link reads Book time with me', async () => {
    const { html } = await page({ ...base, linkedinUrl: 'https://www.linkedin.com/in/ada', website: 'https://example.com/', link1: { label: 'My Calendar', url: 'https://cal.example.org/ada' }, link2: { label: 'Book a meeting', url: 'https://cal.example.org/b' } });
    expect(html).toContain('View LinkedIn');
    expect(html).toContain('Visit website');
    expect(html).toContain('Book time with me');
    expect(html).toContain('Book a meeting');
    expect(html).not.toContain('My Calendar');
  });

  it('sends a strict CSP: styles inline only, and the one script allowed by its hash', async () => {
    const { r } = await page({ ...base, email: 'a@b.co' });
    const csp = r.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'sha256-${BACK_SCRIPT_HASH}'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(BACK_SCRIPT_HASH).toBe(createHash('sha256').update(BACK_SCRIPT).digest('base64'));
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('preview tags', () => {
  const tags = (html) => html.match(/<meta [^>]*>/g).join('\n');

  it('name and role in a clean title and description, the branded image, canonical url and profile', async () => {
    const { html } = await page({ ...base, title: 'Analyst', organization: 'Engines', email: 'ada@example.com', photoUrl: photoDataUrl() });
    const t = tags(html);
    expect(t).toContain('property="og:title" content="Ada Lovelace \u2014 Digital Card"');
    expect(t).toContain('property="og:description" content="Analyst at Engines · Save contact info and connect instantly"');
    expect(t).toContain(`property="og:image" content="${ORIGIN}/card-og-default.png"`);
    expect(t).not.toContain('photo.jpg');
    expect(t).toContain('property="og:image:width" content="1200"');
    expect(t).toContain(`property="og:url" content="${ORIGIN}/c/${ID}"`);
    expect(t).toContain('property="og:type" content="profile"');
    expect(t).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('with no title or organization the description is just the invitation; one of them reads alone', async () => {
    const t = tags((await page({ ...base, email: 'ada@example.com' })).html);
    expect(t).toContain('property="og:description" content="Save contact info and connect instantly"');
    expect(tags((await page({ ...base, title: 'CEO', email: 'a@b.co' })).html)).toContain('content="CEO · Save contact info and connect instantly"');
    expect(tags((await page({ ...base, organization: 'Doggy Entertainment', email: 'a@b.co' })).html)).toContain('content="Doggy Entertainment · Save contact info and connect instantly"');
    expect(t).toContain(`content="${ORIGIN}/card-og-default.png"`);
  });

  it('a photo, embedded or external, is never the preview image', async () => {
    const t = tags((await page({ ...base, email: 'a@b.co', photoUrl: 'https://img.example.com/a.jpg' })).html);
    expect(t).toContain(`property="og:image" content="${ORIGIN}/card-og-default.png"`);
    expect(t).not.toContain('img.example.com');
  });

  it('never carries email, phone, handles or links, even when shared', async () => {
    const { html } = await page({
      ...base, email: 'ada@example.com', phone: '+1 555 010 0000', instagram: 'ada_l', linkedinUrl: 'https://www.linkedin.com/in/ada',
      website: 'https://example.com/', link1: { label: 'Book', url: 'https://calendly.com/ada' },
    });
    const t = tags(html);
    for (const secret of ['ada@example.com', '555', 'ada_l', 'linkedin.com', 'https://example.com/', 'calendly']) expect(t, secret).not.toContain(secret);
  });
});

describe('escaping', () => {
  const EVIL = `"><script>alert(1)</script><img src=x onerror=alert(2)>'\`&`;
  const doc = {
    ...base, firstName: EVIL, lastName: EVIL, title: EVIL, organization: EVIL, email: 'a@b.co',
    link1: { label: EVIL, url: 'https://x.example.com/' }, link2: { label: 'ok', url: `https://x.example.com/?q="><script>alert(3)</script>` },
  };

  it('no value can start a tag or break out of an attribute, anywhere in the page', async () => {
    const { html } = await page(doc);
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html).toContain(`<script>${BACK_SCRIPT}</script>`);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain('&lt;script&gt;');
    // Every attribute value in the output is quoted and holds no raw quote, angle bracket or backtick.
    for (const [, value] of html.matchAll(/ (?:content|href|src|alt|title)="([^"]*)"/g)) {
      expect(value).not.toMatch(/[<>`]/);
    }
  });

  it('the helpers escape text and attributes separately', () => {
    expect(escapeText(`<a href="x">&'`)).toBe('&lt;a href="x"&gt;&amp;\'');
    expect(escapeAttr(`<a href="x">&'\``)).toBe('&lt;a href&#61;&quot;x&quot;&gt;&amp;&#39;&#96;');
    expect(escapeText('a\u0000b\u0007c')).toBe('abc');
  });

  it('the vcard cannot be made to start a new field', () => {
    const view = parsePublicCard({ ...base, title: 'x\nEND:VCARD\nBEGIN:VCARD', organization: 'a;b,c', link1: { label: 'L\nTEL:1', url: 'https://x.example.com/' } });
    const vcf = buildPublicVCard(view);
    expect(vcf.match(/^END:VCARD/gm)).toHaveLength(1);
    expect(vcf).not.toMatch(/^TEL:1/m);
    expect(vcf).toContain('ORG:a\\;b\\,c');
  });
});

describe('re-validation of values', () => {
  const ok = (extra) => parsePublicCard({ ...base, ...extra });

  it('links must be https, with no spaces and no credentials', () => {
    for (const url of ['javascript:alert(1)', 'http://example.com/', 'https://user@example.com/', 'https://user:pw@example.com/', 'https://exa mple.com/', 'https://example.com/a b', 'data:text/html,hi', 'mailto:a@b.co', 'example.com', 'https:///x', `https://example.com/${'a'.repeat(500)}`, 'https://example.com/\n']) {
      expect(safeHttpsUrl(url), url).toBeNull();
      expect(ok({ link1: { label: 'x', url } }).links, url).toHaveLength(0);
    }
    expect(ok({ link1: { label: 'x', url: 'https://example.com/a?b=c#d' } }).links).toHaveLength(1);
  });

  it('other fields are dropped, not rendered, when they are not what they claim', () => {
    const c = ok({ email: 'not an email', phone: 'call me', linkedinUrl: 'https://evil.example.com/in/x', instagram: '../x', website: 'javascript:alert(1)', photoUrl: 'javascript:alert(1)', title: 'x'.repeat(101) });
    for (const k of ['email', 'phone', 'linkedinUrl', 'instagram', 'website', 'photoUrl', 'title']) expect(c[k], k).toBeUndefined();
  });

  it('a card with no name, the wrong schema or a bad photo is unavailable or photo-less', () => {
    expect(parsePublicCard({ ...base, firstName: '', lastName: '' })).toBeNull();
    expect(parsePublicCard({ ...base, schemaVersion: 1 })).toBeNull();
    expect(parsePublicCard(null)).toBeNull();
    expect(ok({ photoUrl: 'data:image/png;base64,AAAA' }).photoUrl).toBeUndefined();
    expect(ok({ photoUrl: 'data:image/jpeg;base64,/9j/AAAA' }).photoUrl).toBeDefined();
  });

  it('keys the public copy should never have are ignored', () => {
    const c = ok({ ownerUid: 'U', sharingEnabled: 'true' });
    expect(JSON.stringify(c)).not.toContain('ownerUid');
  });
});

describe('contact.vcf', () => {
  it('is text/vcard with the shared fields and labelled links, and nothing else', async () => {
    const r = await get(`/c/${ID}/contact.vcf`, {
      ...base, title: 'Analyst', organization: 'Engines', email: 'ada@example.com', website: 'https://example.com/',
      link1: { label: 'Book a meeting', url: 'https://calendly.com/ada' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/vcard');
    expect(r.headers.get('content-disposition')).toContain('Ada_Lovelace.vcf');
    expectHeaders(r);
    const vcf = await r.text();
    for (const line of ['BEGIN:VCARD', 'VERSION:3.0', 'N:Lovelace;Ada;;;', 'FN:Ada Lovelace', 'ORG:Engines', 'TITLE:Analyst', 'EMAIL;TYPE=INTERNET:ada@example.com', 'URL:https://example.com/', 'item1.URL:https://calendly.com/ada', 'item1.X-ABLabel:Book a meeting', 'END:VCARD']) {
      expect(vcf.split('\r\n')).toContain(line);
    }
    expect(vcf).not.toContain('TEL');
  });

  it('matches the app\'s own builder for the standard fields', () => {
    const fields = { firstName: 'Ada', lastName: 'Lovelace', title: 'Analyst', organization: 'Engines', email: 'ada@example.com', phone: '+1 555 010 0000', linkedinUrl: 'https://www.linkedin.com/in/ada', instagram: 'ada_l', website: 'https://example.com/' };
    const share = Object.fromEntries(['photoUrl', 'title', 'organization', 'email', 'phone', 'linkedinUrl', 'instagram', 'website'].map((k) => [k, true]));
    const app = buildMyCardVCard({ ...fields, photoUrl: '', share, sharingEnabled: true });
    const edge = buildPublicVCard(parsePublicCard({ ...base, ...fields }));
    expect(edge).toBe(app);
  });

  it('folds long lines at 75 bytes', () => {
    const vcf = buildPublicVCard(parsePublicCard({ ...base, title: 'é'.repeat(60) }));
    for (const line of vcf.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe('photo.jpg', () => {
  it('decodes the stored JPEG', async () => {
    const photo = photoDataUrl();
    const r = await get(`/c/${ID}/photo.jpg`, { ...base, email: 'a@b.co', photoUrl: photo });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expectHeaders(r);
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(btoa(String.fromCharCode(...bytes))).toBe(photo.slice('data:image/jpeg;base64,'.length));
  });

  it('is the same unavailable answer when the photo is private, a link or not a JPEG', async () => {
    const miss = await (await get(`/c/${ID}`, null)).text();
    for (const doc of [{ ...base, email: 'a@b.co' }, { ...base, email: 'a@b.co', photoUrl: 'https://img.example.com/a.jpg' }]) {
      const r = await get(`/c/${ID}/photo.jpg`, doc);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(miss);
    }
  });
});

describe('every miss is the same', () => {
  const variants = async () => {
    const ok = { ...base, email: 'a@b.co' };
    return [
      ['unknown', await get(`/c/${ID}`, null)],
      ['malformed id', await get('/c/short', ok)],
      ['id with a bad character', await get(`/c/${ID.slice(0, 21)}!`, ok)],
      ['path traversal', await get('/c/..%2F..%2Fx', ok)],
      ['flag off', await get(`/c/${ID}`, ok, { MY_CARD_SHARING_ENABLED: 'false' })],
      ['flag missing', await get(`/c/${ID}`, ok, { MY_CARD_SHARING_ENABLED: '' })],
      ['flag not exactly true', await get(`/c/${ID}`, ok, { MY_CARD_SHARING_ENABLED: 'TRUE' })],
      ['not a card', await get(`/c/${ID}`, { foo: 'bar' })],
      ['no name', await get(`/c/${ID}`, { ...base, firstName: '', lastName: '' })],
      ['wrong schema', await get(`/c/${ID}`, { ...base, schemaVersion: 1 })],
      ['no project', await get(`/c/${ID}`, ok, { MY_CARD_FIREBASE_PROJECT_ID: '' })],
      ['fetch throws', await handle(new Request(`${ORIGIN}/c/${ID}`), { getEnv: getEnv(), fetchImpl: async () => { throw new Error('down'); } })],
      ['server error', await handle(new Request(`${ORIGIN}/c/${ID}`), { getEnv: getEnv(), fetchImpl: async () => new Response('x', { status: 500 }) })],
      ['invalid json', await handle(new Request(`${ORIGIN}/c/${ID}`), { getEnv: getEnv(), fetchImpl: async () => new Response('not json') })],
      ['vcard of a miss', await get(`/c/${ID}/contact.vcf`, null)],
      ['vcard with the flag off', await get(`/c/${ID}/contact.vcf`, ok, { MY_CARD_SHARING_ENABLED: 'false' })],
      ['POST', await handle(new Request(`${ORIGIN}/c/${ID}`, { method: 'POST' }), { getEnv: getEnv(), fetchImpl: fetchOf(docResponse(ok)) })],
    ];
  };

  it('same status, same body, same headers, every one with the required headers', async () => {
    const all = await variants();
    const [, first] = all[0];
    const body = await first.clone().text();
    expect(first.status).toBe(404);
    expect(body).toContain("This card isn't available");
    expect(body).toContain('href="/signup?ref=card"');
    const headersOf = (r) => JSON.stringify([...r.headers.entries()].sort());
    for (const [what, r] of all) {
      expect(r.status, what).toBe(404);
      expect(await r.clone().text(), what).toBe(body);
      expect(headersOf(r), what).toBe(headersOf(first));
      expectHeaders(r);
    }
  });

  it('the unavailable page names nothing about why', async () => {
    const body = await (await get(`/c/${ID}`, null)).text();
    for (const word of ['suspend', 'retired', 'takedown', 'taken down', 'revoked', 'disabled', 'flag']) expect(body.toLowerCase()).not.toContain(word);
  });
});

describe('the data source', () => {
  it('reads only publicCards/<id> in the configured project, with no key and no credentials', async () => {
    const calls = [];
    await handle(new Request(`${ORIGIN}/c/${ID}`), {
      getEnv: getEnv({ MY_CARD_FIREBASE_PROJECT_ID: 'demo-project' }),
      fetchImpl: async (url, init) => { calls.push([String(url), init]); return docResponse({ ...base, email: 'a@b.co' }); },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`https://firestore.googleapis.com/v1/projects/demo-project/databases/(default)/documents/publicCards/${ID}`);
    expect(calls[0][0]).not.toMatch(/key=|users\/|card\/main/);
    expect(JSON.stringify(calls[0][1])).not.toMatch(/authorization|cookie/i);
  });

  it('the flag off makes no read at all', async () => {
    let called = false;
    await handle(new Request(`${ORIGIN}/c/${ID}`), { getEnv: getEnv({ MY_CARD_SHARING_ENABLED: 'false' }), fetchImpl: async () => { called = true; return notFound(); } });
    expect(called).toBe(false);
  });

  it('falls back to VITE_FIREBASE_PROJECT_ID', async () => {
    let seen = '';
    await handle(new Request(`${ORIGIN}/c/${ID}`), {
      getEnv: (n) => ({ MY_CARD_SHARING_ENABLED: 'true', VITE_FIREBASE_PROJECT_ID: 'fallback-proj' })[n] || '',
      fetchImpl: async (u) => { seen = String(u); return notFound(); },
    });
    expect(seen).toContain('/projects/fallback-proj/');
  });
});
