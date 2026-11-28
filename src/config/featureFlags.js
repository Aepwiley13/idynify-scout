/**
 * Build-time feature flags, read from the environment Vite is given.
 *
 * myCardSharing  (VITE_MY_CARD_SHARING)
 *   My Card sharing (MY-CARD-SHARE-001): Share My Card, Copy Link, the QR code, the public page and
 *   additional links. It is "on" in the staging and preview contexts (netlify.toml) and OFF in production:
 *   merged code ships hidden, and the page behaves exactly as it did before the feature. It is one of three
 *   layers (rules, this UI flag, and the edge function's MY_CARD_SHARING_ENABLED); production turns on
 *   only at release, with explicit approval.
 */
const ON = Object.freeze(['on', 'true', '1', 'yes']);

/** Whether a flag value, as an environment gives it, means on. Anything else, or nothing, is off. */
export const isOn = (value) => typeof value === 'string' && ON.includes(value.trim().toLowerCase());

export const myCardSharingEnabled = () => isOn(import.meta.env?.VITE_MY_CARD_SHARING);
