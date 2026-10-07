/**
 * csvImportService — the Firestore half of the Scout+ CSV contact import.
 *
 * Two calls, matching the two screens:
 *
 *   previewCsvImport   resolve every READY row against the workspace with the
 *                      canonical identity guard. No writes. The user sees what
 *                      will be created, what already exists, and what was
 *                      flagged, BEFORE anything is written.
 *
 *   commitCsvImport    write it: create the new contacts, merge new identifiers
 *                      onto the existing ones, tag every one of them with the
 *                      import's group tag.
 *
 * WHAT THIS DELIBERATELY REUSES
 * ─────────────────────────────
 *   prepareContactWrite        the one dedupe engine — no second one here
 *   mergeIdentifiers           its additive, never-clobber merge rules
 *   ensureCompanyForContact    the one company resolver, same as Add Manually
 *   buildUserAddedContact      the same document Add Manually writes
 *
 * FAILURE IS PER ROW
 * ──────────────────
 * The old upload resolved and merged inside one loop around one batch, so a
 * single IdentityConflictError on row 30 threw out of the loop after rows 1–29
 * had already merged, and the user saw "Failed to upload" with no way to tell
 * what had been written. Here every row's resolution and every merge is its
 * own try/catch, creates are committed in chunks, and the result lists exactly
 * which rows failed and why. Nothing one row does can abort another.
 */

import { arrayUnion, collection, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';
import { prepareContactWrite } from './contactWriteGuard';
import { createWebAdapter, mergeIdentifiers } from './contactIdentityService';
import { ensureCompanyForContact, NAME_SOURCE } from './companyIdentityService';
import { IdentityConflictError } from '../utils/identityResolution';
import { buildUserAddedContact } from '../schemas/userAddedContact';
import { buildImportTag, ROW_STATUS, toIdentityCandidate, isHiddenFromPeople } from '../utils/csvContactImport';

/** Resolution outcome for a READY row, set by previewCsvImport. */
export const PREVIEW_OUTCOME = Object.freeze({
  NEW: 'new',               // will be created
  REVIEW: 'review',         // will be created, flagged as a possible duplicate (name + company)
  EXISTING: 'existing',     // already in IDYNIFY — identifiers merged, included in the group
  EMAIL_CONFLICT: 'email_conflict', // already in IDYNIFY, matched by phone/LinkedIn/Apollo, but the CSV
                                    // email differs from the stored one — imported into the group with
                                    // the stored email untouched, and NOT handed to a cadence
  CONFLICT: 'conflict',     // two existing records share an identifier — not imported
  DUPLICATE: 'duplicate',   // resolves to the same existing contact as an earlier row
  LOOKUP_FAILED: 'lookup_failed', // could not check for duplicates — not imported (fails closed)
});

/** Outcomes that will be written by commitCsvImport. */
export const IMPORTABLE_OUTCOMES = Object.freeze([
  PREVIEW_OUTCOME.NEW, PREVIEW_OUTCOME.REVIEW, PREVIEW_OUTCOME.EXISTING, PREVIEW_OUTCOME.EMAIL_CONFLICT,
]);

/** Outcomes that merge onto an existing contact rather than create one. */
const MATCHED_OUTCOMES = Object.freeze([PREVIEW_OUTCOME.EXISTING, PREVIEW_OUTCOME.EMAIL_CONFLICT]);

const SIGNAL_LABELS = Object.freeze({
  linkedin_url: 'LinkedIn URL',
  phone: 'phone',
  apollo_person_id: 'Apollo ID',
  firestore_id: 'contact ID',
});

const normEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '') || null;

/** The address IDYNIFY would send to for an existing contact. */
function storedEmailOf(existing) {
  return normEmail(existing?.email) || normEmail(existing?.work_email) || normEmail(existing?.email_normalized);
}

/**
 * An existing contact matched on something OTHER than email, whose stored
 * email differs from the one in the CSV.
 *
 * The merge rules never overwrite an email, so a cadence would go to the
 * stored address — not the one in the file the user is looking at. Which is
 * right is a question only the user can answer, so this is surfaced, the
 * stored email is left alone, and the contact is kept out of the cadence
 * hand-off until someone resolves it in People.
 *
 * @returns {null | { signal: string, signalLabel: string, csvEmail: string, storedEmail: string }}
 */
export function detectEmailConflict(row, decision) {
  if (decision?.action !== 'merge') return null;
  const signal = decision.resolution?.signal;
  if (!signal || signal === 'email') return null;
  const csvEmail = normEmail(row.contact?.email);
  const storedEmail = storedEmailOf(decision.existing);
  if (!csvEmail || !storedEmail || csvEmail === storedEmail) return null;
  return { signal, signalLabel: SIGNAL_LABELS[signal] ?? signal, csvEmail, storedEmail };
}

/** Firestore allows 500 writes per batch; stay well under it. */
export const CREATE_BATCH_SIZE = 400;

/** Resolution concurrency. Each row is a handful of indexed equality reads. */
const PREVIEW_CONCURRENCY = 5;

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Resolve every READY row against the workspace.
 *
 * Returns the same rows with `outcome` (one of PREVIEW_OUTCOME) and, for rows
 * that resolve, the `decision` from prepareContactWrite. Non-READY rows pass
 * through untouched.
 *
 * ONE adapter for the whole file: the fallback scan window is loaded at most
 * once per import instead of once per new row.
 */
export async function previewCsvImport(userId, rows, { onProgress } = {}) {
  const adapter = createWebAdapter(userId);
  const ready = rows.filter((r) => r.status === ROW_STATUS.READY);
  let done = 0;

  const resolved = await mapWithConcurrency(ready, PREVIEW_CONCURRENCY, async (row) => {
    let out;
    try {
      const decision = await prepareContactWrite(userId, toIdentityCandidate(row.contact), {
        source: 'CSVUpload.contacts',
        adapter,
      });
      let outcome = PREVIEW_OUTCOME.NEW;
      const emailConflict = detectEmailConflict(row, decision);
      if (emailConflict) outcome = PREVIEW_OUTCOME.EMAIL_CONFLICT;
      else if (decision.action === 'merge') outcome = PREVIEW_OUTCOME.EXISTING;
      else if (decision.resolution?.requiresReview) outcome = PREVIEW_OUTCOME.REVIEW;
      out = {
        ...row,
        outcome,
        decision,
        ...(emailConflict ? {
          emailConflict,
          reason: `${row.contact.name}: matched by ${emailConflict.signalLabel}. CSV email ${emailConflict.csvEmail} ≠ IDYNIFY email ${emailConflict.storedEmail}. Imported without changing the email; not added to cadences until resolved in People`,
        } : {}),
      };
    } catch (err) {
      if (err instanceof IdentityConflictError) {
        out = {
          ...row,
          outcome: PREVIEW_OUTCOME.CONFLICT,
          reason: `${err.contactIds?.length ?? 2} existing contacts share this ${err.signal?.replace('_', ' ') ?? 'identifier'} — resolve them in People first`,
        };
      } else {
        console.error('[csv-import] duplicate check failed for row', row.rowNumber, err);
        out = {
          ...row,
          outcome: PREVIEW_OUTCOME.LOOKUP_FAILED,
          reason: 'Could not check this row for duplicates — try the import again',
        };
      }
    }
    done += 1;
    onProgress?.(done, ready.length);
    return out;
  });

  // Two rows with different identifiers can still resolve to the SAME existing
  // contact (row 3 by email, row 9 by phone). Merging both is harmless, but
  // counting both would report one person as two.
  const claimed = new Map();
  for (const r of resolved) {
    if (!MATCHED_OUTCOMES.includes(r.outcome)) continue;
    const id = r.decision.contactId;
    if (claimed.has(id)) {
      r.outcome = PREVIEW_OUTCOME.DUPLICATE;
      r.reason = `Same existing contact as row ${claimed.get(id)}`;
    } else {
      claimed.set(id, r.rowNumber);
    }
  }

  const byRow = new Map(resolved.map((r) => [r.rowNumber, r]));
  return rows.map((r) => byRow.get(r.rowNumber) ?? r);
}

/** Counts per preview outcome (READY rows only). */
export function summarizePreview(rows) {
  const counts = Object.fromEntries(Object.values(PREVIEW_OUTCOME).map((o) => [o, 0]));
  for (const r of rows) if (r.outcome) counts[r.outcome] += 1;
  return counts;
}

function makeBatchId(now) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `csv_${now.getTime()}_${rand}`;
}

/** A CSV note, in the shape StickyNotes reads and writes (`contact.notes[]`). */
function csvNote(content, batchId, iso) {
  return { id: `${batchId}_note`, content, created_at: iso, updated_at: iso, source: 'csv_import' };
}

/**
 * Write the import.
 *
 * @param {string} userId
 * @param {Array} previewRows   the output of previewCsvImport
 * @param {object} options
 * @param {string} options.importName   user-facing name for the group tag
 * @param {string} [options.fileName]
 * @param {Date}   [options.now]
 * @param {Function} [options.onProgress]  (done, total)
 *
 * @returns {Promise<{
 *   batchId: string,
 *   tag: string,
 *   created: object[],   new contacts, as written, each with `id`
 *   updated: object[],   existing contacts now in the group, each with `id`.
 *                        `_emailConflict` marks one whose CSV email differs
 *                        from the stored one; `_archived` marks one hidden
 *                        from the standard People view.
 *   failed: Array<{rowNumber: number, reason: string}>,
 * }>}
 */
export async function commitCsvImport(userId, previewRows, {
  importName, fileName = null, now = new Date(), onProgress,
} = {}) {
  const iso = now.toISOString();
  const batchId = makeBatchId(now);
  const tag = buildImportTag(importName, now);
  const contactsRef = collection(db, 'users', userId, 'contacts');

  const importable = previewRows.filter((r) => IMPORTABLE_OUTCOMES.includes(r.outcome));
  const created = [];
  const updated = [];
  const failed = [];
  let done = 0;
  const tick = () => { done += 1; onProgress?.(done, importable.length); };

  // One company resolution per distinct company name. Fifty rows from one
  // company resolve it once, and the company it creates for row 1 is the one
  // row 2 links to — not a second record minted a millisecond later.
  const companyCache = new Map();
  async function companyFor(contact) {
    const name = contact.company?.trim() || '';
    const key = name ? `name:${name.toLowerCase()}` : null;
    if (key && companyCache.has(key)) return companyCache.get(key);
    let companyId = null;
    try {
      ({ companyId } = await ensureCompanyForContact(userId, {
        name: name || null,
        email: contact.email || null,
      }, {
        source: 'csv_import',
        // The user supplied this name in their file. Enrichment may not overwrite it.
        nameSource: NAME_SOURCE.USER,
      }));
    } catch (err) {
      // A company is enrichment, not identity. The contact is still imported.
      console.warn('[csv-import] company resolution failed — contact imported without company', err?.message);
    }
    if (key) companyCache.set(key, companyId);
    return companyId;
  }

  const provenance = {
    import_method: 'csv',
    import_batch_id: batchId,
    import_name: importName || null,
    import_file_name: fileName,
  };

  // ── Existing contacts: merge identifiers, join the group ──────────────────
  for (const row of importable.filter((r) => MATCHED_OUTCOMES.includes(r.outcome))) {
    try {
      const { contactId, existing } = row.decision;
      const candidate = { ...toIdentityCandidate(row.contact) };
      // An email conflict never touches the stored address: not `email`, and
      // not `email_normalized` either — mergeIdentifiers rewrites the
      // normalized form for any email it is given, which would leave the
      // record's email and its normalized form naming two different people.
      if (row.emailConflict) candidate.email = null;
      // Fill a missing company the same way Add Manually would; never replace one.
      if (!existing?.company_id && (row.contact.company || row.contact.email)) {
        const companyId = await companyFor(row.contact);
        if (companyId) candidate.company_id = companyId;
      }
      // Fill-only enrichment details the merge rules allow (location is an
      // identifier-class field there); canonical fields like name and title
      // are never touched.
      if (row.contact.location || row.contact.state) {
        candidate.location = row.contact.location || row.contact.state;
      }
      const patch = mergeIdentifiers(existing, candidate);
      const write = {
        ...patch,
        tags: arrayUnion(tag),
        last_import_batch_id: batchId,
        updated_at: iso,
      };
      const existingNotes = Array.isArray(existing?.notes) ? existing.notes : [];
      if (row.contact.notes && !existingNotes.some((n) => n?.content === row.contact.notes)) {
        write.notes = arrayUnion(csvNote(row.contact.notes, batchId, iso));
      }
      await updateDoc(doc(db, 'users', userId, 'contacts', contactId), write);
      const existingTags = Array.isArray(existing?.tags) ? existing.tags : [];
      updated.push({
        ...existing,
        ...patch,
        id: contactId,
        tags: existingTags.includes(tag) ? existingTags : [...existingTags, tag],
        _rowNumber: row.rowNumber,
        // In-session flags for the success screen and the cadence hand-off.
        ...(row.emailConflict ? { _emailConflict: row.emailConflict } : {}),
        ...(isHiddenFromPeople(existing) ? { _archived: true } : {}),
      });
    } catch (err) {
      console.error('[csv-import] merge failed for row', row.rowNumber, err);
      failed.push({ rowNumber: row.rowNumber, reason: 'Could not update the existing contact' });
    }
    tick();
  }

  // ── New contacts: build, then commit in chunks ────────────────────────────
  const pending = [];
  for (const row of importable.filter((r) => !MATCHED_OUTCOMES.includes(r.outcome))) {
    const c = row.contact;
    const companyId = (c.company || c.email) ? await companyFor(c) : null;
    const extra = {
      ...provenance,
      first_name: c.first_name || null,
      last_name: c.last_name || null,
      industry: c.industry || null,
      state: c.state || null,
      location: c.location || c.state || null,
      tags: [tag],
    };
    if (c.notes) extra.notes = [csvNote(c.notes, batchId, iso)];
    const record = buildUserAddedContact({
      identityFields: row.decision.fields,
      person: c,
      companyId,
      source: 'csv_import',
      addedFrom: 'csv',
      extra,
      now: iso,
    });
    pending.push({ row, ref: doc(contactsRef), record });
  }

  for (let i = 0; i < pending.length; i += CREATE_BATCH_SIZE) {
    const chunk = pending.slice(i, i + CREATE_BATCH_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(({ ref, record }) => batch.set(ref, record));
    try {
      await batch.commit();
      chunk.forEach(({ row, ref, record }) => created.push({ ...record, id: ref.id, _rowNumber: row.rowNumber }));
    } catch (err) {
      console.error('[csv-import] batch commit failed', err);
      chunk.forEach(({ row }) => failed.push({ rowNumber: row.rowNumber, reason: 'Could not save this contact' }));
    }
    chunk.forEach(tick);
  }

  console.info('[csv-import] complete', {
    batchId, tag, created: created.length, updated: updated.length, failed: failed.length,
  });

  return { batchId, tag, created, updated, failed };
}

export default { previewCsvImport, commitCsvImport, summarizePreview, PREVIEW_OUTCOME };
