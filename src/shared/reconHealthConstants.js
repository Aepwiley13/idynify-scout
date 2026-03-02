/**
 * Shared RECON health constants used by:
 *   - src/shared/reconHealth.js  (client-side computeReconHealth)
 *   - netlify/functions/barry-coach-section.js  (coaching endpoint)
 *   - ReconOverview.jsx  (knowledge map UI)
 */

// ─── Section weights (must sum to 100) ───────────────────────────────────────

export const SECTION_WEIGHTS = {
  1: 25,  // Business Foundation — used in every Barry call
  2: 20,  // Product Deep Dive — source of truth for sequence content
  3: 15,  // Target Market — required for Scout ICP alignment
  5: 15,  // Pain Points — required for mission sequence relevance
  9: 10,  // Messaging — required for tone and value prop
  4:  5,  // Psychographics — adds depth
  6:  3,  // Buying Behavior — supplementary
  7:  3,  // Decision Process — supplementary
  8:  3,  // Competitive Landscape — supplementary
  10:  1, // Behavioral Signals — edge-case enrichment
};

// ─── Critical sections ────────────────────────────────────────────────────────

export const CRITICAL_SECTIONS = [1, 2, 3, 5];

export const CRITICAL_GAP_FLAGS = {
  1: 'NO_BUSINESS_FOUNDATION',
  2: 'NO_PRODUCT_DETAIL',
  3: 'NO_TARGET_MARKET',
  5: 'NO_PAIN_POINTS',
};

// ─── Staleness threshold ──────────────────────────────────────────────────────

export const STALENESS_DAYS = 90;

// ─── Fallback assumption strings (shown in weak-state hover tooltips) ─────────
// These represent what Barry literally uses when a dimension has thin data.

export const FALLBACK_ASSUMPTIONS = {
  identity:
    "I know your company name but not what you do or who you sell to. I'm generating context from contact data only.",
  icp:
    "I have no ICP criteria. I'm treating all contacts equally — no firmographic filtering or fit assessment.",
  'pain-points':
    "I have no pain point context. Conversation starters are role-based, not problem-based.",
  decisions:
    "I have no buyer journey data. Sequence timing is using generic cadence, not your buyer's actual evaluation window.",
  competitive:
    "I have no competitive landscape. I won't reference your positioning when competitors come up in conversation.",
  messaging:
    "I have no value proposition or tone guidance. Outreach uses category-level framing, not your actual positioning.",
  signals:
    "I have no behavioral signal data. Lead prioritization doesn't account for buying readiness indicators.",
};

// ─── Training dimensions ──────────────────────────────────────────────────────
// Single canonical definition — imported by ReconOverview, reconHealth, etc.

export const TRAINING_DIMENSIONS = [
  {
    id: 'identity',
    label: 'Business Identity',
    sections: [1, 2],
    impactWhenMissing: 'Barry has zero context — all output is purely generic.',
    fallbackAssumption: FALLBACK_ASSUMPTIONS.identity,
    priority: 1,
  },
  {
    id: 'icp',
    label: 'Ideal Customer Profile',
    sections: [3, 4],
    impactWhenMissing: 'Scout ICP alignment cannot be validated. Lead scoring is unweighted.',
    fallbackAssumption: FALLBACK_ASSUMPTIONS.icp,
    priority: 2,
  },
  {
    id: 'pain-points',
    label: 'Pain & Motivations',
    sections: [5, 6],
    impactWhenMissing: 'Mission sequences miss buyer motivation context.',
    fallbackAssumption: FALLBACK_ASSUMPTIONS['pain-points'],
    priority: 3,
  },
  {
    id: 'decisions',
    label: 'Decision Process',
    sections: [7],
    impactWhenMissing: 'Sequence timing uses generic cadence, not your buyer\'s actual evaluation window.',
    fallbackAssumption: FALLBACK_ASSUMPTIONS.decisions,
    priority: 4,
  },
  {
    id: 'competitive',
    label: 'Competitive Intel',
    sections: [8],
    impactWhenMissing: 'Barry won\'t reference competitive positioning when alternatives come up.',
    fallbackAssumption: FALLBACK_ASSUMPTIONS.competitive,
    priority: 5,
  },
  {
    id: 'messaging',
    label: 'Messaging Framework',
    sections: [9],
    impactWhenMissing: 'Outreach uses category-level framing instead of your actual positioning.',
    fallbackAssumption: FALLBACK_ASSUMPTIONS.messaging,
    priority: 6,
  },
  {
    id: 'signals',
    label: 'Behavioral Signals',
    sections: [10],
    impactWhenMissing: 'Lead prioritization doesn\'t account for buying readiness indicators.',
    fallbackAssumption: FALLBACK_ASSUMPTIONS.signals,
    priority: 7,
  },
];

// ─── Section → dimension map (convenience lookup) ─────────────────────────────

export const SECTION_TO_DIMENSION = {};
for (const dim of TRAINING_DIMENSIONS) {
  for (const s of dim.sections) {
    SECTION_TO_DIMENSION[s] = dim.id;
  }
}

// ─── Section module path map ──────────────────────────────────────────────────

export const SECTION_TO_MODULE_PATH = {
  1: '/recon/icp-intelligence',
  2: '/recon/icp-intelligence',
  3: '/recon/icp-intelligence',
  4: '/recon/icp-intelligence',
  5: '/recon/objections',
  6: '/recon/objections',
  7: '/recon/buying-signals',
  8: '/recon/competitive-intel',
  9: '/recon/messaging',
  10: '/recon/buying-signals',
};

export const DIMENSION_MODULE_PATH = {
  identity:     '/recon/icp-intelligence',
  icp:          '/recon/icp-intelligence',
  'pain-points':'/recon/objections',
  decisions:    '/recon/buying-signals',
  competitive:  '/recon/competitive-intel',
  messaging:    '/recon/messaging',
  signals:      '/recon/buying-signals',
};
