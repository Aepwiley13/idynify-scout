/**
 * Who the signed-in user is, for display.
 *
 * `displayName` on `users/{uid}` is THE CANONICAL FIELD. Settings → Account
 * writes it; everything else here is fallback, in descending order of how much
 * it is really a name the user chose:
 *
 *   1. displayName          — set by the user, in Settings → Account
 *   2. firstName + lastName — sometimes filled by onboarding
 *   3. name                 — legacy, written by older code paths
 *   4. derived from email   — a convenience, not a claim about identity
 *
 * The last resort derives rather than falling back to showing the address:
 * `aaron@idynify.com` → "Aaron", `aaron.wiley@…` → "Aaron Wiley". Before this
 * sprint the whole product printed the raw email, because there was nowhere to
 * set a name; now there is, and the moment a user saves one it wins, because
 * it is checked first.
 *
 * Firebase Auth's own `displayName` is deliberately NOT consulted: it is unset
 * for email/password signups, which is how everyone here signs up, and reading
 * it would put a second writable name in play with no way to reconcile the two.
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

  // Canonical. Whatever the user typed in Settings → Account wins outright.
  const chosen = (user.displayName || '').trim();
  if (chosen) return chosen;

  const first = (user.firstName || '').trim();
  const last = (user.lastName || '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');

  const legacy = (user.name || '').trim();
  if (legacy) return legacy;

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
