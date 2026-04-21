/**
 * Canonical RECON section ID mapping — shared schema contract.
 *
 * Every assembler (client or server) that extracts RECON context for Barry
 * must import from here. Never inline these numbers elsewhere.
 *
 * sectionId values are the numeric keys stored in dashboards/{uid}.modules[recon].sections[].sectionId
 *
 * If a section's purpose changes, update this map and the change propagates
 * to all callers automatically.
 */

export const RECON_SECTION_MAP = {
  icp:             1,  // Business Foundation — who the user is, what they sell
  valueProposition: 2,  // Product Deep Dive — features, differentiation, use cases
  psychographics:  4,  // Ideal Customer Psychographics — buyer fears, goals, values, emotional state
  painPoints:      5,  // Pain Points & Motivations — primary pain, cost, triggers, workarounds
  outreachContext: 9,  // Messaging & Value Proposition — core messaging, voice, proof points
};

// Section 9 is per-ICP; sections 1–8 are shared user-level intelligence.
export const MESSAGING_SECTION_ID = 9;
export const ICP_LEVEL_SECTIONS = [9];

/**
 * Default ICP ID for existing single-ICP users.
 * Cluster F migration promotes this to a real icpProfiles document.
 * All company writes tag icpId with this value when no explicit profile is active.
 */
export const DEFAULT_ICP_ID = 'default';

/**
 * Default Service Profile ID — used as fallback when no specific service is
 * selected in the First Touch flow and when a user has no configured profiles.
 * Barry treats this as "general services — use RECON context only."
 */
export const DEFAULT_SERVICE_ID = 'default';
