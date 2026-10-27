/**
 * Social profiles on a contact: one list, one platform registry.
 *
 *   social_profiles: [{
 *     platform: 'instagram',                         // a SOCIAL_PLATFORMS id
 *     handle:   'kristinsokol',                      // the matching form: lowercase, no @
 *     url:      'https://www.instagram.com/kristinsokol',
 *     observed: '@KRISTINSOKOL',                     // exactly as printed or typed
 *     source:   'business_card',                     // where it came from (SOCIAL_SOURCES)
 *     status:   'observed',                          // how far it is trusted (SOCIAL_STATUS)
 *     added_at: '2026-10-27T…',
 *   }]
 *
 * TRUST
 * ─────
 *   observed        read from a card and left as read
 *   user_confirmed  the user chose its platform, typed it, or edited it
 *   verified        reserved: nothing sets it yet
 *
 * A handle read from a card is not as good as one the user confirmed, so only
 * a confirmed profile fills the contact's older single field (`facebook_url`).
 *
 * THE OLDER FIELDS STAY
 * ─────────────────────
 * `linkedin_url` (with `linkedin_url_normalized`) is still the one LinkedIn
 * identity: Find LinkedIn, duplicate detection, identity resolution, Barry and
 * enrichment read it, and nothing here writes it. `facebook_url` and
 * `twitter_url` stay as they are. readSocialProfiles shows a contact's
 * LinkedIn and Facebook from those fields too, so no contact needs migrating.
 *
 * NEVER IDENTITY
 * ──────────────
 * Social profiles never match or merge people: two contacts can share a
 * business's Instagram. Nothing in identity resolution reads this list.
 *
 * ADDING A PLATFORM
 * ─────────────────
 * One entry in PLATFORMS (plus an icon where it is shown). The contact's
 * shape does not change. X is left out on purpose for now; its entry would
 * name `twitter_url` as its field.
 *
 * Pure and dependency-free: the capture assembler and contract use it too.
 */

export const SOCIAL_STATUS = Object.freeze({
  OBSERVED: 'observed',
  USER_CONFIRMED: 'user_confirmed',
  VERIFIED: 'verified',
});

/** Statuses trusted enough to fill a contact's older single field. */
const CONFIRMED = new Set([SOCIAL_STATUS.USER_CONFIRMED, SOCIAL_STATUS.VERIFIED]);

export const SOCIAL_SOURCES = Object.freeze({
  BUSINESS_CARD: 'business_card',
  USER: 'user',
});

/**
 * Each platform: its hosts, how a handle looks, the address built from it,
 * and the contact's older single field for it, if any.
 */
const PLATFORMS = Object.freeze({
  linkedin: Object.freeze({
    label: 'LinkedIn',
    hosts: ['linkedin.com'],
    // A person's profile only: /in/<slug>.
    handleFromPath: segments => (segments[0] === 'in' ? segments[1] : null),
    handle: /^[a-z0-9][a-z0-9_%-]{1,99}$/,
    url: handle => `https://www.linkedin.com/in/${handle}`,
    field: 'linkedin_url',
  }),
  instagram: Object.freeze({
    label: 'Instagram',
    hosts: ['instagram.com', 'instagr.am'],
    handleFromPath: segments => segments[0],
    handle: /^[a-z0-9._]{1,30}$/,
    url: handle => `https://www.instagram.com/${handle}`,
    field: null,
  }),
  facebook: Object.freeze({
    label: 'Facebook',
    hosts: ['facebook.com', 'fb.com'],
    handleFromPath: (segments, params) => (segments[0] === 'profile.php' && /^\d+$/.test(params.get('id') ?? '')
      ? `profile.php?id=${params.get('id')}`
      : segments[0]),
    handle: /^(?:[a-z0-9.]{1,50}|profile\.php\?id=\d{1,20})$/,
    url: handle => `https://www.facebook.com/${handle}`,
    field: 'facebook_url',
  }),
});

/** Every platform the registry knows, in display order. */
export const SOCIAL_PLATFORMS = Object.freeze(Object.keys(PLATFORMS));

/**
 * Platforms a social row on the review screen may be. LinkedIn has its own
 * field there, which goes through LinkedIn's own confirm and duplicate checks.
 */
export const REVIEW_SOCIAL_PLATFORMS = Object.freeze(['instagram', 'facebook']);

export const platformLabel = platform => PLATFORMS[platform]?.label ?? null;

/** Path words that are a site's own pages, never someone's handle. */
const RESERVED_PATHS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'pages', 'groups', 'events', 'share', 'sharer', 'watch', 'login', 'home']);

const str = v => (typeof v === 'string' ? v.trim() : '');

/** The platform a hostname belongs to (subdomains included), or null. */
export function platformForHost(hostname) {
  const host = str(hostname).toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  return SOCIAL_PLATFORMS.find(id => PLATFORMS[id].hosts.some(h => host === h || host.endsWith(`.${h}`))) ?? null;
}

/** `https://…`, `www.…` or `instagram.com/…` as a URL, else null. */
function asUrl(text) {
  if (!/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]|$)/i.test(text)) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/**
 * Read one social reference: a profile address, or a handle.
 *
 * An address's site decides the platform, whatever `platform` says. A bare
 * handle (`@KRISTINSOKOL`) has the platform it is given, or none: the network
 * is never guessed. Returns null when the text is neither.
 *
 * @param {string} text
 * @param {{ platform?: string|null }} [options]
 * @returns {{ platform: string|null, handle: string, url: string|null } | null}
 */
export function parseSocialReference(text, { platform = null } = {}) {
  const value = str(text);
  if (!value || /\s/.test(value)) return null;

  // An address when it names its scheme, `www.` or a platform's own site;
  // `kristin.sokol` without those is a handle that has a dot in it.
  const url = asUrl(value);
  const fromHost = url ? platformForHost(url.hostname) : null;
  if (url && (fromHost || /^(?:https?:\/\/|www\.)/i.test(value))) {
    if (!fromHost) return null;
    const rule = PLATFORMS[fromHost];
    let segments;
    try {
      segments = url.pathname.split('/').filter(Boolean).map(s => decodeURIComponent(s).toLowerCase());
    } catch {
      return null;
    }
    const handle = str(rule.handleFromPath(segments, url.searchParams)).toLowerCase();
    if (!handle || RESERVED_PATHS.has(handle) || !rule.handle.test(handle)) return null;
    return { platform: fromHost, handle, url: rule.url(handle) };
  }

  const handle = value.replace(/^@/, '').toLowerCase();
  const rule = PLATFORMS[platform];
  if (rule) {
    if (!rule.handle.test(handle) || RESERVED_PATHS.has(handle)) return null;
    return { platform, handle, url: rule.url(handle) };
  }
  // No platform: a handle-shaped word, kept for the user to place.
  return /^[a-z0-9._-]{1,50}$/.test(handle) ? { platform: null, handle, url: null } : null;
}

/** The key two entries share when they are the same profile. */
export const socialKey = entry => (entry?.platform && entry?.handle ? `${entry.platform}:${String(entry.handle).toLowerCase()}` : null);

/**
 * One stored entry from what was observed or typed, or null when it cannot be
 * read or has no platform.
 */
export function makeSocialProfile({ text, platform = null, observed = null, source, status, addedAt = new Date().toISOString() }) {
  const parsed = parseSocialReference(text, { platform });
  if (!parsed?.platform) return null;
  return {
    platform: parsed.platform,
    handle: parsed.handle,
    url: parsed.url,
    observed: str(observed) || str(text),
    source,
    status,
    added_at: addedAt,
  };
}

/** A stored entry read back, or null when it is not one this registry understands. */
function fromStored(entry) {
  if (!entry || typeof entry !== 'object' || !PLATFORMS[entry.platform]) return null;
  const parsed = parseSocialReference(entry.url || entry.handle, { platform: entry.platform });
  if (!parsed || parsed.platform !== entry.platform) return null;
  return {
    platform: parsed.platform,
    handle: parsed.handle,
    url: parsed.url,
    observed: str(entry.observed) || null,
    source: str(entry.source) || null,
    status: Object.values(SOCIAL_STATUS).includes(entry.status) ? entry.status : null,
    added_at: str(entry.added_at) || null,
  };
}

/**
 * Every social profile the contact has, for display: its list, plus the
 * profile in each older single field that the list does not already hold.
 * Ordered by platform, then as stored.
 */
export function readSocialProfiles(contact) {
  const list = (Array.isArray(contact?.social_profiles) ? contact.social_profiles : []).map(fromStored).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const key = socialKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  for (const platform of SOCIAL_PLATFORMS) {
    const field = PLATFORMS[platform].field;
    const parsed = field ? parseSocialReference(contact?.[field]) : null;
    if (!parsed || parsed.platform !== platform || seen.has(socialKey(parsed))) continue;
    seen.add(socialKey(parsed));
    out.push({ ...parsed, observed: null, source: 'contact_field', status: null, added_at: null });
  }
  const order = p => SOCIAL_PLATFORMS.indexOf(p.platform);
  return out.map((entry, i) => [entry, i]).sort(([a, i], [b, j]) => order(a) - order(b) || i - j).map(([entry]) => entry);
}

/**
 * Add social profiles to a contact without replacing any.
 *
 * Every entry the contact has stays as stored, with its status, including
 * ones this code does not understand. An incoming profile is added only when
 * the contact has no profile with the same platform and handle (compared in
 * their matching form, its older single field included); a different handle
 * on the same platform is added beside the one there. LinkedIn is never added
 * here: `linkedin_url` is its record. A confirmed profile fills its platform's
 * older single field only when that field is empty.
 *
 * @param {object}   contact   the contact as stored ({} for a new one)
 * @param {object[]} incoming  entries from makeSocialProfile
 * @returns {{ patch: object, added: object[] }}  an empty patch when nothing is new
 */
export function mergeSocialProfiles(contact, incoming) {
  const stored = Array.isArray(contact?.social_profiles) ? contact.social_profiles : [];
  const known = new Set(readSocialProfiles(contact).map(socialKey));
  const added = [];
  for (const entry of Array.isArray(incoming) ? incoming : []) {
    const key = socialKey(entry);
    if (!key || entry.platform === 'linkedin' || !PLATFORMS[entry.platform] || known.has(key)) continue;
    known.add(key);
    added.push(entry);
  }
  if (added.length === 0) return { patch: {}, added };

  const patch = { social_profiles: [...stored, ...added] };
  for (const entry of added) {
    const field = PLATFORMS[entry.platform].field;
    if (field && CONFIRMED.has(entry.status) && !str(contact?.[field]) && !(field in patch)) patch[field] = entry.url;
  }
  return { patch, added };
}
