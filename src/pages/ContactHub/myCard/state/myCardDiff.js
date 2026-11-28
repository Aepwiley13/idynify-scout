/**
 * My Card — what differs between two cards, by name.
 *
 * Used when a save finds a newer saved card (or a recovered draft started from
 * an older one): the person is told WHICH fields differ, so choosing between
 * "Load latest saved version" and "Save my version over it" is an informed
 * choice. Only the names of fields come out, never their values.
 *
 * Fields are compared the way the card keeps them: an email typed in capitals
 * and the same email saved in lower case are not a difference, nor are spaces
 * the card would not keep. Text the rules refuse is compared as typed.
 */
import { CARD_FIELDS, LINK_SLOTS, SHAREABLE_FIELDS, normalizeCardField, normalizeLink } from '../../../../utils/myCardRules';
import { FIELD_META } from '../cardDraft';

const own = (object, key) => object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
const tidy = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** A field's value as the card would keep it; as typed (tidied) when the card's rules refuse it. */
function comparable(field, raw) {
  const { value, error } = normalizeCardField(field, raw);
  return error ? tidy(raw) : value;
}

const valueOf = (card, field) => comparable(field, own(card, field) ? card[field] : '');
const switchOf = (card, field) => own(card, 'share') && own(card.share, field) && card.share[field] === true;

/** A link as the card would keep it ('' for none); as typed (tidied) when the card's rules refuse it. */
function linkOf(card, slot) {
  const raw = own(card, slot) ? card[slot] : null;
  if (!raw || typeof raw !== 'object') return '';
  const { value, error } = normalizeLink(raw);
  return JSON.stringify(error || !value ? [tidy(raw.label), tidy(raw.url)] : [value.label, value.url]);
}
const linkName = (mine, theirs, slot) => (own(mine, slot) && mine[slot]?.label) || (own(theirs, slot) && theirs[slot]?.label) || 'Additional link';

/**
 * @param {object} mine    a card (the draft)
 * @param {object} theirs  a card (the saved one)
 * @returns {{ changes: Array<{ kind: 'value'|'switch', field: string, label: string }> }}
 *   In the form's order: the values, then the switches. A field whose value and
 *   switch both differ is listed twice, once for each.
 */
export function diffCards(mine, theirs) {
  const changes = [];
  for (const field of CARD_FIELDS) {
    if (valueOf(mine, field) !== valueOf(theirs, field)) {
      changes.push({ kind: 'value', field, label: FIELD_META[field].label });
    }
  }
  for (const slot of LINK_SLOTS) {
    if (linkOf(mine, slot) !== linkOf(theirs, slot)) changes.push({ kind: 'value', field: slot, label: linkName(mine, theirs, slot) });
  }
  for (const field of SHAREABLE_FIELDS) {
    if (switchOf(mine, field) !== switchOf(theirs, field)) {
      changes.push({ kind: 'switch', field, label: FIELD_META[field].shareLabel ?? FIELD_META[field].label });
    }
  }
  for (const slot of LINK_SLOTS) {
    if (switchOf(mine, slot) !== switchOf(theirs, slot) && (own(mine, slot) || own(theirs, slot))) {
      changes.push({ kind: 'switch', field: slot, label: linkName(mine, theirs, slot) });
    }
  }
  return { changes };
}

/** Whether two cards differ at all. */
export const cardsDiffer = (mine, theirs) => diffCards(mine, theirs).changes.length > 0;

/** The differences as words for a person: ["Title", "Email switch"]. */
export function describeChanges(changes) {
  return changes.map((change) => (change.kind === 'switch' ? `${change.label} switch` : change.label));
}
