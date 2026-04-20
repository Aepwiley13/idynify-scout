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

/**
 * Default ICP ID for existing single-ICP users.
 * Cluster F (Multi-ICP Architecture) will replace 'default' with real profile IDs.
 * All RECON writes and Barry context reads should tag icpId now so the migration
 * in Cluster F is a field update, not a structural rewrite.
 */
export const DEFAULT_ICP_ID = 'default';
