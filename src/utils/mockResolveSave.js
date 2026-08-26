/**
 * MOCKED RESOLVE_SAVE — stands in for Team A's barryResolveSave until it exists.
 *
 * ⚠️  MOCK. Delete on wiring. It defines NOTHING except the response SHAPE and
 * the conversational rhythm around it. It must not become a second resolver:
 *   · it does not decide identity — verdicts are canned
 *   · it does not read or write Firestore
 *   · it does not normalise identifiers
 *
 * SHAPE IS TAKEN VERBATIM FROM docs/GATE2_CANDIDATE_CONTRACT.md so that wiring
 * the real endpoint is a call-site swap and nothing above it changes.
 *
 *   POST /.netlify/functions/barryResolveSave
 *   { userId, authToken, operationId, actor, commit, candidates[] }
 *
 *   → { success, operationId, results: [{ clientRef, outcome, contactId,
 *       matchedOn, existingName, candidates[] }], summary }
 */

/** Contract outcomes. Only `matched` and `created` are ever written on commit. */
export const OUTCOME = {
  MATCHED: 'matched',      // resolved on an authoritative signal
  CREATED: 'created',      // true zero-match
  AMBIGUOUS: 'ambiguous',  // weak name+company signal only — ASK
  REFUSED: 'refused',      // 2+ existing records share an authoritative id — fail closed
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

/** operationId bridges preview → commit. Client-generated, per the contract. */
export function mintOperationId() {
  return (globalThis.crypto?.randomUUID?.())
    || `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {Object[]} candidates CandidatePayload[]
 * @returns {Promise<{success:boolean, operationId:string, results:Array, summary:Object}>}
 */
export async function mockResolveSaveDryRun(candidates, { latencyMs = 900, operationId } = {}) {
  await delay(latencyMs);   // Barry should visibly be doing something

  const opId = operationId || mintOperationId();
  const n = candidates.length;

  const results = candidates.map((c, i) => {
    // Deterministic spread so the demo exercises all four outcomes.
    // Refused mirrors the contract's meaning: a genuine identifier collision,
    // NOT "this candidate is thin" — a thin candidate resolves to created.
    let outcome = OUTCOME.MATCHED;
    if (n >= 3 && i === n - 1) outcome = OUTCOME.AMBIGUOUS;
    else if (n >= 4 && i >= n - 3) outcome = OUTCOME.CREATED;
    if (n >= 6 && i === n - 4) outcome = OUTCOME.REFUSED;

    const base = { clientRef: c.clientRef, outcome, name: c.name, company_name: c.company_name };

    if (outcome === OUTCOME.MATCHED) {
      return { ...base, contactId: `mock_contact_${i}`, matchedOn: 'email', existingName: c.name };
    }
    if (outcome === OUTCOME.AMBIGUOUS) {
      // Contract: `candidates[]` carries the possibilities. Barry does not pick.
      return {
        ...base,
        contactId: null,
        matchedOn: 'name+company',
        candidates: [
          { contactId: 'mock_amb_a', existingName: c.name, company_name: 'Acme', title: 'VP Operations', lastInteraction: '2 months ago' },
          { contactId: 'mock_amb_b', existingName: c.name, company_name: 'Contoso', title: 'Director of Ops', lastInteraction: 'never' },
        ],
      };
    }
    if (outcome === OUTCOME.REFUSED) {
      return {
        ...base,
        contactId: null,
        reason: 'two existing contacts share this email address',
      };
    }
    return { ...base, contactId: null };   // created
  });

  return { success: true, operationId: opId, results, summary: summarise(results) };
}

/** Contract summary keys: matched · created · ambiguous · refused. */
export function summarise(results) {
  const count = (o) => results.filter(r => r.outcome === o).length;
  return {
    total: results.length,
    matched: count(OUTCOME.MATCHED),
    created: count(OUTCOME.CREATED),
    ambiguous: count(OUTCOME.AMBIGUOUS),
    refused: count(OUTCOME.REFUSED),
  };
}

/**
 * Barry's sentence. The contract is explicit that the user must see WHAT WILL
 * HAPPEN, not how many rows they ticked — "approving a count is not approving a
 * decision". So this never says "20 contacts will be saved".
 * Only mentions what is actually true: a clean set gets a clean sentence.
 */
export function previewSentence(summary) {
  if (!summary || summary.total === 0) return 'Nothing selected yet.';
  const lines = [];
  if (summary.matched) lines.push(`${summary.matched} ${summary.matched === 1 ? 'is' : 'are'} already in IDYNIFY`);
  if (summary.created) lines.push(`${summary.created} would be new`);
  if (summary.ambiguous) lines.push(`${summary.ambiguous} ${summary.ambiguous === 1 ? 'needs' : 'need'} your help`);
  if (summary.refused) lines.push(`${summary.refused} I can't tell apart`);
  return `I checked these against the people you already know.\n\n${lines.join('\n')}`;
}
