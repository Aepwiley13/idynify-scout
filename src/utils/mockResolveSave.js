/**
 * MOCKED RESOLVE_SAVE — stands in for Team A's barryResolveSave until it exists.
 *
 * ⚠️  MOCK. DEV ONLY. DELETE ON WIRING.
 *
 * This module must NEVER enter the production bundle. It is imported through a
 * dynamic `import()` that sits inside an `import.meta.env.DEV` guard, so in a
 * production build the branch is statically false, the import is unreachable,
 * and the module is dropped from the graph entirely.
 *
 * It previously leaked into production despite a guarded call site, because
 * BarryResolutionPreview imported OUTCOME from here — a real component pulling
 * in a mock. The contract vocabulary now lives in utils/resolutionContract.js
 * and this file contains ONLY the fake resolver.
 *
 * It defines nothing except the response SHAPE and the conversational rhythm:
 *   · it does not decide identity — outcomes are canned
 *   · it does not read or write Firestore
 *   · it does not normalise identifiers
 *
 * Shape taken verbatim from docs/GATE2_CANDIDATE_CONTRACT.md:
 *   POST /.netlify/functions/barryResolveSave
 *   { userId, authToken, operationId, actor, commit, candidates[] }
 *   → { success, operationId, results: [{ clientRef, outcome, contactId,
 *       matchedOn, existingName, candidates[] }], summary }
 */

import { OUTCOME, summarise, mintOperationId } from './resolutionContract.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

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
