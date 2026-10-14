/**
 * Company-only enrichment after a user accepts a company.
 *
 * Discovery (Apollo mixed_companies/search) returns no industry, size or HQ,
 * so an accepted company would sit in Saved Companies with unknowns until
 * someone opened it. Accepting is the moment the user says "I care about this
 * company", so it is where one organization lookup is worth spending:
 *
 *   accept → status 'accepted' (unchanged, not awaited by this)
 *          → enrichAcceptedCompany: ONE Apollo organizations/enrich call
 *          → verified fields written to the same company document
 *
 * Independent of people discovery, which also runs after an accept: this
 * module never searches for or matches people.
 *
 * Never throws and is never awaited by the save: the company is saved whether
 * or not this succeeds, and a failure leaves the normal unknown state.
 */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { applyCompanyEnrichment, canEnrich, enrichmentSignals } from './companyIdentityService';
import { isProvisionalBarryIntel } from '../utils/companyDisplay';

export const ENRICHMENT_CACHE_MS = 14 * 24 * 60 * 60 * 1000;
// A pending marker older than this is treated as abandoned (tab closed mid-call).
export const ENRICHMENT_PENDING_TTL_MS = 2 * 60 * 1000;

export const COMPANY_ENRICHMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  DONE: 'done',
  FAILED: 'failed',
});

/** Any enrichment, company-only or full, from the last 14 days. */
export function isEnrichmentFresh(company, now = Date.now()) {
  return Boolean(company?.apolloEnrichment && company?.apolloEnrichedAt
    && now - company.apolloEnrichedAt < ENRICHMENT_CACHE_MS);
}

/**
 * A FULL enrichment (with decision makers) from the last 14 days — what the
 * company detail views need. A company-only result does not satisfy them, so
 * opening a company still behaves exactly as it did before accept-enrichment.
 */
export function isFullEnrichmentFresh(company, now = Date.now()) {
  return isEnrichmentFresh(company, now) && company.apolloEnrichment?._raw?.mode !== 'company';
}

/** Company-only enrichment is running for this company right now. */
export function isEnrichmentPending(company, now = Date.now()) {
  return company?.company_enrichment_status === COMPANY_ENRICHMENT_STATUS.PENDING
    && typeof company.company_enrichment_requested_at === 'number'
    && now - company.company_enrichment_requested_at < ENRICHMENT_PENDING_TTL_MS;
}

const inFlight = new Map();

/** Test seam: forget in-flight calls. */
export function resetEnrichmentGuards() {
  inFlight.clear();
}

/**
 * Enrich an accepted company with verified company-level data, once.
 *
 * Skips (0 Apollo calls) when the company was enriched in the last 14 days,
 * when another call for it is already running (this tab, or a fresh pending
 * marker from another), or when it carries no domain or Apollo id to look up.
 *
 * @returns {Promise<{action: 'enriched'|'skipped'|'failed'|'noop', reason?: string}>}
 */
export function enrichAcceptedCompany({ userId, company }) {
  if (!userId || !company?.id) return Promise.resolve({ action: 'noop', reason: 'missing-subject' });
  const key = `${userId}/${company.id}`;
  if (inFlight.has(key)) return inFlight.get(key);

  const run = (async () => {
    const ref = doc(db, 'users', userId, 'companies', company.id);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return { action: 'noop', reason: 'missing-company' };
      const current = snap.data() ?? {};

      if (isEnrichmentFresh(current)) return { action: 'skipped', reason: 'fresh' };
      if (isEnrichmentPending(current)) return { action: 'skipped', reason: 'pending' };
      if (!canEnrich(current)) return { action: 'skipped', reason: 'no-signal' };

      // The token belongs to whoever is signed in — the admin, when impersonating.
      const authToken = await auth.currentUser?.getIdToken();
      if (!authToken) return { action: 'skipped', reason: 'signed-out' };

      await updateDoc(ref, {
        company_enrichment_status: COMPANY_ENRICHMENT_STATUS.PENDING,
        company_enrichment_requested_at: Date.now(),
      });

      const { domain, organizationId } = enrichmentSignals(current);
      const response = await fetch('/.netlify/functions/enrichCompany', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, authToken, domain, organizationId, mode: 'company' }),
      });
      if (!response.ok) throw new Error(`enrichCompany failed: ${response.status}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'enrichCompany failed');

      const data = result.data ?? {};
      // The cached snapshot is view state, safe to write directly. Barry's text
      // is replaced only while it is still the provisional discovery text —
      // never over richer text another source wrote.
      await updateDoc(ref, {
        apolloEnrichment: data,
        apolloEnrichedAt: Date.now(),
        ...(data.barry_intel && isProvisionalBarryIntel(current) ? { barry_intel: data.barry_intel } : {}),
      });

      // Identity and top-level fields go through the guard: fills holes and
      // placeholders only, never overwrites a real value or an authoritative name.
      await applyCompanyEnrichment(userId, company.id, {
        apollo_organization_id: data._raw?.apolloOrgId ?? null,
        name: data.snapshot?.name ?? null,
        ...(data.canonical ?? {}),
      }, { source: 'accept.companyOnly' });

      // Last, so "Verifying…" clears only once every field above has landed.
      await updateDoc(ref, { company_enrichment_status: COMPANY_ENRICHMENT_STATUS.DONE });
      return { action: 'enriched' };
    } catch (err) {
      console.warn('[company-enrichment] company-only enrichment failed — company stays saved', {
        companyId: company.id, error: err?.message,
      });
      await updateDoc(ref, {
        company_enrichment_status: COMPANY_ENRICHMENT_STATUS.FAILED,
        company_enrichment_failed_at: Date.now(),
      }).catch(() => {});
      return { action: 'failed' };
    }
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, run);
  return run;
}
