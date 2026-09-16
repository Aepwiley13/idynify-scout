/**
 * icpRelationshipService — the browser adapter that writes the Company↔ICP
 * relationship model.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SHADOW WRITES. Nothing in Sprint 1 READS what this writes.              ║
 * ║  Legacy fields stay authoritative; the read cutover is Sprint 3.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The decision engine is runtime-independent and lives in utils/icpLineage.js
 * and utils/icpCriteria.js — the same split Gate 2 established, so a Netlify
 * function can reach the same answers without the web SDK.
 *
 * THREE RULES THIS FILE EXISTS TO ENFORCE
 * ───────────────────────────────────────
 * 1. LEGACY FIRST, SHADOW SECOND, AND SHADOW NEVER FAILS THE USER.
 *    Every function here is fail-soft: it logs and returns a result, and never
 *    throws into a caller whose legacy write has already committed. A shadow
 *    failure leaves shadow behind, which is safe because nothing reads it. The
 *    reverse — shadow ahead of legacy — is prevented by call order and is
 *    invariant I-11.
 *
 * 2. RELATIONSHIP AND EVENT COMMIT TOGETHER.
 *    Both are written in one transaction, so they cannot diverge from each
 *    other. That removes a whole failure class rather than detecting it later.
 *
 * 3. EVENTS ARE CREATED, NEVER WRITTEN OVER.
 *    The transaction reads the event id first and no-ops if it already exists.
 *    "Idempotent" here means a true no-op — never an overwrite of a differing
 *    payload onto the same id, which would be a mutation of history and is what
 *    invariant I-5 forbids. Firestore rules are meant to make this structural
 *    as well; see the note in firestore.rules about why that needs a deliberate
 *    deploy rather than riding along with this sprint.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  ACTOR,
  EVENT_TYPE,
  SUBJECT_TYPE,
  buildEvent,
  eventId,
  relationshipId,
  isDecision,
} from '../utils/icpLineage';
import {
  criteriaFingerprint,
  criteriaVersionId,
  materialCriteria,
} from '../utils/icpCriteria';

// ── Kill switch ─────────────────────────────────────────────────────────────

/**
 * One flag disables every shadow write. Because nothing reads them, flipping it
 * off is safe at any moment and needs no cleanup — which is the point of
 * shipping the model dark before anything depends on it.
 */
let shadowWritesEnabled = (() => {
  try {
    const v = import.meta?.env?.VITE_ICP_SHADOW_WRITES;
    return v === undefined ? true : String(v) !== 'false';
  } catch {
    return true;
  }
})();

export function setShadowWritesEnabled(on) { shadowWritesEnabled = !!on; }
export function areShadowWritesEnabled() { return shadowWritesEnabled; }

const OFF = Object.freeze({ ok: true, skipped: true, reason: 'shadow-writes-disabled' });

// ── Paths ───────────────────────────────────────────────────────────────────

const relationshipsRef = (uid) => collection(db, 'users', uid, 'icpRelationships');
const eventsRef = (uid) => collection(db, 'users', uid, 'lineageEvents');
const versionsRef = (uid, icpId) => collection(db, 'users', uid, 'icpProfiles', icpId, 'criteriaVersions');
const icpProfileRef = (uid, icpId) => doc(db, 'users', uid, 'icpProfiles', icpId);
const exclusionRef = (uid, subjectType, subjectId) =>
  doc(db, 'users', uid, 'exclusions', `${subjectType}__${subjectId}`);

/** Shadow failures are logged, never surfaced, never thrown. */
function soft(op, err) {
  console.warn(`[icp-shadow] ${op} failed (non-blocking):`, err?.code || '', err?.message || err);
  return { ok: false, error: err?.message || String(err) };
}

// ── Criteria versions ───────────────────────────────────────────────────────

/**
 * Guarantee the ICP has a current criteria version, and return it.
 *
 * Invariant I-8 forbids a relationship under an ICP with no version. This is
 * deliberately LAZY rather than a bulk pass over every existing profile: the
 * approved initialization is bounded, and doing it on first touch means no
 * migration script ever runs against production. An ICP that is never used
 * never gets a version, which is correct — nothing references it.
 *
 * Idempotent: an unchanged fingerprint mints nothing and returns what exists.
 */
export async function ensureCriteriaVersion(userId, icpId, profileOverride = null) {
  if (!shadowWritesEnabled) return OFF;
  if (!userId || !icpId) return { ok: false, error: 'missing-identity' };

  try {
    const profileSnap = await getDoc(icpProfileRef(userId, icpId));
    const current = profileSnap.exists() ? profileSnap.data() : null;

    // The fingerprint is taken from the STORED profile, not from a copy the
    // caller happened to be holding. Screens load `icpList` once on mount, so
    // an in-memory profile can be behind an edit made without leaving the page
    // (Barry refinement, the reclarification modal) — and stamping a version
    // from a stale copy would record criteria the user had already changed.
    // `profileOverride` exists for tests and for a caller that has just written
    // the profile itself and knows its own payload is current.
    const source = profileOverride ?? current;
    if (!source) return { ok: false, error: 'icp-profile-not-found' };
    const fingerprint = criteriaFingerprint(source);

    // Fast path: the pointer is present and the criteria have not moved.
    if (current?.currentCriteriaVersionId && current?.currentCriteriaFingerprint === fingerprint) {
      return { ok: true, minted: false, versionId: current.currentCriteriaVersionId, fingerprint };
    }

    // Slow path: confirm against the stored version before minting, so a
    // missing pointer on an unchanged profile does not create a duplicate.
    if (current?.currentCriteriaVersionId) {
      const existing = await getDoc(doc(versionsRef(userId, icpId), current.currentCriteriaVersionId));
      if (existing.exists() && existing.data()?.fingerprint === fingerprint) {
        return { ok: true, minted: false, versionId: current.currentCriteriaVersionId, fingerprint };
      }
    }

    const createdAt = new Date().toISOString();
    const versionId = criteriaVersionId(fingerprint, Date.now());

    await runTransaction(db, async (tx) => {
      const vRef = doc(versionsRef(userId, icpId), versionId);
      const vSnap = await tx.get(vRef);
      const pSnap = await tx.get(icpProfileRef(userId, icpId));
      const previousId = pSnap.exists() ? (pSnap.data()?.currentCriteriaVersionId ?? null) : null;

      if (!vSnap.exists()) {
        // Immutable once written — see the create-only rule in the header.
        tx.set(vRef, {
          fingerprint,
          eligibilityCriteria: materialCriteria(source),
          supersedesVersionId: previousId,
          createdAt,
        });
      }
      // Additive pointer on an existing document. The only write this sprint
      // makes to a document that already existed, and it replaces nothing.
      tx.set(
        icpProfileRef(userId, icpId),
        { currentCriteriaVersionId: versionId, currentCriteriaFingerprint: fingerprint },
        { merge: true },
      );
    });

    return { ok: true, minted: true, versionId, fingerprint };
  } catch (err) {
    return soft('ensureCriteriaVersion', err);
  }
}

// ── The one write path ──────────────────────────────────────────────────────

/**
 * Apply one event to one relationship, atomically.
 *
 * Reads happen before writes, as Firestore transactions require: the
 * relationship (for `fromState`) and the event id (for the create-only check).
 *
 * @returns {{ok: boolean, recorded?: boolean, alreadyRecorded?: boolean, state?: string}}
 */
async function applyEvent({
  userId,
  subjectType = SUBJECT_TYPE.COMPANY,
  subjectId,
  icpId,
  eventType,
  causeId,
  source = null,
  actor = ACTOR.USER,
  versionId = null,
  fingerprint = null,
  extraRelationshipFields = {},
}) {
  if (!shadowWritesEnabled) return OFF;
  if (!userId || !subjectId || !icpId || !causeId) {
    return { ok: false, error: 'missing-identity' };
  }

  try {
    const relId = relationshipId(icpId, subjectType, subjectId);
    const relRef = doc(relationshipsRef(userId), relId);
    const occurredAt = new Date().toISOString();

    // The id depends only on scope, type and cause — never on current state —
    // so existence can be checked BEFORE the transition is validated. That
    // order matters: a retry of an already-applied event must be a no-op, and
    // validating first would instead reject it as an illegal transition
    // (accepting an already-accepted relationship) and leave the caller with a
    // spurious failure for a write that had in fact succeeded.
    const evtRef = doc(eventsRef(userId), eventId({ icpId, subjectType, subjectId, eventType, causeId }));

    return await runTransaction(db, async (tx) => {
      const evtSnap = await tx.get(evtRef);
      const relSnap = await tx.get(relRef);
      const existing = relSnap.exists() ? relSnap.data() : null;
      const fromState = existing?.state ?? null;

      if (evtSnap.exists()) {
        // Already recorded. A true no-op — never an overwrite.
        return { ok: true, alreadyRecorded: true, state: fromState };
      }

      // buildEvent refuses an illegal transition before anything is written.
      const { body } = buildEvent({
        subjectType, subjectId, icpId, eventType, causeId,
        criteriaVersionId: versionId,
        criteriaFingerprint: fingerprint,
        source, actor, fromState, occurredAt,
      });

      tx.set(evtRef, body);

      const relationshipPatch = {
        icpId,
        subjectType,
        subjectId,
        state: body.toState,
        stateChangedAt: occurredAt,
        // firstObservedAt is when THIS system first saw the relationship.
        // firstEncounteredAt and encounteredUnderVersion are set only by a real
        // `encountered` event — a relationship opened by a decision leaves them
        // null, because we did not witness the encounter and will not claim to.
        firstObservedAt: existing?.firstObservedAt ?? occurredAt,
        ...(eventType === EVENT_TYPE.ENCOUNTERED
          ? {
              firstEncounteredAt: existing?.firstEncounteredAt ?? occurredAt,
              encounteredUnderVersion: existing?.encounteredUnderVersion ?? versionId,
            }
          : {}),
        associationKind: existing?.associationKind ?? 'direct',
        ...extraRelationshipFields,
      };

      // I-3: decidedUnderVersion/Fingerprint exist iff the state is a decision.
      if (isDecision(eventType)) {
        relationshipPatch.decidedUnderVersion = versionId;
        relationshipPatch.decidedUnderFingerprint = fingerprint;
      } else if (eventType === EVENT_TYPE.RECONSIDERED || eventType === EVENT_TYPE.RESURFACED) {
        relationshipPatch.decidedUnderVersion = null;
        relationshipPatch.decidedUnderFingerprint = null;
      }

      tx.set(relRef, relationshipPatch, { merge: true });
      return { ok: true, recorded: true, state: body.toState };
    });
  } catch (err) {
    return soft(`applyEvent:${eventType}`, err);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Discovery surfaced this subject for this ICP for the first time. */
export async function recordEncounter({ userId, subjectId, icpId, profile, causeId, source = 'apollo_api', subjectType = SUBJECT_TYPE.COMPANY }) {
  const version = await ensureCriteriaVersion(userId, icpId, profile ?? null);
  if (version.skipped) return OFF;
  return applyEvent({
    userId, subjectType, subjectId, icpId,
    eventType: EVENT_TYPE.ENCOUNTERED,
    causeId, source, actor: ACTOR.SYSTEM,
    versionId: version.versionId ?? null,
    fingerprint: version.fingerprint ?? null,
  });
}

/**
 * The user accepted or rejected this subject under this ICP.
 *
 * Called AFTER the legacy write has committed — rule 1 in the header. The
 * caller passes the ICP it was actually deciding under, never the globally
 * active one.
 */
export async function recordDecision({ userId, subjectId, icpId, profile, accepted, causeId, source = null, subjectType = SUBJECT_TYPE.COMPANY }) {
  const version = await ensureCriteriaVersion(userId, icpId, profile ?? null);
  if (version.skipped) return OFF;
  return applyEvent({
    userId, subjectType, subjectId, icpId,
    eventType: accepted ? EVENT_TYPE.ACCEPTED : EVENT_TYPE.REJECTED,
    causeId, source, actor: ACTOR.USER,
    versionId: version.versionId ?? null,
    fingerprint: version.fingerprint ?? null,
  });
}

/**
 * The user passed for now.
 *
 * `skippedInCycle` is what stops the subject returning inside the run it was
 * skipped in; the client additionally drops `skipped` relationships from the
 * queue render, so it cannot reappear within the session either.
 */
export async function recordSkip({ userId, subjectId, icpId, profile, causeId, cycleId, source = null, subjectType = SUBJECT_TYPE.COMPANY }) {
  const version = await ensureCriteriaVersion(userId, icpId, profile ?? null);
  if (version.skipped) return OFF;
  return applyEvent({
    userId, subjectType, subjectId, icpId,
    eventType: EVENT_TYPE.SKIPPED,
    causeId, source, actor: ACTOR.USER,
    versionId: version.versionId ?? null,
    fingerprint: version.fingerprint ?? null,
    extraRelationshipFields: { skippedInCycle: cycleId ?? null },
  });
}

/** A skipped subject returned, or a rejection became eligible again. */
export async function recordResurface({ userId, subjectId, icpId, profile, causeId, reconsidered = false, subjectType = SUBJECT_TYPE.COMPANY }) {
  const version = await ensureCriteriaVersion(userId, icpId, profile ?? null);
  if (version.skipped) return OFF;
  return applyEvent({
    userId, subjectType, subjectId, icpId,
    eventType: reconsidered ? EVENT_TYPE.RECONSIDERED : EVENT_TYPE.RESURFACED,
    causeId, actor: ACTOR.SYSTEM,
    versionId: version.versionId ?? null,
    fingerprint: version.fingerprint ?? null,
    extraRelationshipFields: { skippedInCycle: null },
  });
}

// ── People (Sprint 2) ───────────────────────────────────────────────────────

/**
 * A person, surfaced by an ICP-driven search.
 *
 * Only two write paths genuinely carry ICP context — post-accept auto-discovery
 * and the People tab. LinkedIn Link, Find Contacts, CSV and manual adds have no
 * ICP in scope and deliberately create NO association rather than a guessed one:
 * an absent association is the honest record that nobody evaluated this person
 * against an ICP.
 *
 * `subjectId` is the contact's Firestore document id, which ADR-002 makes
 * canonical and which is stable across the composite `{companyId}_{personId}`
 * ids the Apollo paths produce.
 */
export async function recordPersonEncounter({ userId, contactId, icpId, causeId, source }) {
  return recordEncounter({
    userId, icpId, causeId, source,
    subjectId: contactId,
    subjectType: SUBJECT_TYPE.PERSON,
  });
}

/** The user saved this person to engage (accepted) or archived them (rejected). */
export async function recordPersonDecision({ userId, contactId, icpId, accepted, causeId, source }) {
  return recordDecision({
    userId, icpId, accepted, causeId, source,
    subjectId: contactId,
    subjectType: SUBJECT_TYPE.PERSON,
  });
}

/**
 * The user passed on this person for now.
 *
 * People-mode skip already has legacy semantics keyed on a DATE
 * (`people_mode_skipped` + `skipped_date`), so the cycle recorded here is that
 * same day marker rather than a discovery run. The two sides then agree about
 * what "comes back later" means instead of inventing a second notion of it.
 */
export async function recordPersonSkip({ userId, contactId, icpId, causeId, cycleId, source }) {
  return recordSkip({
    userId, icpId, causeId, cycleId, source,
    subjectId: contactId,
    subjectType: SUBJECT_TYPE.PERSON,
  });
}

// ── Reads (for tests, reconciliation and Sprint 3 — not wired to any screen) ─

export async function getRelationship(userId, icpId, subjectId, subjectType = SUBJECT_TYPE.COMPANY) {
  try {
    const snap = await getDoc(doc(relationshipsRef(userId), relationshipId(icpId, subjectType, subjectId)));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    soft('getRelationship', err);
    return null;
  }
}

export async function getRelationshipsForIcp(userId, icpId, state = null) {
  try {
    const clauses = [where('icpId', '==', icpId)];
    if (state) clauses.push(where('state', '==', state));
    const snap = await getDocs(query(relationshipsRef(userId), ...clauses));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    soft('getRelationshipsForIcp', err);
    return [];
  }
}

export async function isExcluded(userId, subjectId, subjectType = SUBJECT_TYPE.COMPANY) {
  try {
    const snap = await getDoc(exclusionRef(userId, subjectType, subjectId));
    return snap.exists() && snap.data()?.active === true;
  } catch (err) {
    soft('isExcluded', err);
    return false;
  }
}

/** Events for one relationship, ordered — the input to replay (I-12). */
export async function getRelationshipEvents(userId, icpId, subjectId, subjectType = SUBJECT_TYPE.COMPANY) {
  try {
    const snap = await getDocs(query(
      eventsRef(userId),
      where('subjectId', '==', subjectId),
      where('icpId', '==', icpId),
      limit(500),
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => (e.subjectType ?? SUBJECT_TYPE.COMPANY) === subjectType)
      .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  } catch (err) {
    soft('getRelationshipEvents', err);
    return [];
  }
}

export default {
  recordPersonEncounter,
  recordPersonDecision,
  recordPersonSkip,
  setShadowWritesEnabled,
  areShadowWritesEnabled,
  ensureCriteriaVersion,
  recordEncounter,
  recordDecision,
  recordSkip,
  recordResurface,
  getRelationship,
  getRelationshipsForIcp,
  getRelationshipEvents,
  isExcluded,
};
