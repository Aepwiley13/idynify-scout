/**
 * cadenceSend — shared rules for the bulk cadence send (BulkComposeModal).
 *
 * Kept out of the component file so the modal, the Scout+ import hand-off
 * and the tests all read one definition.
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { stripOpeningGreetings, finalizeBarryOpening, finalizeInlinePersonalization } from './emailGreeting.js';
import { contactFirstName, contactDisplayName } from './contactDisplayName.js';

/**
 * Recipients per send. The send loop is sequential with a 1.5s gap, so 100 is
 * about three minutes in an open tab — the practical ceiling for a browser-run
 * send. Personalization is still requested PERSONALIZE_CHUNK at a time, because
 * barryBulkPersonalize caps each request at 25; the user sees one operation.
 */
export const MAX_BULK_CONTACTS = 100;
export const PERSONALIZE_CHUNK = 25;

/**
 * Every delivery of the cadence named `cadenceName`, per person, across all
 * of its sends.
 *
 * Each send writes its own cadence doc, so "this cadence" is identified by its
 * name — which is what the user picks when they reuse one. Sending it again
 * adds a doc; nothing earlier is overwritten, so a person's history is one
 * entry per send that reached them:
 *
 *   Map { contactId → [{ cadenceId, at }, …] }   oldest first; `at` in ms (0 if unknown)
 *
 * A contact counts as delivered when its row says sent/opened, or when the
 * send loop recorded it in `deliveredContactIds` (which survives a send
 * interrupted before its completion write). One equality query; no composite
 * index needed.
 */
export async function loadDeliveryHistory(userId, cadenceName) {
  const name = (cadenceName || '').trim();
  const history = new Map();
  if (!userId || !name) return history;
  const snap = await getDocs(query(collection(db, 'users', userId, 'cadences'), where('name', '==', name)));
  snap.docs.forEach((d) => {
    const c = d.data();
    const at = millis(c.lastSentAt) || millis(c.completedAt) || millis(c.createdAt);
    const ids = new Set(c.deliveredContactIds || []);
    (c.contacts || []).forEach((ct) => {
      if (ct?.contactId && (ct.status === 'sent' || ct.status === 'opened')) ids.add(ct.contactId);
    });
    ids.forEach((id) => {
      if (!history.has(id)) history.set(id, []);
      history.get(id).push({ cadenceId: d.id, at });
    });
  });
  history.forEach((sends) => sends.sort((a, b) => a.at - b.at));
  return history;
}

/** People who already received the cadence named `cadenceName` (any of its sends). */
export async function loadAlreadyDelivered(userId, cadenceName) {
  return new Set((await loadDeliveryHistory(userId, cadenceName)).keys());
}

/** "Oct 1" — the date shown for one delivery in a person's cadence history. */
export function formatSendDate(ms) {
  if (!ms) return 'earlier';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * The message a cadence was composed from, for reuse with new recipients.
 *
 * Cadences sent from here on store `templateSubject` / `templateBody`. Older
 * cadence docs only carry `subject` / `body` — the FIRST recipient's rendered
 * email, beginning "Hi <name>," (and, when Barry personalized it, that
 * person's opening line). The greeting is stripped so it is not sent to
 * everyone twice; anything else is returned as-is and flagged `legacy` so the
 * UI can ask the user to check it before sending.
 */
export function cadenceTemplate(cadence = {}) {
  if (cadence.templateBody != null || cadence.templateSubject != null) {
    return {
      subject: cadence.templateSubject || '',
      body: cadence.templateBody || '',
      path: cadence.path || 'write_your_own',
      personalize: cadence.personalizedWithBarry !== false,
      cc: cadence.cc || '',
      hasAttachment: Boolean(cadence.hasAttachment),
      legacy: false,
    };
  }
  const body = String(cadence.body || '').replace(/^Hi [^\n]*,\s*\n+/, '');
  return {
    subject: cadence.subject || '',
    body,
    path: cadence.path || 'write_your_own',
    personalize: cadence.personalizedWithBarry !== false,
    cc: cadence.cc || '',
    hasAttachment: false,
    legacy: true,
  };
}

/** A Firestore Timestamp, Date, ISO string or millis → millis (0 when absent). */
function millis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Cadences newest first, by completion time and, for a send that never
 * completed, its start time — so an interrupted send sorts where it began
 * instead of disappearing.
 */
export function sortCadencesByRecency(cadences = []) {
  const at = (c) => millis(c.completedAt) || millis(c.lastSentAt) || millis(c.createdAt);
  return [...cadences].sort((a, b) => at(b) - at(a));
}

/**
 * Existing cadences to offer for reuse, newest first, one per name.
 *
 * Every send writes its own cadence doc, so a cadence sent three times appears
 * three times in the collection. The picker shows each name once, using its
 * most recent send as the template.
 */
export function distinctCadencesForReuse(cadences = []) {
  const byName = new Map();
  for (const c of [...cadences].sort((a, b) => millis(b.createdAt ?? b.completedAt) - millis(a.createdAt ?? a.completedAt))) {
    const name = (c.name || '').trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, c);
  }
  return [...byName.values()];
}

// ─── Message rendering ──────────────────────────────────────────────────────
//
// ONE message model. There used to be two compose modes with separate subject
// and body state — "Write your own" (greeting + Barry opening line + body) and
// "Send with attachment" ({{personalize}} filled inline) — and switching to the
// second to attach a PDF threw away the message the user had just reused. Now
// an attachment is just an addition to the message, and which personalization
// style applies is decided by the body itself:
//
//   body contains {{personalize}}  → Barry fills the tag in place; the body
//                                    controls its own greeting
//   otherwise                      → "Hi {first}," + Barry's opening line (when
//                                    personalizing) + body
//
// The preview, the test send and the real send all render through this, so
// what the user reviews is what is sent.

const PERSONALIZE_TAG = /\{\{personalize\}\}/gi;

export function hasPersonalizeTag(text) {
  return /\{\{personalize\}\}/i.test(text || '');
}

/**
 * A contact's first name for greetings and {{first_name}}. Empty when the only
 * "name" on file is an email address — a CSV row with an email and no name is
 * stored that way, and "Hi sam@acme.com," is worse than "Hi,".
 */
export function firstNameFor(contact = {}) {
  // "chelsie" → "Chelsie"; intentional casing (McDonald, LaToya) is kept.
  // A last-name-only contact has no first name, so it gets "Hi," too.
  return contactFirstName(contact);
}

export function greetingFor(contact = {}) {
  const first = firstNameFor(contact);
  return first ? `Hi ${first},` : 'Hi,';
}

export function replaceContactTags(text, contact = {}) {
  const company = contact.company_name || contact.company || '';
  return String(text || '')
    .replace(/\{\{first_name\}\}/gi, firstNameFor(contact))
    .replace(/\{\{company\}\}/gi, company);
}

/**
 * Render one recipient's email.
 *
 * @param {object} args
 * @param {string} args.subject      the shared subject (may contain tags)
 * @param {string} args.body         the shared body (may contain tags)
 * @param {object} args.contact
 * @param {string} [args.openingLine] Barry's text for this contact
 * @param {boolean} [args.personalize] greeting mode: include the opening line
 * @returns {{ subject: string, body: string, inline: boolean }}
 */
export function renderCadenceEmail({ subject, body, contact, openingLine = '', personalize = true }) {
  const inline = hasPersonalizeTag(body);
  const renderedSubject = replaceContactTags(subject, contact);
  const first = firstNameFor(contact);

  // ONE opening structure, whatever was typed or generated:
  //   "Hi {First}," — the only greeting, always the system's
  //   [Barry's one context sentence]            (opening-line mode, Barry on)
  //   the shared body, its opening paragraphs stripped of any greeting/address
  // A {{personalize}} body follows the same rule; Barry's text goes in the tag.
  const sharedBody = stripOpeningGreetings(body, first);
  const parts = [greetingFor(contact)];

  if (inline) {
    // A failed personalization leaves the tag empty rather than sending the
    // literal "{{personalize}}" to a real person.
    const fill = finalizeInlinePersonalization(openingLine, first);
    const filled = capitalizeLead(sharedBody.replace(PERSONALIZE_TAG, fill).replace(/^[ \t]+/, ''));
    parts.push(replaceContactTags(filled, contact));
    return { subject: renderedSubject, body: parts.join('\n\n'), inline };
  }

  const opening = personalize ? finalizeBarryOpening(openingLine, { firstName: first, body: sharedBody }) : '';
  if (opening) parts.push(opening);
  parts.push(replaceContactTags(sharedBody, contact));
  return { subject: renderedSubject, body: parts.join('\n\n'), inline };
}

function capitalizeLead(text) {
  return text.replace(/^(\s*)(\p{Ll})/u, (_, ws, ch) => ws + ch.toUpperCase());
}

/**
 * A recipient's label: "chelsie hightower" → "Chelsie Hightower"; no name →
 * their email, never a name guessed from it. See utils/contactDisplayName.js.
 */
export function displayContactName(contact = {}) {
  return contactDisplayName(contact);
}

