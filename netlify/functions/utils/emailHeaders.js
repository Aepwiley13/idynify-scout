/* global Buffer */
/**
 * Header encoding shared by every function that builds a raw RFC 2822 message
 * for the Gmail API.
 *
 * Header lines in the raw message must be 7-bit ASCII. Subjects used to be
 * written raw, so "tomorrow — People Pitch" went out as the em dash's three
 * UTF-8 bytes in an undeclared header; Gmail read them as Latin-1 and the
 * recipient saw "tomorrow Ã¢Â€Â” People Pitch". gmail-send-quick.js was fixed
 * first (#684); this module is that fix, moved here so every send path uses it
 * (#685).
 */

/**
 * RFC 2047 encoding for a header value.
 *
 * Any value containing a non-ASCII character is sent as one or more
 * =?UTF-8?B?…?= encoded words, split on whole characters and kept under the
 * 75-character word limit. Pure-ASCII values are returned unchanged. CR/LF are
 * folded to a space, so no value can inject an extra header.
 */
export function encodeHeaderValue(value) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const words = [];
  let chunk = '';
  let bytes = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (chunk && bytes + size > 45) { words.push(chunk); chunk = ''; bytes = 0; }
    chunk += ch;
    bytes += size;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(' ');
}

/** `Name <email>` with the display name encoded when it is not plain ASCII. */
export function formatAddress(name, email) {
  if (!name || name === email) return email;
  const display = /^[\x20-\x7E]*$/.test(name) ? name : encodeHeaderValue(name);
  return `${display} <${email}>`;
}

/**
 * A plain-text message with its headers encoded — the exact header set
 * gmail-send, gmail-send-wave and process-scheduled-engagements already sent.
 */
export function buildPlainTextEmail({ toName, toEmail, subject, body }) {
  return [
    `To: ${formatAddress(toName, toEmail)}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body,
  ].join('\n');
}
