/**
 * My Card — "Download contact": what to say, whether it can be done, and doing it.
 *
 * It downloads the card as it is NOW, an unsaved draft included, so the file
 * matches the preview: the name, and each field that is switched to Shared and
 * valid. Private fields are never in it. It is a file on the person's own
 * device and nothing else: no database is read or written, no network call is
 * made, the card is not saved, and sharing is not touched. (This module imports
 * nothing that could do any of that, and a test holds it to that.)
 *
 * The page uses DOWNLOAD_CONTACT for its words, contactDownloadState to decide
 * whether the button is on and what to mention, and downloadContact for the click.
 */
import { downloadMyCardVCard } from '../../../utils/vcard';
import { CARD_FIELDS, NAME_FIELDS, normalizeCardField } from '../../../utils/myCardRules';
import { FIELD_META, previewOf } from './cardDraft';

/** The words, in one place so the button, its note and its messages cannot drift. */
export const DOWNLOAD_CONTACT = Object.freeze({
  label: 'Download contact',
  note: 'Downloads the card shown in the preview. This does not save your changes to IDYNIFY.',
  noName: 'Add your name to download your contact.',
  failed: 'Your browser couldn\'t start the download. Try again.',
  omitted: (labels) => `Not included, because ${labels.length === 1 ? 'it isn\'t' : 'they aren\'t'} valid yet: ${labels.join(', ')}.`,
});

const tidy = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * What a download of this draft would be.
 *
 * @returns {{
 *   available: boolean,
 *   reason: null|'no-name',
 *   omitted: string[],   fields the person meant to include (the name, or anything switched to Shared)
 *                        that are not valid, so the file leaves them out
 * }}
 *   `available` is false when there is no usable name: there is nothing to give.
 *   Private fields are never listed, valid or not: they are not in the file either way.
 */
export function contactDownloadState(card) {
  const source = card !== null && typeof card === 'object' ? card : {};
  const share = source.share !== null && typeof source.share === 'object' ? source.share : {};
  const omitted = [];
  for (const field of CARD_FIELDS) {
    const raw = Object.prototype.hasOwnProperty.call(source, field) ? tidy(source[field]) : '';
    if (raw === '') continue;
    const meant = NAME_FIELDS.includes(field) || share[field] === true;
    if (meant && normalizeCardField(field, raw).error) omitted.push(FIELD_META[field].shareLabel ?? FIELD_META[field].label);
  }
  const available = previewOf(card) !== null;
  return { available, reason: available ? null : 'no-name', omitted };
}

/**
 * Downloads the draft as a contact file.
 *
 * @returns {{ status: 'downloaded', fileName: string, omitted: string[], message: string|null }
 *   | { status: 'unavailable', reason: 'no-name', message: string }
 *   | { status: 'failed', fileName: string, message: string }}
 *   `message` is words for the person: what was left out, or what went wrong.
 */
export function downloadContact(card, options) {
  const state = contactDownloadState(card);
  if (!state.available) return { status: 'unavailable', reason: state.reason, message: DOWNLOAD_CONTACT.noName };

  const result = downloadMyCardVCard(card, options);
  if (result.status === 'failed') return { status: 'failed', fileName: result.fileName, message: DOWNLOAD_CONTACT.failed };
  if (result.status !== 'downloaded') return { status: 'unavailable', reason: 'no-name', message: DOWNLOAD_CONTACT.noName };
  return {
    status: 'downloaded',
    fileName: result.fileName,
    omitted: state.omitted,
    message: state.omitted.length > 0 ? DOWNLOAD_CONTACT.omitted(state.omitted) : null,
  };
}
