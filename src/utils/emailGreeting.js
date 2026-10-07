/**
 * emailGreeting — the ONE greeting layer of a cadence email.
 *
 * A cadence email is:  "Hi {first},"  +  Barry's one-line opening  +  shared body.
 * The system owns the greeting. Two other layers used to add their own:
 *
 *   - Barry's opening line, which often began "Michael, …" or "Hey Michael, …"
 *   - the shared body, when the user typed "Hey {{first_name}}, …" themselves
 *
 * and the recipient got "Hi Michael, / Michael, I'm reaching out… / Hey Michael,
 * I'm hoping…". These helpers strip a leading greeting or name from those two
 * layers so only the system's greeting remains.
 *
 * Pure — no Firebase, no DOM. Imported by the browser renderer
 * (src/utils/cadenceSend.js) and by the Barry function
 * (netlify/functions/barryBulkPersonalize.js) so both apply the same rule.
 */

const GREETING_WORDS = '(?:hi|hey|hello|hiya|howdy|dear|greetings|good\\s+(?:morning|afternoon|evening))';

// What may follow the greeting word: a name, a {{first_name}} tag, or a
// generic addressee ("there", "all", "everyone", "team", "friends").
const ADDRESSEE = '(?:\\{\\{\\s*first_name\\s*\\}\\}|there|all|everyone|team|friends?|folks|[A-Z\\u00C0-\\u024F][\\w\\u00C0-\\u024F\'’.-]*)';

// "Hi Michael," / "Hey {{first_name}} —" / "Hello!" / "Dear Michael:" at the very start.
const LEADING_GREETING = new RegExp(
  `^\\s*${GREETING_WORDS}(?:\\s+${ADDRESSEE})?\\s*(?:[,!:;]|\\s[—–-])\\s*`,
  'i',
);

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function capitalizeFirst(text) {
  return text.replace(/^(\s*)(\p{Ll})/u, (_, ws, ch) => ws + ch.toUpperCase());
}

/**
 * Remove a greeting at the start of the shared body ("Hey {{first_name}}, I'm
 * hoping…" → "I'm hoping…"). The system adds "Hi {first}," itself.
 * Only the leading greeting is touched; the rest of the body is unchanged.
 */
export function stripLeadingGreeting(body, firstName = '') {
  const text = String(body ?? '');
  // A bare leading name — "{{first_name}}, I'm hoping…" or "Michael, I'm
  // hoping…" — is a second greeting too. Repeated, so "Hi Michael,\n\nHey
  // Michael, …" loses both.
  const first = String(firstName ?? '').trim();
  const names = ['\\{\\{\\s*first_name\\s*\\}\\}', first ? escapeRegExp(first) : null].filter(Boolean).join('|');
  const leadingName = new RegExp(`^\\s*(?:${names})\\s*(?:[,!:;]|\\s[—–-])\\s*`, 'i');
  let stripped = text;
  for (let i = 0; i < 4; i += 1) {
    const next = stripped.replace(LEADING_GREETING, '').replace(leadingName, '');
    if (next === stripped) break;
    stripped = next;
  }
  if (stripped === text) return text;
  return capitalizeFirst(stripped);
}

/**
 * Clean Barry's opening line so it never repeats the greeting or the name:
 *   "Hey Michael, I thought…"  → "I thought…"
 *   "Michael, I wanted…"       → "I wanted…"
 *   "Michael — I wanted…"      → "I wanted…"
 * A name used later in the sentence is left alone — only a leading address
 * duplicates "Hi Michael,".
 */
export function cleanBarryOpening(line, firstName = '') {
  let text = String(line ?? '').trim();
  if (!text) return '';
  text = text.replace(LEADING_GREETING, '');
  const first = String(firstName ?? '').trim();
  if (first) {
    const leadingName = new RegExp(`^\\s*${escapeRegExp(first)}\\s*(?:[,!:;]|\\s[—–-])\\s*`, 'i');
    text = text.replace(leadingName, '');
  }
  return capitalizeFirst(text.trim());
}

/**
 * Display casing for a recipient's name — presentation only, never written back.
 *
 * Imported lists are full of "chelsie hightower" and "MICHAEL", which made
 * greetings read "Hi chelsie,". A name part that is ENTIRELY lowercase or
 * ENTIRELY uppercase is title-cased (each word, and after a hyphen or
 * apostrophe: "o'neill" → "O'Neill", "MARY-JANE" → "Mary-Jane"). Anything with
 * mixed capitalization was capitalized on purpose — McDonald, LaToya, DeLaCruz,
 * "van Buren", "de la Cruz" — and is returned exactly as given.
 */
export function displayNameCase(value) {
  const text = String(value ?? '').trim();
  if (!text || text.includes('@')) return text;
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return text;
  const allLower = letters === letters.toLowerCase() && letters !== letters.toUpperCase();
  const allUpper = letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  if (!allLower && !allUpper) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * Version of the rendering rules in this file. Shown with a Send Test result
 * next to the server's own version, so a tester can see which code built and
 * sent the email.
 */
export const EMAIL_RENDER_VERSION = 'render-3';

/** Used when Barry's line is unusable (empty, all greeting, names the recipient, or restates the body). */
export const BARRY_FALLBACK_OPENING = 'I wanted to make sure this was on your radar.';

const STOP_WORDS = new Set((
  'the and for you your you\'re you\'ll can are was were with this that from have has had our its it\'s ' +
  'i\'m i\'d i\'ve i\'ll but not all any they them their there here will would could about into just ' +
  'also what when which who some more very really been being than then too out get got let'
).split(' '));

function contentWords(text) {
  return (String(text ?? '').toLowerCase().replace(/’/g, "'").match(/[\p{L}\p{N}']+/gu) || [])
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Does this line mostly repeat one of the body's opening sentences? */
function restatesBody(line, body) {
  const words = contentWords(line);
  if (words.length === 0) return false;
  const sentences = String(body ?? '').split(/(?<=[.!?])\s+|\n+/).slice(0, 8);
  return sentences.some((sentence) => {
    const own = new Set(contentWords(sentence));
    if (own.size === 0) return false;
    const shared = words.filter((w) => own.has(w)).length;
    return shared >= 3 && shared / words.length >= 0.6;
  });
}

/**
 * Barry's line as it will be sent: one context sentence, no greeting, no
 * recipient name, not a restatement of the shared body. Enforced here, in the
 * renderer — not left to the prompt.
 *
 *   "Michael, I thought…" / "Hey Michael, I thought…"  → "I thought…"
 *   "…given your work, Michael."                        → "…given your work."
 *   "I'm hoping you can make it tomorrow…" (= the body)  → fallback sentence
 *   a line that still names the recipient                → fallback sentence
 */
export function finalizeBarryOpening(line, { firstName = '', body = '' } = {}) {
  const raw = String(line ?? '').trim();
  if (!raw) return '';
  let text = cleanBarryOpening(raw, firstName);
  const first = String(firstName ?? '').trim();
  if (text && first) {
    const name = escapeRegExp(first);
    text = text
      .replace(new RegExp(`\\s*,\\s*${name}\\s*(?=[.!?]?$)`, 'i'), '')
      .replace(new RegExp(`,\\s*${name}\\s*,`, 'gi'), ',')
      .trim();
    if (new RegExp(`(^|[^\\p{L}])${name}([^\\p{L}]|$)`, 'iu').test(text)) return BARRY_FALLBACK_OPENING;
  }
  if (!text) return BARRY_FALLBACK_OPENING;
  if (body && restatesBody(text, body)) return BARRY_FALLBACK_OPENING;
  return text;
}

export default {
  stripLeadingGreeting, cleanBarryOpening, displayNameCase, finalizeBarryOpening,
  EMAIL_RENDER_VERSION, BARRY_FALLBACK_OPENING,
};
