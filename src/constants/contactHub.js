/**
 * Contact Hub — the on/off switch (Phase 1A).
 *
 * OFF BY DEFAULT. The Contact Hub appears only in a build made with
 * `VITE_CONTACT_HUB=on` (also accepted: `true`, `1`). In any other build —
 * including production, where the variable is not set — there is no sidebar
 * item, no mobile drawer item and no route: /contact-hub falls through to the
 * app's catch-all like any unknown URL.
 *
 * It is a build-time switch, the same shape as SHELL_MIGRATION, so the answer
 * is one constant for the whole app and cannot differ between the sidebar and
 * the router. It is not a per-account rollout; that is a later decision.
 *
 * Staging QA: put `VITE_CONTACT_HUB=on` in the staging env file that
 * scripts/staging/stagingDev.mjs is started with. That runner drops every
 * VITE_* variable from the shell, so the env file is the only place it can
 * come from.
 */

import { hasActiveAccess } from '../utils/billingEntitlement';

export const canUseContactHubScout = (uid, account) => Boolean(uid && account?.id === uid && hasActiveAccess(account));

/** Pure: is this raw variable value an explicit "on"? Anything else is off. */
export function contactHubEnabledFrom(value) {
  return value === 'on' || value === 'true' || value === '1';
}

export const CONTACT_HUB = Object.freeze({
  enabled: contactHubEnabledFrom(import.meta.env?.VITE_CONTACT_HUB),
});

/** Where the Contact Hub lives. One place, so links and routes cannot drift. */
export const CONTACT_HUB_PATH = '/contact-hub';
export const contactHubPersonPath = (contactId) => `${CONTACT_HUB_PATH}/person/${encodeURIComponent(contactId)}`;

/**
 * My Card: a page of its own beside My People, not a part of it. It is a
 * sibling route, so opening it does not load the user's contacts.
 */
export const CONTACT_HUB_MY_CARD_SEGMENT = 'my-card';
export const CONTACT_HUB_MY_CARD_PATH = `${CONTACT_HUB_PATH}/${CONTACT_HUB_MY_CARD_SEGMENT}`;

/** The Sticker Wall. */
export const CONTACT_HUB_STICKERS_SEGMENT = 'stickers';
export const CONTACT_HUB_STICKERS_PATH = `${CONTACT_HUB_PATH}/${CONTACT_HUB_STICKERS_SEGMENT}`;

/**
 * My People filtered by one sticker: /contact-hub?sticker=<id>. No id is My
 * People with no filter. The filter is part of the address, so it can be
 * bookmarked and the browser's back and forward buttons step through it.
 */
export const CONTACT_HUB_STICKER_PARAM = 'sticker';
export const contactHubStickerPath = (stickerId) => (stickerId
  ? `${CONTACT_HUB_PATH}?${CONTACT_HUB_STICKER_PARAM}=${encodeURIComponent(stickerId)}`
  : CONTACT_HUB_PATH);

/**
 * The place under Contact Hub's sidebar item that Contact Hub draws its own
 * entries into (components/layout/sidebarSlots.js). The same id the
 * navigation model gives the destination.
 */
export const CONTACT_HUB_SIDEBAR_SLOT = 'contact-hub';

/** The same path with any trailing slash removed, for comparing. */
const trimmed = (pathname) => String(pathname ?? '').replace(/\/+$/, '');
export function isContactHubPath(pathname) {
  const path = trimmed(pathname);
  return CONTACT_HUB.enabled && (path === CONTACT_HUB_PATH || path.startsWith(CONTACT_HUB_PATH + '/'));
}

export const isContactHubListPath = (pathname) => trimmed(pathname) === CONTACT_HUB_PATH;
export const isContactHubStickersPath = (pathname) => trimmed(pathname) === CONTACT_HUB_STICKERS_PATH;
