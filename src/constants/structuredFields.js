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
 *
 * relationship_state (added) answers: "Where is this relationship on the arc from
 * stranger to strategic partner?" — drives Barry's Hunter recommendations and CTA labels.
 * It lives alongside warmth_level (not replacing it) as a richer relationship descriptor.
 */

// ── Contact Structured Fields ───────────────────────────

export const RELATIONSHIP_TYPES = [
  { id: 'prospect', label: 'Prospect', description: 'No prior relationship — net new contact' },
  { id: 'known', label: 'Known', description: 'Existing relationship — met before, have context' },
  { id: 'partner', label: 'Partner', description: 'Business partner, collaborator, or referral source' },
  { id: 'delegate', label: 'Delegate', description: 'Gatekeeper, referral, or someone acting on behalf of a decision-maker' }
];

/**
 * RELATIONSHIP_STATES — The relationship arc from stranger to strategic partner.
 * This is the primary field Barry uses for Hunter recommendations.
 * Drives: outcome_goal defaults, CTA labels, Barry's one-liner on Hunter cards.
 */
export const RELATIONSHIP_STATES = [
  { id: 'unaware', label: 'Unaware', description: "Never been contacted — they don't know you yet" },
  { id: 'aware', label: 'Aware', description: 'Knows who you are, but no real engagement yet' },
  { id: 'engaged', label: 'Engaged', description: 'Active back-and-forth happening — conversation is live' },
  { id: 'warm', label: 'Warm', description: 'Positive relationship, some trust built — receptive to outreach' },
  { id: 'trusted', label: 'Trusted', description: 'Deep relationship, proven value — they rely on you' },
  { id: 'advocate', label: 'Advocate', description: 'Actively referring or championing you to others' },
  { id: 'dormant', label: 'Dormant', description: 'Was warm or trusted, but has gone quiet — needs a reconnect' },
  { id: 'strained', label: 'Strained', description: 'Something went wrong — relationship needs repair' },
  { id: 'strategic_partner', label: 'Strategic Partner', description: 'Formal or deep partnership with ongoing strategic alignment' }
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

/**
 * OUTCOME_GOALS — Full relationship-arc goal library.
 * Organized into 8 categories covering the full arc from stranger to strategic partner.
 * NOTE: 'engage' is deprecated — use 'enter_conversation' instead.
 */
export const OUTCOME_GOALS = [
  // ── Awareness & Relevance (top of arc) ──
  { id: 'establish_awareness',   label: 'Establish Awareness',   category: 'awareness',    description: 'Get on their radar for the first time' },
  { id: 'clarify_positioning',   label: 'Clarify Positioning',   category: 'awareness',    description: 'Make clear what you do and why it matters to them' },
  { id: 'validate_alignment',    label: 'Validate Alignment',    category: 'awareness',    description: 'Confirm there is genuine fit before going deeper' },
  { id: 'identify_mutual_interest', label: 'Identify Mutual Interest', category: 'awareness', description: 'Find shared goals or overlapping priorities' },
  { id: 'confirm_fit',           label: 'Confirm Fit',           category: 'awareness',    description: 'Verify this is the right person, company, or opportunity' },
  { id: 'enter_conversation',    label: 'Enter Conversation',    category: 'awareness',    description: 'Start a real dialogue — move from cold to engaged' },
  { id: 'clarify_intent',        label: 'Clarify Intent',        category: 'awareness',    description: 'Determine whether this contact is a buyer, influencer, connector, or irrelevant' },

  // ── Engagement & Trust Building ──
  { id: 'build_rapport',         label: 'Build Rapport',         category: 'engagement',   description: 'Establish genuine personal connection before business' },
  { id: 'demonstrate_value',     label: 'Demonstrate Value',     category: 'engagement',   description: 'Show what you bring before asking for anything' },
  { id: 'share_social_proof',    label: 'Share Social Proof',    category: 'engagement',   description: 'Use case studies, mutual connections, or wins to build credibility' },
  { id: 'establish_credibility', label: 'Establish Credibility', category: 'engagement',   description: 'Position yourself as an expert or trusted voice in their space' },
  { id: 'increase_trust',        label: 'Increase Trust',        category: 'engagement',   description: 'Move the relationship from transactional to genuine' },
  { id: 'deepen_conversation',   label: 'Deepen Conversation',   category: 'engagement',   description: 'Go beyond surface-level — get into real priorities and challenges' },
  { id: 'understand_priorities', label: 'Understand Priorities', category: 'engagement',   description: 'Learn what they actually care about right now' },
  { id: 'map_influence',         label: 'Map Influence',         category: 'engagement',   description: 'Understand who influences this person and who they influence' },
  { id: 'gather_context',        label: 'Gather Context',        category: 'engagement',   description: 'Collect background needed before making a real ask' },

  // ── Strategic Advancement ──
  { id: 'schedule_meeting',      label: 'Schedule Meeting',      category: 'strategic',    description: 'Get a meeting on the calendar' },
  { id: 'secure_commitment',     label: 'Secure Commitment',     category: 'strategic',    description: 'Get a verbal or written yes to a next step' },
  { id: 'define_next_step',      label: 'Define Next Step',      category: 'strategic',    description: 'Advance an active mission to its next concrete action' },
  { id: 'gain_internal_advocate', label: 'Gain Internal Advocate', category: 'strategic', description: 'Identify and cultivate a champion inside the organization' },
  { id: 'position_as_advisor',   label: 'Position as Advisor',   category: 'strategic',   description: 'Shift the relationship from vendor to trusted thought partner' },
  { id: 'request_collaboration', label: 'Request Collaboration', category: 'strategic',   description: 'Propose working together on a specific initiative' },
  { id: 'propose_partnership',   label: 'Propose Partnership',   category: 'strategic',   description: 'Put a formal partnership or agreement on the table' },
  { id: 'explore_opportunity',   label: 'Explore Opportunity',   category: 'strategic',   description: 'Investigate whether a specific opportunity is real and worth pursuing' },
  { id: 'co_create_solution',    label: 'Co-Create Solution',    category: 'strategic',   description: 'Work together to design the right outcome for both parties' },

  // ── Relationship Maintenance ──
  { id: 'stay_top_of_mind',      label: 'Stay Top of Mind',      category: 'maintenance',  description: 'Light-touch contact to maintain visibility without pressure' },
  { id: 'reconnect',             label: 'Reconnect',             category: 'maintenance',  description: 'Re-engage a dormant relationship — warm it back up' },
  { id: 'rebuild_relationship',  label: 'Rebuild Relationship',  category: 'maintenance',  description: 'Re-establish trust or rapport after going dark or a rough patch' },
  { id: 'celebrate_milestone',   label: 'Celebrate Milestone',   category: 'maintenance',  description: "Acknowledge a promotion, launch, anniversary, or win in their world" },
  { id: 'offer_support',         label: 'Offer Support',         category: 'maintenance',  description: 'Show up for them during a challenge with no ask attached' },
  { id: 'add_value_no_ask',      label: 'Add Value (No Ask)',    category: 'maintenance',  description: 'Share something genuinely useful — no strings attached' },
  { id: 'strengthen_loyalty',    label: 'Strengthen Loyalty',    category: 'maintenance',  description: 'Deepen commitment and affinity in an already strong relationship' },
  { id: 'express_gratitude',     label: 'Express Gratitude',     category: 'maintenance',  description: 'Acknowledge something they did that mattered to you' },

  // ── Expansion & Leverage ──
  { id: 'get_introduction',      label: 'Get Introduction',      category: 'expansion',    description: 'Ask for a warm intro to someone they know' },
  { id: 'ask_for_referral',      label: 'Ask for Referral',      category: 'expansion',    description: 'Request a referral to a potential customer or partner' },
  { id: 'expand_network',        label: 'Expand Network',        category: 'expansion',    description: 'Strategically grow your network through this relationship' },
  { id: 'access_new_market',     label: 'Access New Market',     category: 'expansion',    description: 'Use this contact as a bridge into a new segment or geography' },
  { id: 'secure_testimonial',    label: 'Secure Testimonial',    category: 'expansion',    description: 'Ask for a written or recorded testimonial you can use in marketing' },
  { id: 'create_case_study',     label: 'Create Case Study',     category: 'expansion',    description: 'Propose documenting your work together as a public success story' },
  { id: 'formalize_partnership', label: 'Formalize Partnership', category: 'expansion',    description: 'Move from informal collaboration to a structured agreement' },
  { id: 'upsell_relationship',   label: 'Upsell Relationship',   category: 'expansion',    description: 'Expand scope, budget, or commitment with an existing customer or partner' },
  { id: 'strategic_alignment',   label: 'Strategic Alignment',   category: 'expansion',    description: 'Align on long-term goals, roadmap, or joint strategy' },

  // ── Validation & Insight ──
  { id: 'gather_feedback',       label: 'Gather Feedback',       category: 'validation',   description: 'Collect input, opinions, or validation on an idea, product, or offer' },
  { id: 'pressure_test_idea',    label: 'Pressure Test Idea',    category: 'validation',   description: 'Get honest pushback on a hypothesis before committing to it' },
  { id: 'validate_offer',        label: 'Validate Offer',        category: 'validation',   description: 'Test whether your offer resonates before going to market' },
  { id: 'market_intelligence',   label: 'Market Intelligence',   category: 'validation',   description: 'Gather intel on market trends, competitors, or dynamics' },
  { id: 'competitive_insight',   label: 'Competitive Insight',   category: 'validation',   description: 'Understand how this contact perceives you vs. the competition' },
  { id: 'decision_criteria_discovery', label: 'Decision Criteria Discovery', category: 'validation', description: 'Learn exactly how they make decisions and what matters most' },
  { id: 'objection_discovery',   label: 'Objection Discovery',   category: 'validation',   description: 'Surface objections early so Barry can help you address them' },
  { id: 'risk_assessment',       label: 'Risk Assessment',       category: 'validation',   description: 'Identify what could go wrong in this relationship or deal' },

  // ── Transactional ──
  { id: 'close_deal',            label: 'Close Deal',            category: 'transactional', description: 'Drive to a signed agreement or purchase decision' },
  { id: 'sign_agreement',        label: 'Sign Agreement',        category: 'transactional', description: 'Get a contract or formal agreement executed' },
  { id: 'onboard_client',        label: 'Onboard Client',        category: 'transactional', description: 'Transition a new customer from signed to successful' },
  { id: 'deliver_value',         label: 'Deliver Value',         category: 'transactional', description: 'Fulfill the commitment made — do the thing you promised' },
  { id: 'confirm_satisfaction',  label: 'Confirm Satisfaction',  category: 'transactional', description: 'Check in post-delivery to ensure they got what they needed' },
  { id: 'renew_contract',        label: 'Renew Contract',        category: 'transactional', description: 'Re-sign or extend an existing agreement before it lapses' },

  // ── Meta-Outcomes (often invisible but always present) ──
  { id: 'shift_perception',      label: 'Shift Perception',      category: 'meta',         description: 'Change how they think about you, your company, or your offer' },
  { id: 'increase_status',       label: 'Increase Status',       category: 'meta',         description: 'Elevate your positioning in their eyes' },
  { id: 'reduce_friction',       label: 'Reduce Friction',       category: 'meta',         description: 'Remove a barrier that is slowing progress' },
  { id: 'resolve_tension',       label: 'Resolve Tension',       category: 'meta',         description: 'Address and dissolve conflict or awkwardness in the relationship' },
  { id: 'reset_expectations',    label: 'Reset Expectations',    category: 'meta',         description: 'Realign what both sides expect from the relationship going forward' },
  { id: 'create_urgency',        label: 'Create Urgency',        category: 'meta',         description: 'Introduce a genuine reason to act now rather than later' },
  { id: 'build_reciprocity',     label: 'Build Reciprocity',     category: 'meta',         description: 'Give something valuable so the relationship naturally flows both ways' },
  { id: 'establish_authority',   label: 'Establish Authority',   category: 'meta',         description: 'Position yourself as the expert they should listen to in your domain' },
  { id: 'test_engagement',       label: 'Test Engagement',       category: 'meta',         description: 'Send a low-stakes message to see if this relationship is still alive' },
  { id: 'disqualify_gracefully', label: 'Disqualify Gracefully', category: 'meta',         description: 'Exit a relationship that is not a fit — without burning the bridge' }
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

// ── Hunter Status ───────────────────────────────────────

/**
 * HUNTER_STATUS — Contact lifecycle within the Hunter deck.
 * 'deck'             — In the swipe queue, awaiting a decision
 * 'engaged_pending'  — Rocket launched; Barry processing in background (3–5s gap)
 * 'active_mission'   — In Active Missions, mission created
 * 'archived'         — Soft-dismissed from deck; retrievable from Archived tab
 */
export const HUNTER_STATUSES = ['deck', 'engaged_pending', 'active_mission', 'archived'];

// ── CTA Label Engine ────────────────────────────────────

/**
 * CTA_LABEL_MAP — Maps relationship_state to the correct button label for Hunter cards.
 * When an active mission exists, always use 'active_mission' key regardless of state.
 * For unmapped states, fallback is 'Engage'.
 */
export const CTA_LABEL_MAP = {
  unaware:          { outcomeGoal: 'enter_conversation',    label: 'Start Conversation' },
  aware:            { outcomeGoal: 'build_rapport',         label: 'Build Rapport' },
  engaged:          { outcomeGoal: 'deepen_conversation',   label: 'Deepen Conversation' },
  warm:             { outcomeGoal: 'deepen_conversation',   label: 'Deepen Relationship' },
  trusted:          { outcomeGoal: 'get_introduction',      label: 'Request Introduction' },
  advocate:         { outcomeGoal: 'strengthen_loyalty',    label: 'Strengthen Relationship' },
  dormant:          { outcomeGoal: 'reconnect',             label: 'Reconnect' },
  strained:         { outcomeGoal: 'rebuild_relationship',  label: 'Rebuild Trust' },
  strategic_partner:{ outcomeGoal: 'strategic_alignment',   label: 'Advance Partnership' },
  active_mission:   { outcomeGoal: 'define_next_step',      label: 'Advance Mission' }
};

/**
 * getCTAForContact — Returns { label, outcomeGoal } for the Hunter Engage button.
 * Pass hasActiveMission=true to override with 'Advance Mission' regardless of state.
 */
export function getCTAForContact(relationshipState, hasActiveMission = false) {
  if (hasActiveMission) return CTA_LABEL_MAP.active_mission;
  return CTA_LABEL_MAP[relationshipState] || { outcomeGoal: 'enter_conversation', label: 'Engage' };
}

/**
 * getDefaultOutcomeGoal — Returns the Barry-recommended outcome_goal for a given
 * relationship_state. Used to auto-select outcome_goal in mission setup instead of
 * making the user pick from 60+ goals.
 */
export function getDefaultOutcomeGoal(relationshipState) {
  const mapping = CTA_LABEL_MAP[relationshipState];
  return mapping?.outcomeGoal || 'enter_conversation';
}

// ── OUTCOME_GOALS grouped by category ──────────────────

/**
 * OUTCOME_GOALS_BY_CATEGORY — Same goals, grouped for UI dropdowns that
 * need category sections. Keys match the category field on each goal.
 */
export const OUTCOME_GOALS_BY_CATEGORY = OUTCOME_GOALS.reduce((acc, goal) => {
  if (!acc[goal.category]) acc[goal.category] = [];
  acc[goal.category].push(goal);
  return acc;
}, {});

export const OUTCOME_GOAL_CATEGORIES = [
  { id: 'awareness',    label: 'Awareness & Relevance' },
  { id: 'engagement',  label: 'Engagement & Trust Building' },
  { id: 'strategic',   label: 'Strategic Advancement' },
  { id: 'maintenance', label: 'Relationship Maintenance' },
  { id: 'expansion',   label: 'Expansion & Leverage' },
  { id: 'validation',  label: 'Validation & Insight' },
  { id: 'transactional', label: 'Transactional' },
  { id: 'meta',        label: 'Meta-Outcomes' }
];

// ── Lookup helpers ──────────────────────────────────────

export function getLabelById(options, id) {
  return options.find(o => o.id === id)?.label || null;
}

export function getDescriptionById(options, id) {
  return options.find(o => o.id === id)?.description || null;
}
