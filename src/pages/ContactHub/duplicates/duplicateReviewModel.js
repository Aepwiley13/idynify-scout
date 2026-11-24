import { DUPLICATE_KEYS } from '../../../utils/duplicateEvidence';
import { safeEmail } from '../../../utils/savedContactEmail';
import { extractIdentifiers, normalizeEmail, normalizeLoose, normalizePhone } from '../../../utils/identityNormalization';
import { mergeIdentifiers } from '../../../utils/identityResolution';
import { readContactPhones, phoneDisplay, splitExtension } from '../../../utils/contactPhones';
import { hasRealContactPhoto } from '../../../utils/contactPhoto';
import { personName } from '../peopleRules';

const unique = (values) => [...new Set(values.filter(Boolean))];
const array = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value.trim() : '';
const evidenceRank = { 'Needs review': 0, 'Strong match': 1, 'Possible match': 2 };
// Broad buckets are reviewed in a bounded set of comparisons anchored on the first record.
const PAIRWISE_LIMIT = 12;

function emails(contact) {
  return unique([
    ...array(contact.emails).map((entry) => entry?.value ?? entry),
    ...array(contact.extraEmails), contact.email, contact.work_email, contact.email_address,
    contact.email_normalized,
  ].map((value) => normalizeEmail(safeEmail(value)?.address)));
}

function uniquePhones(values) {
  const byNumber = new Map();
  for (const value of values.filter(Boolean)) {
    const number = splitExtension(value);
    const key = JSON.stringify([normalizePhone(number.value) ?? number.value, number.extension]);
    if (!byNumber.has(key)) byNumber.set(key, value);
  }
  return [...byNumber.values()];
}

function oneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) return oneEdit(b, a);
  let offset = 0;
  for (let index = 0; index < a.length; index++) {
    if (a[index] === b[index + offset]) continue;
    if (offset || (a.length === b.length && a.slice(index + 1) !== b.slice(index + 1))) return false;
    if (a.length === b.length) return true;
    offset = 1;
    if (a[index] !== b[index + offset]) return false;
  }
  return true;
}

function indexRow(buckets, signal, key, contact) {
  if (!key) return;
  const indexKey = JSON.stringify([signal, key]);
  if (!buckets.has(indexKey)) buckets.set(indexKey, { signal, rows: [] });
  buckets.get(indexKey).rows.push(contact);
}

function indexContact(buckets, row) {
  const { ids, given, family, email } = row;
  for (const address of email) indexRow(buckets, 'Same email address', address, row);
  indexRow(buckets, 'Same LinkedIn profile', DUPLICATE_KEYS.linkedin_url(ids), row);
  indexRow(buckets, 'Same external person ID', DUPLICATE_KEYS.apollo_person_id(ids), row);
  indexRow(buckets, 'Same phone number', DUPLICATE_KEYS.phone(ids), row);
  const company = ids.company || ids.companyId;
  if (!company || !given || !family) return;
  indexRow(buckets, 'Same name and organization', DUPLICATE_KEYS.name_company({ ...ids, companyId: company }), row);
  if (given.length < 4 || given.length > 40) return;
  const spellings = unique([given, ...[...given].map((_, i) => given.slice(0, i) + given.slice(i + 1))]);
  for (const spelling of spellings) indexRow(buckets, 'Similar name and same organization', [spelling, family, company], row);
}

function recordPair(pairs, left, right, signal, shared) {
  if (left.contact.id === right.contact.id) return;
  if (signal.startsWith('Similar') && !oneEdit(left.given, right.given)) return;
  const ordered = [left, right].sort((a, b) => a.contact.id.localeCompare(b.contact.id));
  const id = JSON.stringify(ordered.map((row) => row.contact.id));
  if (!pairs.has(id)) pairs.set(id, { id, rows: ordered, evidence: new Set(), shared: false });
  const pair = pairs.get(id);
  pair.evidence.add(signal);
  pair.shared ||= shared;
}

export function detectPossibleDuplicates(contacts) {
  const buckets = new Map();
  const pairs = new Map();
  for (const contact of contacts) {
    const ids = extractIdentifiers(contact);
    const [given, ...last] = (ids.name ?? '').split(' ');
    indexContact(buckets, { contact, ids, email: emails(contact), given, family: last.join(' ') });
  }
  for (const { signal, rows } of buckets.values()) {
    const large = rows.length > PAIRWISE_LIMIT;
    for (let i = 0; i < (large ? 1 : rows.length - 1); i++) {
      for (let j = i + 1; j < rows.length; j++) recordPair(pairs, rows[i], rows[j], signal, rows.length > 2);
    }
  }
  return [...pairs.values()].map(({ id, rows: [left, right], evidence, shared }) => {
    const conflicts = [
      ['LinkedIn profiles differ', left.ids.linkedinUrl, right.ids.linkedinUrl],
      ['External person IDs differ', left.ids.apolloPersonId, right.ids.apolloPersonId],
    ].filter(([, a, b]) => a && b && a !== b).map(([label]) => label);
    const sameName = left.ids.name && left.ids.name === right.ids.name;
    const strong = evidence.has('Same LinkedIn profile') || evidence.has('Same external person ID')
      || (evidence.has('Same email address') && sameName);
    const confidence = conflicts.length || shared || (evidence.has('Same email address') && !strong)
      ? 'Needs review' : strong ? 'Strong match' : 'Possible match';
    return { id, contacts: [left.contact, right.contact], evidence: [...evidence], confidence, conflicts, shared };
  }).sort((a, b) => evidenceRank[a.confidence] - evidenceRank[b.confidence] || a.id.localeCompare(b.id));
}

const valuesFor = (contact) => ({
  Name: extractIdentifiers(contact).name ? personName(contact) : '',
  Organization: text(contact.company_name || contact.companyName || contact.organization_name),
  'Company record': text(contact.company_id),
  'Primary email': emails(contact)[0],
  'Primary phone': phoneDisplay(readContactPhones(contact)[0]),
  'Job title': text(contact.title || contact.job_title),
  Location: text(contact.location) || [contact.city, contact.state, contact.country].map(text).filter(Boolean).join(', '),
  'LinkedIn profile': text(contact.linkedin_url) || extractIdentifiers(contact).linkedinUrl,
  'External person ID': extractIdentifiers(contact).apolloPersonId,
  Photo: contact.contact_hub_photo === 'hidden' ? 'Hidden'
    : contact.contact_hub_photo === 'custom' ? 'Custom photo'
      : hasRealContactPhoto(contact) ? 'Original photo' : '',
  Reminder: text(contact.next_best_step?.action) || (contact.next_step_due ? 'Existing next step' : ''),
});

export function contactReviewDetails(contact) {
  return {
    fields: valuesFor(contact),
    emails: emails(contact),
    phones: uniquePhones([...readContactPhones(contact).map(phoneDisplay), ...array(contact.extraPhones).map(text)]),
    stickers: unique([...array(contact.sticker_ids), ...Object.keys(contact.sticker_assignments ?? {})]),
    stickerSources: unique(Object.values(contact.sticker_assignments ?? {}).map((entry) => text(entry?.assigned_by))),
    notes: array(contact.notes).length,
    permission: contact.email_opt_out === true || contact.do_not_email === true || contact.unsubscribed === true
      || /^(unsubscribed|opted[_ -]?out|suppressed)$/i.test(text(contact.email_status)) ? 'Opt-out or suppression recorded' : 'Permission requires verification',
    sources: unique([contact.source, contact.addedFrom, ...array(contact.identity_sources)].map(text)),
    photoSource: text(contact.photo_source),
  };
}

export function buildDuplicatePreview([left, right], choices = {}) {
  const details = [contactReviewDetails(left), contactReviewDetails(right)];
  // Use existing fill-only identifier logic for the baseline. Explicit choices
  // here are presentation values and are never returned as a Firestore patch.
  const filled = valuesFor({ ...left, ...mergeIdentifiers(left, right) });
  const fields = Object.keys(filled).map((label) => {
    const [a, b] = details.map((entry) => entry.fields[label]);
    const comparable = label === 'External person ID' || label === 'Company record' ? (value) => value : normalizeLoose;
    const conflict = Boolean(a && b && (comparable(a) !== comparable(b)
      || label === 'Photo' || label === 'Reminder'));
    return { label, values: [a, b], conflict, value: conflict ? [a, b][choices[label]] : a || b || filled[label] };
  });
  return {
    details, fields,
    emails: unique(details.flatMap((entry) => entry.emails)),
    phones: uniquePhones(details.flatMap((entry) => entry.phones)),
    stickers: unique(details.flatMap((entry) => entry.stickers)),
    notes: details.reduce((total, entry) => total + entry.notes, 0),
    sources: unique(details.flatMap((entry) => entry.sources)),
  };
}
