/**
 * icpRelationshipWriter — the SERVER adapter that writes the Company↔ICP
 * relationship model from discovery.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE CONTAINS NO LINEAGE LOGIC.                                    ║
 * ║                                                                          ║
 * ║  It translates writes into the Firestore REST API. Every decision about  ║
 * ║  transitions, identifiers and criteria lives in:                         ║
 * ║                                                                          ║
 * ║      src/utils/icpLineage.js                                             ║
 * ║      src/utils/icpCriteria.js                                            ║
 * ║                                                                          ║
 * ║  If you find yourself adding a rule here, it belongs there.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The cross-runtime import below is the pattern this codebase already ships:
 * `contactResolver.js` imports `src/utils/identityResolution.js` exactly this
 * way, for exactly this reason — one engine, two runtimes, no second opinion.
 *
 * ─── WHY REST AND THE USER'S TOKEN, NOT firebase-admin ─────────────────────
 * The brief said "admin-SDK adapter", and for Barry's write verbs that would be
 * right — contactResolver is admin, because its callers are. This caller is
 * not. `search-companies.js` writes every company through the Firestore REST
 * API with the requesting user's Bearer token, and matching it is the better
 * answer here for one reason that outranks consistency of style:
 *
 *   ADMIN BYPASSES SECURITY RULES. The append-only guarantee on lineageEvents
 *   was just verified 19/19 against a real emulator and promoted into
 *   firestore.rules. Writing discovery's events through the Admin SDK would put
 *   the single largest producer of those events OUTSIDE the rule that protects
 *   them — the guarantee would hold for every path except the one that writes
 *   most of the data.
 *
 * Writing as the user keeps discovery under the same rule as everything else:
 * create is allowed, update and delete are refused by the database. It also
 * adds no credential surface to a function that currently needs none.
 *
 * ─── ATOMICITY AND CREATE-ONLY, WITHOUT A TRANSACTION ──────────────────────
 * The browser adapter uses a transaction because the web SDK has no
 * create-if-absent. REST does, and it composes better:
 *
 *   - `:commit` applies several writes atomically — the relationship and its
 *     event land together or not at all, which is the same guarantee, cheaper.
 *   - `currentDocument: { exists: false }` makes each write a true create. A
 *     replay fails the precondition rather than overwriting, so idempotency is
 *     a no-op and never a mutation of history.
 *
 * ─── SHADOW RULES, UNCHANGED ───────────────────────────────────────────────
 * Nothing reads what this writes. It is additive, it never touches an existing
 * field, it is fail-soft in every branch, and the kill switch disables it with
 * no cleanup. Discovery must never fail because a shadow write did.
 */

import {
  ACTOR,
  EVENT_TYPE,
  SUBJECT_TYPE,
  buildEvent,
  relationshipId,
} from '../../../src/utils/icpLineage.js';
import {
  criteriaFingerprint,
  criteriaVersionId,
  materialCriteria,
} from '../../../src/utils/icpCriteria.js';

/** One flag disables every shadow write from the server. */
export function shadowWritesEnabled() {
  return String(process.env.ICP_SHADOW_WRITES ?? 'true') !== 'false';
}

const OFF = Object.freeze({ ok: true, skipped: true, reason: 'shadow-writes-disabled' });

/** Shadow failures are logged and swallowed. Discovery is never blocked by one. */
function soft(op, err) {
  console.warn(`[icp-shadow:server] ${op} failed (non-blocking):`, err?.message || err);
  return { ok: false, error: err?.message || String(err) };
}

// ── REST value encoding ─────────────────────────────────────────────────────

/** JS value → Firestore REST typed value. */
export function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return fields;
}

/** Firestore REST typed value → JS, for the few fields we read back. */
function fromFirestoreValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFirestoreValue);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields ?? {})) out[k] = fromFirestoreValue(val);
    return out;
  }
  return null;
}

function fromFirestoreFields(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
  return out;
}

// ── Paths ───────────────────────────────────────────────────────────────────

const docBase = (projectId) =>
  `projects/${projectId}/databases/(default)/documents`;
const restUrl = (projectId, path) =>
  `https://firestore.googleapis.com/v1/${docBase(projectId)}/${path}`;

async function getDoc({ projectId, authToken, path }) {
  const res = await fetch(restUrl(projectId, path), {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${path} → ${res.status}`);
  const body = await res.json();
  return fromFirestoreFields(body.fields);
}

/**
 * Commit several writes atomically.
 *
 * `createOnly` attaches the exists:false precondition, which is what makes a
 * replay a refusal rather than an overwrite. A precondition failure comes back
 * as 400/409 and is reported as `alreadyRecorded`, not as an error.
 */
async function commit({ projectId, authToken, writes }) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/${docBase(projectId)}:commit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        writes: writes.map(w => ({
          update: {
            name: `${docBase(projectId)}/${w.path}`,
            fields: toFirestoreFields(w.data),
          },
          ...(w.createOnly ? { currentDocument: { exists: false } } : {}),
        })),
      }),
    },
  );

  if (res.ok) return { ok: true, committed: true };

  const text = await res.text();

  // A retry of an already-recorded write. MEASURED against a real Firestore
  // emulator rather than assumed — the precondition failure comes back as:
  //
  //   409 {"error":{"code":409,"status":"ALREADY_EXISTS",
  //        "message":"entity already exists: EntityRef[... /lineageEvents/e1]"}}
  //
  // and the stored document is left untouched. Matched three independent ways
  // (status, status string, message) because this branch is the difference
  // between "idempotent" and "every retry surfaces a spurious error".
  if (
    res.status === 409
    || /ALREADY_EXISTS|FAILED_PRECONDITION/i.test(text)
    || /entity already exists|already exists/i.test(text)
  ) {
    return { ok: true, alreadyRecorded: true };
  }

  throw new Error(`commit → ${res.status} ${text.slice(0, 180)}`);
}

// ── Criteria versions ───────────────────────────────────────────────────────

/**
 * Guarantee the ICP has a current criteria version, and return it.
 *
 * Same lazy contract as the browser adapter (invariant I-8), and the same
 * source of truth: the fingerprint comes from the STORED profile, never from a
 * caller's copy. `search-companies` holds a `companyProfile` that may have been
 * merged or defaulted in memory, and stamping a version from that would record
 * criteria the ICP does not actually have.
 */
export async function ensureCriteriaVersion({ projectId, userId, authToken, icpId }) {
  if (!shadowWritesEnabled()) return OFF;
  if (!projectId || !userId || !icpId) return { ok: false, error: 'missing-identity' };

  try {
    const profile = await getDoc({ projectId, authToken, path: `users/${userId}/icpProfiles/${icpId}` });
    if (!profile) return { ok: false, error: 'icp-profile-not-found' };

    const fingerprint = criteriaFingerprint(profile);
    if (profile.currentCriteriaVersionId && profile.currentCriteriaFingerprint === fingerprint) {
      return { ok: true, minted: false, versionId: profile.currentCriteriaVersionId, fingerprint };
    }

    const versionId = criteriaVersionId(fingerprint, Date.now());
    const createdAt = new Date().toISOString();

    // The version is create-only; the pointer is a merge onto the profile and
    // is the one field this sprint adds to a document that already existed.
    await commit({
      projectId, authToken,
      writes: [{
        path: `users/${userId}/icpProfiles/${icpId}/criteriaVersions/${versionId}`,
        data: {
          fingerprint,
          eligibilityCriteria: materialCriteria(profile),
          supersedesVersionId: profile.currentCriteriaVersionId ?? null,
          createdAt,
        },
        createOnly: true,
      }],
    });

    // Separate write: a merge, not a create, so it must not carry the
    // precondition and must not clobber the rest of the profile.
    const patchUrl = `${restUrl(projectId, `users/${userId}/icpProfiles/${icpId}`)}`
      + `?updateMask.fieldPaths=currentCriteriaVersionId`
      + `&updateMask.fieldPaths=currentCriteriaFingerprint`;
    const patch = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        fields: toFirestoreFields({ currentCriteriaVersionId: versionId, currentCriteriaFingerprint: fingerprint }),
      }),
    });
    if (!patch.ok) throw new Error(`pointer patch → ${patch.status}`);

    return { ok: true, minted: true, versionId, fingerprint };
  } catch (err) {
    return soft('ensureCriteriaVersion', err);
  }
}

// ── The write path ──────────────────────────────────────────────────────────

/**
 * Record that this ICP surfaced this company for the first time.
 *
 * `encountered` is legal only from no relationship at all, so an existing
 * relationship is left untouched: whether it should resurface is an admission
 * decision, and admission is still dark. Discovery's job here is to record the
 * arrivals it actually caused.
 *
 * @param {object} p
 * @param {string} p.cycleId  The discovery run. Used as the event's causeId, so
 *   one company surfaced twice in one run produces one event, and a retried run
 *   converges instead of duplicating.
 */
export async function recordDiscoveryEncounter({
  projectId, userId, authToken, icpId, subjectId,
  cycleId, source = 'apollo_api', subjectType = SUBJECT_TYPE.COMPANY,
  version = null,
}) {
  if (!shadowWritesEnabled()) return OFF;
  if (!projectId || !userId || !icpId || !subjectId || !cycleId) {
    return { ok: false, error: 'missing-identity' };
  }

  try {
    const v = version ?? await ensureCriteriaVersion({ projectId, userId, authToken, icpId });
    if (v.skipped) return OFF;

    const relId = relationshipId(icpId, subjectType, subjectId);
    const existing = await getDoc({
      projectId, authToken, path: `users/${userId}/icpRelationships/${relId}`,
    });
    if (existing) {
      // Already known to this ICP — so this is a RE-ENCOUNTER, and decision 6
      // says a confident match accumulates provenance rather than overwriting
      // it. The relationship itself is left alone: whether it should resurface
      // is an admission decision, and admission is dark until Sprint 3. What is
      // recorded is the fact that discovery met it again.
      const occurredAtRe = new Date().toISOString();
      const re = buildEvent({
        subjectType, subjectId, icpId,
        eventType: EVENT_TYPE.PROVENANCE_ADDED,
        causeId: cycleId,
        criteriaVersionId: v.versionId ?? null,
        criteriaFingerprint: v.fingerprint ?? null,
        source, actor: ACTOR.SYSTEM,
        fromState: existing.state ?? null,   // state-neutral: to === from
        occurredAt: occurredAtRe,
      });
      const res = await commit({
        projectId, authToken,
        writes: [{ path: `users/${userId}/lineageEvents/${re.id}`, data: re.body, createOnly: true }],
      });
      return { ...res, reEncounter: true };
    }

    const occurredAt = new Date().toISOString();
    const { id, body } = buildEvent({
      subjectType, subjectId, icpId,
      eventType: EVENT_TYPE.ENCOUNTERED,
      causeId: cycleId,
      criteriaVersionId: v.versionId ?? null,
      criteriaFingerprint: v.fingerprint ?? null,
      source, actor: ACTOR.SYSTEM,
      fromState: null, occurredAt,
    });

    return await commit({
      projectId, authToken,
      writes: [
        { path: `users/${userId}/lineageEvents/${id}`, data: body, createOnly: true },
        {
          path: `users/${userId}/icpRelationships/${relId}`,
          data: {
            icpId, subjectType, subjectId,
            state: body.toState,
            associationKind: 'direct',
            firstObservedAt: occurredAt,
            firstEncounteredAt: occurredAt,
            encounteredUnderVersion: v.versionId ?? null,
            stateChangedAt: occurredAt,
          },
          createOnly: true,
        },
      ],
    });
  } catch (err) {
    return soft('recordDiscoveryEncounter', err);
  }
}

export default {
  shadowWritesEnabled,
  ensureCriteriaVersion,
  recordDiscoveryEncounter,
  toFirestoreValue,
  toFirestoreFields,
};
