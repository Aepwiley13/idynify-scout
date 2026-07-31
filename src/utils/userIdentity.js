/**
 * Who the signed-in user is, for display.
 *
 * The top bar and the mobile drawer both need a display name and an initials
 * avatar, and the product has never stored a first/last name for the account
 * holder — `users/{uid}` carries `firstName` only when onboarding happened to
 * fill it, and Firebase Auth's `displayName` is unset for email/password
 * signups, which is how everyone here signs up. Every surface that wanted a
 * name has so far printed the raw email instead.
 *
 * So this resolves through what actually exists, in order, and derives a name
 * from the email as a last resort rather than falling back to showing the
 * address. `aaron@idynify.com` → "Aaron"; `aaron.wiley@…` → "Aaron Wiley".
 *
 * The derived name is a display convenience, not a claim about identity: if a
 * real name field lands later it wins automatically, because it is checked
 * first.
 */

/** Capitalise a lowercase email fragment: "wiley" → "Wiley". */
function titleCase(word) {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Name derived from the email local part. Splits on the separators people
 * actually use in work addresses and drops any trailing digits
 * ("aaron.wiley2" → "Aaron Wiley").
 */
function nameFromEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const local = email.split('@')[0];
  if (!local) return '';

  return local
    .split(/[._\-+]+/)
    .map(part => part.replace(/\d+$/, ''))
    .filter(Boolean)
    .map(titleCase)
    .join(' ');
}

/**
 * The name to show. Never an email address.
 *
 * Returns '' only when there is nothing at all to work from, so callers can
 * decide what an anonymous state looks like rather than being handed a
 * placeholder they did not ask for.
 */
export function displayNameFor(user) {
  if (!user) return '';

  const first = (user.firstName || '').trim();
  const last = (user.lastName || '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');

  const single = (user.name || user.displayName || '').trim();
  if (single) return single;

  return nameFromEmail(user.email);
}

/**
 * Up to two initials for the avatar circle.
 *
 * Falls back to the first letter of the email rather than rendering an empty
 * circle, and to '?' rather than nothing at all — an avatar with no glyph
 * reads as a broken image, which is the specific failure the logo assets
 * already produce elsewhere in this shell.
 */
export function initialsFor(user) {
  const name = displayNameFor(user);

  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }

  const email = user?.email;
  if (email) return email.charAt(0).toUpperCase();
  return '?';
}
