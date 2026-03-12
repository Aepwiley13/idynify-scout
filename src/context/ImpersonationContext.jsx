/**
 * ImpersonationContext
 *
 * Global React context that holds impersonation session state.
 * Every component that needs user-scoped data should use either:
 *   - useActiveUserId() hook (reactive, inside React tree)
 *   - getActiveUserId()  function (synchronous, anywhere)
 *
 * Read-only mode: When impersonating, write operations are blocked by default.
 * Set IMPERSONATION_MODE to 'full_access' to allow writes (higher risk).
 */

import { createContext, useContext, useMemo, useEffect } from 'react';
import { auth } from '../firebase/config';

// ─── Policy constant ─────────────────────────────────────────────────────────
// 'readonly' = admin can view everything but cannot mutate data on behalf of user
// 'full_access' = admin can act as the user (requires extra confirmation)
export const IMPERSONATION_MODE = 'readonly';

// ─── Module-level cache ───────────────────────────────────────────────────────
// Allows non-hook code (event handlers, utility functions) to get the active
// user ID without needing React context. Kept in sync by ImpersonationProvider.
let _impersonationCache = null; // { targetUserId, adminUserId } | null

/**
 * Non-hook version. Returns:
 * - The impersonated user's UID if an active session exists
 * - auth.currentUser.uid otherwise
 * - null if not authenticated
 */
export function getActiveUserId() {
  if (_impersonationCache?.targetUserId) return _impersonationCache.targetUserId;
  return auth.currentUser?.uid || null;
}

/**
 * Non-hook version. Returns an effective "user" object suitable for data
 * queries — same shape as auth.currentUser but with uid potentially overridden.
 */
export function getEffectiveUser() {
  const realUser = auth.currentUser;
  if (!realUser) return null;
  if (_impersonationCache?.targetUserId) {
    return {
      uid: _impersonationCache.targetUserId,
      email: _impersonationCache.targetUserEmail || '',
      _isImpersonated: true,
      getIdToken: () => realUser.getIdToken(),
    };
  }
  return realUser;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ImpersonationContext = createContext({
  isImpersonating: false,
  targetUserId: null,
  targetUserEmail: null,
  adminUserId: null,
  reason: null,
  expiresAt: null,
  sessionId: null,
  sessionType: null,
  mode: IMPERSONATION_MODE,
  isReadOnly: false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Accepts the impersonation session object from App.jsx.
 * When `session` is non-null and status === 'active', impersonation is on.
 */
export function ImpersonationProvider({ session, children }) {
  const value = useMemo(() => {
    const active = !!session && session.status === 'active';

    return {
      isImpersonating: active,
      targetUserId: active ? session.targetUserId : null,
      targetUserEmail: active ? (session.targetUserEmail || '') : null,
      adminUserId: active ? session.adminUserId : null,
      reason: active ? (session.reason || '') : null,
      expiresAt: active ? session.expiresAt : null,
      sessionId: active ? session.sessionId : null,
      sessionType: active ? (session.sessionType || 'admin') : null,
      mode: IMPERSONATION_MODE,
      isReadOnly: IMPERSONATION_MODE === 'readonly' && active,
    };
  }, [session]);

  // Keep module-level cache in sync so non-hook code can use getActiveUserId()
  useEffect(() => {
    if (value.isImpersonating) {
      _impersonationCache = {
        targetUserId: value.targetUserId,
        targetUserEmail: value.targetUserEmail,
        adminUserId: value.adminUserId,
      };
    } else {
      _impersonationCache = null;
    }
  }, [value.isImpersonating, value.targetUserId]);

  return (
    <ImpersonationContext.Provider value={value}>
      {children}
    </ImpersonationContext.Provider>
  );
}

// ─── React Hooks ──────────────────────────────────────────────────────────────

/**
 * Full impersonation context — use when you need session metadata.
 */
export function useImpersonation() {
  return useContext(ImpersonationContext);
}

/**
 * Returns the correct user ID for data fetching (reactive hook version).
 * - If impersonating → targetUserId
 * - Otherwise → auth.currentUser.uid
 */
export function useActiveUserId() {
  const { isImpersonating, targetUserId } = useContext(ImpersonationContext);
  const currentUser = auth.currentUser;

  if (isImpersonating && targetUserId) return targetUserId;
  return currentUser?.uid || null;
}

/**
 * Returns an active user object shaped like auth.currentUser, with uid
 * overridden to the impersonated user when a session is active.
 * getIdToken() always calls the real admin's token.
 */
export function useActiveUser() {
  const { isImpersonating, targetUserId, targetUserEmail } = useContext(ImpersonationContext);
  const currentUser = auth.currentUser;

  if (isImpersonating && targetUserId && currentUser) {
    return {
      uid: targetUserId,
      email: targetUserEmail || '',
      _isImpersonated: true,
      _realUser: currentUser,
      getIdToken: () => currentUser.getIdToken(),
    };
  }
  return currentUser;
}

export default ImpersonationContext;
