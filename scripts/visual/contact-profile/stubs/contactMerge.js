import { combineContactAffiliations, projectPrimaryAffiliation } from '../../../../src/utils/contactAffiliations';
import { buildPhoneWrite, phoneDisplay, readContactPhones } from '../../../../src/utils/contactPhones';
import { normalizeEmail } from '../../../../src/utils/identityNormalization';
import { deleteFixtureDoc, getFixtureDoc, listFixtureDocs, seedFixtureDoc } from './firestore';
import { getEffectiveUser } from './impersonation';
import { fixture } from './fixture';

export const mergeReviewEnabled = () => new URLSearchParams(window.location.search).get('merge_demo') === '1';

const storage = 'fixture-contact-merge-dismissals';
const read = () => JSON.parse(sessionStorage.getItem(storage) ?? '[]');
const clone = (value) => structuredClone(value);
const unique = (values, key) => [...new Map(values.map((item) => [key(item), item])).values()];
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
let receipt = null;
let last = null;

function emailFacts(contact) {
  const values = [...(contact.emails ?? []), contact.email, contact.work_email, contact.email_address].filter(Boolean);
  const uniqueFacts = unique(values.map((entry) => typeof entry === 'string' ? { value: entry } : entry).filter((entry) => entry.value), (entry) => normalizeEmail(entry.value));
  return uniqueFacts;
}

function mergePlan(left, right, choices) {
  const emails = unique([...emailFacts(left), ...emailFacts(right)], (entry) => normalizeEmail(entry.value));
  const phones = unique([...readContactPhones(left), ...readContactPhones(right)], (phone) => phone.normalized ?? `${phone.value}:${phone.label}`);
  const notes = unique([...(left.notes ?? []), ...(right.notes ?? [])], (note) => note.id ? `id:${note.id}` : JSON.stringify(note));
  const stickerIds = unique([...(left.sticker_ids ?? []), ...(right.sticker_ids ?? [])], String);
  const assignments = { ...(right.sticker_assignments ?? {}), ...(left.sticker_assignments ?? {}) };
  const affiliations = combineContactAffiliations(left, right);
  const merged = { ...left, ...projectPrimaryAffiliation(affiliations), contact_affiliations: affiliations,
    emails, notes, sticker_ids: stickerIds, sticker_assignments: assignments,
    identity_sources: unique([...(left.identity_sources ?? []), ...(right.identity_sources ?? []), left.source, right.source,
      left.identity_source, right.identity_source].filter(Boolean), String) };
  if (emails.length) {
    const selected = Number.isInteger(choices.primary_email) ? emails[choices.primary_email]?.value : undefined;
    merged.email = selected ?? left.email ?? emails[0].value;
    merged.email_normalized = normalizeEmail(merged.email);
  }
  if (phones.length) {
    const phoneChoices = phones.filter((phone) => phone.label !== 'fax');
    const selected = Number.isInteger(choices.primary_phone) ? phoneChoices[choices.primary_phone] : undefined;
    const preferred = selected ?? phoneChoices.find((phone) => phoneDisplay(phone) === left.phone) ?? phoneChoices[0];
    Object.assign(merged, buildPhoneWrite(phones.map((phone, index) => ({ ...phone, id: phone.id ?? `merge-${index}` }))));
    if (preferred) { merged.phone = phoneDisplay(preferred); merged.contact_hub_primary_phone = phoneDisplay(preferred); }
  }
  const conflicts = [];
  if (emails.length > 1) conflicts.push({ key: 'primary_email', options: emails.map((item) => item.value) });
  if (phones.filter((phone) => phone.label !== 'fax').length > 1) conflicts.push({ key: 'primary_phone', options: phones.filter((phone) => phone.label !== 'fax').map(phoneDisplay) });
  return { merged, conflicts };
}

function contactPath(uid, id) { return `users/${uid}/contacts/${id}`; }

export async function mergeRequest(uid, action, input, active) {
  if (uid !== getEffectiveUser().uid || getEffectiveUser()._isImpersonated || !active()) throw new Error('read_only');
  if (action === 'dismissals') return { pairs: read(), latest: receipt };
  if (action === 'dismiss' || action === 'restore') {
    const pair = [input.sourceId, input.survivorId].sort();
    const retained = read().filter((value) => !same(value, pair));
    sessionStorage.setItem(storage, JSON.stringify(action === 'dismiss' ? [...retained, pair] : retained));
    return { pair };
  }
  if (action === 'preview') {
    if (receipt?.status === 'rolled_back') receipt = null;
    const left = getFixtureDoc(contactPath(uid, input.survivorId));
    const right = getFixtureDoc(contactPath(uid, input.sourceId));
    if (!left || !right || left.contact_hub_lifecycle?.status === 'retired' || right.contact_hub_lifecycle?.status === 'retired') throw new Error('contact_unavailable');
    const plan = mergePlan(left, right, input.choices ?? {});
    const unresolved = plan.conflicts.some(({ key }) => !Number.isInteger(input.choices?.[key]) || input.choices[key] < 0 || input.choices[key] >= (key === 'primary_email' ? plan.merged.emails.length : plan.merged.phones.filter((phone) => phone.label !== 'fax').length));
    const events = listFixtureDocs(contactPath(uid, input.sourceId) + '/timeline');
    const allEvents = listFixtureDocs(contactPath(uid, input.survivorId) + '/timeline');
    const token = !unresolved ? 'fixture-verified-preview' : null;
    last = { ...input, token, left: clone(left), right: clone(right), merged: clone(plan.merged),
      sourceEvents: clone(events), survivorEvents: clone(allEvents), created: [] };
    return { conflicts: plan.conflicts, blockers: [], combined: {
      name: plan.merged.name ?? null,
      emails: plan.merged.emails.map((item) => ({ ...item, primary: normalizeEmail(item.value) === normalizeEmail(plan.merged.email) })),
      phones: readContactPhones(plan.merged).map((item) => ({ ...item, primary: phoneDisplay(item) === plan.merged.phone })),
      affiliations: plan.merged.contact_affiliations,
      notes: plan.merged.notes,
      stickers: plan.merged.sticker_ids.map((id) => ({ id, name: fixture.stickers?.[id]?.name ?? id, assignment: plan.merged.sticker_assignments?.[id] ?? null })),
      sources: plan.merged.identity_sources,
      sourceHistory: [left, right].map((contact) => ({ contact_id: contact.id,
        source: contact.source ?? null, identity_source: contact.identity_source ?? null,
        added_from: contact.addedFrom ?? contact.added_from ?? null, source_detail: contact.addedFromSource ?? contact.added_from_source ?? null,
        identity_sources: contact.identity_sources ?? [], email_facts: emailFacts(contact), phone_facts: readContactPhones(contact) })),
      suppressedEmails: [],
    }, activityCount: events.length, token };
  }
  if (action === 'commit') {
    if (receipt) return { receipt };
    if (!last || input.token !== last.token || !input.token) throw new Error('preview_changed');
    const survivorPath = contactPath(uid, input.survivorId);
    const sourcePath = contactPath(uid, input.sourceId);
    const mergeOrigin = { source_id: input.sourceId, operation_id: input.operationId,
      previous_assignments: last.left.sticker_assignments ?? {},
      sticker_assignment_provenance: { [input.survivorId]: last.left.sticker_assignments ?? {}, [input.sourceId]: last.right.sticker_assignments ?? {} },
      source_provenance: [last.left, last.right].map((contact) => ({ contact_id: contact.id, source: contact.source ?? null,
        identity_source: contact.identity_source ?? null, added_from: contact.addedFrom ?? contact.added_from ?? null,
        source_detail: contact.addedFromSource ?? contact.added_from_source ?? null, identity_sources: contact.identity_sources ?? [],
        email_facts: emailFacts(contact), phone_facts: readContactPhones(contact) })),
      previous_source: last.left.source ?? null, previous_fields: { title: last.left.title ?? null, company_name: last.left.company_name ?? null, company_id: last.left.company_id ?? null } };
    const survivor = { ...last.merged, contact_hub_merge_origin: mergeOrigin };
    const source = { ...last.right, is_archived: true,
      contact_hub_lifecycle: { status: 'retired', operation_id: input.operationId, merged_into: input.survivorId } };
    seedFixtureDoc(survivorPath, survivor);
    seedFixtureDoc(sourcePath, source);
    for (const [eventId, event] of last.sourceEvents) {
      const targetId = `${input.survivorId}-merged-${eventId.split('/').at(-1)}`;
      const targetPath = `${survivorPath}/timeline/${targetId}`;
      seedFixtureDoc(targetPath, { ...event, contact_hub_merge_origin: { contact_id: input.sourceId, event_id: eventId.split('/').at(-1) } });
      last.created.push(targetPath);
    }
    window.__mergeFixtureState = { survivor: clone(survivor), source: clone(source), transferredTimeline: last.created.map((path) => clone(getFixtureDoc(path))) };
    receipt = { status: 'merged', operationId: input.operationId, survivorId: input.survivorId,
      sourceId: input.sourceId, rollbackUntil: Date.now() + 7 * 86400000 };
    return { receipt };
  }
  if (action === 'status') return { receipt };
  if (action === 'redirect') return { survivorId: receipt?.status === 'merged' && receipt.sourceId === input.sourceId ? receipt.survivorId : null };
  if (action === 'preview_rollback' && receipt?.status === 'merged') {
    const survivor = getFixtureDoc(contactPath(uid, receipt.survivorId));
    const source = getFixtureDoc(contactPath(uid, receipt.sourceId));
    if (!same(survivor, { ...last.merged, contact_hub_merge_origin: survivor.contact_hub_merge_origin }) || source?.contact_hub_lifecycle?.operation_id !== receipt.operationId) throw new Error('rollback_changed');
    return { token: 'fixture-rollback', receipt };
  }
  if (action === 'rollback' && input.token === 'fixture-rollback' && receipt?.status === 'merged') {
    seedFixtureDoc(contactPath(uid, receipt.survivorId), last.left);
    seedFixtureDoc(contactPath(uid, receipt.sourceId), last.right);
    for (const path of last.created) deleteFixtureDoc(path);
    for (const [path, data] of [...last.survivorEvents, ...last.sourceEvents]) seedFixtureDoc(path, data);
    receipt = { ...receipt, status: 'rolled_back' };
    window.__mergeFixtureState = { survivor: clone(getFixtureDoc(contactPath(uid, receipt.survivorId))), source: clone(getFixtureDoc(contactPath(uid, receipt.sourceId))), rolledBack: true };
    return { receipt };
  }
  throw new Error('unavailable');
}
