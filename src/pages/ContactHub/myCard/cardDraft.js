/**
 * My Card — the editor's draft: what is in the form right now, which fields
 * the person has touched, and everything the editor and the preview need to
 * know about it.
 *
 * Pure functions and a reducer. No React, no Firebase, no routing: a page
 * holds the draft (useCardDraft) and decides what to do with it.
 *
 * THE DRAFT IS IN MEMORY. Nothing here saves anything; a page saves the draft
 * with the storage service, on the person's explicit action.
 *
 * WHAT THE PREVIEW SHOWS
 *   previewOf(draft) is publicCardView(draft): the card's own privacy rule,
 *   applied to the draft as it stands, unsaved changes included. A field with
 *   its switch off, a field left empty and a value the rules refuse are all
 *   left out, so the preview can never show more than a shared card would.
 */
import {
  CARD_FIELDS, SHAREABLE_FIELDS, DEFAULT_SHARE, normalizeCard, normalizeCardField, normalizeShare,
  publicCardView,
} from '../../../utils/myCardRules';
import { acceptSuggestion } from '../../../utils/myCardSuggestions';

const own = (object, key) => object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);

/**
 * What the form shows for each field, in the order it shows them, in groups.
 * `share: false` is the name, which is always on the card and has no switch.
 */
export const EDITOR_SECTIONS = Object.freeze([
  { id: 'you', title: 'You', fields: ['photoUrl', 'firstName', 'lastName', 'title', 'organization'] },
  { id: 'reach', title: 'How to reach you', fields: ['email', 'phone'] },
  { id: 'online', title: 'Elsewhere online', fields: ['linkedinUrl', 'instagram', 'website'] },
]);

export const FIELD_META = Object.freeze({
  photoUrl: {
    label: 'Photo link', shareLabel: 'Photo', type: 'text', inputMode: 'url', autoComplete: 'off', placeholder: 'https://…',
    hint: 'A link to a picture, starting with https://. Your initials are used without one.',
  },
  firstName: { label: 'First name', type: 'text', inputMode: 'text', autoComplete: 'given-name', placeholder: 'Ada', hint: null },
  lastName: { label: 'Last name', type: 'text', inputMode: 'text', autoComplete: 'family-name', placeholder: 'Lovelace', hint: null },
  title: { label: 'Title', type: 'text', inputMode: 'text', autoComplete: 'organization-title', placeholder: 'Founder', hint: null },
  organization: { label: 'Organization', type: 'text', inputMode: 'text', autoComplete: 'organization', placeholder: 'Analytical Engines', hint: null },
  email: { label: 'Email', type: 'text', inputMode: 'email', autoComplete: 'email', placeholder: 'you@example.com', hint: null },
  phone: { label: 'Phone', type: 'text', inputMode: 'tel', autoComplete: 'tel', placeholder: '+1 555 010 2000', hint: null },
  linkedinUrl: {
    label: 'LinkedIn', type: 'text', inputMode: 'url', autoComplete: 'off', placeholder: 'linkedin.com/in/your-name',
    hint: 'Your profile link.',
  },
  instagram: { label: 'Instagram', type: 'text', inputMode: 'text', autoComplete: 'off', placeholder: '@yourname', hint: 'Your name or profile link.' },
  website: { label: 'Website', type: 'text', inputMode: 'url', autoComplete: 'url', placeholder: 'example.com', hint: null },
});

/** The text of a field as a person would see it typed: trimmed, runs of space made one. */
const tidy = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** A draft's card from anything: every field a string, the switches complete, sharing off. */
function draftCard(card) {
  const source = card !== null && typeof card === 'object' && !Array.isArray(card) ? card : {};
  const out = {};
  for (const field of CARD_FIELDS) out[field] = own(source, field) && typeof source[field] === 'string' ? source[field] : '';
  out.share = own(source, 'share') ? normalizeShare(source.share) : { ...DEFAULT_SHARE };
  out.sharingEnabled = false;
  return out;
}

/** The comparable form of a draft: tidy text and the switches. */
const comparable = (card) => JSON.stringify([CARD_FIELDS.map((field) => tidy(card[field])), SHAREABLE_FIELDS.map((field) => card.share[field] === true)]);

/** A draft that starts from `card`. Nothing is touched, and nothing differs from it. */
export function createDraft(card) {
  const start = draftCard(card);
  return { card: start, start, touched: {}, showAll: false };
}

/**
 * @param {ReturnType<typeof createDraft>} state
 * @param {{ type: string }} action
 *   edit        { field, value }        the person typed
 *   blur        { field }               the person left the field: its message may show, and a valid value is tidied
 *   share       { field, value }        a Shared / Private switch
 *   useSuggestion { field, suggestion } the person chose "use this" for an empty field
 *   showAllErrors                       the person tried to save: every message may show
 *   reset       { card, current? }      start over from this card (after a load or a save); with `current`, the
 *                                       text is that, and the draft is measured from `card` (a recovered draft)
 *   discardChanges                      back to where the draft started
 */
export function cardDraftReducer(state, action) {
  switch (action?.type) {
    case 'edit': {
      if (!CARD_FIELDS.includes(action.field)) return state;
      const value = typeof action.value === 'string' ? action.value : '';
      if (state.card[action.field] === value) return state;
      return { ...state, card: { ...state.card, [action.field]: value } };
    }
    case 'blur': {
      if (!CARD_FIELDS.includes(action.field)) return state;
      const touched = { ...state.touched, [action.field]: true };
      // A value that is valid is shown as it will be kept (an email in lower case, a link with https://).
      const { value, error } = normalizeCardField(action.field, state.card[action.field]);
      const card = !error && value && value !== state.card[action.field]
        ? { ...state.card, [action.field]: value }
        : state.card;
      return { ...state, card, touched };
    }
    case 'share': {
      if (!SHAREABLE_FIELDS.includes(action.field) || typeof action.value !== 'boolean') return state;
      if (state.card.share[action.field] === action.value) return state;
      return { ...state, card: { ...state.card, share: { ...state.card.share, [action.field]: action.value } } };
    }
    case 'useSuggestion': {
      // The suggestion rules decide: only an empty field, only a valid value, nothing else changes.
      const card = acceptSuggestion(state.card, action.field, action.suggestion);
      if (card === state.card) return state;
      return { ...state, card: { ...state.card, [action.field]: card[action.field] }, touched: { ...state.touched, [action.field]: true } };
    }
    case 'showAllErrors':
      return state.showAll ? state : { ...state, showAll: true };
    case 'reset': {
      // From `card`, which is where the draft is measured from (what is saved). With `current`, the
      // text starts as that instead: a recovered draft is unsaved changes ON TOP of the saved card.
      const next = createDraft(action.card);
      return action.current === undefined ? next : { ...next, card: draftCard(action.current) };
    }
    case 'discardChanges':
      // Back to where the draft started, as if nothing had been typed.
      return { ...state, card: draftCard(state.start), touched: {}, showAll: false };
    default:
      return state;
  }
}

/** Whether the draft differs from where it started. */
export const isDirty = (state) => comparable(state.card) !== comparable(state.start);

/** Whether the draft, as it stands, is a card the rules accept. */
export const isValid = (state) => normalizeCard(state.card).valid;

/**
 * The messages to show now: a field's own message once it has been left (or
 * after a save was tried), and `name` once either name field has been left.
 * @returns {Record<string, string>}
 */
export function visibleErrors(state) {
  const { errors } = normalizeCard(state.card);
  const visible = {};
  for (const [field, message] of Object.entries(errors)) {
    if (field === 'name') {
      if (state.showAll || state.touched.firstName || state.touched.lastName) visible.name = message;
    } else if (state.showAll || state.touched[field]) {
      visible[field] = message;
    }
  }
  return visible;
}

/** What somebody else would see of this draft: the card's privacy rule, applied to what is typed now. */
export const previewOf = (card) => publicCardView(card);

/**
 * The fields that have a value but are not shared, in the form's order, as
 * { field, label } for the preview's "not on your card" line.
 */
export function unsharedFields(card) {
  const { card: clean } = normalizeCard(card);
  return SHAREABLE_FIELDS
    .filter((field) => clean[field] && clean.share[field] !== true)
    .map((field) => ({ field, label: FIELD_META[field].shareLabel ?? FIELD_META[field].label }));
}

/** A link as a person reads it: no scheme, no www, no trailing slash. */
export const readableLink = (url) => String(url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
