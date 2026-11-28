/**
 * The one escape helper for the public card page. Every user value that reaches HTML goes through
 * escapeText (element content) or escapeAttr (attribute values, always double-quoted by the caller).
 * They are separate on purpose: an attribute value must also neutralise quotes and backticks, and
 * neither is ever used for the other's job.
 */
const TEXT = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const ATTR = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };

// Control characters (other than tab and line breaks, which collapse) are dropped.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const clean = (value) => (value === null || value === undefined ? '' : String(value).replace(CONTROL, ''));

export const escapeText = (value) => clean(value).replace(/[&<>]/g, (c) => TEXT[c]);

export const escapeAttr = (value) => clean(value).replace(/[&<>"'`=]/g, (c) => ATTR[c]);
