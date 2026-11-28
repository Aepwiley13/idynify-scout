/**
 * Contact Hub — My Card: what a card holds, what a valid value is, and what
 * another person may ever be shown.
 *
 * Pure functions, no Firebase and no React, so the privacy rule is testable on
 * its own. Nothing here reads or writes anything: no card document exists yet.
 * When one does it will live at users/{uid}/card/main (CARD_DOC_SEGMENTS),
 * which only its owner can read.
 *
 * THE PRIVACY RULE, IN ONE PLACE
 *   publicCardView(card) is the only way to get what somebody else may see.
 *   The preview of "what others would see", a downloaded shared card and any
 *   future public page must all be built from its result and from nothing
 *   else, so they cannot disagree.
 *
 *   A field appears in it only when ALL of these hold:
 *     1. it is one of the fields listed in SHAREABLE_FIELDS;
 *     2. the owner's switch for it is exactly `true` (share[field] === true);
 *     3. it has a value, and that value is valid.
 *   Anything else is left out: a missing or malformed switch means private.
 *
 *   The name is the card. It is always in the view, and a card with no name
 *   has no view at all.
 *
 *   The result is built field by field from a fixed list. It is never a copy
 *   of the stored card, so a field added to the card later, the switches
 *   themselves, timestamps and anything unexpected in the record cannot leak.
 *
 * THE PHOTO is one of three things: nothing, an https link, or a small JPEG
 *   picture kept IN the card as a data URL (made by utils/photoPrep.js). Which
 *   is the same field and the same switch: a Private photo is as absent from
 *   the view, the preview and a download whether it is a link or a picture.
 *   A data URL is accepted only if it passes photoPrep's inspection (a real,
 *   square, metadata-free JPEG within the size cap): the card never keeps
 *   something merely CLAIMED to be a photo. A refused one gives a message that
 *   never contains the data.
 *
 * DEFAULTS
 *   Email and phone start private, as do Instagram and website. Photo, title,
 *   organization and LinkedIn start shared. Defaults are only ever applied
 *   when a new card is made (newCard): the owner sees every switch before
 *   saving. A stored card with no switches shares nothing but the name.
 */
import { inspectPhotoDataUrl } from './photoPrep.js';

/** Where a user's card will be stored: users/{uid}/card/main. Not written yet. */
export const CARD_COLLECTION = 'card';
export const CARD_DOC_ID = 'main';
export const CARD_DOC_SEGMENTS = (uid) => ['users', uid, CARD_COLLECTION, CARD_DOC_ID];

/**
 * 2 is the schema that can be shared (MY-CARD-SHARE-001): a public ID, five additional links with their own
 * switches, and `sharingEnabled` that may be true. A card saved before it (1) loads unchanged and is upgraded
 * by its next save. An older build refuses to overwrite a version 2 card (see isNewerVersion in the service).
 */
export const CARD_SCHEMA_VERSION = 2;

/** Every field a card holds, in the order the editor and the card show them. */
export const CARD_FIELDS = Object.freeze([
  'firstName', 'lastName', 'photoUrl', 'title', 'organization',
  'email', 'phone', 'linkedinUrl', 'instagram', 'website',
]);

/** The name is always on the card; it has no switch. */
export const NAME_FIELDS = Object.freeze(['firstName', 'lastName']);

/** The fields the owner switches on or off, one switch each. */
export const SHAREABLE_FIELDS = Object.freeze([
  'photoUrl', 'title', 'organization', 'email', 'phone', 'linkedinUrl', 'instagram', 'website',
]);

/** The five additional links (Facebook, a booking page, an event and so on), in display order. */
export const LINK_SLOTS = Object.freeze(['link1', 'link2', 'link3', 'link4', 'link5']);

/** Longest label and address of an additional link, and how many a card may hold. */
export const LINK_LIMITS = Object.freeze({ label: 40, url: 500, count: LINK_SLOTS.length });

/** Every switch a version 2 card holds: the eight fields and the five link slots. */
export const ALL_SHARE_KEYS = Object.freeze([...SHAREABLE_FIELDS, ...LINK_SLOTS]);

/** The contact methods that satisfy the publish gate. Additional links do not count. */
export const CONTACT_METHOD_FIELDS = Object.freeze(['email', 'phone', 'linkedinUrl', 'instagram', 'website']);

/** What a NEW card's link switches start as: Private, like email and phone. */
export const DEFAULT_LINK_SHARE = Object.freeze({ link1: false, link2: false, link3: false, link4: false, link5: false });

/** What a NEW card's switches start as. Email and phone are private. */
export const DEFAULT_SHARE = Object.freeze({
  photoUrl: true,
  title: true,
  organization: true,
  email: false,
  phone: false,
  linkedinUrl: true,
  instagram: false,
  website: false,
});

/** Longest value kept for each field. Longer input is a validation error, not cut. */
export const CARD_LIMITS = Object.freeze({
  firstName: 60,
  lastName: 60,
  photoUrl: 500,           // an https LINK; a picture kept in the card has its own cap (PHOTO.MAX_DATA_URL_CHARS)
  title: 100,
  organization: 120,
  email: 254,
  phone: 40,
  linkedinUrl: 200,
  instagram: 30,
  website: 200,
});

/** The same rule as the Add Person form, so the two agree on what an email is. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INSTAGRAM_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const INSTAGRAM_HOSTS = Object.freeze(['instagram.com', 'www.instagram.com']);
// Instagram's own paths, which are never somebody's handle.
const INSTAGRAM_RESERVED = Object.freeze(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'tv']);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const UNPRINTABLE = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x7f], [0x200b, 0x200d], [0xfeff, 0xfeff]].map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`).join('')}]`, 'g');

/** A string with control characters removed and runs of whitespace made one space. */
function cleanText(value) {
  if (typeof value !== 'string') return '';
  // Control characters and zero-width characters, named by code so none is typed here.
  return value.replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim();
}

const tooLong = (field) => `Keep this to ${CARD_LIMITS[field]} characters or fewer.`;

/** One line of plain text (a name, a title, an organization). */
function normalizeLine(field, raw) {
  const value = cleanText(raw);
  if (!value) return { value: '', error: null };
  if (value.length > CARD_LIMITS[field]) return { value: '', error: tooLong(field) };
  return { value, error: null };
}

function normalizeEmail(raw) {
  const value = cleanText(raw).toLowerCase();
  if (!value) return { value: '', error: null };
  if (value.length > CARD_LIMITS.email) return { value: '', error: tooLong('email') };
  if (!EMAIL_PATTERN.test(value)) return { value: '', error: 'Enter an email address like name@example.com.' };
  return { value, error: null };
}

function normalizePhone(raw) {
  const value = cleanText(raw);
  if (!value) return { value: '', error: null };
  if (value.length > CARD_LIMITS.phone) return { value: '', error: tooLong('phone') };
  // Digits, spaces and the punctuation phone numbers are written with; "x" or
  // "ext" for an extension. Nothing else, so a number can never carry markup.
  if (!/^\+?[0-9 ().-]+(?: ?(?:x|ext\.?) ?[0-9]{1,6})?$/i.test(value)) {
    return { value: '', error: 'Enter a phone number using digits, spaces and + ( ) - only.' };
  }
  const digits = value.replace(/(?:x|ext\.?) ?[0-9]{1,6}$/i, '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return { value: '', error: 'A phone number has between 7 and 15 digits.' };
  }
  return { value, error: null };
}

/**
 * A web address as an https or http URL, or null when it is not one.
 * No address with a user name or password in it, and none that is not a plain
 * web address (javascript:, data:, file: and so on).
 */
function parseWebUrl(text) {
  if (!text || /\s/.test(text)) return null;
  // A scheme that is not http(s) is refused; no scheme means https.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  // A real host: at least one dot, and no trailing or leading one.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
  return url;
}

function normalizeWebsite(raw) {
  const text = cleanText(raw);
  if (!text) return { value: '', error: null };
  if (text.length > CARD_LIMITS.website) return { value: '', error: tooLong('website') };
  const url = parseWebUrl(text);
  if (!url) return { value: '', error: 'Enter a web address like example.com.' };
  return { value: url.href, error: null };
}

const PHOTO_NOT_USABLE = 'That photo couldn\'t be used. Choose another, or remove it.';

// The last picture checked, by identity: a card is normalized many times as the form redraws, and a
// picture is tens of kilobytes to decode and walk. The result is the same for the same string.
let lastPhotoCheck = { input: null, output: null };

/** A picture kept in the card: a data URL, valid only if it is a finished profile photo (photoPrep). */
function normalizePhotoDataUrl(text) {
  if (lastPhotoCheck.input !== text) {
    const output = inspectPhotoDataUrl(text).ok ? { value: text, error: null } : { value: '', error: PHOTO_NOT_USABLE };
    lastPhotoCheck = { input: text, output };
  }
  return { ...lastPhotoCheck.output };
}

/**
 * Whether a photo value is a picture kept in the card (or something that claims to be one), as opposed to a
 * link. Anything that starts with "data:" (in any case) counts: it is never shown to a person as text.
 */
export const isPhotoData = (value) => typeof value === 'string' && /^data:/i.test(value.trimStart());

/** Text this short in the photo field is text a person typed. A picture kept in the card is far longer. */
export const PHOTO_TEXT_MAX_CHARS = 512;

/**
 * Whether a photo value is a PICTURE (a long data URL), to be kept out of text boxes and out of the draft's
 * text fields, as opposed to a link or a few characters somebody typed. It need not be a valid photo: a long
 * data URL that is not one is still never shown or kept as text.
 */
export const isPhotoPicture = (value) => isPhotoData(value) && value.length > PHOTO_TEXT_MAX_CHARS;

/** A photo: nothing, an https link, or a finished profile photo as a data URL. */
function normalizePhotoUrl(raw) {
  const text = cleanText(raw);
  if (!text) return { value: '', error: null };
  if (isPhotoData(text)) return normalizePhotoDataUrl(text);
  if (text.length > CARD_LIMITS.photoUrl) return { value: '', error: tooLong('photoUrl') };
  const url = parseWebUrl(text);
  if (!url || url.protocol !== 'https:') {
    return { value: '', error: 'Enter a link to an image that starts with https://.' };
  }
  return { value: url.href, error: null };
}

/** A LinkedIn profile link, stored as https://www.linkedin.com/in/<name>. */
function normalizeLinkedIn(raw) {
  const text = cleanText(raw);
  if (!text) return { value: '', error: null };
  if (text.length > CARD_LIMITS.linkedinUrl) return { value: '', error: tooLong('linkedinUrl') };
  const invalid = { value: '', error: 'Enter your LinkedIn profile link, like linkedin.com/in/your-name.' };
  const url = parseWebUrl(text);
  if (!url) return invalid;
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return invalid;
  const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
  if (!match) return invalid;
  return { value: `https://www.linkedin.com/in/${match[1]}`, error: null };
}

/** An Instagram name, stored without the @. Accepts "@name", "name" or a profile link. */
function normalizeInstagram(raw) {
  const text = cleanText(raw);
  if (!text) return { value: '', error: null };
  const invalid = { value: '', error: 'Enter your Instagram name, like @yourname.' };
  let handle = text.replace(/^@/, '');
  if (/[/:]/.test(text)) {
    const url = parseWebUrl(text);
    if (!url || !INSTAGRAM_HOSTS.includes(url.hostname.toLowerCase())) return invalid;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return invalid;
    handle = parts[0];
  }
  if (!INSTAGRAM_HANDLE.test(handle) || INSTAGRAM_RESERVED.includes(handle.toLowerCase())) return invalid;
  return { value: handle, error: null };
}

const LINK_NAME_ERROR = 'Add a name for this link, like "Book a meeting".';
const LINK_ADDRESS_ERROR = 'Links must start with https://';

/**
 * An additional link: { label, url }, or none. A link needs both a name and an address, and the address
 * must be an https:// web address with no spaces and no user name or password in it, so what is stored is
 * what the rules accept and what a recipient is shown. Both empty is no link at all, and is not an error.
 * @returns {{ value: { label: string, url: string }|null, error: string|null }}
 */
export function normalizeLink(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const label = cleanText(typeof source.label === 'string' ? source.label : '');
  const text = cleanText(typeof source.url === 'string' ? source.url : '');
  if (!label && !text) return { value: null, error: null };
  if (!label) return { value: null, error: LINK_NAME_ERROR };
  if (label.length > LINK_LIMITS.label) return { value: null, error: `Keep the name to ${LINK_LIMITS.label} characters or fewer.` };
  if (!text) return { value: null, error: LINK_ADDRESS_ERROR };
  if (!/^https:\/\//i.test(text)) return { value: null, error: LINK_ADDRESS_ERROR };
  if (text.length > LINK_LIMITS.url) return { value: null, error: `Keep the address to ${LINK_LIMITS.url} characters or fewer.` };
  const url = parseWebUrl(text);
  if (!url || url.protocol !== 'https:') return { value: null, error: 'Enter a web address like https://example.com.' };
  if (url.href.length > LINK_LIMITS.url) return { value: null, error: `Keep the address to ${LINK_LIMITS.url} characters or fewer.` };
  return { value: { label, url: url.href }, error: null };
}

/** Whether `url` is an address a link may point to: https, no credentials, no spaces. */
export function isSafeLinkUrl(url) {
  return typeof url === 'string' && normalizeLink({ label: 'x', url }).value !== null;
}

const NORMALIZERS = Object.freeze({
  firstName: (raw) => normalizeLine('firstName', raw),
  lastName: (raw) => normalizeLine('lastName', raw),
  photoUrl: normalizePhotoUrl,
  title: (raw) => normalizeLine('title', raw),
  organization: (raw) => normalizeLine('organization', raw),
  email: normalizeEmail,
  phone: normalizePhone,
  linkedinUrl: normalizeLinkedIn,
  instagram: normalizeInstagram,
  website: normalizeWebsite,
});

/**
 * One field's value as it would be stored, and what is wrong with it if
 * anything. An invalid value is stored as empty: it can never be shown.
 * @returns {{ value: string, error: string|null }}
 */
export function normalizeCardField(field, raw) {
  const normalize = own(NORMALIZERS, field) ? NORMALIZERS[field] : null;
  if (!normalize) return { value: '', error: null };
  return normalize(raw);
}

/**
 * The owner's switches, as stored. Only the known fields, and only an exact
 * `true` counts as on: "true", 1, "yes" and a missing entry are all off.
 */
export function normalizeShare(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const share = {};
  for (const field of ALL_SHARE_KEYS) share[field] = own(source, field) && source[field] === true;
  return share;
}

/**
 * A card as it would be stored, from anything: what the editor holds, a stored
 * record, or nothing at all. Only the known fields survive; everything else
 * in the input is dropped.
 *
 * @returns {{ card: object, errors: Record<string, string>, valid: boolean }}
 *   `errors` has an entry for each field whose value was refused. A card with
 *   no name is not valid: `errors.name` says so.
 */
export function normalizeCard(input) {
  const source = isPlainObject(input) ? input : {};
  const card = {};
  const errors = {};
  for (const field of CARD_FIELDS) {
    const { value, error } = normalizeCardField(field, own(source, field) ? source[field] : '');
    card[field] = value;
    if (error) errors[field] = error;
  }
  const share = normalizeShare(own(source, 'share') ? source.share : null);
  // The additional links. A link keeps its own switch wherever it lands, so the slots are closed up
  // in order (a gap is filled by the next link, taking its switch with it): the editor and the
  // stored card never hold a link in one slot and its switch in another. An error is reported
  // against the slot the person typed it in.
  const links = [];
  for (const slot of LINK_SLOTS) {
    const { value, error } = normalizeLink(own(source, slot) ? source[slot] : null);
    if (error) errors[slot] = error;
    if (value) links.push({ value, shared: share[slot] === true });
  }
  LINK_SLOTS.forEach((slot, index) => {
    const link = links[index];
    if (link) card[slot] = link.value;
    share[slot] = Boolean(link && link.shared);
  });
  card.share = share;
  // Sharing the card at all. Off unless it is exactly `true`.
  card.sharingEnabled = own(source, 'sharingEnabled') && source.sharingEnabled === true;
  card.schemaVersion = CARD_SCHEMA_VERSION;
  if (!card.firstName && !card.lastName && !errors.firstName && !errors.lastName) {
    errors.name = 'Add your name: it is what your card is.';
  }
  return { card, errors, valid: Object.keys(errors).length === 0 };
}

/**
 * A new card: nothing filled in but what was suggested (the account's name
 * and email, a connected LinkedIn's name and photo), the default switches,
 * and sharing off. Suggestions are validated like anything typed.
 */
export function newCard(suggestions = null) {
  const { card } = normalizeCard({ ...(isPlainObject(suggestions) ? pickCardFields(suggestions) : {}) });
  return { ...card, share: { ...DEFAULT_SHARE, ...DEFAULT_LINK_SHARE }, sharingEnabled: false };
}

function pickCardFields(source) {
  const picked = {};
  for (const field of CARD_FIELDS) if (own(source, field)) picked[field] = source[field];
  return picked;
}

/** The name as one line: "First Last", or whichever part there is. */
export function cardDisplayName(card) {
  const source = isPlainObject(card) ? card : {};
  const first = normalizeLine('firstName', own(source, 'firstName') ? source.firstName : '').value;
  const last = normalizeLine('lastName', own(source, 'lastName') ? source.lastName : '').value;
  return [first, last].filter(Boolean).join(' ');
}

/** Up to two initials, for the avatar when there is no photo. */
export function cardInitials(card) {
  const source = isPlainObject(card) ? card : {};
  const first = normalizeLine('firstName', own(source, 'firstName') ? source.firstName : '').value;
  const last = normalizeLine('lastName', own(source, 'lastName') ? source.lastName : '').value;
  const letters = [first, last].filter(Boolean).map((part) => Array.from(part)[0]);
  if (letters.length === 1 && Array.from(first || last).length > 1) return Array.from(first || last).slice(0, 2).join('').toUpperCase();
  return letters.join('').toUpperCase();
}

/**
 * What somebody else may see of this card. See THE PRIVACY RULE at the top.
 *
 * Takes anything (a stored record, the editor's state, a damaged record) and
 * returns a new, frozen object holding the name and each field that is
 * switched on, filled in and valid. Returns null when the card has no name.
 *
 * It does NOT look at `sharingEnabled`: this is also what the owner's own
 * preview shows before the card has ever been shared. Whether a card is
 * shared at all is publishedCardView's question.
 *
 * @returns {null | Readonly<{
 *   name: string, firstName: string, lastName: string, initials: string,
 *   photoUrl?: string, title?: string, organization?: string, email?: string,
 *   phone?: string, linkedinUrl?: string, instagram?: string, website?: string,
 * }>}
 */
export function publicCardView(card) {
  const { card: clean } = normalizeCard(card);
  const name = cardDisplayName(clean);
  if (!name) return null;

  // Built from literals, one field at a time. Never a copy of the card.
  const view = {
    name,
    firstName: clean.firstName,
    lastName: clean.lastName,
    initials: cardInitials(clean),
  };
  for (const field of SHAREABLE_FIELDS) {
    if (clean.share[field] === true && clean[field]) view[field] = clean[field];
  }
  for (const slot of LINK_SLOTS) {
    if (clean.share[slot] === true && clean[slot]) view[slot] = Object.freeze({ label: clean[slot].label, url: clean[slot].url });
  }
  return Object.freeze(view);
}

/**
 * What a public page may show: the same view, and only when the owner has
 * turned sharing on (exactly `true`). Otherwise null, whatever the switches
 * say. Sharing cannot be turned on yet; this is here so that when it can,
 * the page has one function to call and no rule of its own.
 */
export function publishedCardView(card) {
  const source = isPlainObject(card) ? card : {};
  if (!(own(source, 'sharingEnabled') && source.sharingEnabled === true)) return null;
  return publicCardView(source);
}

/** The fields a view can hold, for anything that needs to check it took no others. */
export const PUBLIC_VIEW_KEYS = Object.freeze(['name', 'firstName', 'lastName', 'initials', ...SHAREABLE_FIELDS, ...LINK_SLOTS]);

// ── Publishing (MY-CARD-SHARE-001) ──────────────────────────────────────────

/** The public ID of a card: 22 characters of base64url (128 random bits). */
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const isValidPublicId = (value) => typeof value === 'string' && PUBLIC_ID_PATTERN.test(value);

/**
 * A new public ID: 128 random bits from the browser's (or Node's) secure random source, as 22 characters
 * of base64url. It is never derived from anything about the person. `random` is for tests.
 */
export function newPublicId(random = globalThis.crypto) {
  if (!random || typeof random.getRandomValues !== 'function') throw new Error('No secure random source is available.');
  const bytes = random.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Whether a card may be live, and if not what would fix it with one tap: a name and at least one Shared
 * contact method (email, phone, LinkedIn, Instagram or website). Additional links do not count. The gate
 * applies only while the card is live; information never has to stay public.
 * @returns {{ ok: boolean, fixes: Array<{ action: 'share'|'add', field: string }> }}
 */
export function publishGate(card) {
  const { card: clean } = normalizeCard(card);
  const fixes = [];
  const named = Boolean(cardDisplayName(clean));
  if (!named) fixes.push({ action: 'add', field: 'firstName' });
  const hasContact = CONTACT_METHOD_FIELDS.some((field) => clean.share[field] === true && clean[field]);
  if (!hasContact) {
    const held = CONTACT_METHOD_FIELDS.filter((field) => clean[field]);
    if (held.length) for (const field of held) fixes.push({ action: 'share', field });
    else fixes.push({ action: 'add', field: 'email' }, { action: 'add', field: 'phone' });
  }
  return { ok: named && hasContact, fixes };
}

/**
 * The public copy of a card, as publicCards/{publicId} stores it: the name, the revision it belongs to,
 * and exactly the fields publicCardView allows. Firestore's rules compare it with the private card field
 * by field, so it is built from the same view and from nothing else. Null when the card has no name.
 */
export function publicCardDoc(card, { revision, updatedAt }) {
  const view = publicCardView(card);
  if (!view) return null;
  const copy = {
    firstName: view.firstName, lastName: view.lastName, revision, schemaVersion: CARD_SCHEMA_VERSION, updatedAt,
  };
  for (const field of SHAREABLE_FIELDS) if (view[field]) copy[field] = view[field];
  for (const slot of LINK_SLOTS) if (view[slot]) copy[slot] = { label: view[slot].label, url: view[slot].url };
  return copy;
}
