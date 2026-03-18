/**
 * STAGE SYSTEM
 *
 * Replaces the Brigade dropdown options with a pipeline-driven stage system.
 * Stage reflects where a contact lives in the Idynify platform.
 *
 * This is a PARALLEL system to Brigade — the existing Brigade field and Barry's
 * behavioral contracts are untouched. Stage drives the profile badge and the
 * Stage dropdown only. Brigade continues to drive Barry's tone and strategy.
 *
 * Stage field: contacts.stage         — 'scout' | 'hunter' | 'sniper' | 'basecamp' | 'fallback'
 * Source field: contacts.stage_source — 'auto' | 'manual_override'
 *
 * Auto-assignment rules (based on person_type):
 *   person_type === 'customer'      → Basecamp
 *   person_type === 'past_customer' → Fallback
 *   person_type === 'lead'          → Scout (default; refine to Hunter/Sniper in a later sprint)
 *   person_type === 'partner'       → null (Partner sits outside the pipeline for now)
 *   person_type === 'network'       → null (Network sits outside the pipeline for now)
 *
 * Manual override always wins. Auto-assignment only fires when stage_source !== 'manual_override'.
 */

import { MODULE_COLORS } from '../theme/tokens';

// ── Stage definitions ─────────────────────────────────────────────────────────

export const STAGES = [
  {
    id:          'scout',
    label:       'Scout',
    color:       MODULE_COLORS.scout,
    bgColor:     `${MODULE_COLORS.scout}14`,
    borderColor: `${MODULE_COLORS.scout}35`,
    description: 'Contact is in the Scout module — needs initial engagement',
  },
  {
    id:          'hunter',
    label:       'Hunter',
    color:       MODULE_COLORS.hunter,
    bgColor:     `${MODULE_COLORS.hunter}14`,
    borderColor: `${MODULE_COLORS.hunter}35`,
    description: 'Contact is in the Hunter module — actively being pursued',
  },
  {
    id:          'sniper',
    label:       'Sniper',
    color:       MODULE_COLORS.sniper,
    bgColor:     `${MODULE_COLORS.sniper}14`,
    borderColor: `${MODULE_COLORS.sniper}35`,
    description: 'Contact is in the Sniper module — high-priority target',
  },
  {
    id:          'basecamp',
    label:       'Basecamp',
    color:       MODULE_COLORS.basecamp,
    bgColor:     `${MODULE_COLORS.basecamp}14`,
    borderColor: `${MODULE_COLORS.basecamp}35`,
    description: 'Active customer — relationship is live',
  },
  {
    id:          'fallback',
    label:       'Fallback',
    color:       MODULE_COLORS.fallback,
    bgColor:     `${MODULE_COLORS.fallback}14`,
    borderColor: `${MODULE_COLORS.fallback}35`,
    description: 'Past customer — churned or inactive',
  },
];

export const STAGE_MAP = STAGES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

// ── Color map for the FieldChip component ────────────────────────────────────

export const STAGE_COLORS = STAGES.reduce((acc, s) => {
  acc[s.id] = { color: s.color, bg: s.bgColor, border: s.borderColor };
  return acc;
}, {});

// ── Auto-derive stage from person_type ────────────────────────────────────────

/**
 * Returns the auto-assigned stage ID for a given person_type, or null if no
 * automatic mapping exists for that type (partner, network).
 *
 * @param {string} personType - 'lead' | 'customer' | 'past_customer' | 'partner' | 'network'
 * @returns {string|null} stage ID or null
 */
export function deriveStageFromPersonType(personType) {
  switch (personType) {
    case 'customer':      return 'basecamp';
    case 'past_customer': return 'fallback';
    case 'lead':          return 'scout';
    default:              return null;
  }
}

/**
 * Compute the effective stage for a contact.
 *
 * If stage_source is 'manual_override', the user's explicit choice is honoured.
 * Otherwise derive from person_type.
 *
 * @param {Object} contact - contact document
 * @returns {string|null} stage ID
 */
export function resolveContactStage(contact) {
  if (contact.stage_source === 'manual_override' && contact.stage) {
    return contact.stage;
  }
  return deriveStageFromPersonType(contact.person_type) ?? contact.stage ?? null;
}
