/**
 * icpLineage — the runtime-independent core of the Company↔ICP relationship model.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHAT HAPPENED and WHAT IS TRUE NOW ARE DIFFERENT OBJECTS.               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * WHY THIS EXISTS (Sprint 1A)
 * ───────────────────────────
 * A company's standing with an ICP used to be one scalar `status` field doing
 * two jobs at once: "what did the user decide" and "which ICP is this for".
 * One field cannot hold two ICPs' answers, so a company accepted under
 * Nonprofits was invisible to InKind, and a rejection blocked the organization
 * from every ICP forever. Worse, `icpId` was a live pointer into a mutable
 * profile: editing an ICP retroactively changed what the system believed had
 * caused a record to enter. Production carries a company discovered on 9 July
 * whose ICP document was created on 13 July and has since been renamed — the
 * system now reports, with no error, that a healthcare firm was found by a
 * credit-unions profile.
 *
 * So: a relationship is a record, its history is append-only, and the criteria
 * it was judged against are immutable. This module owns the parts of that with
 * no I/O — the vocabulary, the identifiers, the legal transitions and replay —
 * so the browser and a Netlify function cannot disagree about any of them.
 * Firestore access lives in the adapters, the same split Gate 2 established
 * between identityResolution.js and contactIdentityService.js.
 *
 * NOTHING HERE READS OR WRITES. It is pure by design and by test.
 */

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** What a relationship can be about. `person` is reserved for Sprint 2. */
export const SUBJECT_TYPE = Object.freeze({
  COMPANY: 'company',
  PERSON: 'person',
});

/**
 * The four states of a relationship.
 *
 * `skipped`, NOT `deferred`. A `deferred` status exists in production — ten
 * records — but it was written only by the original Scout Game Mode, whose
 * write path was deleted two days later by the pivot to bucket-based
 * engagement. Reusing the word would silently give those orphans the new
 * meaning, so the new state gets a new name.
 */
export const RELATIONSHIP_STATE = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
});

export const RELATIONSHIP_STATES = Object.freeze(Object.values(RELATIONSHIP_STATE));

/** Membership is exactly one state. There is no second signal to drift from it. */
export function isMember(state) {
  return state === RELATIONSHIP_STATE.ACCEPTED;
}

/**
 * Event types. The OUTCOME IS THE TYPE — there is deliberately no generic
 * `decided`, because a log that records only "a transition happened" cannot say
 * whether the user accepted, rejected or skipped, and in our semantics a skip
 * is explicitly not a decision. It must be readable in the log, never inferred
 * from the absence of a later event.
 */
export const EVENT_TYPE = Object.freeze({
  ENCOUNTERED: 'encountered',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
  RESURFACED: 'resurfaced',
  RECONSIDERED: 'reconsidered',
  PROVENANCE_ADDED: 'provenance_added',
  EXCLUDED: 'excluded',
  UNEXCLUDED: 'unexcluded',
});

export const EVENT_TYPES = Object.freeze(Object.values(EVENT_TYPE));

/** Who caused an event. A background write is never mistaken for a decision. */
export const ACTOR = Object.freeze({ USER: 'user', SYSTEM: 'system' });

// ── Identifiers ─────────────────────────────────────────────────────────────

const SEP = '__';
const GLOBAL_SCOPE = '_global';

/**
 * Reject a component that would make an id ambiguous or unparseable.
 *
 * Nothing ever parses an id back into parts — the fields are stored on the
 * document and every reader uses those — but a component containing the
 * separator would let two different triples produce the same id, which would
 * silently merge two relationships. That is worth refusing loudly.
 */
function assertIdComponent(value, label) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`icpLineage: ${label} is required to build an id`);
  }
  const s = String(value);
  if (s.includes(SEP)) {
    throw new Error(`icpLineage: ${label} may not contain "${SEP}" — got "${s}"`);
  }
  if (s.includes('/')) {
    throw new Error(`icpLineage: ${label} may not contain "/" — got "${s}"`);
  }
  return s;
}

/**
 * The relationship id: one document per (ICP, subject) pair.
 *
 * Deterministic so that a duplicate relationship is not expressible and a
 * replayed write converges instead of creating a second row.
 *
 * OWNERSHIP NEUTRALITY: no user or org id appears here. Ownership is carried by
 * the document path. Firestore paths are fixed at creation, so a future move to
 * org ownership would still need a storage migration to copy documents — but it
 * would move them, not re-derive their identity.
 */
export function relationshipId(icpId, subjectType, subjectId) {
  return [
    assertIdComponent(icpId, 'icpId'),
    assertIdComponent(subjectType, 'subjectType'),
    assertIdComponent(subjectId, 'subjectId'),
  ].join(SEP);
}

/**
 * The scope an event describes.
 *
 * ─── WHY THE ICP IS IN THE EVENT ID ────────────────────────────────────────
 * An id of {subjectId}__{eventType}__{causeId} has no ICP dimension, and that
 * is a silent history-loss bug waiting for multi-ICP. The concrete case is a
 * reconsider sweep: one criteria change makes the same company re-eligible
 * under two ICPs, both events are written from a single originating action, so
 * both derive the same causeId — and the two ids collide. One ICP's event
 * overwrites the other's, with no error and nothing to notice.
 *
 * Scoping to the relationship removes the collision by construction rather than
 * relying on every caller to mint distinct cause ids. Global events, which have
 * no ICP, carry an explicit `_global` scope so their shape is stated rather
 * than implied by a missing segment.
 */
export function eventScopeKey({ icpId = null, subjectType, subjectId }) {
  if (icpId) return relationshipId(icpId, subjectType, subjectId);
  return [
    GLOBAL_SCOPE,
    assertIdComponent(subjectType, 'subjectType'),
    assertIdComponent(subjectId, 'subjectId'),
  ].join(SEP);
}

/**
 * The event id. Deterministic, and unique per (scope, type, cause).
 *
 * `causeId` names the interaction or sweep that produced the event, so a retry
 * of the same action lands on the same id and is recognised as already
 * recorded. See the create-only rule in icpRelationshipService.
 */
export function eventId({ icpId = null, subjectType, subjectId, eventType, causeId }) {
  if (!EVENT_TYPES.includes(eventType)) {
    throw new Error(`icpLineage: unknown eventType "${eventType}"`);
  }
  return [
    eventScopeKey({ icpId, subjectType, subjectId }),
    eventType,
    assertIdComponent(causeId, 'causeId'),
  ].join(SEP);
}

// ── Transitions ─────────────────────────────────────────────────────────────

const { PENDING, ACCEPTED, REJECTED, SKIPPED } = RELATIONSHIP_STATE;

/**
 * The legal transitions, and the only ones.
 *
 * `from: null` means "no relationship yet". Two absences are deliberate:
 * there is no accepted → skipped (once something is a member, "not now" is
 * meaningless), and nothing deletes a relationship — a relationship that should
 * never have existed is still something that happened.
 */
export const TRANSITIONS = Object.freeze([
  { event: EVENT_TYPE.ENCOUNTERED, from: [null], to: PENDING },
  { event: EVENT_TYPE.ACCEPTED, from: [null, PENDING, ACCEPTED, REJECTED, SKIPPED], to: ACCEPTED },
  { event: EVENT_TYPE.REJECTED, from: [null, PENDING, ACCEPTED, REJECTED, SKIPPED], to: REJECTED },
  { event: EVENT_TYPE.SKIPPED, from: [null, PENDING], to: SKIPPED },
  { event: EVENT_TYPE.RESURFACED, from: [SKIPPED], to: PENDING },
  { event: EVENT_TYPE.RECONSIDERED, from: [REJECTED], to: PENDING },
]);

/**
 * ─── WHY A DECISION MAY OPEN A RELATIONSHIP FROM null ───────────────────────
 * The obvious table has only `encountered` leaving null, and that is right in a
 * world where every relationship starts with an observed encounter. Sprint 1 is
 * not that world: the shadow model goes live against a workspace that already
 * holds thousands of queued companies, and discovery's own shadow write is not
 * wired yet. A user swiping one of those has genuinely made a decision about a
 * relationship whose encounter this system never saw.
 *
 * There were two ways to handle it and only one of them is honest. Synthesising
 * an `encountered` event so the table stays tidy would fabricate a moment that
 * was never observed — the exact failure this programme exists to end. So a
 * decision may instead open the relationship directly, and the ABSENCE of an
 * `encountered` event is the record that we never saw the encounter.
 *
 * `resurfaced` and `reconsidered` keep their strict predecessors, because each
 * asserts a specific prior state rather than merely the first thing observed.
 *
 * ─── WHY A DECISION MAY RE-ASSERT THE STATE IT ALREADY HOLDS ───────────────
 * accepted → accepted looks like a no-op worth forbidding, and it is the shape
 * that lets the shadow model heal itself. Undo is NOT modelled in Sprint 1:
 * the legacy undo path sets a company back to pending and writes no event, so
 * after an undo the shadow relationship still reads `accepted` while the legacy
 * record reads `pending`. Allowing the next decision to re-assert converges the
 * two; forbidding it would leave the divergence permanent and make the
 * reconciler noisy with cases nothing can resolve.
 *
 * A re-assertion is still recorded as its own event with its own cause, so the
 * log says the user decided twice — which is what happened. The undo itself
 * remains unrecorded, and the reconciler will surface an un-followed undo as a
 * genuine divergence, which is the honest outcome until undo gets a vocabulary.
 */

/**
 * Events that record something without moving the relationship.
 *
 * They still write `fromState` and `toState`, as the same value. "No
 * transition" is stated, never implied by an empty column — the same principle
 * as the nullable icpId on provenance_added.
 */
export const STATE_NEUTRAL_EVENTS = Object.freeze([
  EVENT_TYPE.PROVENANCE_ADDED,
  EVENT_TYPE.EXCLUDED,
  EVENT_TYPE.UNEXCLUDED,
]);

export function isStateNeutral(eventType) {
  return STATE_NEUTRAL_EVENTS.includes(eventType);
}

/** Events that carry a decision, and so set decidedUnderVersion / Fingerprint. */
export const DECISION_EVENTS = Object.freeze([EVENT_TYPE.ACCEPTED, EVENT_TYPE.REJECTED]);

export function isDecision(eventType) {
  return DECISION_EVENTS.includes(eventType);
}

/**
 * The state an event produces, or a thrown error if the transition is illegal.
 *
 * @param {string|null} fromState  Current state, or null when no relationship exists.
 * @param {string} eventType
 * @returns {string|null} the resulting state (unchanged for state-neutral events)
 */
export function nextState(fromState, eventType) {
  if (!EVENT_TYPES.includes(eventType)) {
    throw new Error(`icpLineage: unknown eventType "${eventType}"`);
  }
  if (isStateNeutral(eventType)) return fromState ?? null;

  const rule = TRANSITIONS.find(t => t.event === eventType);
  if (!rule) throw new Error(`icpLineage: no transition defined for "${eventType}"`);

  const from = fromState ?? null;
  if (!rule.from.includes(from)) {
    throw new Error(
      `icpLineage: illegal transition — "${eventType}" from "${from}". ` +
      `Legal from: ${rule.from.map(String).join(' | ')}`
    );
  }
  return rule.to;
}

export function isLegalTransition(fromState, eventType) {
  try {
    nextState(fromState, eventType);
    return true;
  } catch {
    return false;
  }
}

// ── Replay ──────────────────────────────────────────────────────────────────

const toMillis = (v) => {
  if (!v) return 0;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return 0;
};

/**
 * Select the events that belong to ONE relationship, in order.
 *
 * ─── WHY REPLAY IS PER RELATIONSHIP, NOT PER SUBJECT ───────────────────────
 * "Replaying a subject's events reproduces its state" stops meaning anything
 * the moment a subject belongs to two ICPs — which is the entire point of this
 * sprint. A company can be accepted under Nonprofits, pending under InKind and
 * rejected under Food at the same time; interleaving those three histories
 * produces a state that was never true of any of them.
 *
 * So replay is scoped to (subjectType, subjectId, icpId). Global events and any
 * event with a null icpId are excluded: they are subject-scoped facts, they
 * never change relationship state, and including them would let an exclusion
 * appear to be part of one ICP's history.
 */
export function eventsForRelationship(events, { subjectType, subjectId, icpId }) {
  return events
    .filter(e =>
      e
      && e.icpId === icpId
      && e.subjectId === subjectId
      && (e.subjectType ?? SUBJECT_TYPE.COMPANY) === subjectType
    )
    .slice()
    .sort((a, b) => toMillis(a.occurredAt) - toMillis(b.occurredAt));
}

/**
 * Replay one relationship's events and return the state they produce.
 *
 * This is invariant I-12 made executable: the log alone answers what a
 * relationship is, without reading the mutable `state` field back. If this ever
 * disagrees with the stored state, the log is right and the state is a bug.
 *
 * @param {object[]} events   Any set of events; foreign ones are filtered out.
 * @param {object} scope      { subjectType, subjectId, icpId }
 * @param {object} [options]
 * @param {boolean} [options.strict=true]  Throw on an illegal transition, or on
 *   an event whose recorded fromState contradicts the replayed one. Off only
 *   for diagnostics over historical data.
 * @returns {string|null} the resulting state, or null if nothing applies.
 */
export function replayRelationship(events, scope, { strict = true } = {}) {
  const ordered = eventsForRelationship(events, scope);
  let state = null;

  for (const e of ordered) {
    if (strict && e.fromState !== undefined && (e.fromState ?? null) !== state) {
      throw new Error(
        `icpLineage: event "${e.eventType}" records fromState "${e.fromState}" ` +
        `but replay is at "${state}" — the log contradicts itself`
      );
    }
    const produced = nextState(state, e.eventType);
    if (strict && e.toState !== undefined && (e.toState ?? null) !== produced) {
      throw new Error(
        `icpLineage: event "${e.eventType}" records toState "${e.toState}" ` +
        `but the transition produces "${produced}"`
      );
    }
    state = produced;
  }
  return state;
}

/**
 * Build the event body for a transition.
 *
 * Both endpoints are always written, including when they are equal — see
 * STATE_NEUTRAL_EVENTS. The caller supplies time and provenance; this decides
 * the transition and refuses an illegal one before anything reaches Firestore.
 */
export function buildEvent({
  subjectType,
  subjectId,
  icpId = null,
  eventType,
  causeId,
  criteriaVersionId = null,
  criteriaFingerprint = null,
  source = null,
  actor = ACTOR.SYSTEM,
  fromState = null,
  occurredAt,
}) {
  const toState = nextState(fromState, eventType);
  return {
    id: eventId({ icpId, subjectType, subjectId, eventType, causeId }),
    body: {
      subjectType,
      subjectId,
      icpId,
      eventType,
      fromState: fromState ?? null,
      toState: toState ?? null,
      causeId,
      criteriaVersionId,
      criteriaFingerprint,
      source,
      actor,
      occurredAt,
    },
  };
}

export default {
  SUBJECT_TYPE,
  RELATIONSHIP_STATE,
  RELATIONSHIP_STATES,
  EVENT_TYPE,
  EVENT_TYPES,
  ACTOR,
  TRANSITIONS,
  STATE_NEUTRAL_EVENTS,
  DECISION_EVENTS,
  isMember,
  isStateNeutral,
  isDecision,
  relationshipId,
  eventScopeKey,
  eventId,
  nextState,
  isLegalTransition,
  eventsForRelationship,
  replayRelationship,
  buildEvent,
};
