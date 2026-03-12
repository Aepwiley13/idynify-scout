/**
 * Super Admin Authentication & RBAC Utilities
 *
 * Manages super admin access with fine-grained RBAC permissions.
 *
 * Roles hierarchy:
 *   super_admin > admin > user
 *
 * Permissions:
 *   global_read        - Read any tenant's data
 *   global_write       - Write/modify any tenant's data
 *   tenant_impersonation - Start support sessions for any user
 *   system_repair      - Execute repair/maintenance tools
 */

import { db } from '../firebase-admin.js';

export const SUPER_ADMIN_PERMISSIONS = {
  GLOBAL_READ: 'global_read',
  GLOBAL_WRITE: 'global_write',
  TENANT_IMPERSONATION: 'tenant_impersonation',
  SYSTEM_REPAIR: 'system_repair'
};

// All permissions granted to super_admin role by default
const ALL_PERMISSIONS = Object.values(SUPER_ADMIN_PERMISSIONS);

/**
 * Check if a user has super admin access
 *
 * Checks:
 * 1. SUPER_ADMIN_USER_IDS environment variable
 * 2. Firestore users/{userId} with role === 'super_admin'
 *
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function checkSuperAdminAccess(userId) {
  if (!userId) return false;

  // Check environment variable
  const superAdminIds = (process.env.SUPER_ADMIN_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (superAdminIds.includes(userId)) {
    console.log('🛡️ Super admin access granted via SUPER_ADMIN_USER_IDS env var');
    return true;
  }

  // Check Firestore
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const { role } = userDoc.data();
      if (role === 'super_admin') {
        console.log('🛡️ Super admin access granted via Firestore role');
        return true;
      }
    }
  } catch (error) {
    console.error('⚠️ Error checking Firestore for super_admin role:', error);
  }

  console.log('❌ Super admin access denied for user:', userId);
  return false;
}

/**
 * Get permissions for a super admin user
 * Returns full permission set for super_admin role.
 *
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function getSuperAdminPermissions(userId) {
  const isSuperAdmin = await checkSuperAdminAccess(userId);
  if (!isSuperAdmin) return [];

  // Check for custom permissions override in Firestore
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const { permissions } = userDoc.data();
      if (Array.isArray(permissions) && permissions.length > 0) {
        return permissions;
      }
    }
  } catch (error) {
    console.error('⚠️ Error fetching custom permissions:', error);
  }

  // Default: all permissions
  return ALL_PERMISSIONS;
}

/**
 * Verify super admin has a specific permission
 *
 * @param {string} userId
 * @param {string} permission - One of SUPER_ADMIN_PERMISSIONS values
 * @returns {Promise<boolean>}
 */
export async function hasSuperAdminPermission(userId, permission) {
  const permissions = await getSuperAdminPermissions(userId);
  return permissions.includes(permission);
}
