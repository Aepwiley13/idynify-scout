/**
 * Contact Hub — My People: what is listed, in what order, and what a search
 * matches. Pure functions over contact records, no Firebase and no React, so
 * the rules are testable on their own.
 *
 * The people are the user's existing contacts (users/{uid}/contacts). Nothing
 * here reads or writes a field that People does not already have.
 */
import { hasArchiveSignal, isDeferredRecord } from '../../constants/statusModel';
import { contactDisplayName } from '../../utils/contactDisplayName';
import { readContactPhones, primaryPhone } from '../../utils/contactPhones';
import { hasSticker, matchesStickerName } from '../../components/stickers/peopleStickers';

/**
 * Who belongs in My People.
 *
 * The same exclusions People applies: a "not today" skip is a queue bookmark
 * with no name on it, and an archived person (or one whose company was
 * archived) has been put away on purpose.
 */
export function isListedInMyPeople(contact) {
  if (!contact || !contact.id) return false;
  if (isDeferredRecord(contact)) return false;
  if (hasArchiveSignal(contact)) return false;
  if (contact.company_archived === true) return false;
  return true;
}

export function listMyPeople(contacts) {
  return (contacts ?? []).filter(isListedInMyPeople);
}

/** When this person was added, as an ISO string or '' when the record has none. */
export function addedAtOf(contact) {
  const raw = contact?.saved_at || contact?.addedAt || contact?.created_at || contact?.createdAt || '';
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  // A Firestore Timestamp, live or as plain data.
  if (typeof raw.toDate === 'function') return raw.toDate().toISOString();
  if (typeof raw.seconds === 'number') return new Date(raw.seconds * 1000).toISOString();
  return '';
}

/** Newest first; people with no date keep their order at the end. */
export function sortNewestFirst(contacts) {
  return [...contacts].sort((a, b) => {
    const dA = addedAtOf(a);
    const dB = addedAtOf(b);
    if (dA === dB) return 0;
    if (!dA) return 1;
    if (!dB) return -1;
    return dA < dB ? 1 : -1;
  });
}

/** "Added Nov 12", with the year once it is not this one. '' when unknown. */
export function addedLabel(contact, now = new Date()) {
  const iso = addedAtOf(contact);
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === now.getFullYear();
  const text = date.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
  return `Added ${text}`;
}

export const personName = (contact) => contactDisplayName(contact);

export const companyOf = (contact) => contact?.company_name || contact?.company || '';

/** "Program Director, UAC" — title and company, whichever exist. */
export function personSubtitle(contact) {
  return [contact?.title, companyOf(contact)].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).join(', ');
}

export const emailOf = (contact) => contact?.email || contact?.work_email || '';

/** The number a "call" button should dial, or ''. */
export function phoneOf(contact) {
  const best = primaryPhone(readContactPhones(contact));
  return best?.value || '';
}

/**
 * Does this person match what was typed? Name, title, company, email, and the
 * names of their stickers (when the sticker registry is available).
 */
export function matchesSearch(contact, term, stickersById = null) {
  const lower = (term ?? '').trim().toLowerCase();
  if (!lower) return true;
  const haystack = [personName(contact), contact?.title, companyOf(contact), emailOf(contact)]
    .filter((s) => typeof s === 'string')
    .join('\n')
    .toLowerCase();
  if (haystack.includes(lower)) return true;
  return stickersById ? matchesStickerName(contact, stickersById, lower) : false;
}

/**
 * The list as shown: My People, narrowed by one sticker and by the search,
 * newest first.
 */
export function visiblePeople(contacts, { term = '', stickerId = null, stickersById = null } = {}) {
  let people = listMyPeople(contacts);
  if (stickerId) people = people.filter((c) => hasSticker(c, stickerId));
  people = people.filter((c) => matchesSearch(c, term, stickersById));
  return sortNewestFirst(people);
}

/** Where ContactHubMain's one load of the user's contacts stands. */
export const HUB_STATUS = Object.freeze({ LOADING: 'loading', READY: 'ready', ERROR: 'error' });
