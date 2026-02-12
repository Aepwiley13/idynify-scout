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
  { id: 'high', label: 'High', description: 'High strategic importance — priority contact' },
  { id: 'critical', label: 'Critical', description: 'Top priority — requires immediate attention and active engagement' }
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

// ── Mission Structured Fields (Step 4) ─────────────────

export const OUTCOME_GOALS = [
  { id: 'schedule_meeting', label: 'Schedule Meeting', description: 'Get a meeting on the calendar' },
  { id: 'secure_commitment', label: 'Secure Commitment', description: 'Get a verbal or written yes to a next step' },
  { id: 'rebuild_relationship', label: 'Rebuild Relationship', description: 'Re-establish trust or rapport after going dark' },
  { id: 'get_introduction', label: 'Get Introduction', description: 'Ask for a warm intro to someone else' },
  { id: 'gather_feedback', label: 'Gather Feedback', description: 'Collect input, opinions, or validation' },
  { id: 'ask_for_referral', label: 'Ask for Referral', description: 'Request a referral to a potential customer or partner' },
  { id: 'close_deal', label: 'Close Deal', description: 'Drive to a signed agreement or purchase' }
];

export const ENGAGEMENT_STYLES = [
  { id: 'light_touch', label: 'Light Touch', description: 'Minimal effort, low frequency — stay on the radar' },
  { id: 'moderate', label: 'Moderate', description: 'Consistent follow-up over weeks — build momentum' },
  { id: 'high_touch', label: 'High-Touch', description: 'White glove, frequent personal engagement — premium attention' }
];

export const MISSION_TIMEFRAMES = [
  { id: 'this_week', label: 'This Week', description: 'Urgent — needs to happen in the next 7 days' },
  { id: 'this_month', label: 'This Month', description: 'Active — target within 30 days' },
  { id: 'this_quarter', label: 'This Quarter', description: 'Strategic — play out over 90 days' },
  { id: 'no_deadline', label: 'No Deadline', description: 'Ongoing — no specific time pressure' }
];

export const NEXT_STEP_TYPES = [
  { id: 'send_message', label: 'Send Message', description: 'Draft and send an email or text' },
  { id: 'book_call', label: 'Book Call', description: 'Schedule a phone or video call' },
  { id: 'request_meeting', label: 'Request Meeting', description: 'Propose an in-person or virtual meeting' },
  { id: 'send_resource', label: 'Send Resource', description: 'Share a document, link, or asset' },
  { id: 'make_introduction', label: 'Make Introduction', description: 'Connect two people via intro' },
  { id: 'follow_up', label: 'Follow Up', description: 'Check in after a previous interaction' }
];

// ── Lookup helpers ──────────────────────────────────────

export function getLabelById(options, id) {
  return options.find(o => o.id === id)?.label || null;
}

export function getDescriptionById(options, id) {
  return options.find(o => o.id === id)?.description || null;
}
