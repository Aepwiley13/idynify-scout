/**
 * icpAttribution — which ICP does this reply belong to, and which ICPs does this
 * person belong to?
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DERIVATION ONLY. Nothing here writes, and nothing reads it yet.         ║
 * ║  Sprint 3's cutover is what makes these answers visible.                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── WHY ATTRIBUTION IS DERIVED AND NEVER STORED ───────────────────────────
 * A stored attribution would have to be written when the reply arrives — which
 * is ADR-006's territory, and ADR-006 has exactly one writer by design. It would
 * also be a second copy of a fact both sides already imply, and two sprints of
 * this programme have been spent removing that exact class of duplicate. This
 * reads two immutable sources and therefore cannot drift from either:
 *
 *   relationship_events   the reply happened          (ADR-006, one writer)
 *   cadence enrollment    the outreach was sent       (Sprint 2 stamps the ICP)
 *   join on              (idynifyUserId, gmailThreadId)
 *
 * ─── THE THREE HONEST OUTCOMES ─────────────────────────────────────────────
 * Measured against production before this was written: 45 of 55 enrollment rows
 * carry a thread id, and 1 of 39 threads appears in two cadences. So the
 * unattributable cases are not hypothetical, and neither is guessed at.
 *
 *   ATTRIBUTED    exactly one enrollment matches the thread
 *   AMBIGUOUS     several match, under different ICPs — reported, never
 *                 resolved by a tie-break nobody agreed to
 *   UNATTRIBUTED  none match: no thread id was captured, the outreach was a
 *                 mission or a manual send, or the reply has no originating
 *                 engagement at all
 */

/** What a reply's ICP attribution can be. */
export const ATTRIBUTION = Object.freeze({
  ATTRIBUTED: 'attributed',
  AMBIGUOUS: 'ambiguous',
  UNATTRIBUTED: 'unattributed',
});

/** How a person came to be associated with an ICP. */
export const ASSOCIATION = Object.freeze({
  DIRECT: 'direct',
  INHERITED: 'inherited',
});

/**
 * Attribute one reply to the ICP its originating engagement was sent under.
 *
 * @param {object} reply        A relationship_event. Needs gmailThreadId.
 * @param {object[]} enrollments  Candidate cadence enrollment rows, each
 *   `{ cadenceId, contactId, gmailThreadId, icpId, icpCriteriaVersionId, sentAt }`.
 * @returns {{status, icpId, icpCriteriaVersionId, cadenceId, reason, candidates}}
 */
export function attributeReply(reply = {}, enrollments = []) {
  const thread = reply?.gmailThreadId ?? null;

  const none = (reason) => ({
    status: ATTRIBUTION.UNATTRIBUTED,
    icpId: null, icpCriteriaVersionId: null, cadenceId: null,
    reason, candidates: [],
  });

  if (!thread) return none('reply-has-no-thread-id');

  // Same person, same thread. contactId is checked when both sides have one —
  // a thread is per-conversation, but two enrollments can share it.
  const matches = enrollments.filter(e =>
    e
    && e.gmailThreadId === thread
    && (!reply.contactId || !e.contactId || e.contactId === reply.contactId)
  );

  if (matches.length === 0) return none('no-enrollment-carries-this-thread');

  // An enrollment with no ICP stamped cannot attribute anything. It is not a
  // weaker match — it is an absence, and absence is Unattributed.
  const stamped = matches.filter(e => e.icpId);
  if (stamped.length === 0) return none('enrollment-carries-no-icp');

  const distinctIcps = [...new Set(stamped.map(e => e.icpId))];
  if (distinctIcps.length > 1) {
    return {
      status: ATTRIBUTION.AMBIGUOUS,
      icpId: null, icpCriteriaVersionId: null, cadenceId: null,
      reason: `thread spans ${distinctIcps.length} ICPs`,
      // Everything a review surface needs to let a human decide. Deliberately
      // NOT resolved here: picking the earliest or latest send would be a
      // tie-break nobody agreed to, and decision 6 already ruled that out for
      // ambiguous company identity.
      candidates: stamped.map(e => ({
        cadenceId: e.cadenceId ?? null,
        icpId: e.icpId,
        icpCriteriaVersionId: e.icpCriteriaVersionId ?? null,
        sentAt: e.sentAt ?? null,
      })),
    };
  }

  const hit = stamped[0];
  return {
    status: ATTRIBUTION.ATTRIBUTED,
    icpId: hit.icpId,
    icpCriteriaVersionId: hit.icpCriteriaVersionId ?? null,
    cadenceId: hit.cadenceId ?? null,
    reason: 'single-enrollment-match',
    candidates: [],
  };
}

/**
 * Every ICP a person is associated with, direct and inherited, always labelled.
 *
 * ─── WHY BOTH, AND WHY ALWAYS LABELLED ─────────────────────────────────────
 * "People from ICP X" includes inherited members by default — otherwise the
 * list is missing everyone whose company matched but who was never individually
 * evaluated, which is most of them. But LIST MEMBERSHIP MUST NEVER IMPLY THAT
 * DIRECT EVALUATION HAPPENED. So the label travels with the association rather
 * than being reconstructed by the caller, and a caller cannot render one without
 * having been handed the other.
 *
 * Direct is RECORDED history: a relationship row written when this person was
 * actually encountered or decided under that ICP. Inherited is DERIVED live from
 * the company's relationships — which is what keeps it current while direct
 * stays historical (decision 5).
 *
 * @param {object[]} personRelationships   relationships where subjectType is person
 * @param {object[]} companyRelationships  relationships for that person's company
 * @returns {{icpId, association, state, via}[]} deduped, direct winning over inherited
 */
export function personIcpAssociations(personRelationships = [], companyRelationships = [], { companyId = null } = {}) {
  const out = new Map();

  for (const r of companyRelationships) {
    if (!r?.icpId) continue;
    out.set(r.icpId, {
      icpId: r.icpId,
      association: ASSOCIATION.INHERITED,
      state: r.state ?? null,
      via: companyId ?? r.subjectId ?? null,
    });
  }

  // Direct overwrites inherited for the same ICP: if we actually evaluated this
  // person, that is the stronger and more honest statement.
  for (const r of personRelationships) {
    if (!r?.icpId) continue;
    out.set(r.icpId, {
      icpId: r.icpId,
      association: ASSOCIATION.DIRECT,
      state: r.state ?? null,
      via: null,
    });
  }

  return [...out.values()];
}

/** True when the only thing linking this person to the ICP is their employer. */
export function isInheritedOnly(associations = [], icpId) {
  const a = associations.find(x => x.icpId === icpId);
  return !!a && a.association === ASSOCIATION.INHERITED;
}

/**
 * Roll replies into a per-ICP summary, with the unattributable share reported
 * rather than hidden.
 *
 * A reply rate that quietly drops its unattributable denominator is a number
 * that flatters itself, which is why both counts come back.
 */
export function summarizeAttribution(results = []) {
  const byIcp = {};
  let ambiguous = 0, unattributed = 0;

  for (const r of results) {
    if (r.status === ATTRIBUTION.ATTRIBUTED) byIcp[r.icpId] = (byIcp[r.icpId] ?? 0) + 1;
    else if (r.status === ATTRIBUTION.AMBIGUOUS) ambiguous++;
    else unattributed++;
  }

  const attributed = Object.values(byIcp).reduce((a, n) => a + n, 0);
  return {
    byIcp,
    attributed,
    ambiguous,
    unattributed,
    total: results.length,
    // The share a reply-rate-by-ICP chart must show alongside its bars.
    unattributableShare: results.length
      ? +(((ambiguous + unattributed) / results.length) * 100).toFixed(1)
      : 0,
  };
}

export default {
  ATTRIBUTION,
  ASSOCIATION,
  attributeReply,
  personIcpAssociations,
  isInheritedOnly,
  summarizeAttribution,
};
