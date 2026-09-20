/**
 * icpProfileWrite.js — what a criteria-editing screen is allowed to persist.
 *
 * An ICP document carries three kinds of field, and they have three different
 * owners:
 *
 *   identity   — id, createdAt, source
 *   lifecycle  — isActive, status        (owned ONLY by setActiveIcpProfile)
 *   criteria   — the targeting definition the ICP Settings screen edits
 *
 * ICP Settings used to persist its whole in-memory profile object with a
 * non-merging setDoc. That object is a spread of the ICP as it was when the
 * screen mounted, so the save replayed a stale `isActive`/`status` pair over
 * whatever had happened since — including an activation performed seconds
 * earlier on the same screen. A workspace could end up with every profile
 * `isActive: false`, which resolveActiveIcp reports as 'none-active', which in
 * turn silently stops Discovery attributing any decisions at all.
 *
 * The rule this module enforces: a screen writes the fields it owns, by name,
 * and merges. Lifecycle changes travel through setActiveIcpProfile or they do
 * not happen.
 *
 * ICP_CRITERIA_FIELDS lists the fields ICP Settings actually has an editor for.
 * Fields it merely displays or carries (revenueRanges, messaging, managedByBarry,
 * lookalikeSeed, …) are deliberately absent: writing back a value this screen
 * cannot change is how a stale snapshot reverts another writer's work, which is
 * the same defect one level down.
 */

export const ICP_CRITERIA_FIELDS = Object.freeze([
  'name',
  'industries',
  'companySizes',
  'locations',
  'isNationwide',
  'targetTitles',
  'scoringWeights',
  'foundedAgeRange',
  'notes',
]);

/** Fields no criteria screen may ever write. Asserted, not just documented. */
export const ICP_LIFECYCLE_FIELDS = Object.freeze(['isActive', 'status']);
export const ICP_IDENTITY_FIELDS = Object.freeze(['id', 'createdAt', 'source']);

/**
 * Project an in-memory profile down to the criteria fields, ready to be written
 * with { merge: true }.
 *
 * `undefined` values are dropped rather than written: Firestore rejects them,
 * and an absent key under a merge correctly means "leave whatever is stored".
 *
 * @param {Object} profile - the screen's in-memory profile
 * @param {Object} [overrides={}] - values that win over the profile (e.g. an edited name)
 * @returns {Object} criteria-only payload
 */
export function buildIcpCriteriaWrite(profile, overrides = {}) {
  const source = { ...(profile || {}), ...overrides };
  const write = {};
  for (const field of ICP_CRITERIA_FIELDS) {
    if (source[field] !== undefined) write[field] = source[field];
  }
  return write;
}
