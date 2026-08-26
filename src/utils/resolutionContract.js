/**
 * RESOLUTION CONTRACT — the real, permanent vocabulary of RESOLVE_SAVE.
 *
 * Split out of mockResolveSave.js deliberately. BarryResolutionPreview needs
 * OUTCOME to render, and while OUTCOME lived in the mock module the mock was
 * pulled into the PRODUCTION bundle through a real component — no DEV guard at
 * the call site could have removed it.
 *
 * The rule this file encodes: contract vocabulary is real and survives; the
 * fake resolver is temporary and must be structurally excludable. Nothing in
 * here is a mock, and nothing in here may import one.
 *
 * Source: docs/GATE2_CANDIDATE_CONTRACT.md
 */

/** Contract outcomes. Only `matched` and `created` are ever written on commit. */
export const OUTCOME = {
  MATCHED: 'matched',      // resolved on an authoritative signal
  CREATED: 'created',      // true zero-match
  AMBIGUOUS: 'ambiguous',  // weak name+company signal only — ASK
  REFUSED: 'refused',      // 2+ existing records share an authoritative id — fail closed
};

/**
 * operationId bridges preview → commit. Client-generated, per the contract, and
 * MINTED EXACTLY ONCE per operation: the same id must travel through the
 * preview, the user's ambiguity answers, and the final approval, because
 * RESOLVE_SAVE is idempotent on it. Minting a second id at approval would make
 * the commit a different operation from the preview the user approved.
 */
export function mintOperationId() {
  return (globalThis.crypto?.randomUUID?.())
    || `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
 * Barry's sentence for a preview.
 *
 * The contract is explicit that the user must see WHAT WILL HAPPEN, not how
 * many rows they ticked — "approving a count is not approving a decision". So
 * this never says "20 contacts will be saved", and it mentions only what is
 * actually true: a clean set gets a clean sentence.
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
