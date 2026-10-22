/**
 * Contact photo helpers — the one place that decides whether a contact has a
 * genuine profile photo, and which URL to use at which size.
 *
 * Today a contact stores a single `photo_url` (Apollo, LinkedIn og:image,
 * Google CSE, or a manually pasted URL). There is no separate original /
 * thumbnail pair, so both sizes resolve to the same URL. LinkedIn CDN URLs are
 * signed, so the size segment in their path (e.g. `shrink_200_200`) cannot be
 * rewritten to ask for a bigger image. If a higher-resolution field is ever
 * stored, add it to `resolveContactPhotoSources` and every caller picks it up.
 */

// Keep in step with PLACEHOLDER_PATTERNS in netlify/functions/retryLinkedInPhoto.js,
// plus LinkedIn asset kinds that are real images but not a person's face.
const NOT_A_FACE_PATTERNS = [
  'ghost-person', 'ghost_person', 'default-avatar', 'no-photo',
  'placeholder', '/static.licdn.com/sc/h/', 'data:image',
  'company-logo', 'displaybackgroundimage',
];

/** True when `url` is missing, not http(s), or a known placeholder / non-face image. */
export function isPlaceholderPhoto(url) {
  if (!url || typeof url !== 'string') return true;
  const lower = url.trim().toLowerCase();
  if (!/^https?:\/\//.test(lower)) return true;
  return NOT_A_FACE_PATTERNS.some(p => lower.includes(p));
}

/** True when the contact has a photo worth showing as their face. */
export function hasRealContactPhoto(contact) {
  return !isPlaceholderPhoto(contact?.photo_url);
}

/**
 * The URLs to use for a contact's photo: `thumbnail` for small avatars,
 * `full` for enlarged views. Both null when there is no real photo.
 */
export function resolveContactPhotoSources(contact) {
  if (!hasRealContactPhoto(contact)) return { thumbnail: null, full: null };
  const url = contact.photo_url.trim();
  return { thumbnail: url, full: url };
}

/** "Jimmy Choi" from `name`, else from first/last name; '' when neither is set. */
export function contactDisplayName(contact) {
  if (contact?.name?.trim()) return contact.name.trim();
  return [contact?.first_name, contact?.last_name].filter(Boolean).join(' ').trim();
}

export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
