/**
 * normalizeIcpParams.js — Normalize Barry-extracted ICP params to canonical vocabulary.
 *
 * Barry's ICP reclarification path (barryMissionChat) can return free-form
 * industry names ("saas", "fintech") and non-canonical company sizes
 * ("501-1000" without commas). The server now validates, but this function
 * provides defense-in-depth at the client write boundary: every path that
 * merges icp_params into an icpProfiles document calls this first.
 *
 * Uses normalizeTargeting (T-1) for industries and company sizes. Values
 * that T-1 cannot resolve to a canonical match are dropped — a missing
 * field is acceptable, a fabricated field is not.
 */

import { normalizeIndustry, normalizeCompanySize, MATCHED } from './normalizeTargeting.js';
import { COMPANY_SIZE_OPTIONS } from '../constants/targetingCanon.js';

export function normalizeIcpParams(params) {
  if (!params) return params;
  const out = { ...params };

  if (Array.isArray(out.industries)) {
    const canonical = [];
    for (const raw of out.industries) {
      const r = normalizeIndustry(raw);
      if (r.status === MATCHED && !canonical.includes(r.value)) {
        canonical.push(r.value);
      }
    }
    out.industries = canonical;
  }

  if (Array.isArray(out.companySizes)) {
    const canonical = [];
    for (const raw of out.companySizes) {
      const r = normalizeCompanySize(raw);
      if (r.status === MATCHED) {
        for (const v of r.values) {
          if (!canonical.includes(v)) canonical.push(v);
        }
      }
    }
    out.companySizes = canonical;
  }

  return out;
}
