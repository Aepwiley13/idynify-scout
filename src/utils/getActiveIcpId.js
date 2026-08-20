import { resolveActiveIcp, isResolved } from './resolveActiveIcp';

/**
 * Returns the active ICP profile ID for a user, or null when no ICP identity
 * can be established.
 *
 * TRANSITION PATH — do not add new callers. This is a thin id-only wrapper over
 * the canonical resolution contract in resolveActiveIcp.js, kept so the Hunter
 * surfaces that only need an id are not forced to destructure a resolution
 * object. New code should call resolveActiveIcp directly, which preserves the
 * distinction between 'no-profiles', 'none-active' and 'read-failed'.
 *
 * End state: deleted once the four Hunter callers consume the resolution object.
 *
 * It previously returned DEFAULT_ICP_ID on an empty result or a thrown error,
 * which sent callers to icpProfiles/default — a document that usually does not
 * exist — so Barry silently generated outreach with no ICP messaging. Missing
 * ICP identity is now null, and callers must handle it explicitly.
 *
 * @returns {Promise<string|null>}
 */
export async function getActiveIcpId(userId) {
  const resolution = await resolveActiveIcp(userId);
  return isResolved(resolution) ? resolution.icpId : null;
}
