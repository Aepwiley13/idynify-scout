/**
 * barryResolveSave — RESOLVE_SAVE. Gate 2's canonical entity-write primitive.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  THE MODEL INTERPRETS INTENT.                                            ║
 * ║  THE RESOLVER DETERMINES IDENTITY.                                       ║
 * ║  THE USER RESOLVES AMBIGUITY.                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Given transient CandidatePayloads, resolve each against canonical identity,
 * merge where an authoritative signal matched, create ONLY on a true zero-match,
 * ask where the signal is weak, and refuse where it is contradictory.
 *
 * Contract: docs/GATE2_CANDIDATE_CONTRACT.md
 * Engine:   src/utils/identityResolution.js   (one engine, two runtimes)
 *
 * ─── WHY THE ENDPOINT REJECTS A CLIENT-SUPPLIED contactId ──────────────────
 * Barry's existing pipeline path accepts an LLM-emitted contact_id and checks
 * only that the document exists — never that it was the right person. With two
 * Sarah Johnsons in context the model picks one, the server accepts it, and the
 * confirmation button asks the user to approve a choice they were never shown.
 * That is confidence theatre with a button on top. Here a candidate carrying
 * any canonical id is rejected outright, structurally.
 *
 * ─── COMMIT RE-RESOLVES. IT DOES NOT TRUST THE PREVIEW ─────────────────────
 * The dry-run's verdict is a statement about the workspace at preview time. The
 * workspace can change between the two calls, so commit resolves again and acts
 * on what is true now. This also happens to be what makes the disambiguation
 * mechanism below need no storage.
 */

import { db } from './firebase-admin.js';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { logApiUsage } from './utils/logApiUsage.js';
import { createAdminAdapter } from './utils/contactResolver.js';
import {
  resolveContactCore,
  mergeIdentifiers,
  identityFields,
  RESOLUTION,
  IdentityConflictError,
} from '../../src/utils/identityResolution.js';
import {
  createStatusFields,
  RECORD_STATUS,
  RELATIONSHIP_STATUS,
  STAGE,
} from '../../src/constants/statusModel.js';

/** Contract outcomes. Mirrors src/utils/resolutionContract.js on the client. */
const OUTCOME = {
  MATCHED: 'matched',
  CREATED: 'created',
  AMBIGUOUS: 'ambiguous',
  REFUSED: 'refused',
};

/**
 * The minimum evidence Barry needs before it may create a canonical contact.
 *
 * ─── BARRY MAY CREATE ONLY WHAT BARRY CAN FIND AGAIN ───────────────────────
 *
 * This is exactly the resolver's own re-match capability, stated as a
 * precondition. An authoritative identifier resolves on an indexed query;
 * name + company resolves through hierarchy step 6. A candidate carrying
 * NEITHER cannot be re-found by any rung, which has two consequences and both
 * are bad: every later encounter with the same person creates another record,
 * and the record already written can never be reconciled with anything.
 *
 * So a candidate below the threshold is REFUSED rather than created, and Barry
 * asks for more instead of manufacturing an orphan. "Add Jane Smith" with no
 * company and no address is not a save — it is a question.
 *
 * This replaces an earlier attempt to solve the same problem by persisting the
 * UI's `clientRef` as an idempotency key. That was wrong twice over: the
 * published handshake states clientRef is correlation only and is never
 * persisted, and persisting a UI key would have papered over insufficient
 * identity rather than surfacing it.
 */
function hasSufficientIdentity(candidate) {
  const authoritative = Boolean(
    candidate.email
    || candidate.apollo_person_id
    || candidate.linkedin_url
    || candidate.phone,
  );
  if (authoritative) return true;

  // The weak signal is still a signal: step 6 can re-find it, and does.
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const company = candidate.company_name ?? candidate.company_id ?? null;
  return Boolean(name && company);
}

/** A candidate may never carry canonical identity. Rejected, not ignored. */
const FORBIDDEN_ON_CANDIDATE = ['contactId', 'contact_id', 'canonicalId', 'personId', 'id'];

/**
 * Bounded so one request cannot become an unbounded write.
 * Well above any plausible selection; low enough to stay a single operation.
 */
const MAX_CANDIDATES = 200;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body),
});

// ── Disambiguation ──────────────────────────────────────────────────────────

/**
 * THE AMBIGUITY CHOICE CONTRACT, and why it needs no storage.
 *
 * A preview can return `ambiguous` with the canonical records the resolver could
 * not choose between. The user picks one. That choice has to reach commit
 * without letting a client name an arbitrary contact.
 *
 * The mechanism is membership in a FRESHLY COMPUTED candidate set:
 *
 *   · the choice arrives in the request envelope as `resolutions[clientRef]`,
 *     never on the CandidatePayload — so the contract's absolute rule that a
 *     candidate carries no canonical id stays literally intact, and Team C's
 *     findPayloadViolations() keeps enforcing it unchanged;
 *   · commit re-resolves that candidate anyway;
 *   · the chosen id is accepted only if it appears in the candidate list that
 *     re-resolution just produced.
 *
 * That is stronger than replaying a token from the earlier call, because it
 * cannot be stale: if the workspace changed such that the record is no longer
 * one of the possibilities, the choice is refused rather than honoured.
 *
 * Workspace ownership needs no separate check. The candidate set is produced by
 * the resolver querying users/{uid}/contacts for the authenticated workspace, so
 * every id in it is by construction inside that workspace and a foreign id can
 * never be a member.
 *
 * HONEST LIMIT: with no operations collection the server cannot prove the id
 * came from THAT operationId's preview — only that it is a valid answer to the
 * same question right now. operationId carries idempotency and correlation, not
 * authorization. If binding to a specific preview is ever required, the minimal
 * upgrade is an HMAC-signed token, not a collection. Not built: nothing today
 * needs it, and the membership check already prevents naming an arbitrary
 * contact.
 */
function applyUserResolution(resolution, chosenId) {
  if (!chosenId) return { ok: false, reason: 'no_choice' };
  if (resolution.outcome !== RESOLUTION.REVIEW) {
    // The world moved between preview and commit — it now resolves on its own,
    // or matches nothing. Either way the user answered a question that is no
    // longer being asked.
    return { ok: false, reason: 'stale_resolution' };
  }
  const offered = resolution.candidates.map(c => c.id);
  if (!offered.includes(chosenId)) return { ok: false, reason: 'candidate_not_offered' };
  return { ok: true, contactId: chosenId };
}

// ── Per-candidate resolution ────────────────────────────────────────────────

async function resolveOne(adapter, candidate, chosenId, operationId) {
  let resolution;
  try {
    resolution = await resolveContactCore(adapter, candidate, { source: 'barryResolveSave' });
  } catch (err) {
    if (err instanceof IdentityConflictError) {
      // Two existing records share one authoritative identifier. Not a match —
      // a data-integrity violation. Barry does not pick one.
      return {
        clientRef: candidate.clientRef,
        outcome: OUTCOME.REFUSED,
        contactId: null,
        matchedOn: err.signal,
        reason: `two existing contacts share the same ${err.signal}`,
        candidates: err.contactIds.map(id => ({ contactId: id })),
      };
    }
    throw err;
  }

  if (resolution.outcome === RESOLUTION.MATCHED) {
    return {
      clientRef: candidate.clientRef,
      outcome: OUTCOME.MATCHED,
      contactId: resolution.contactId,
      matchedOn: resolution.signal,
      existingName: resolution.existing?.name ?? null,
      _resolution: resolution,
    };
  }

  if (resolution.outcome === RESOLUTION.REVIEW) {
    // Did THIS operation already create one of these? A name+company candidate
    // written by an earlier attempt comes back as an ambiguity against itself,
    // and asking the user to disambiguate a record they just created is a
    // retry presenting as a question. Recognised via identity_operation_id —
    // the field already authorized for exactly this — so a retry is a clean
    // no-op rather than merely a safe one.
    const mine = [];
    for (const c of resolution.candidates) {
      const doc = await adapter.getById(c.id);
      if (doc?.identity_operation_id && doc.identity_operation_id === operationId) mine.push(doc);
    }
    if (mine.length === 1) {
      return {
        clientRef: candidate.clientRef,
        outcome: OUTCOME.CREATED,
        contactId: mine[0].id,
        matchedOn: 'operation_retry',
        _resolution: { ...resolution, contactId: mine[0].id, existing: mine[0] },
        _alreadyWritten: true,
      };
    }

    const chosen = applyUserResolution(resolution, chosenId);
    if (chosen.ok) {
      // The user answered. This is the ONLY path by which a canonical id
      // supplied from outside the resolver is honoured, and it is honoured
      // only because the resolver just offered it.
      const existing = resolution.candidates.find(c => c.id === chosen.contactId) ?? null;
      return {
        clientRef: candidate.clientRef,
        outcome: OUTCOME.MATCHED,
        contactId: chosen.contactId,
        matchedOn: 'user_disambiguation',
        existingName: existing?.name ?? null,
        _resolution: { ...resolution, contactId: chosen.contactId, existing },
      };
    }

    return {
      clientRef: candidate.clientRef,
      outcome: OUTCOME.AMBIGUOUS,
      contactId: null,
      matchedOn: resolution.signal,
      ...(chosenId ? { reason: chosen.reason } : {}),
      candidates: resolution.candidates.map(c => ({
        contactId: c.id,
        existingName: c.name,
        company_name: c.company_name,
      })),
    };
  }

  // Nothing matched. Creating is only correct if the record could be found
  // again — see hasSufficientIdentity.
  if (!hasSufficientIdentity(candidate)) {
    return {
      clientRef: candidate.clientRef,
      outcome: OUTCOME.REFUSED,
      contactId: null,
      matchedOn: null,
      reason: 'insufficient_identity',
      detail: 'needs an email, phone, LinkedIn or Apollo id — or a name together '
            + 'with a company — before it can become a contact',
    };
  }

  return {
    clientRef: candidate.clientRef,
    outcome: OUTCOME.CREATED,
    contactId: null,             // filled in on commit
    matchedOn: null,
    _resolution: resolution,
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * A deterministic id where the data supplies one, an auto id otherwise.
 * `{companyId}_{apolloPersonId}` is the convention four existing Apollo paths
 * already use, and re-saving the same person overwrites rather than duplicating.
 */
function deterministicId(candidate) {
  const apollo = candidate.apollo_person_id ?? null;
  const company = candidate.company_id ?? null;
  if (apollo && company) return `${company}_${apollo}`;
  return null;
}

async function commitResults(userId, results, candidatesByRef, { operationId, actor }) {
  const contacts = db.collection('users').doc(userId).collection('contacts');

  for (const result of results) {
    const candidate = candidatesByRef.get(result.clientRef);

    if (result.outcome === OUTCOME.MATCHED) {
      const patch = mergeIdentifiers(result._resolution.existing ?? {}, candidate);
      if (Object.keys(patch).length > 0) {
        await contacts.doc(result.contactId).update({
          ...patch,
          identity_operation_id: operationId,
          identity_actor: actor,
        });
      }
      continue;
    }

    if (result.outcome === OUTCOME.CREATED) {
      // This operation already wrote it on a previous attempt.
      if (result._alreadyWritten) continue;

      const id = deterministicId(candidate);
      const ref = id ? contacts.doc(id) : contacts.doc();

      await ref.set({
        ...identityFields(candidate),
        ...createStatusFields({
          recordStatus: RECORD_STATUS.ACTIVE,
          relationshipStatus: RELATIONSHIP_STATUS.NEW,
          stage: STAGE.SCOUT,
        }),
        name: candidate.name ?? null,
        title: candidate.title ?? null,
        email: candidate.email ?? null,
        phone: candidate.phone ?? null,
        linkedin_url: candidate.linkedin_url ?? null,
        apollo_person_id: candidate.apollo_person_id ?? null,
        company_id: candidate.company_id ?? null,
        company_name: candidate.company_name ?? null,
        lead_owner: userId,
        source: candidate.source ?? 'barry_resolve_save',
        identity_source: 'barryResolveSave',
        identity_sources: [candidate.source ?? 'barry_resolve_save'],
        identity_operation_id: operationId,
        identity_actor: actor,
        addedAt: new Date().toISOString(),
      }, { merge: true });

      result.contactId = ref.id;
      continue;
    }

    // ambiguous and refused are never written. That is the whole point.
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const startTime = Date.now();
  let userId;

  try {
    const body = JSON.parse(event.body || '{}');
    userId = body.userId;
    const { authToken, operationId, candidates, resolutions = {} } = body;
    const actor = body.actor === 'barry' ? 'barry' : 'user';
    const commit = body.commit === true;

    if (!userId || !authToken) return json(400, { error: 'Missing userId or authToken' });
    if (!operationId || typeof operationId !== 'string') {
      // Required in both modes: it is what bridges preview and commit, and what
      // makes a retry a no-op instead of a second set of records.
      return json(400, { error: 'Missing operationId' });
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return json(400, { error: 'candidates must be a non-empty array' });
    }
    if (candidates.length > MAX_CANDIDATES) {
      return json(400, { error: `Too many candidates (max ${MAX_CANDIDATES})` });
    }

    for (const c of candidates) {
      if (!c || (c.kind !== 'person' && c.kind !== 'company')) {
        return json(400, { error: "every candidate needs kind 'person' or 'company'" });
      }
      if (c.kind === 'company') {
        // Company resolution is Gate 2 Phase 5 and is not authorized for
        // implementation yet. Refusing plainly beats resolving it wrongly.
        return json(400, { error: 'company candidates are not supported yet (Gate 2 Phase 5)' });
      }
      if (!c.clientRef || typeof c.clientRef !== 'string') {
        return json(400, { error: 'every candidate needs a clientRef' });
      }
      for (const forbidden of FORBIDDEN_ON_CANDIDATE) {
        if (c[forbidden] !== undefined) {
          return json(400, {
            error: `a candidate must never carry ${forbidden} — the resolver determines identity`,
          });
        }
      }
    }

    await verifyAuthToken(authToken, userId);

    // ONE adapter for the whole operation: the scan window is loaded at most
    // once for all candidates rather than once each.
    const adapter = createAdminAdapter(db, userId);

    const candidatesByRef = new Map(candidates.map(c => [c.clientRef, c]));
    const results = [];
    for (const candidate of candidates) {
      results.push(await resolveOne(adapter, candidate, resolutions[candidate.clientRef], operationId));
    }

    if (commit) {
      await commitResults(userId, results, candidatesByRef, { operationId, actor });
    }

    const summary = {
      total: results.length,
      matched: results.filter(r => r.outcome === OUTCOME.MATCHED).length,
      created: results.filter(r => r.outcome === OUTCOME.CREATED).length,
      ambiguous: results.filter(r => r.outcome === OUTCOME.AMBIGUOUS).length,
      refused: results.filter(r => r.outcome === OUTCOME.REFUSED).length,
    };

    await logApiUsage(userId, 'barryResolveSave', 'success', {
      responseTime: Date.now() - startTime,
      metadata: { commit, actor, operationId, ...summary },
    });

    return json(200, {
      success: true,
      operationId,
      committed: commit,
      // `_resolution` is internal working state and never leaves the function.
      results: results.map((r) => {
        const out = { ...r };
        delete out._resolution;
        delete out._alreadyWritten;
        return out;
      }),
      summary,
    });

  } catch (err) {
    console.error('[barryResolveSave] error:', err.message);
    try {
      if (userId) {
        await logApiUsage(userId, 'barryResolveSave', 'error', {
          responseTime: Date.now() - startTime,
          metadata: { message: err.message },
        });
      }
    } catch { /* logging must not mask the original failure */ }
    return json(500, { error: err.message || 'resolve_save_failed' });
  }
};

export default { handler };
