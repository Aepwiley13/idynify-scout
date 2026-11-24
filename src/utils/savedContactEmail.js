const UNSAFE_IN_ADDRESS = '\\s@,;<>?&#%"\'\\\\';
const EMAIL = new RegExp(`^[^${UNSAFE_IN_ADDRESS}]+@[^${UNSAFE_IN_ADDRESS}]+\\.[^${UNSAFE_IN_ADDRESS}]{2,}$`, 'u');
const EMAIL_MAX = 254;

/**
 * An address that is safe to put in a mailto: link, or null. A comma, semicolon, query, fragment,
 * percent, quote, angle bracket or space is refused, so a link cannot add a recipient, a subject or a header.
 */
export function safeEmail(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim();
  if (address.length === 0 || address.length > EMAIL_MAX || !EMAIL.test(address)) return null;
  return { address, href: `mailto:${encodeURI(address)}` };
}

/** The first usable address, in the order the contact card reads them: emails[], then email, then work_email. */
export function emailOf(contact) {
  const listed = Array.isArray(contact?.emails) ? contact.emails.map((entry) => (typeof entry === 'string' ? entry : entry?.value)) : [];
  for (const candidate of [...listed, contact?.email, contact?.work_email]) {
    const found = safeEmail(candidate);
    if (found) return found;
  }
  return null;
}
