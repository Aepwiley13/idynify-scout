/**
 * personHeaderModel — what a person's identity header needs to be drawn, and nothing else.
 *
 *   buildPersonHeaderModel(contact, { stickersById, now }) → PersonHeaderModel
 *
 * A DISPLAY MODEL, NOT A RECORD. It is derived from the contact the application
 * already holds, every time, and is never stored, written back or merged into a
 * contact. There is no second source of truth: change the contact and build the
 * model again. It is frozen, so it cannot be edited by accident either.
 *
 * PURE. It imports only other pure helpers (name, photo, phone, social and sticker
 * rules). No React, no Firebase or Firestore, no authentication, no services, no
 * billing, no routing, no enrichment: a test holds it to that. That is what lets
 * Contact Hub and, later, Scout draw the same header from the same contact.
 *
 * WHAT IT REUSES (nothing is re-invented):
 *   name           utils/contactDisplayName   (the rule behind peopleRules' personName)
 *   photo          utils/contactPhoto         (hasRealContactPhoto, resolveContactPhotoSources)
 *   phones         utils/contactPhones        (readContactPhones, primaryPhone, phoneDisplay)
 *   social         utils/socialProfiles       (readSocialProfiles: addresses are rebuilt from the
 *                                              platform's own rule, so only https links to the
 *                                              platform itself ever come out)
 *   stickers       services/stickers/stickerCore (visibleStickers, STICKER_COLORS)
 *
 * TOLERANT. A missing, blank, wrongly-typed or malformed value is left out, never
 * shown as "undefined" or "[object Object]", and never makes the model throw. Very
 * long values are clipped (a generous cap, with an ellipsis) so one bad import
 * cannot break a layout. A link is only offered when it is safe: a mailto address
 * cannot carry a second recipient, a subject or a header; a tel number is digits
 * and an optional leading +; a social address is rebuilt, not echoed.
 *
 * @typedef {object} PersonHeaderModel
 * @property {string}  name             what to call the person ("Unknown contact" when there is no name)
 * @property {boolean} hasName          false when the name is the "Unknown contact" stand-in
 * @property {string|null} title
 * @property {string|null} organization
 * @property {string|null} location     read-only text, from `location` or city, state, country
 * @property {{ initials: string, photoUrl: string|null, fullPhotoUrl: string|null }} avatar
 *             initials are always present (the fallback); photoUrl is null unless the contact has
 *             a real photo (placeholders and non-https values are not photos)
 * @property {{ text: string, href: string, label: string }|null} phone
 *             the number to call (mobile first, never a fax); text includes any extension; href is tel:
 * @property {{ address: string, href: string }|null} email   the first usable address; href is mailto:
 * @property {Array<{ platform: string, label: string, url: string, handle: string }>} social
 * @property {Array<{ id: string, name: string, color: string, emoji: string|null }>|null} stickers
 *             null: stickers are not available here (draw no sticker area); []: available, none
 *             assigned (draw only the add control, when there is an action for it)
 * @property {{ active: boolean, lastActivityAt: string|null }} activity
 *             active: contact in the last 30 days
 */
import { contactDisplayName, nameParts, UNKNOWN_CONTACT } from '../../../utils/contactDisplayName.js';
import { resolveContactPhotoSources } from '../../../utils/contactPhoto.js';
import { primaryPhone, phoneDisplay, readContactPhones } from '../../../utils/contactPhones.js';
import { readSocialProfiles, platformLabel } from '../../../utils/socialProfiles.js';
import { STICKER_COLORS, visibleStickers } from '../../../services/stickers/stickerCore.js';

/** Generous caps for text shown in a header: far above anything a person types, far below a layout breaker. */
export const LIMITS = Object.freeze({ name: 200, title: 200, organization: 200, location: 200, emoji: 16 });

/** "Active" means a message or contact in this long. The existing contact card's rule. */
export const ACTIVE_WINDOW_MS = 30 * 86_400_000;

// ─── Text ────────────────────────────────────────────────────────────────────

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
const graphemesOf = (text) => (segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text));

/** The text as one clean line: strings only, controls dropped, spaces collapsed, '' when nothing is left. */
function line(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\p{Cc}/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/** `value` as a clean line of at most `max` characters (whole characters, never half of one), or null. */
function clipped(value, max) {
  const text = line(value);
  if (!text) return null;
  const parts = graphemesOf(text);
  if (parts.length <= max) return text;
  return `${parts.slice(0, max - 1).join('').trimEnd()}…`;
}

// ─── Name and initials ───────────────────────────────────────────────────────

/** The first letter or number of a word, as one whole character ('' when it has none). */
const leadOf = (word) => graphemesOf(word).find((g) => /[\p{L}\p{N}]/u.test(g)) ?? '';

/**
 * Up to two initials: the first word's and the last word's; one for a single word; '?' when the
 * name has no letters at all. The same letters the contact card draws for an ordinary name, but
 * safe for names outside the basic alphabet (a letter with its accent, a name in another script).
 */
export function initialsOf(name) {
  const words = line(name).split(' ').filter((w) => leadOf(w) !== '');
  if (words.length === 0) return '?';
  const first = leadOf(words[0]);
  const last = words.length > 1 ? leadOf(words[words.length - 1]) : '';
  return `${first}${last}`.toLocaleUpperCase();
}

// ─── Location, title, organization ───────────────────────────────────────────

/** "Salt Lake City, UT, United States" from whichever parts the contact has; `location` wins when it is set. */
export function locationText(contact) {
  const direct = clipped(contact?.location, LIMITS.location);
  if (direct) return direct;
  const parts = [];
  for (const field of ['city', 'state', 'country']) {
    const part = line(contact?.[field]);
    if (part && !parts.some((p) => p.toLowerCase() === part.toLowerCase())) parts.push(part);
  }
  return clipped(parts.join(', '), LIMITS.location);
}

// ─── Links ───────────────────────────────────────────────────────────────────

const UNSAFE_IN_ADDRESS = '\\s@,;<>?&#%"\'\\\\';
const EMAIL = new RegExp(`^[^${UNSAFE_IN_ADDRESS}]+@[^${UNSAFE_IN_ADDRESS}]+\\.[^${UNSAFE_IN_ADDRESS}]{2,}$`, 'u');
const EMAIL_MAX = 254;

/**
 * An address that is safe to put in a mailto: link, or null. A comma, semicolon, query, fragment,
 * percent, quote, angle bracket or space is refused, so a link cannot add a recipient, a subject or a header.
 */
export function safeEmail(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  if (address.length === 0 || address.length > EMAIL_MAX || !EMAIL.test(address)) return null;
  return { address, href: `mailto:${encodeURI(address)}` };
}

/** The first usable address, in the order the contact card reads them: emails[], then email, then work_email. */
function emailOf(contact) {
  const listed = Array.isArray(contact?.emails) ? contact.emails.map((entry) => (typeof entry === 'string' ? entry : entry?.value)) : [];
  for (const candidate of [...listed, contact?.email, contact?.work_email]) {
    const found = safeEmail(candidate);
    if (found) return found;
  }
  return null;
}

/** A tel: link for a number: digits and a leading +, 7 to 15 digits (the length a phone number can have), or null. */
export function safeTelHref(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${raw.startsWith('+') ? '+' : ''}${digits}`;
}

function phoneOf(contact) {
  const entry = primaryPhone(readContactPhones(contact));
  if (!entry) return null;
  const href = safeTelHref(entry.value);
  if (!href) return null;
  const text = clipped(phoneDisplay(entry), 60);
  return text ? { text, href, label: entry.label } : null;
}

function socialOf(contact) {
  return readSocialProfiles(contact)
    .filter((p) => typeof p.url === 'string' && p.url.startsWith('https://'))
    .map((p) => ({ platform: p.platform, label: platformLabel(p.platform) ?? p.platform, url: p.url, handle: p.handle }));
}

// ─── Stickers ────────────────────────────────────────────────────────────────

function stickersOf(contact, stickersById) {
  if (!(stickersById instanceof Map)) return null;
  return visibleStickers(contact ?? {}, stickersById).map((s) => ({
    id: String(s.id),
    name: clipped(s.name, LIMITS.name) ?? '',
    color: STICKER_COLORS.includes(s.color) ? s.color : 'gray',
    emoji: clipped(s.emoji, LIMITS.emoji),
  })).filter((s) => s.name !== '');
}

// ─── Activity ────────────────────────────────────────────────────────────────

function timeOf(value) {
  let v = value;
  if (value !== null && typeof value === 'object' && typeof value.toDate === 'function') {
    try { v = value.toDate(); } catch { return null; }
  }
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

function activityOf(contact, now) {
  // The contact card's rule: the last message, else the last contact. A value that is not a date is skipped.
  const at = [contact?.last_message_at, contact?.last_contacted_at].map(timeOf).find((t) => t !== null) ?? null;
  return { active: at !== null && now - at < ACTIVE_WINDOW_MS, lastActivityAt: at === null ? null : new Date(at).toISOString() };
}

// ─── The model ───────────────────────────────────────────────────────────────

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

/**
 * @param {object|null|undefined} contact  the contact as the application holds it; never changed
 * @param {object} [options]
 * @param {Map<string, object>} [options.stickersById]  the sticker registry, when stickers are available
 * @param {number} [options.now]  the time to judge activity by (defaults to now); for tests and previews
 * @returns {Readonly<PersonHeaderModel>}
 */
export function buildPersonHeaderModel(contact, { stickersById = null, now = Date.now() } = {}) {
  const source = contact !== null && typeof contact === 'object' ? contact : {};
  // The shared name helper turns any value into text (an object would become "[object Object]"), so it is
  // handed only the name fields that really are text.
  const text = (v) => (typeof v === 'string' ? v : '');
  const nameSource = {
    name: text(source.name),
    first_name: text(source.first_name) || text(source.firstName),
    last_name: text(source.last_name) || text(source.lastName),
  };
  const parts = nameParts(nameSource);
  const hasName = Boolean(parts.name || parts.first || parts.last);
  // Never the email address as a name: the address has its own pill.
  const name = clipped(contactDisplayName(nameSource, { email: false }), LIMITS.name) ?? UNKNOWN_CONTACT;
  const { thumbnail, full } = resolveContactPhotoSources(source);

  return deepFreeze({
    name,
    hasName,
    title: clipped(source.title, LIMITS.title),
    organization: clipped(source.company_name, LIMITS.organization) ?? clipped(source.company, LIMITS.organization),
    location: locationText(source),
    avatar: { initials: hasName ? initialsOf(name) : '?', photoUrl: thumbnail, fullPhotoUrl: full },
    phone: phoneOf(source),
    email: emailOf(source),
    social: socialOf(source),
    stickers: stickersOf(source, stickersById),
    activity: activityOf(source, now),
  });
}

export default buildPersonHeaderModel;
