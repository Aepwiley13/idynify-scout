/**
 * companyDecision — the ONE canonical company decision path.
 *
 * Every surface where a user approves, rejects or skips a company calls this
 * module: Daily Discoveries (the reference, where this logic was lifted from),
 * the in-conversation results card on /barry, Mission Control's Approve, and
 * Company Detail's preview Approve. Before this existed only Daily Discoveries
 * stamped the deciding ICP, wrote the shadow decision event and fired persona
 * people discovery; the other three wrote a bare status and nothing else, so
 * the first company a new customer approved had the weakest provenance in the
 * product.
 *
 * What each surface still owns is its UI: counters, toasts, queue position,
 * its own per-mount guards. What lives here is everything that must be the
 * same no matter where the decision was made.
 *
 * ─── WRITE ORDER (invariant I-11) ──────────────────────────────────────────
 *   1. legacy company document          — authoritative, awaited, may throw
 *   2. shadow relationship + event      — strictly after, strictly fail-soft
 *   3. persona people discovery (right) — after the decision has committed
 *
 * ─── WHICH ICP A DECISION IS RECORDED UNDER ────────────────────────────────
 *   · an explicit surface ICP always wins. It is the only ICP stamped as
 *     `swipedForICPId`, the only one the shadow write attributes the decision
 *     to, and the only one whose persona drives people discovery;
 *   · otherwise the decision rests on the company's DISCOVERY icpId as
 *     fallback provenance only (`decision_icp_basis: 'discovery_fallback'`).
 *     It says which search surfaced the company, not what the user was
 *     deciding under, so it is never stamped as swipedForICPId and never
 *     shadow-written;
 *   · otherwise the decision is recorded as unattributed. Never guessed.
 *
 * Discovery and decision are different facts — a company found under ICP A
 * can be approved under ICP B — so they never share a field. The discovery ICP
 * is frozen on every decision as `decision_discovery_icp_id`, whatever the
 * basis; `swipedForICPId` holds only the explicit decision ICP; the company's
 * own `icpId` is never written here.
 *
 * ─── SKIP IS NOT A DECISION ────────────────────────────────────────────────
 * Skip means "not now". It keeps `status: 'pending'`, writes no decision field,
 * and hides the company only for the current discovery cycle. It is not a
 * rejection and not a cross-ICP exclusion.
 */

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { prepareContactWrite, applyContactMerge } from './contactWriteGuard';
import { RECORD_STATUS } from '../constants/statusModel';
import { DEFAULT_ICP_ID } from '../utils/reconSectionMap';
import { recordDecision, recordSkip, recordPersonEncounter } from './icpRelationshipService';

/** Where a decision was made. Persisted as `swipe_source`, which names the surface. */
export const DECISION_SURFACE = Object.freeze({
  DAILY_DISCOVERIES: 'daily_discoveries',
  BARRY_FIRST_VALUE: 'barry_first_value',
  MISSION_CONTROL: 'mission_control',
  COMPANY_DETAIL: 'company_detail',
});

/** How the ICP recorded on a decision was arrived at. */
export const DECISION_ICP_BASIS = Object.freeze({
  SURFACE: 'surface',
  DISCOVERY_FALLBACK: 'discovery_fallback',
  UNATTRIBUTED: 'unattributed',
});

/**
 * Fields a surface wrote before this module existed. Kept verbatim so nothing
 * that reads them loses anything; none of them carries decision meaning the
 * canonical fields do not.
 */
const SURFACE_LEGACY_FIELDS = {
  [DECISION_SURFACE.DAILY_DISCOVERIES]: () => ({}),
  [DECISION_SURFACE.BARRY_FIRST_VALUE]: () => ({}),
  [DECISION_SURFACE.MISSION_CONTROL]: () => ({ approvedAt: serverTimestamp() }),
  [DECISION_SURFACE.COMPANY_DETAIL]: (swipedAt) => ({ approvedAt: swipedAt, approved_from: 'company_detail_preview' }),
};

/**
 * The ICP a decision is recorded under — see the header. `activeICPId` is the
 * surface ICP or null; it is the only value that may be stamped as the
 * decision context. `discoveryIcpId` is provenance, kept apart from it.
 */
export function resolveDecisionIcp({ surfaceIcpId = null, company = {} } = {}) {
  // `default` is a legacy sentinel, not an association.
  const discoveryIcpId = company?.icpId && company.icpId !== DEFAULT_ICP_ID ? company.icpId : null;
  if (surfaceIcpId) {
    return { activeICPId: surfaceIcpId, discoveryIcpId, basis: DECISION_ICP_BASIS.SURFACE };
  }
  if (discoveryIcpId) {
    return { activeICPId: null, discoveryIcpId, basis: DECISION_ICP_BASIS.DISCOVERY_FALLBACK };
  }
  return { activeICPId: null, discoveryIcpId: null, basis: DECISION_ICP_BASIS.UNATTRIBUTED };
}

// ── Double-tap guard ────────────────────────────────────────────────────────
//
// The shared backstop behind whatever guard a surface has of its own. Two
// claims per subject:
//   · in flight — a second call while the first is still writing is dropped;
//   · decided   — the same decision delivered again after the first settled is
//                 a second delivery, not a second decision, and is dropped.
// A different direction is a real change of mind and goes through. Undo and a
// failed write both release the claim, so swipe → undo → re-swipe and
// fail → retry each remain a real second decision.

const inFlight = new Set();
const decided = new Map();
const subjectKey = (userId, companyId) => `${userId}/${companyId}`;

/** Test seam: forget every claim. */
export function resetDecisionGuards() {
  inFlight.clear();
  decided.clear();
}

/**
 * Record one approve (`right`) or reject (`left`) decision.
 *
 * Throws only if the legacy write fails, so a caller can tell the user to try
 * again. Returns `{ recorded: false, reason }` for a dropped duplicate.
 */
export async function recordCompanyDecision({
  userId, company, direction, surface,
  surfaceIcpId = null, gesture = 'unknown', feedback = null,
}) {
  if (!userId || !company?.id) return { recorded: false, reason: 'missing-subject' };
  if (direction !== 'right' && direction !== 'left') return { recorded: false, reason: 'bad-direction' };
  const legacyFieldsFor = SURFACE_LEGACY_FIELDS[surface];
  if (!legacyFieldsFor) throw new Error(`[companyDecision] unknown surface: ${surface}`);

  const key = subjectKey(userId, company.id);
  if (inFlight.has(key)) return { recorded: false, reason: 'in-flight' };
  if (decided.get(key) === direction) return { recorded: false, reason: 'already-decided' };
  inFlight.add(key);

  const { activeICPId, discoveryIcpId, basis } = resolveDecisionIcp({ surfaceIcpId, company });
  try {
    const companyRef = doc(db, 'users', userId, 'companies', company.id);
    // One timestamp for the decision: the legacy write and the shadow event
    // describe the same moment, and it doubles as the shadow write's causeId —
    // a retry lands on the same event id and is recognised as already recorded.
    const swipedAt = new Date().toISOString();
    await updateDoc(companyRef, {
      ...legacyFieldsFor(swipedAt),
      status: direction === 'right' ? 'accepted' : 'rejected',
      swipedAt,
      swipeDirection: direction,
      // WHICH gesture — keyboard | drag | button. Distinct from swipe_source,
      // which names the SURFACE.
      swipe_gesture: gesture,
      swipe_source: surface,
      ...(activeICPId ? { swipedForICPId: activeICPId } : {}),
      decision_icp_basis: basis,
      decision_discovery_icp_id: discoveryIcpId,
      ...(direction === 'right' && feedback ? { barryFeedback: feedback, feedbackAt: new Date().toISOString() } : {}),
      ...(direction === 'left' && feedback ? { barryRejectionFeedback: feedback, rejectionFeedbackAt: new Date().toISOString() } : {}),
    });

    // Shadow, strictly after the legacy write and strictly fail-soft: the
    // service swallows its own errors. Recorded under the surface ICP only —
    // the one stamped as swipedForICPId — so the two can never disagree. With
    // no surface ICP there is nothing to attribute and nothing is guessed.
    if (activeICPId) {
      await recordDecision({
        userId,
        subjectId: company.id,
        icpId: activeICPId,
        accepted: direction === 'right',
        causeId: swipedAt,
        source: company.source ?? null,
      });
    }

    decided.set(key, direction);
    return { recorded: true, swipedAt, activeICPId, discoveryIcpId, basis };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Skip — "not now", explicitly not a decision.
 *
 * Keeps `status: 'pending'` (which already blocks rediscovery) and writes no
 * swipedAt, swipeDirection, swipedForICPId or swipe_gesture: a skip that left
 * decision fields behind would read as a rejection to every consumer of them.
 * `skippedInCycle` hides the card for this discovery run only.
 *
 * `currentCycleId` undefined means the surface does not track the cycle, so it
 * is read from where Daily Discoveries keeps it.
 */
export async function skipCompany({ userId, company, surfaceIcpId = null, currentCycleId }) {
  if (!userId || !company?.id) return { recorded: false, reason: 'missing-subject' };
  if (currentCycleId === undefined) currentCycleId = await readCurrentCycleId(userId);
  const { activeICPId } = resolveDecisionIcp({ surfaceIcpId, company });

  const skippedAt = new Date().toISOString();

  // Legacy first, and field-scoped: this document carries a lifetime of
  // provenance that an unmasked write would delete.
  await updateDoc(doc(db, 'users', userId, 'companies', company.id), {
    skippedInCycle: currentCycleId ?? null,
    skippedAt,
  });

  // Shadow second, fail-soft. The relationship moves to `skipped` and records
  // the cycle, so the guard agrees on both sides at cutover.
  if (activeICPId) {
    await recordSkip({
      userId,
      subjectId: company.id,
      icpId: activeICPId,
      causeId: skippedAt,
      cycleId: currentCycleId ?? null,
      source: company.source ?? null,
    });
  }
  return { recorded: true, skippedAt };
}

async function readCurrentCycleId(userId) {
  const snap = await getDoc(doc(db, 'users', userId, 'scoutProgress', 'swipes')).catch(() => null);
  return snap?.exists?.() ? (snap.data().currentCycleId ?? null) : null;
}

/**
 * The persona a surface ICP asks for. Read fresh — the surface decides WHICH
 * ICP, Firestore decides what it currently says. No surface ICP, no titles:
 * fail closed rather than borrow someone else's persona.
 */
export async function resolveDecisionPersona(userId, activeICPId) {
  if (!userId || !activeICPId) return [];
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'icpProfiles', activeICPId));
    return snap.exists() ? (snap.data().targetTitles || []) : [];
  } catch (err) {
    console.warn('[companyDecision] could not read the decision ICP persona:', err.message);
    return [];
  }
}

/**
 * Persona people discovery after an approve.
 *
 * The titles write is awaited; the contact search runs in the background and
 * never blocks or fails the decision that triggered it.
 */
export async function triggerPeopleDiscovery({ user, company, icpTitles, activeICPId, causeId }) {
  if (!user?.uid || !company?.id || !icpTitles?.length) return;
  const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
  const formattedTitles = icpTitles.map((title, index) => ({ title, rank: index + 1, score: 100 - (index * 10) }));
  await updateDoc(companyRef, { selected_titles: formattedTitles, titles_updated_at: new Date().toISOString(), titles_source: 'icp_auto' });
  if (!company.apollo_organization_id) return;

  const authToken = await user.getIdToken();
  fetch('/.netlify/functions/searchPeople', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user.uid, authToken, organizationId: company.apollo_organization_id, titles: icpTitles, maxResults: 3 }),
  }).then(res => res.json()).then(async result => {
    if (result.success && result.people?.length > 0) {
      for (const person of result.people) {
        const contactId = `${company.id}_${person.id}`;

        // Identity resolution before every auto-discovered write. This runs in
        // the BACKGROUND after a decision, so a duplicate created here is one
        // the user never saw made and has no reason to look for.
        const decision = await prepareContactWrite(user.uid, {
          contactId,
          apollo_person_id: person.id,
          email: person.email,
          linkedin_url: person.linkedin_url,
          name: person.name,
          company_id: company.id,
          company_name: company.name,
          source: 'icp_auto_discovery',
        }, { source: 'DailyLeads.autoDiscovery', recordStatus: RECORD_STATUS.SUGGESTED });

        if (decision.action === 'merge') {
          await applyContactMerge(user.uid, decision);
          continue;
        }

        await setDoc(doc(db, 'users', user.uid, 'contacts', contactId), {
          ...person,
          // Identity envelope after the spread, never from it: `person` is an
          // enrichment API payload and carries no archival state, no normalized
          // identifiers and no status dimensions.
          ...decision.fields,
          company_id: company.id, company_name: company.name,
          lead_owner: user.uid, status: 'suggested', source: 'icp_auto_discovery',
          discovered_at: new Date().toISOString(),
        });

        // Shadow (Sprint 2), after the legacy write. This search ran because of
        // an ICP, so the person was genuinely encountered under it — a DIRECT
        // association. activeICPId is the ICP the company was just decided under.
        if (activeICPId) {
          await recordPersonEncounter({
            userId: user.uid,
            contactId,
            icpId: activeICPId,
            causeId,
            source: 'icp_auto_discovery',
          });
        }
      }
      await updateDoc(companyRef, { auto_contact_status: 'completed', auto_contact_count: result.people.length, auto_contact_searched_at: new Date().toISOString() });
    }
  }).catch(err => console.error('Background contact search failed:', err));
}

/**
 * Approve from a surface that has no decision flow of its own: the decision,
 * then persona people discovery.
 *
 * Resolves once the DECISION has committed, so the surface responds exactly as
 * fast as it did before. Discovery is a side effect of a decision that already
 * stands: it runs behind it, its failure is logged and never thrown, and its
 * promise is returned as `peopleDiscovery` for anyone who needs to wait on it.
 */
export async function approveCompany({ user, company, surface, surfaceIcpId = null, gesture = 'button' }) {
  const result = await recordCompanyDecision({
    userId: user?.uid, company, direction: 'right', surface, surfaceIcpId, gesture,
  });
  if (!result.recorded) return result;
  const peopleDiscovery = (async () => {
    const icpTitles = await resolveDecisionPersona(user.uid, result.activeICPId);
    await triggerPeopleDiscovery({ user, company, icpTitles, activeICPId: result.activeICPId, causeId: result.swipedAt });
  })().catch(err => console.error('[companyDecision] people discovery after approve failed:', err));
  return { ...result, peopleDiscovery };
}

/**
 * Undo, step one: the company is undecided again. Leaves swipedForICPId and
 * the decision ICP fields in place — the reconciler reads them to recognise an
 * undo the shadow model could not follow.
 */
export async function undoCompanyDecision({ userId, companyId }) {
  const companyRef = doc(db, 'users', userId, 'companies', companyId);
  await updateDoc(companyRef, { status: 'pending', swipedAt: null, swipeDirection: null, swipe_gesture: null });
  decided.delete(subjectKey(userId, companyId));
}

/** Undo, step two (approvals only): retract what people discovery added. */
export async function undoApprovalSideEffects({ userId, companyId }) {
  const companyRef = doc(db, 'users', userId, 'companies', companyId);
  await updateDoc(companyRef, { selected_titles: null, titles_updated_at: null, titles_source: null, auto_contact_status: null, auto_contact_count: null, auto_contact_searched_at: null });
  const autoContactsQuery = query(collection(db, 'users', userId, 'contacts'), where('company_id', '==', companyId), where('source', '==', 'icp_auto_discovery'));
  const autoContactDocs = await getDocs(autoContactsQuery);
  for (const contactDoc of autoContactDocs.docs) await deleteDoc(contactDoc.ref);
}

export default {
  DECISION_SURFACE, DECISION_ICP_BASIS, resolveDecisionIcp,
  recordCompanyDecision, skipCompany, resolveDecisionPersona,
  triggerPeopleDiscovery, approveCompany, undoCompanyDecision, undoApprovalSideEffects,
};
