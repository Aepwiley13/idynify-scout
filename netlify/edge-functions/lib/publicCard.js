/**
 * The public card: reading it, re-validating it and rendering it. Pure functions plus one fetch.
 *
 * The ONLY data source is publicCards/{id}, read through Firestore's public REST endpoint with no key
 * (the rules let anyone `get` one document whose ID they hold). Everything the page, the .vcf, the photo
 * and the preview tags show is built from the object parsePublicCard returns, so they cannot disagree.
 * Every value is re-validated here as if the rules had not already done so: any shape problem means
 * "unavailable", never a partial page.
 */
/* eslint-disable no-control-regex */
import { escapeAttr, escapeText } from './escape.js';
import { buildPublicVCard } from './vcard.js';

export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DATA_URL_PREFIX = 'data:image/jpeg;base64,';
const MAX_PHOTO_CHARS = 80000;
const LIMITS = { firstName: 60, lastName: 60, title: 100, organization: 120, email: 254, phone: 40, linkedinUrl: 200, instagram: 30, website: 200 };
const LINK_KEYS = ['link1', 'link2', 'link3', 'link4', 'link5'];

// ── Reading ──────────────────────────────────────────────────────────────────

/** A Firestore REST typed value as a plain value, or undefined when it is not a kind we read. */
function plain(typed) {
  if (!typed || typeof typed !== 'object') return undefined;
  if ('stringValue' in typed) return typeof typed.stringValue === 'string' ? typed.stringValue : undefined;
  if ('integerValue' in typed) {
    const n = Number(typed.integerValue);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  if ('mapValue' in typed) {
    const fields = typed.mapValue && typed.mapValue.fields;
    if (!fields || typeof fields !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(fields)) out[key] = plain(value);
    return out;
  }
  return undefined;
}

export function projectIdFrom(getEnv) {
  return getEnv('MY_CARD_FIREBASE_PROJECT_ID') || getEnv('VITE_FIREBASE_PROJECT_ID') || getEnv('FIREBASE_PROJECT_ID') || '';
}

/** The public document, as plain fields, or null for anything that is not a readable card. */
export async function fetchPublicDocument(id, { projectId, fetchImpl = fetch }) {
  if (!ID_PATTERN.test(id) || !/^[a-z0-9-]{4,60}$/i.test(projectId || '')) return null;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/publicCards/${id}`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || typeof body !== 'object' || !body.fields) return null;
    const out = {};
    for (const [key, value] of Object.entries(body.fields)) out[key] = plain(value);
    return out;
  } catch {
    return null;
  }
}

// ── Re-validation ────────────────────────────────────────────────────────────

const text = (value, max) => (typeof value === 'string' && value.length > 0 && value.length <= max
  // eslint-disable-next-line no-control-regex
  && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined);

/** An https web address with no spaces and no credentials; returns the URL object or null. */
export function safeHttpsUrl(value, max = 500) {
  if (typeof value !== 'string' || value.length > max || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  // The address must name a host itself: the URL parser would quietly repair "https:///x".
  if (!/^https:\/\/[^/?#@\s]+/i.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
  return url;
}

function safeWebsite(value) {
  if (typeof value !== 'string' || value.length > LIMITS.website || /[\s\u0000-\u001f\u007f]/.test(value)) return undefined;
  if (!/^https?:\/\//i.test(value)) return undefined;
  let url;
  try { url = new URL(value); } catch { return undefined; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname) return undefined;
  return value;
}

function safeLinkedIn(value) {
  const url = typeof value === 'string' && value.length <= LIMITS.linkedinUrl ? safeHttpsUrl(value, LIMITS.linkedinUrl) : null;
  if (!url) return undefined;
  const host = url.hostname.toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com') ? value : undefined;
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const PHONE = /^\+?[0-9 ().-]+(?: ?(?:x|ext\.?) ?[0-9]{1,6})?$/i;
const INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;

function safePhoto(value) {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith(DATA_URL_PREFIX)) {
    const b64 = value.slice(DATA_URL_PREFIX.length);
    return value.length <= MAX_PHOTO_CHARS && /^\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(b64) && b64.length % 4 === 0 ? value : undefined;
  }
  return safeHttpsUrl(value, 500) ? value : undefined;
}

/**
 * The validated public card, or null. Only known keys are read; a key that fails its check is left
 * out (the rest of the card is still the owner's choice), but a missing name, a wrong schema or a
 * non-card document makes the whole card unavailable.
 */
export function parsePublicCard(doc) {
  if (!doc || typeof doc !== 'object' || doc.schemaVersion !== 2) return null;
  const firstName = typeof doc.firstName === 'string' && doc.firstName.length <= LIMITS.firstName ? doc.firstName : '';
  const lastName = typeof doc.lastName === 'string' && doc.lastName.length <= LIMITS.lastName ? doc.lastName : '';
  const clean = (s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = [clean(firstName), clean(lastName)].filter(Boolean).join(' ');
  if (!name) return null;

  const card = { firstName: clean(firstName), lastName: clean(lastName), name, links: [] };
  const title = text(doc.title, LIMITS.title);
  const organization = text(doc.organization, LIMITS.organization);
  const email = text(doc.email, LIMITS.email);
  const phone = text(doc.phone, LIMITS.phone);
  const instagram = typeof doc.instagram === 'string' && INSTAGRAM.test(doc.instagram) ? doc.instagram : undefined;
  if (title) card.title = title;
  if (organization) card.organization = organization;
  if (email && EMAIL.test(email)) card.email = email;
  if (phone && PHONE.test(phone) && phone.replace(/\D/g, '').length >= 7) card.phone = phone;
  if (instagram) card.instagram = instagram;
  const linkedinUrl = safeLinkedIn(doc.linkedinUrl);
  if (linkedinUrl) card.linkedinUrl = linkedinUrl;
  const website = safeWebsite(doc.website);
  if (website) card.website = website;
  const photoUrl = safePhoto(doc.photoUrl);
  if (photoUrl) card.photoUrl = photoUrl;

  for (const key of LINK_KEYS) {
    const link = doc[key];
    if (!link || typeof link !== 'object') continue;
    const label = typeof link.label === 'string' ? link.label.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const url = safeHttpsUrl(link.url);
    if (label && label.length <= 40 && url) card.links.push({ label, url: link.url, host: url.hostname });
  }
  return card;
}

export const hasPhotoData = (card) => !!card.photoUrl && card.photoUrl.startsWith(DATA_URL_PREFIX);

/** The photo's JPEG bytes (for /photo.jpg), or null when there is no embedded photo or it is not a JPEG. */
export function photoBytes(card) {
  if (!card || !hasPhotoData(card)) return null;
  try {
    const bin = atob(card.photoUrl.slice(DATA_URL_PREFIX.length));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
  } catch {
    return null;
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * Done: goes back where the person came from (history.back), or closes the tab when a script opened it,
 * or, with no history at all (a QR scan opens a fresh tab), goes to the IDYNIFY home page.
 * Its SHA-256 is in the Content-Security-Policy below; a test keeps the two together.
 */
export const BACK_SCRIPT = "(function(){var b=document.getElementById('back');if(!b)return;b.hidden=false;b.addEventListener('click',function(){if(history.length>1){history.back();return}if(window.opener){window.close();return}location.href='/'})})()";
export const BACK_SCRIPT_HASH = "UgI9C15wyyyBx/kF+oofcKNCrxVyiN+JWwBgKdl7M1M=";

export const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Netlify-CDN-Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  // The one inline script (the Done button) is allowed by its hash; nothing else may run.
'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${BACK_SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
});

const FOOTER = 'Create your free digital business card';
const DESCRIPTION_TAIL = 'Save contact info and connect instantly';

const CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:#f4f4f8;color:#14122b;font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:480px;margin:0 auto;padding:20px 16px 32px}
.card{overflow:hidden;background:#fff;border:1px solid #e4e4ee;border-radius:24px;box-shadow:0 8px 28px rgba(26,16,64,.12)}
.banner{height:128px;background:radial-gradient(120% 150% at 100% 0%,#e8197d 0%,transparent 58%),linear-gradient(135deg,#1a1040 0%,#4f46e5 55%,#7c3aed 100%)}
.body{display:flex;flex-direction:column;align-items:center;padding:0 24px 24px;text-align:center}
.avatar{width:112px;height:112px;margin:-56px 0 14px;border-radius:50%;object-fit:cover;background:#4f46e5;color:#fff;box-shadow:0 0 0 5px #fff;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800}
h1{margin:0;font-size:28px;line-height:1.15;font-weight:800;overflow-wrap:anywhere}
.title{margin:4px 0 0;font-size:17px;font-weight:600;overflow-wrap:anywhere}.org{margin:2px 0 0;color:#55537a;overflow-wrap:anywhere}
.save{display:block;width:100%;margin:20px 0 0;padding:14px;border-radius:14px;background:#e8197d;color:#fff;font-weight:700;font-size:17px;text-decoration:none;text-align:center}
.actions{list-style:none;margin:16px 0 0;padding:14px 0 0;width:100%;border-top:1px solid #e4e4ee;text-align:left}
.actions li{margin:0}.actions a{display:block;min-height:48px;padding:8px 6px;color:#14122b;text-decoration:none;overflow-wrap:anywhere}
.actions a:focus-visible,.save:focus-visible,.foot a:focus-visible{outline:3px solid #4f46e5;outline-offset:2px}
.k{display:block;font-size:12px;color:#55537a;letter-spacing:.02em}.v{font-size:16px;font-weight:600}
.bar{margin:0 0 12px}.back{min-height:44px;padding:8px 18px 8px 12px;border:1px solid #e4e4ee;border-radius:22px;background:#fff;color:#14122b;font-weight:600;font-size:16px;font-family:inherit;cursor:pointer}.back:focus-visible{outline:3px solid #4f46e5;outline-offset:2px}
.foot{margin:22px 0 0;text-align:center;font-size:14px}.foot a{display:inline-flex;flex-direction:column;align-items:center;gap:6px;color:#4f46e5;text-decoration:none;font-weight:600}.logo{display:block;width:120px;height:auto}
.na{padding:48px 24px;text-align:center}.na h1{font-size:22px}
@media (prefers-color-scheme:dark){body{background:#0d0a1f;color:#f1f0fb}.card{background:#17133a;border-color:#2c2760}.avatar{box-shadow:0 0 0 5px #17133a}.actions{border-color:#2c2760}.actions a{color:#f1f0fb}.k,.org{color:#b7b4de}.foot a{color:#a5a0ff}.back{background:#17133a;border-color:#2c2760;color:#f1f0fb}}`;

function shell({ title, head = '', body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${escapeText(title)}</title>${head}`
    + `<style>${CSS}</style></head><body><main><div class="bar"><button type="button" id="back" class="back" hidden aria-label="Go back">\u2039 Done</button></div>${body}</main><script>${BACK_SCRIPT}</script></body></html>`;
}

const footer = `<div class="foot"><a href="/signup?ref=card"><img class="logo" src="/assets/Idynify_logo1.png" alt="IDYNIFY" width="120" height="40"><span>${escapeText(FOOTER)}</span></a></div>`;

/** One body for every miss: unknown, malformed, retired, taken down, flag off, unreadable. */
export function renderUnavailable() {
  return shell({
    title: "This card isn't available",
    body: `<div class="card na"><h1>This card isn't available</h1><p>The link may be wrong, or the owner has turned it off.</p></div>${footer}`,
  });
}

const initials = (card) => Array.from([card.firstName, card.lastName].filter(Boolean).map((p) => Array.from(p)[0]).join('')).slice(0, 2).join('').toUpperCase();

/** What the preview tags may say: name, and "Title · Organization" only when they are in the copy. */
export function previewOf(card) {
  const role = card.title && card.organization ? `${card.title} at ${card.organization}` : (card.title || card.organization || '');
  const description = role ? `${role} · ${DESCRIPTION_TAIL}` : `${DESCRIPTION_TAIL[0].toUpperCase()}${DESCRIPTION_TAIL.slice(1)}`;
  return { title: `${card.name} \u2014 Digital Card`, description };
}

/** A booking link reads as an invitation. Only the plain default names are reworded; anything the person typed stays as typed. */
const friendlyLabel = (label) => (/^(my )?(calendar|schedule)$/i.test(label) ? 'Book time with me' : label);

const row = (href, label, value, external) => `<li><a href="${escapeAttr(href)}"${external ? ' target="_blank" rel="noopener noreferrer nofollow ugc"' : ''}><span class="k">${escapeText(label)}</span><span class="v">${escapeText(value)}</span></a></li>`;

export function renderCard(card, { origin, id }) {
  const { title, description } = previewOf(card);
  const pageUrl = `${origin}/c/${id}`;
  const photoPath = hasPhotoData(card) ? `/c/${id}/photo.jpg` : null;
  // The preview image is the IDYNIFY branded card image, never the person's photo.
  const image = `${origin}/card-og-default.png`;
  const head = [
    ['og:title', title], ['og:description', description], ['og:image', image], ['og:image:width', '1200'], ['og:image:height', '630'], ['og:image:alt', `${card.name}'s digital business card on IDYNIFY`], ['og:url', pageUrl], ['og:type', 'profile'], ['og:site_name', 'IDYNIFY'],
  ].map(([p, c]) => `<meta property="${p}" content="${escapeAttr(c)}">`).join('')
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeAttr(title)}">`
    + `<meta name="twitter:description" content="${escapeAttr(description)}"><meta name="twitter:image" content="${escapeAttr(image)}">`
    + `<meta name="description" content="${escapeAttr(description)}"><link rel="canonical" href="${escapeAttr(pageUrl)}">`;

  const avatar = card.photoUrl
    ? `<img class="avatar" src="${escapeAttr(photoPath || card.photoUrl)}" alt="" width="112" height="112" referrerpolicy="no-referrer">`
    : `<div class="avatar" aria-hidden="true">${escapeText(initials(card))}</div>`;

  const rows = [];
  if (card.phone) {
    const dial = card.phone.replace(/[^0-9+]/g, '');
    rows.push(row(`tel:${dial}`, 'Call', card.phone), row(`sms:${dial}`, 'Text', card.phone));
  }
  if (card.email) rows.push(row(`mailto:${card.email}`, 'Email', card.email));
  if (card.linkedinUrl) rows.push(row(card.linkedinUrl, 'LinkedIn', 'View LinkedIn', true));
  if (card.instagram) rows.push(row(`https://www.instagram.com/${card.instagram}`, 'Instagram', `@${card.instagram}`, true));
  if (card.website) rows.push(row(card.website, new URL(card.website).hostname, 'Visit website', true));
  for (const link of card.links) rows.push(row(link.url, link.host, friendlyLabel(link.label), true));

  const body = `<div class="card"><div class="banner"></div><div class="body">${avatar}<h1>${escapeText(card.name)}</h1>`
    + (card.title ? `<p class="title">${escapeText(card.title)}</p>` : '')
    + (card.organization ? `<p class="org">${escapeText(card.organization)}</p>` : '')
    + `<a class="save" href="/c/${escapeAttr(id)}/contact.vcf">Save to Contacts</a>`
    + (rows.length ? `<ul class="actions">${rows.join('')}</ul>` : '')
    + `</div></div>${footer}`;
  return shell({ title: `${card.name} · IDYNIFY`, head, body });
}

export { buildPublicVCard };
