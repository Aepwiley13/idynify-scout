/**
 * STRUCTURED CONTEXT FIELDS
 *
 * Step 3: Structured inputs for Contact and Campaign classification.
 * These fields feed Barry's prompt for consistent, high-quality context generation.
 *
 * IMPORTANT: engagementIntent (prospect/warm/customer/partner) remains separate.
 * It answers: "What kind of relationship do I have right now?" (Hunter messaging flow)
 * These fields answer: "How do I structurally classify this for strategic planning?"
 *
 * Do NOT collapse relationship_type into engagementIntent or vice versa.
 */

// ── Contact Structured Fields ───────────────────────────

export const RELATIONSHIP_TYPES = [
  { id: 'prospect', label: 'Prospect', description: 'No prior relationship — net new contact' },
  { id: 'known', label: 'Known', description: 'Existing relationship — met before, have context' },
  { id: 'partner', label: 'Partner', description: 'Business partner, collaborator, or referral source' },
  { id: 'delegate', label: 'Delegate', description: 'Gatekeeper, referral, or someone acting on behalf of a decision-maker' }
];

export const WARMTH_LEVELS = [
  { id: 'cold', label: 'Cold', description: 'No prior interaction — first touch' },
  { id: 'warm', label: 'Warm', description: 'Some prior interaction or mutual connection' },
  { id: 'hot', label: 'Hot', description: 'Active conversation or strong existing rapport' }
];

export const STRATEGIC_VALUES = [
  { id: 'low', label: 'Low', description: 'Low strategic importance to current goals' },
  { id: 'medium', label: 'Medium', description: 'Moderate strategic importance' },
  { id: 'high', label: 'High', description: 'High strategic importance — priority contact' }
];

// ── Campaign Structured Fields ──────────────────────────

export const OBJECTIVE_TYPES = [
  { id: 'acquire', label: 'Acquire', description: 'New relationship or deal' },
  { id: 'activate', label: 'Activate', description: 'Move someone from passive to engaged' },
  { id: 'expand', label: 'Expand', description: 'Upsell, deepen, or grow an existing relationship' },
  { id: 'retain', label: 'Retain', description: 'Renew, maintain, or prevent churn' },
  { id: 'influence', label: 'Influence', description: 'Political, advisory, or strategic alignment' },
  { id: 'partner', label: 'Partner', description: 'Referral, collaboration, or co-creation' }
];

export const TIME_HORIZONS = [
  { id: 'immediate', label: 'Immediate', description: '0–30 days' },
  { id: 'near_term', label: 'Near-Term', description: '1–3 months' },
  { id: 'long_term', label: 'Long-Term', description: '3+ months' },
  { id: 'ongoing', label: 'Ongoing', description: 'No defined end' }
];

export const STRATEGIC_PRIORITIES = [
  { id: 'low', label: 'Low', description: 'Low urgency — handle when capacity allows' },
  { id: 'medium', label: 'Medium', description: 'Standard priority' },
  { id: 'high', label: 'High', description: 'High priority — active focus' },
  { id: 'critical', label: 'Critical', description: 'Top priority — requires immediate attention' }
];

// ── Lookup helpers ──────────────────────────────────────

export function getLabelById(options, id) {
  return options.find(o => o.id === id)?.label || null;
}

export function getDescriptionById(options, id) {
  return options.find(o => o.id === id)?.description || null;
}
