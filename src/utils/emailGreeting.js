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
export function stripLeadingGreeting(body) {
  const text = String(body ?? '');
  const stripped = text.replace(LEADING_GREETING, '');
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

export default { stripLeadingGreeting, cleanBarryOpening, displayNameCase };
