/**
 * contactEngageStatus.js — Unified contact engagement status system.
 *
 * Single source of truth for contact engagement states used across
 * AllLeads, EngagementCenter, and CSM cards.
 *
 * Statuses: 'converted' | 'replied' | 'active' | 'cold' | 'overdue'
 *
 * Spec ref: v1.2 Section 12.4 — Status vocabulary unification.
 */

const OVERDUE_DAYS = 7; // days since last contact = overdue

// ─── Colors ──────────────────────────────────────────────────────────────────
const RED   = '#dc2626';
const GREEN = '#22c55e';
const GRAY  = '#6b7280';
const BLUE  = '#0ea5e9';
const TEAL  = '#10b981';

/**
 * Derive a contact's engagement status from document fields only (no Firestore reads).
 *
 * Checks converted FIRST — converted contacts must never appear as overdue/active/cold.
 *
 * @param {Object} contact — Firestore contact document
 * @returns {'converted'|'replied'|'active'|'cold'|'overdue'}
 */
export function getContactEngageStatus(contact) {
  const now = Date.now();
  const lastContactAt = contact.engagement_summary?.last_contact_at;
  const nbsDueAt = contact.next_best_step?.due_at;
  const contactStatus = contact.contact_status || contact.lead_status || contact.status;
  const hunterStatus = contact.hunter_status;
  const warmth = contact.warmth_level;

  // ── Converted: customer / converted ─────────────────────────────────────
  if (
    contactStatus === 'converted' ||
    contactStatus === 'customer' ||
    contactStatus === 'Active Customer' ||
    hunterStatus === 'converted'
  ) return 'converted';

  // ── Replied: in conversation recently ───────────────────────────────────
  if (
    contactStatus === 'In Conversation' ||
    hunterStatus === 'in_conversation' ||
    (lastContactAt && (now - new Date(lastContactAt).getTime()) < 3 * 86400_000 &&
      contact.engagement_summary?.replies_received > 0)
  ) return 'replied';

  // ── Active: contacted within the week ───────────────────────────────────
  if (
    contactStatus === 'Engaged' ||
    hunterStatus === 'active_mission' ||
    hunterStatus === 'awaiting_reply' ||
    hunterStatus === 'engaged_pending' ||
    (lastContactAt && (now - new Date(lastContactAt).getTime()) < OVERDUE_DAYS * 86400_000)
  ) return 'active';

  // ── Cold: never reached out, cold warmth, or New status ─────────────────
  if (
    !lastContactAt ||
    contactStatus === 'New' ||
    warmth === 'cold'
  ) return 'cold';

  // ── Overdue: NBS past due, Dormant, Awaiting Reply, or too long ─────────
  if (
    (nbsDueAt && new Date(nbsDueAt).getTime() < now) ||
    contactStatus === 'Dormant' ||
    contactStatus === 'Awaiting Reply' ||
    (lastContactAt && (now - new Date(lastContactAt).getTime()) >= OVERDUE_DAYS * 86400_000)
  ) return 'overdue';

  return 'overdue';
}

/**
 * Unified status configuration — colors, labels, badge styles.
 * Used by EngagementCenter, AllLeads cards, and CSM cards.
 */
export const ENGAGE_STATUS_CONFIG = {
  converted: { label: 'Converted', color: TEAL,  dot: TEAL  },
  replied:   { label: 'Replied',   color: BLUE,  dot: BLUE  },
  active:    { label: 'Active',    color: GREEN, dot: GREEN },
  cold:      { label: 'Cold',      color: GRAY,  dot: GRAY  },
  overdue:   { label: 'Overdue',   color: RED,   dot: RED   },
};

/**
 * Badge config for card badges (background, border, label).
 * Spec ref: v1.2 Section 2.2 — card stripe colors.
 */
export const ENGAGE_BADGE_CONFIG = {
  cold:      { label: 'COLD',      bg: `${GRAY}20`,  color: GRAY,  border: `${GRAY}40`  },
  active:    { label: 'ACTIVE',    bg: `${GREEN}20`, color: GREEN, border: `${GREEN}40` },
  overdue:   { label: 'OVERDUE',   bg: `${RED}20`,   color: RED,   border: `${RED}40`   },
  replied:   { label: 'REPLIED',   bg: `${BLUE}20`,  color: BLUE,  border: `${BLUE}40`  },
  converted: { label: 'CONVERTED', bg: `${TEAL}20`,  color: TEAL,  border: `${TEAL}40`  },
};

/**
 * Sort priority: overdue first (needs attention), then replied, active, cold, converted.
 */
export const ENGAGE_SORT_ORDER = {
  overdue: 0,
  replied: 1,
  active: 2,
  cold: 3,
  converted: 4,
};
