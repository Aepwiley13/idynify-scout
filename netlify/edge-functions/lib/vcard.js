/**
 * vCard 3.0 for a public card, built in the edge function from the PUBLIC COPY alone.
 *
 * A small pure module that mirrors buildMyCardVCard in src/utils/vcard.js (same lines, same order,
 * same escaping and 75-byte folding) without importing it: that file pulls in browser-only photo code.
 * If one changes, change the other (src/test/publicCardEdge.test.js compares them).
 * Shared additional links are written as labelled URL entries:
 *   item1.URL:<url>
 *   item1.X-ABLabel:<label>
 */
const DATA_URL_PREFIX = 'data:image/jpeg;base64,';
const FOLD_AT = 75;
const encoder = new TextEncoder();

function stripControl(value) {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    if (!((code < 32 && code !== 10 && code !== 13) || code === 127)) out += character;
  }
  return out;
}

export function escapeVCardText(value) {
  if (value === null || value === undefined) return '';
  return stripControl(String(value))
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const uriValue = (value) => stripControl(String(value)).replace(/[\r\n]+/g, '');

function foldLine(line) {
  if (line.length <= FOLD_AT && encoder.encode(line).length <= FOLD_AT) return line;
  if (/^[\x20-\x7e]*$/.test(line)) {
    const pieces = [line.slice(0, FOLD_AT)];
    for (let at = FOLD_AT; at < line.length; at += FOLD_AT - 1) pieces.push(line.slice(at, at + FOLD_AT - 1));
    return pieces.join('\r\n ');
  }
  const parts = [];
  let current = '';
  let size = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (size + width > FOLD_AT) {
      parts.push(current);
      current = '';
      size = 1;
    }
    current += character;
    size += width;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const assemble = (lines) => `${['BEGIN:VCARD', 'VERSION:3.0', ...lines, 'END:VCARD'].map(foldLine).join('\r\n')}\r\n`;

/**
 * @param {object} view  the validated public card (lib/publicCard.js: parsePublicCard), whose
 *   web addresses were already re-validated; `links` is the array of shared {label, url}.
 */
export function buildPublicVCard(view) {
  const lines = [
    `N:${escapeVCardText(view.lastName)};${escapeVCardText(view.firstName)};;;`,
    `FN:${escapeVCardText(view.name)}`,
  ];
  if (view.organization) lines.push(`ORG:${escapeVCardText(view.organization)}`);
  if (view.title) lines.push(`TITLE:${escapeVCardText(view.title)}`);
  if (view.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCardText(view.email)}`);
  if (view.phone) lines.push(`TEL;TYPE=VOICE:${escapeVCardText(view.phone)}`);
  if (view.website) lines.push(`URL:${uriValue(view.website)}`);
  if (view.linkedinUrl) lines.push(`URL;TYPE=LinkedIn:${uriValue(view.linkedinUrl)}`);
  if (view.instagram) lines.push(`URL;TYPE=Instagram:https://www.instagram.com/${uriValue(view.instagram)}`);
  if (view.photoUrl) {
    lines.push(view.photoUrl.startsWith(DATA_URL_PREFIX)
      ? `PHOTO;ENCODING=b;TYPE=JPEG:${view.photoUrl.slice(DATA_URL_PREFIX.length)}`
      : `PHOTO;VALUE=uri:${uriValue(view.photoUrl)}`);
  }
  (view.links || []).forEach((link, index) => {
    lines.push(`item${index + 1}.URL:${uriValue(link.url)}`);
    lines.push(`item${index + 1}.X-ABLabel:${escapeVCardText(link.label)}`);
  });
  return assemble(lines);
}

/** A safe download name: letters and digits joined by underscores. */
export function vcardFileName(name) {
  const base = Array.from(String(name).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '')).slice(0, 60).join('').replace(/_+$/g, '');
  const safe = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i.test(base) ? `${base}_contact` : base;
  return `${safe || 'contact'}.vcf`;
}
