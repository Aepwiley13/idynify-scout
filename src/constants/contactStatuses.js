/**
 * CONTACT_STATUSES — the contact status vocabulary, pure and dependency-free.
 *
 * Extracted from contactStateMachine.js so this vocabulary can be read
 * without pulling in that file's browser-only Firebase client SDK imports
 * (firebase/firestore, src/firebase/config.js — which reads
 * import.meta.env at module scope and crashes outside a Vite-processed
 * environment). Netlify Functions are bundled with esbuild, not Vite, so
 * import.meta.env is simply undefined there — any import chain reaching
 * this far crashes at cold start with "Cannot read properties of
 * undefined (reading 'VITE_FIREBASE_API_KEY')" before a single request is
 * handled. contactStateMachine.js re-exports this for its existing
 * frontend callers; the values and their meaning are unchanged.
 *
 * Operation People First — Updated Status Model:
 *
 * ── Lead Statuses (person_type === 'lead') ──────────────
 *   New             — Contact just created, never engaged
 *   Engaged         — A confirmed outbound/inbound interaction happened, or
 *                     one was explicitly logged after the fact
 *   Awaiting Reply  — Message sent, waiting for response
 *   In Conversation — Contact replied positively, dialogue active
 *   Dormant         — No activity for an extended period (auto or manual)
 *
 * ── Network/Relationship Statuses ───────────────────────
 *   Active Customer  — Current customer (person_type === 'customer')
 *   Past Customer    — Former customer (person_type === 'past_customer')
 *   Partner          — Active partner relationship (person_type === 'partner')
 *   Network          — Part of the relationship ecosystem (person_type === 'network')
 *
 * ── Legacy Statuses (maintained for backward compatibility) ─
 *   In Campaign     — Contact assigned to a campaign (legacy)
 *   Active Mission  — Contact assigned to a mission (legacy — missions deprecated)
 *   Mission Complete — Mission workflow completed (legacy)
 */

export const CONTACT_STATUSES = {
  // Active lead statuses
  NEW: 'New',
  ENGAGED: 'Engaged',
  AWAITING_REPLY: 'Awaiting Reply',
  IN_CONVERSATION: 'In Conversation',
  DORMANT: 'Dormant',

  // Relationship statuses (person_type-driven)
  ACTIVE_CUSTOMER: 'Active Customer',
  PAST_CUSTOMER: 'Past Customer',
  PARTNER: 'Partner',
  NETWORK: 'Network',

  // Legacy statuses (maintained for backward compatibility — do not use for new contacts)
  IN_CAMPAIGN: 'In Campaign',
  ACTIVE_MISSION: 'Active Mission',
  MISSION_COMPLETE: 'Mission Complete'
};
