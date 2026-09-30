/**
 * confirmAndActivateIcp.js — the one authoritative "user confirmed this
 * targeting" sequence.
 *
 * Extracted verbatim from BarryOnboarding.jsx's confirm handler so a second
 * caller (Mission Control Barry) can reuse the exact same write/search
 * behavior instead of a second implementation. Semantics are unchanged:
 * same fields, same create-vs-write-through branch, same lifecycle owner
 * (setActiveIcpProfile), same bridge, same retrieval gate, same search
 * trigger. `source` is the one necessary addition — the original code hard-
 * coded 'barry_onboarding' because there was only one caller; a second
 * caller must not misattribute its confirmations as onboarding's.
 *
 * Does not touch onboarding-specific bookkeeping (the user doc's
 * onboardingComplete/barryState fields, analytics events, or the
 * barryConversations/icp conversation-state document) — those remain the
 * caller's concern, called around this function, not inside it.
 */

import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { hasRetrievalConstraint } from './targetingProposal';
import { resolveActiveIcp, isResolved } from './resolveActiveIcp';
import { setActiveIcpProfile } from './setActiveIcpProfile';
import { COMPANY_SIZE_OPTIONS } from '../constants/targetingCanon';

/**
 * Collapses a companySizes bucket array into a short human line for a
 * targeting confirmation. Presentational only: parses our own known
 * COMPANY_SIZE_OPTIONS bucket-string format, never user text — not the
 * keyword/regex parsing of conversation content the targeting handoff
 * explicitly avoids.
 */
export function formatCompanySizeRange(sizes) {
  if (!sizes || sizes.length === 0) return null;
  if (sizes.length === 1) return `${sizes[0]} employees`;

  const lowerBound = sizes[0].split('-')[0];
  const topBucket = COMPANY_SIZE_OPTIONS[COMPANY_SIZE_OPTIONS.length - 1];
  if (sizes[sizes.length - 1] === topBucket) {
    return `${lowerBound}+ employees`;
  }
  const lastBucket = sizes[sizes.length - 1];
  const upperBound = lastBucket.includes('-') ? lastBucket.split('-')[1] : lastBucket;
  return `${lowerBound}–${upperBound} employees`;
}

export const DEFAULT_SCORING_WEIGHTS = {
  industry: 50,
  location: 25,
  employeeSize: 15,
  revenue: 10,
};

/**
 * The single source of truth for what a confirmation screen may claim
 * Idynify is about to do — and what confirmAndActivateIcp actually persists.
 * Both read from this function so the two can never drift apart.
 *
 * Deliberately narrow: company-search criteria (what actually narrows Apollo
 * retrieval — see hasRetrievalConstraint) versus people-targeting criteria
 * (titles, used downstream, never sent to Apollo as a company filter).
 * Revenue is excluded on purpose — the extractor never captures it, so there
 * is nothing effective to display; inventing a value here would be the same
 * dishonesty this exists to prevent.
 *
 * @param {Object} extractedICP - the extractor's understood/icp_params shape
 * @returns {{
 *   company: { locations: string[], isNationwide: boolean, companySizes: string[] },
 *   people: { targetTitles: string[] },
 * }}
 */
export function effectiveTargeting(extractedICP) {
  const isNationwide = extractedICP.locations === 'nationwide';
  return {
    company: {
      locations: isNationwide ? [] : (extractedICP.locations || []),
      isNationwide,
      companySizes: extractedICP.companySizes || [],
    },
    people: {
      targetTitles: extractedICP.targetTitles || [],
    },
  };
}

/**
 * @param {{uid: string, getIdToken: () => Promise<string>}} user - Firebase Auth user
 * @param {Object} extractedICP - the extractor's `understood`/icp_params shape
 *   (industries, companySizes, locations, targetTitles, companyKeywords,
 *   searchStrategy, lookalikeSeed, foundedAgeRange, confidenceScore)
 * @param {string} [source='barry_onboarding'] - who is confirming this targeting
 * @returns {Promise<{icpId: string, icpProfile: Object, canSearch: boolean, searchPromise: Promise<Object>|null}>}
 *   `searchPromise` resolves with the search-companies response body (or
 *   rejects) when `canSearch` is true, so a caller that needs the search's
 *   outcome (e.g. for its own analytics) can observe it without this
 *   function needing to know what those events are. It is `null` when
 *   `canSearch` is false. The request itself is already in flight — this
 *   promise does not delay it, it only lets a caller observe it.
 */
export async function confirmAndActivateIcp(user, extractedICP, source = 'barry_onboarding') {
  const { company, people } = effectiveTargeting(extractedICP);
  const icpProfile = {
    industries: extractedICP.industries || [],
    companySizes: company.companySizes,
    revenueRanges: [],
    skipRevenue: true,
    locations: company.locations,
    isNationwide: company.isNationwide,
    targetTitles: people.targetTitles,
    searchStrategy: extractedICP.searchStrategy || 'industry_only',
    lookalikeSeed: extractedICP.lookalikeSeed || null,
    companyKeywords: extractedICP.companyKeywords || [],
    foundedAgeRange: extractedICP.foundedAgeRange || null,
    scoringWeights: DEFAULT_SCORING_WEIGHTS,
    updatedAt: new Date().toISOString(),
    source,
    barryConfidenceScore: extractedICP.confidenceScore || 0.8,
    managedByBarry: true,
  };

  // The authoritative icpProfiles document is written first. The bridge is
  // written afterward as a projection carrying that identity.
  const resolution = await resolveActiveIcp(user.uid);

  if (resolution.status === 'unresolved' && resolution.reason === 'read-failed') {
    // A transient read failure must not cause a duplicate ICP. It is not
    // evidence that the user has none.
    throw new Error('Could not confirm your existing target profile. Please try again.');
  }

  let icpId;
  if (isResolved(resolution)) {
    // An ICP already exists and is active — write through to it rather
    // than creating a second one.
    icpId = resolution.icpId;
    await setDoc(
      doc(db, 'users', user.uid, 'icpProfiles', icpId),
      { ...resolution.profile, ...icpProfile, isActive: true, status: 'active' },
      { merge: true }
    );
  } else {
    // 'no-profiles', or ICPs exist but none is active. Either way the user
    // has explicitly confirmed this definition, so it becomes a new ICP and
    // that confirmation activates it. No existing candidate is silently
    // promoted on their behalf.
    icpId = `icp_${Date.now()}`;
    await setDoc(doc(db, 'users', user.uid, 'icpProfiles', icpId), {
      ...icpProfile,
      name: 'My ICP',
      isActive: true,
      status: 'active',
      messaging: null,
      messagingProgress: 0,
      source: `${source}_confirmed`,
      createdAt: new Date().toISOString(),
    });
  }

  // The bridge has exactly one writer, on both branches: setActiveIcpProfile.
  await setActiveIcpProfile(user.uid, icpId);

  // Attribution is the caller's confirmation to record, and attribution is
  // all it records. Merged, and naming no lifecycle field.
  await setDoc(
    doc(db, 'users', user.uid, 'companyProfile', 'current'),
    { icpId, icpIdSource: `${source}_confirmed` },
    { merge: true }
  );

  // A search may only be called ICP-targeted when at least one retrieval
  // constraint derived from the ICP actually narrows the result set.
  // targetTitles do not constrain a company search, revenue is never sent
  // to Apollo, and lookalikeSeed is received and logged by the query
  // builder but never becomes a query parameter.
  const canSearch = hasRetrievalConstraint(icpProfile);

  let searchPromise = null;
  if (canSearch) {
    const authToken = await user.getIdToken();
    // The request is fired immediately and not awaited here — the caller
    // does not wait on it to tell the user targeting was confirmed — but the
    // promise is returned so a caller that wants the outcome (e.g. its own
    // analytics on how many companies were found) can still observe it.
    searchPromise = fetch('/.netlify/functions/search-companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.uid,
        authToken,
        companyProfile: icpProfile,
        icpId,
      }),
    }).then(res => {
      if (!res.ok) throw new Error(`search failed (${res.status})`);
      return res.json();
    });
    // A caller that does not read searchPromise must not produce an
    // unhandled rejection.
    searchPromise.catch(err => console.error('Background search failed:', err));
  }

  return { icpId, icpProfile, canSearch, searchPromise };
}
