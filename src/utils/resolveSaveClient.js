/**
 * RESOLVE_SAVE / LINK CLIENT — the only place the UI talks to Gate 2.
 *
 * Thin by design. It builds the request envelope, calls the endpoint, and hands
 * the response back unchanged. It contains NO identity logic: it does not decide
 * whether someone already exists, does not rank candidates, does not normalise
 * identifiers, and does not invent ids. Every one of those belongs to the
 * resolver, and duplicating any of them here is how the two drift apart.
 *
 * Endpoints (Gate 2 Phase 3/4):
 *   POST /.netlify/functions/barryResolveSave
 *   POST /.netlify/functions/barryLink
 */

const RESOLVE_ENDPOINT = '/.netlify/functions/barryResolveSave';
const LINK_ENDPOINT = '/.netlify/functions/barryLink';

/**
 * The resolver rejects a candidate carrying any of these outright — a candidate
 * has no canonical identity, and supplying one would be the UI answering the
 * question the resolver exists to answer. Stripped here as a last line of
 * defence so a future caller cannot trip the 400 by accident.
 */
const FORBIDDEN_ON_CANDIDATE = ['contactId', 'contact_id', 'canonicalId', 'personId', 'id'];

function scrub(candidate) {
  const clean = { ...candidate };
  for (const f of FORBIDDEN_ON_CANDIDATE) delete clean[f];
  return clean;
}

async function post(endpoint, body) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const err = new Error(data?.error || `${endpoint} failed (${res.status})`);
    err.status = res.status;
    err.serverError = data?.error || null;
    throw err;
  }
  return data;
}

/**
 * RESOLVE_SAVE.
 *
 * @param {Object}   p
 * @param {string}   p.userId
 * @param {string}   p.authToken
 * @param {string}   p.operationId   SAME id for preview and commit — it is what
 *                                   bridges the two and makes a retry a no-op.
 * @param {Object[]} p.candidates    CandidatePayload[]
 * @param {Object}   [p.resolutions] { [clientRef]: contactId } — user's answers.
 *                                   contactId MUST have come from the candidates
 *                                   the resolver offered for that clientRef.
 * @param {boolean}  [p.commit]      false = preview (writes nothing)
 * @param {'user'|'barry'} [p.actor]
 * @returns {Promise<{success, operationId, committed, results, summary}>}
 */
export function resolveSave({ userId, authToken, operationId, candidates, resolutions = {}, commit = false, actor = 'user' }) {
  return post(RESOLVE_ENDPOINT, {
    userId,
    authToken,
    operationId,
    commit,
    actor,
    resolutions,
    candidates: candidates.map(scrub),
  });
}

/**
 * LINK — place already-canonical contacts into a workflow stage.
 *
 * A contact already at the target stage comes back `changed: false` with no
 * reason. That is a valid no-op, NOT a failure: LINK is a lens over the
 * canonical person, not a copy of them.
 *
 * @returns {Promise<{success, operationId, targetStage, results, summary}>}
 *          summary = { total, moved, alreadyThere, notFound }
 */
export function link({ userId, authToken, operationId, contactIds, targetStage, actor = 'user' }) {
  return post(LINK_ENDPOINT, { userId, authToken, operationId, contactIds, targetStage, actor });
}

/**
 * Report the FINAL STATE, not the number of writes.
 *
 * "I moved 20 contacts" is false when 10 were already there. What the user
 * cares about is where things ended up, so a full no-op still reads as success.
 */
export function linkSentence(summary, targetStage) {
  const place = targetStage.charAt(0).toUpperCase() + targetStage.slice(1);
  const ready = (summary.total || 0) - (summary.notFound || 0);
  if (ready === 0) return `I couldn't place any of those in ${place}.`;
  const base = ready === 1 ? `That one is now ready in ${place}.` : `All ${ready} are now ready in ${place}.`;
  return summary.notFound ? `${base} ${summary.notFound} I couldn't find.` : base;
}

export { RESOLVE_ENDPOINT, LINK_ENDPOINT };
