import { readMergeRelationships, planMergeRelationships } from './contactMergeRelationships.js';
import { hasArchiveSignal, isDeferredRecord } from '../../../src/constants/statusModel.js';
import { Buffer } from 'node:buffer';
import { extractIdentifiers } from '../../../src/utils/identityNormalization.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { safeEmail } from '../../../src/utils/savedContactEmail.js';
import { readContactPhones, buildPhoneWrite, phoneDisplay } from '../../../src/utils/contactPhones.js';
import { normalizeEmail, normalizeLinkedInUrl } from '../../../src/utils/identityNormalization.js';
import { combineContactAffiliations, projectPrimaryAffiliation, validateContactAffiliations } from '../../../src/utils/contactAffiliations.js';

const MINUTE = 60_000;
const WEEK = 7 * 24 * 60 * MINUTE;
const id = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(x);
const uuid = (x) => typeof x === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const sort = (value) => {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
};
const canonical = (value) => JSON.stringify(sort(value));
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const mac = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url');
const fail = (http, code) => Object.assign(new Error(code), { http, code });
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const version = (snap) => snap.updateTime?.toDate?.().toISOString() + ':' + snap.updateTime?.nanoseconds;
const list = (x) => Array.isArray(x) ? x : [];
const union = (values, key) => [...new Map(values.map((item) => [key(item), item])).values()];
const unionKeepingFirst = (values, key) => {
  const unique = new Map();
  for (const item of values) if (!unique.has(key(item))) unique.set(key(item), item);
  return [...unique.values()];
};
const fields = ['name', 'first_name', 'last_name', 'title', 'job_title', 'company_name', 'company_id', 'city', 'state', 'country', 'location', 'address', 'linkedin_url', 'apollo_person_id'];
const nonempty = (x) => x !== null && x !== undefined && x !== '';
const contactPath = (uid, cid) => `users/${uid}/contacts/${cid}`;
const frozen = (person) => person?.contact_hub_lifecycle?.status === 'retired';
const sourceHistoryFor = (contact, contactId) => ({ contact_id: contactId,
  source: contact.source ?? null, identity_source: contact.identity_source ?? null,
  added_from: contact.addedFrom ?? contact.added_from ?? null,
  source_detail: contact.addedFromSource ?? contact.added_from_source ?? null,
  identity_sources: list(contact.identity_sources),
  email_facts: emails(contact), phone_facts: readContactPhones(contact) });

function emails(person) {
  const values = [...list(person.emails), person.email, person.work_email, person.email_address];
  const facts = values.flatMap((entry) => {
    const address = safeEmail(typeof entry === 'string' ? entry : entry?.value)?.address;
    return address ? [{ ...(typeof entry === 'object' ? entry : {}), value: address }] : [];
  });
  const byAddress = new Map();
  for (const fact of facts) {
    const key = normalizeEmail(fact.value);
    const prior = byAddress.get(key);
    byAddress.set(key, prior ? { ...fact, ...prior, value: prior.value } : fact);
  }
  return [...byAddress.values()];
}

function applyPlan(a, b, choices, blockers, privatePhotos, identityConfirmed = false) {
  const merged = { ...a };
  if ([a, b].some((entry) => entry.contact_hub_merge_origin)) blockers.add('previous_merge_requires_review');
  const conflicts = [];
  const choose = (key, values) => {
    if (values.length < 2) return values[0];
    const selected = choices[key];
    conflicts.push({ key, options: values });
    return Number.isInteger(selected) && selected >= 0 && selected < values.length ? values[selected] : undefined;
  };
  for (const key of fields) {
    if (['title', 'job_title', 'company_name', 'company_id'].includes(key)) continue;
    const values = union([a[key], b[key]].filter(nonempty), canonical);
    const value = choose(key, values);
    if (value !== undefined) merged[key] = value;
  }
  const photoOptions = union([a, b].filter((record) => nonempty(record.photo_url))
    .map((record) => [record.photo_url, record.photo_source ?? null]), canonical);
  if (photoOptions.length && !privatePhotos) {
    const selected = choose('original_photo', photoOptions.map(([url, source]) => source ? `${url} (${source})` : url));
    if (selected) {
      const selectedIndex = photoOptions.length === 1 ? 0 : choices.original_photo;
      [merged.photo_url, merged.photo_source] = photoOptions[selectedIndex];
    }
  }
  if ([a, b].some((entry) => list(entry.emails).some((item) => !safeEmail(typeof item === 'string' ? item : item?.value)))) blockers.add('invalid_email_fact');
  const leftIds = extractIdentifiers(a);
  const rightIds = extractIdentifiers(b);
  const corroborated = ['apolloPersonId', 'linkedinUrl', 'phone'].some((key) => leftIds[key] && leftIds[key] === rightIds[key])
    || emails(a).some((entry) => emails(b).some((other) => normalizeEmail(other.value) === normalizeEmail(entry.value)))
    || (leftIds.name && leftIds.company && leftIds.name === rightIds.name && leftIds.company === rightIds.company);
  if (!corroborated && !identityConfirmed) blockers.add('identity_not_verified');
  for (const key of ['apollo_person_id', 'linkedin_url_normalized', 'linkedin_url']) {
    const normalize = key.startsWith('linkedin') ? normalizeLinkedInUrl : String;
    if (a[key] && b[key] && normalize(a[key]) !== normalize(b[key])) blockers.add('conflicting_identity');
  }
  // When one address exists on both records, keep the survivor's canonical label.
  // The source record's original label remains in sourceHistory/source_provenance.
  const addresses = unionKeepingFirst([...emails(a), ...emails(b)], (entry) => normalizeEmail(entry.value));
  addresses.forEach((entry, index) => { entry.id = `merge_${digest([normalizeEmail(entry.value), entry.label ?? null, index]).slice(0, 20)}`; });
  const primaryEmail = choose('primary_email', addresses.map((entry) => entry.value));
  if (addresses.length) {
    const chosenEmail = primaryEmail ?? a.email ?? addresses[0].value;
    addresses.sort((x, y) => Number(normalizeEmail(y.value) === normalizeEmail(chosenEmail)) - Number(normalizeEmail(x.value) === normalizeEmail(chosenEmail)));
    merged.emails = addresses;
    merged.email = chosenEmail;
    merged.email_normalized = normalizeEmail(chosenEmail);
  }
  // As with email, preserve the survivor's label for a shared number; the retired
  // source and merge provenance retain its independently observed label.
  const numbers = unionKeepingFirst([...readContactPhones(a), ...readContactPhones(b)], (phone) => phone.normalized ?? `${phoneDisplay(phone)}:${phone.label}`);
  const primaryPhone = choose('primary_phone', numbers.filter((number) => number.label !== 'fax').map(phoneDisplay));
  if (numbers.length) {
    Object.assign(merged, buildPhoneWrite(numbers.map((phone, index) => ({ ...phone, id: `merged-${index}` }))));
    if (primaryPhone) {
      merged.phone = primaryPhone;
      merged.contact_hub_primary_phone = primaryPhone;
    }
  }
  const affiliations = combineContactAffiliations(a, b);
  if (affiliations.length > 20) blockers.add('affiliation_limit');
  if (!validateContactAffiliations(affiliations).ok) blockers.add('invalid_affiliations');
  merged.contact_affiliations = affiliations;
  Object.assign(merged, projectPrimaryAffiliation(affiliations));
  const allowed = new Set([...fields, 'contact_affiliations', 'photo_url', 'photo_source', 'contact_hub_photo', 'email', 'emails', 'email_normalized', 'work_email', 'email_address', 'phones', 'phone', 'phone_normalized', 'phone_mobile', 'phone_direct', 'phone_work', 'phone_home', 'notes', 'sticker_ids', 'sticker_assignments', 'source', 'identity_source', 'identity_sources', 'addedFrom', 'addedFromSource', 'added_from', 'added_from_source', 'addedAt', 'saved_at', 'created_at', 'createdAt', 'updated_at', 'status', 'lead_owner', 'linkedin_url_normalized', 'email_status', 'email_opt_out', 'unsubscribed', 'do_not_email', 'next_best_step', 'next_step_due', 'next_step_type', 'next_best_step_history']);
  for (const key of Object.keys(b)) {
    if (!allowed.has(key) && canonical(a[key]) !== canonical(b[key])) blockers.add('unclassified_source_fields');
  }
  merged.notes = union([
    ...list(a.notes), ...list(b.notes).map((note, index) =>
      list(a.notes).some((item) => item.id === note.id && canonical(item) !== canonical(note))
        ? { ...note, id: `merge-${digest([note, index]).slice(0, 30)}` } : note),
  ], canonical);
  merged.sticker_ids = union([...list(a.sticker_ids), ...list(b.sticker_ids)], String);
  merged.sticker_assignments = { ...b.sticker_assignments, ...a.sticker_assignments };
  merged.sticker_assignments = Object.fromEntries(merged.sticker_ids
    .filter((stickerId) => Object.hasOwn(merged.sticker_assignments, stickerId))
    .map((stickerId) => [stickerId, merged.sticker_assignments[stickerId]]));
  if (merged.sticker_ids.length > 50) blockers.add('sticker_limit');
  merged.identity_sources = union([...list(a.identity_sources), ...list(b.identity_sources), a.source, b.source].filter(Boolean), String);
  if (merged.linkedin_url) merged.linkedin_url_normalized = normalizeLinkedInUrl(merged.linkedin_url);
  if ([a, b].some((entry) => {
    const facts = [entry, ...list(entry.emails).filter((email) => email && typeof email === 'object')];
    return facts.some((fact) => fact.email_opt_out || fact.opt_out || fact.optOut || fact.unsubscribed
      || fact.do_not_email || fact.email_permissions || fact.consent || fact.suppressed
      || /opt|unsub|suppress/i.test(fact.email_status ?? fact.status ?? ''));
  })) blockers.add('email_permission_requires_review');
  if ([a, b].some((entry) => hasArchiveSignal(entry) || isDeferredRecord(entry) || entry.company_archived)) blockers.add('unsupported_contact_status');
  if ([a, b].some((entry) => entry.status && !['active', 'saved', 'new'].includes(entry.status))) blockers.add('unsupported_contact_status');
  return { merged, conflicts, choose, affiliations };
}

export function createContactMerge({ db, verifyToken, secret, enabled, executionEnabled = () => false, inspectCollections = async () => [], timestamp, now = Date.now }) {
  const readToken = (token) => {
    const [payload, signature, extra] = typeof token === 'string' ? token.split('.') : [];
    if (!payload || !signature || extra || token.length > 2_000) throw fail(409, 'preview_changed');
    const check = mac(secret(), payload);
    if (check.length !== signature.length || !timingSafeEqual(Buffer.from(check), Buffer.from(signature))) throw fail(409, 'preview_changed');
    try { return JSON.parse(Buffer.from(payload, 'base64url')); } catch { throw fail(409, 'preview_changed'); }
  };
  const tokenFor = (uid, scope, hash) => {
    const payload = Buffer.from(JSON.stringify({ uid, scope, hash, expires: now() + 10 * MINUTE, v: 1 })).toString('base64url');
    return `${payload}.${mac(secret(), payload)}`;
  };
  const checkToken = (input, uid, scope, hash) => {
    const token = readToken(input.token);
    if (token.uid !== uid || token.scope !== scope || token.hash !== hash || token.expires <= now() || token.v !== 1) throw fail(409, 'preview_changed');
  };
  return async (event) => {
    if (!enabled() || (secret()?.length ?? 0) < 32) return json(404, { error: 'unavailable' });
    if (event.httpMethod !== 'POST') return json(405, { error: 'method' });
    const bearer = (event.headers?.authorization ?? event.headers?.Authorization ?? '').match(/^Bearer (\S+)$/i)?.[1];
    let actor;
    try { actor = bearer && await verifyToken(bearer); } catch { return json(401, { error: 'sign_in' }); }
    if (!id(actor?.uid)) return json(401, { error: 'sign_in' });
    if (actor.firebase?.sign_in_provider === 'custom') return json(403, { error: 'read_only' });
    try {
      if (event.isBase64Encoded || typeof event.body !== 'string' || event.body.length > 16_000) throw fail(400, 'invalid_request');
      const input = JSON.parse(event.body);
      const uid = actor.uid;
      if (input?.uid !== uid) throw fail(403, 'read_only');
      const { action, survivorId, sourceId, operationId } = input;
      const owner = db.doc(`users/${uid}`);
      const sessions = db.collection('impersonationSessions').where('adminUserId', '==', uid).where('status', '==', 'active');
      const op = uuid(operationId) ? db.doc(`contact_hub_merges/${uid}/operations/${operationId}`) : null;

      return await db.runTransaction(async (tx) => {
        const [account, active] = await Promise.all([tx.get(owner), tx.get(sessions)]);
        if (!account.exists || active.docs.some((row) => {
          const until = row.data().expiresAt?.toMillis?.();
          return !Number.isFinite(until) || until > now();
        })) throw fail(403, 'read_only');
        if (['dismiss', 'restore', 'dismissals'].includes(action)) {
          const saved = db.collection(`users/${uid}/contact_duplicate_dismissals`);
          const fingerprint = (rows) => mac(secret(), canonical(rows.map((row) => {
            const ids = extractIdentifiers(row.data());
            return [row.id, ids.name, ids.company, ids.companyId, ids.linkedinUrl, ids.apolloPersonId,
              [...new Set(emails(row.data()).map((item) => normalizeEmail(item.value)))].sort(),
              readContactPhones(row.data()).filter((phone) => ['mobile', 'direct', 'home'].includes(phone.label))
                .map((phone) => phone.normalized).filter(Boolean).sort(), ids.phone];
          })));
          if (action === 'dismissals') {
            const query = saved.orderBy('__name__').limit(100);
            const page = await tx.get(typeof input.cursor === 'string' && /^[a-f0-9]{64}$/.test(input.cursor)
              ? query.startAfter(saved.doc(input.cursor)) : query);
            const relevant = await Promise.all(page.docs.map(async (entry) => {
              const record = entry.data();
              if (!Array.isArray(record.pair) || record.pair.length !== 2 || !record.pair.every(id)) return null;
              const rows = await Promise.all(record.pair.map((cid) => tx.get(db.doc(contactPath(uid, cid)))));
              return rows.every((row) => row.exists && !frozen(row.data())) && record.fingerprint === fingerprint(rows)
                ? record.pair : null;
            }));
            const latest = input.cursor ? null : (await tx.get(db.collection(`contact_hub_merges/${uid}/operations`)
              .orderBy('committedAt', 'desc').limit(1))).docs[0]?.data()?.receipt ?? null;
            return json(200, { latest, pairs: relevant.filter(Boolean), cursor: page.docs.length === 100 ? page.docs.at(-1).id : null });
          }
          const pair = [sourceId, survivorId].sort();
          if (!pair.every(id) || pair[0] === pair[1]) throw fail(400, 'invalid_request');
          const ref = saved.doc(digest(pair));
          if (action === 'restore') tx.delete(ref);
          else {
            const rows = await Promise.all(pair.map((cid) => tx.get(db.doc(contactPath(uid, cid)))));
            if (!rows.every((row) => row.exists && !frozen(row.data()))) throw fail(409, 'contact_unavailable');
            tx.set(ref, { pair, version: 1, fingerprint: fingerprint(rows), updated_at: timestamp() });
          }
          return json(200, { pair });
        }
        if (action === 'redirect') {
          if (!id(sourceId)) throw fail(400, 'invalid_request');
          let next = sourceId;
          const seen = new Set();
          while (!seen.has(next) && seen.size < 8) {
            seen.add(next);
            const marker = (await tx.get(db.doc(`contact_hub_retired/${uid}/contacts/${next}`))).data();
            if (!marker) {
              const target = await tx.get(db.doc(contactPath(uid, next)));
              return json(200, { survivorId: seen.size > 1 && target.exists && !frozen(target.data()) ? next : null });
            }
            if (!id(marker.merged_into)) break;
            next = marker.merged_into;
          }
          return json(200, { survivorId: null });
        }
        const priorSnapshot = op ? await tx.get(op) : null;
        const prior = priorSnapshot?.data();
        if (action === 'status') return json(200, { receipt: prior?.receipt ?? null });
        if (action === 'preview_rollback' || action === 'rollback') {
          if (!prior || !op) throw fail(404, 'merge_missing');
          if (prior.receipt.status === 'rolled_back') return json(200, { receipt: prior.receipt });
          if (prior.rollbackUntil <= now()) throw fail(409, 'rollback_expired');
          const recovery = (await tx.get(op.collection('recovery').doc('state'))).data();
          if (!recovery) throw fail(409, 'rollback_changed');
          const checked = await Promise.all(recovery.expected.map((entry) => tx.get(db.doc(entry.path))));
          const match = checked.every((snap, index) => {
            const expected = recovery.expected[index];
            if (expected.absent) return !snap.exists;
            return snap.exists && version(snap) === (expected.version || version(priorSnapshot)) && digest(snap.data()) === expected.hash;
          });
          const a = db.doc(contactPath(uid, prior.receipt.survivorId));
          const b = db.doc(contactPath(uid, prior.receipt.sourceId));
          const survivorChildren = await tx.get(a.collection('timeline').limit(301));
          const sourceChildren = await tx.get(b.collection('timeline').limit(301));
          const relations = await readMergeRelationships(tx, db, uid, [a, b]);
          const queueHash = digest(relations.map(({ queue }) => queue.docs.map((row) => row.ref.path).sort()));
          const future = await inventoryBlockers(tx, db, uid, [a, b]);
          const sent = await tx.get(db.collection(`contact_hub_gmail_limits/${uid}/attempts`).where('status', '==', 'sent').limit(301));
          if (sent.docs.length >= 301 || sent.docs.some((row) => {
            const data = row.data();
            const at = data.createdAt?.toMillis?.();
            return (!data.contactId || [a.id, b.id].includes(data.contactId)) && (!Number.isFinite(at) || at >= prior.committedAt);
          })) future.add('external_side_effect');
          if (!match || future.size || (recovery.queueHash && recovery.queueHash !== queueHash) || digest(survivorChildren.docs.map((row) => row.ref.path).sort()) !== recovery.timelineHash
            || digest(sourceChildren.docs.map((row) => [row.id, version(row), digest(row.data())])) !== recovery.sourceTimelineHash) throw fail(409, 'rollback_changed');
          const hash = digest([operationId, recovery.expected, 'rollback']);
          if (action === 'preview_rollback') return json(200, { token: tokenFor(uid, 'rollback', hash), receipt: prior.receipt });
          if (!executionEnabled()) throw fail(403, 'execution_disabled');
          checkToken(input, uid, 'rollback', hash);
          tx.set(a, recovery.survivor);
          tx.set(b, recovery.source);
          for (const item of recovery.relationships ?? []) {
            if (item.before) tx.set(db.doc(item.path), item.before);
            else tx.delete(db.doc(item.path));
          }
          for (const path of recovery.created) tx.delete(db.doc(path));
          const receipt = { ...prior.receipt, status: 'rolled_back' };
          tx.update(op, { receipt });
          return json(200, { receipt });
        }
        if (!['preview', 'commit'].includes(action) || !id(survivorId) || !id(sourceId) || sourceId === survivorId
          || (action === 'commit' && !op) || !input.choices || Array.isArray(input.choices) || typeof input.choices !== 'object') throw fail(400, 'invalid_request');
        const identityConfirmed = input.identityConfirmed === true;
        if (identityConfirmed && !uuid(operationId)) throw fail(400, 'invalid_request');
        const requestHash = digest([survivorId, sourceId, input.choices, identityConfirmed, identityConfirmed ? operationId : null]);
        if (prior && action === 'commit') {
          if (prior.requestHash !== requestHash) throw fail(409, 'operation_conflict');
          return json(200, { receipt: prior.receipt });
        }
        const a = db.doc(contactPath(uid, survivorId));
        const b = db.doc(contactPath(uid, sourceId));
        const marker = db.doc(`contact_hub_retired/${uid}/contacts/${sourceId}`);
        const [left, right, retirement, from, into, blockers] = await Promise.all([
          tx.get(a), tx.get(b), tx.get(marker), tx.get(b.collection('timeline').limit(301)), tx.get(a.collection('timeline').limit(301)),
          inventoryBlockers(tx, db, uid, [a, b]),
        ]);
        if (!left.exists || !right.exists || retirement.exists || frozen(left.data()) || frozen(right.data())) throw fail(409, 'contact_unavailable');
        if ([left, right].some((row) => row.data().lead_owner && row.data().lead_owner !== uid)) throw fail(403, 'read_only');
        const names = (await Promise.all([inspectCollections(a), inspectCollections(b)])).flat();
        if (names.some((name) => !['timeline', 'private'].includes(name))) blockers.add('unclassified_child_records');
        const related = await readMergeRelationships(tx, db, uid, [a, b]);
        const plan = applyPlan(left.data(), right.data(), input.choices, blockers, related.some(({ photo }) => photo.exists), identityConfirmed);
        const relationships = planMergeRelationships({ current: [left.data(), right.data()], related,
          merged: plan.merged, choose: plan.choose, blockers, canonical, now, survivorId });
        const unresolved = plan.conflicts.some(({ key, options }) => !Number.isInteger(input.choices[key])
          || input.choices[key] < 0 || input.choices[key] >= options.length);
        const addresses = [...new Set(emails(plan.merged).map(({ value }) => normalizeEmail(value)))];
        if (addresses.some((address) => address.includes('/'))) blockers.add('email_permission_requires_review');
        const restrictions = await Promise.all(addresses.filter((address) => !address.includes('/')).map((address) =>
          tx.get(db.doc(`emailSuppressionList/${address}`))));
        const suppressed = restrictions.filter((row) => row.exists).map((row) => row.id);
        if (suppressed.length) plan.merged.contact_hub_email_suppressed = suppressed;
        const sourceRows = from.docs.map((row) => [row.id, version(row), digest(row.data())]);
        const targetRows = into.docs.map((row) => [row.id, version(row), digest(row.data())]);
        const dependencyRows = related.flatMap(({ photo, queue }) => [
          [photo.ref.path, photo.exists ? version(photo) : null],
          ...queue.docs.map((row) => [row.ref.path, version(row)]),
        ]);
        const hash = digest([requestHash, version(left), version(right), sourceRows, targetRows, dependencyRows,
          restrictions.map((row) => [row.id, row.exists ? version(row) : null])]);
        const reserved = new Set(into.docs.map((row) => row.id));
        const writes = from.docs.map((row) => {
          const targetId = reserved.has(row.id) ? `merge-${digest([sourceId, row.id]).slice(0, 40)}` : row.id;
          if (targetId !== row.id && reserved.has(targetId)) blockers.add('timeline_collision');
          reserved.add(targetId);
          return [a.collection('timeline').doc(targetId), { ...row.data(), contact_hub_merge_origin: { contact_id: sourceId, event_id: row.id } }];
        });
        if (writes.length + relationships.writes.length + 8 > 300
          || Buffer.byteLength(canonical(relationships.writes.map(({ before, after }) => [before, after]))) > 400_000 || into.docs.length >= 301
          || Buffer.byteLength(canonical([left.data(), right.data(), plan.merged])) > 120_000
          || writes.some(([, data]) => Buffer.byteLength(canonical(data)) > 256 * 1024)
          || Buffer.byteLength(canonical(writes.map(([, data]) => data))) > 3 * 1024 * 1024) blockers.add('plan_limit');
        if (action === 'preview') return json(200, { conflicts: plan.conflicts, blockers: [...blockers], activityCount: writes.length + into.docs.length,
          combined: { name: plan.merged.name ?? null, emails: emails(plan.merged).map((row) => ({ ...row, primary: normalizeEmail(row.value) === normalizeEmail(plan.merged.email) })), phones: readContactPhones(plan.merged).map((row) => ({ ...row, primary: phoneDisplay(row) === plan.merged.phone })), notes: plan.merged.notes, stickers: plan.merged.sticker_ids.map((stickerId) => ({ id: stickerId, assignment: plan.merged.sticker_assignments?.[stickerId] ?? null })), affiliations: plan.affiliations, sources: plan.merged.identity_sources, sourceHistory: [sourceHistoryFor(left.data(), survivorId), sourceHistoryFor(right.data(), sourceId)], suppressedEmails: suppressed },
          token: !unresolved && !blockers.size ? tokenFor(uid, 'commit', hash) : null });
        if (!executionEnabled()) throw fail(403, 'execution_disabled');
        if (unresolved || blockers.size) throw fail(409, 'merge_blocked');
        checkToken(input, uid, 'commit', hash);
        const retired = { ...right.data(), is_archived: true, contact_hub_lifecycle: { status: 'retired', operation_id: operationId, merged_into: survivorId } };
        const merged = { ...plan.merged, contact_hub_merge_origin: { source_id: sourceId, operation_id: operationId,
          previous_original: { url: left.data().photo_url ?? null, source: left.data().photo_source ?? null },
          previous_assignments: left.data().sticker_assignments ?? {}, previous_emails: emails(left.data()),
          sticker_assignment_provenance: { [survivorId]: left.data().sticker_assignments ?? {}, [sourceId]: right.data().sticker_assignments ?? {} },
          source_provenance: [sourceHistoryFor(left.data(), survivorId), sourceHistoryFor(right.data(), sourceId)],
          previous_source: left.data().source ?? null, previous_fields: Object.fromEntries(fields.filter((key) => nonempty(left.data()[key])).map((key) => [key, left.data()[key]])),
          previous_phone_facts: readContactPhones(left.data()) } };
        const markerData = { merged_into: survivorId, operation_id: operationId, retired_at: timestamp() };
        const receipt = { operationId, survivorId, sourceId, status: 'merged', rollbackUntil: now() + WEEK };
        tx.set(a, merged);
        tx.set(b, retired);
        tx.set(marker, markerData);
        for (const [ref, data] of writes) tx.set(ref, data);
        const committedRelations = relationships.writes.map(({ ref, before, after }) => ({
          ref, before, after: after && ref.path.endsWith('/private/photo') ? { ...after, updatedAt: timestamp() } : after,
        }));
        for (const { ref, after } of committedRelations) {
          if (after) tx.set(ref, after);
          else tx.delete(ref);
        }
        const archives = relationships.photos.flatMap((photo, index) => photo
          ? [[op.collection('photo').doc(index === 0 ? 'survivor' : 'source'), photo]] : []);
        for (const [ref, photo] of archives) tx.set(ref, photo);
        const expected = [[a, merged], [b, retired], [marker, markerData], ...writes, ...archives].map(([ref, data]) => ({ path: ref.path, hash: digest(data) }));
        expected.push(...into.docs.map((row) => ({ path: row.ref.path, hash: digest(row.data()), version: version(row) })));
        expected.push(...committedRelations.map(({ ref, after }) => after
          ? { path: ref.path, hash: digest(after) } : { path: ref.path, absent: true }));
        if (related[1].photo.exists) expected.push({ path: related[1].photo.ref.path,
          hash: digest(related[1].photo.data()), version: version(related[1].photo) });
        const futureQueue = related.flatMap(({ queue }) => queue.docs.map((row) => row.ref.path)).sort();
        tx.set(op.collection('recovery').doc('state'), {
          survivor: left.data(), source: right.data(), expected, sourceTimelineHash: digest(sourceRows),
          created: [marker.path, ...writes.map(([ref]) => ref.path), ...archives.map(([ref]) => ref.path)],
          relationships: committedRelations.map(({ ref, before }) => ({ path: ref.path, before })),
          queueHash: digest([futureQueue, []]),
          timelineHash: digest([...into.docs.map((row) => row.ref.path), ...writes.map(([ref]) => ref.path)].sort()),
        });
        tx.set(op, { requestHash, receipt, committedAt: now(), rollbackUntil: receipt.rollbackUntil,
          identityConfirmation: identityConfirmed ? { actorUid: uid, confirmedAt: timestamp(), contactIds: [survivorId, sourceId], versions: [version(left), version(right)] } : null });
        return json(200, { receipt });
      });
    } catch (error) {
      return json(error.http ?? (error instanceof SyntaxError ? 400 : 503), { error: error.code ?? 'unavailable' });
    }
  };
}

async function inventoryBlockers(tx, db, uid, people) {
  const blockers = new Set();
  const probes = people.flatMap((contact) => [
    ...['scheduledEngagements', 'barryQueue', 'notifications'].map((name) => ['unsupported_worker_reference',
      db.collection(`users/${uid}/${name}`).where('contactId', '==', contact.id).limit(1)]),
    ...['barry_drafts', 'barry_analysis', 'relationship_context', 'barry_sessions', 'barry_attributions', 'stageHistory', 'outcomeLog'].map((name) =>
      ['unsupported_worker_history', contact.collection(name).limit(1)]),
  ]);
  probes.push(...['waves', 'cadences'].map((name) => ['unsupported_outreach_scope', db.collection(`users/${uid}/${name}`).limit(1)]));
  const workerQueue = await tx.get(db.collection('barry_processing_queue').where('idynifyUserId', '==', uid).limit(301));
  if (workerQueue.docs.length >= 301 || workerQueue.docs.some((row) => people.some((contact) => contact.id === row.data().contactId))) {
    blockers.add('unsupported_worker_reference');
  }
  const attempts = await tx.get(db.collection(`contact_hub_gmail_limits/${uid}/attempts`).where('status', 'in', ['sending', 'unknown']).limit(301));
  if (attempts.docs.length >= 301 || attempts.docs.some((row) => !row.data().contactId || people.some((contact) => contact.id === row.data().contactId))) {
    blockers.add('unresolved_gmail_attempt');
  }
  await Promise.all(probes.map(async ([reason, query]) => {
    if (!(await tx.get(query)).empty) blockers.add(reason);
  }));
  return blockers;
}
