import { db } from '../firebase-admin.js';

/**
 * Credit costs for different operations
 *
 * Enrich 1 company with 3 contacts = 10 credits total:
 * - 1 credit: Add company data
 * - 3 credits: Get 3 contact names
 * - 3 credits: Get 3 emails
 * - 3 credits: Get 3 phone numbers
 */
export const creditCosts = {
  addCompany: 1,           // Add company to saved list
  getContactName: 1,       // Reveal contact name
  revealEmail: 1,          // Reveal email address
  revealPhone: 1,          // Reveal phone number
  enrichCompanyFull: 10    // Full enrichment (1 company + 3 contacts with email + phone)
};

/**
 * A numeric `credits` value is evidence of what's left, not of the original allocation or how
 * much has been used — those are genuinely unknown for a legacy numeric-shaped account.
 * `total`/`used` are reported as null (not invented as 0/remaining) so callers never render a
 * fabricated usage history. Nothing here converts the stored shape; a numeric document stays
 * numeric through this module unless a real Stripe allocation event later overwrites it wholesale
 * with a genuine `{total, used, remaining, resetDate}` object.
 */
function readCreditsShape(credits) {
  if (typeof credits === 'number') {
    return { remaining: credits, total: null, used: null, legacyNumeric: true };
  }
  return { ...credits, legacyNumeric: false };
}

/**
 * Deduct credits from user account
 *
 * @param {string} userId - Firebase user UID
 * @param {string} action - Action type from creditCosts
 * @param {number} quantity - Number of times to deduct (default 1)
 * @returns {Promise<{success: boolean, creditsUsed?: number, remaining?: number, error?: string, message?: string}>}
 */
export async function deductCredits(userId, action, quantity = 1) {
  const cost = creditCosts[action] * quantity;
  const userRef = db.collection('users').doc(userId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return { success: false, error: 'user_not_found', message: 'User account not found' };
      }
      const userData = userSnap.data();
      if (userData.credits == null) {
        return {
          success: false,
          error: 'credits_not_initialized',
          message: 'Credit system not initialized for this account. Please contact support.',
        };
      }

      const shape = readCreditsShape(userData.credits);
      if (shape.remaining < cost) {
        return {
          success: false,
          error: 'insufficient_credits',
          remaining: shape.remaining,
          required: cost,
          message: `You need ${cost} credits but only have ${shape.remaining} remaining. Upgrade your plan or wait for monthly reset.`,
        };
      }

      const newRemaining = shape.remaining - cost;
      if (shape.legacyNumeric) {
        // Stay numeric. Nothing about total/used is known, so nothing is written for them.
        tx.update(userRef, { credits: newRemaining });
      } else {
        tx.update(userRef, {
          'credits.used': (userData.credits.used ?? 0) + cost,
          'credits.remaining': newRemaining,
        });
      }

      const txRef = db.collection('users').doc(userId).collection('creditTransactions').doc();
      tx.set(txRef, {
        action,
        quantity,
        cost,
        timestamp: new Date().toISOString(),
        remainingAfter: newRemaining,
      });

      return { success: true, creditsUsed: cost, remaining: newRemaining };
    });

    if (result.success) {
      console.log(`✅ Deducted ${cost} credits from user ${userId} (action: ${action}). Remaining: ${result.remaining}`);
    }
    return result;
  } catch (error) {
    console.error('❌ Error deducting credits:', error);
    return { success: false, error: 'deduction_failed', message: `Failed to deduct credits: ${error.message}` };
  }
}

/**
 * Refund credits to user account (e.g., if enrichment fails after deduction)
 *
 * @param {string} userId - Firebase user UID
 * @param {number} amount - Number of credits to refund
 * @returns {Promise<{success: boolean, refunded?: number, remaining?: number}>}
 */
export async function refundCredits(userId, amount) {
  const userRef = db.collection('users').doc(userId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return { success: false, error: 'user_not_found' };
      const userData = userSnap.data();
      if (userData.credits == null) return { success: false, error: 'credits_not_initialized' };

      const shape = readCreditsShape(userData.credits);
      const newRemaining = shape.remaining + amount;

      if (shape.legacyNumeric) {
        tx.update(userRef, { credits: newRemaining });
      } else {
        const newUsed = Math.max(0, (userData.credits.used ?? 0) - amount);
        tx.update(userRef, { 'credits.used': newUsed, 'credits.remaining': newRemaining });
      }

      const txRef = db.collection('users').doc(userId).collection('creditTransactions').doc();
      tx.set(txRef, {
        action: 'refund',
        cost: -amount,
        timestamp: new Date().toISOString(),
        remainingAfter: newRemaining,
      });

      return { success: true, refunded: amount, remaining: newRemaining };
    });
    if (result.success) {
      console.log(`✅ Refunded ${amount} credits to user ${userId}. New remaining: ${result.remaining}`);
    }
    return result;
  } catch (error) {
    console.error('❌ Error refunding credits:', error);
    return { success: false, error: 'refund_failed', message: error.message };
  }
}

/**
 * Get user's current credit balance
 *
 * @param {string} userId - Firebase user UID
 * @returns {Promise<{success: boolean, credits?: object, error?: string}>}
 */
export async function getCreditBalance(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return { success: false, error: 'user_not_found' };

    const userData = userDoc.data();
    if (userData.credits == null) return { success: false, error: 'credits_not_initialized' };

    const shape = readCreditsShape(userData.credits);
    return {
      success: true,
      credits: {
        total: shape.total,
        used: shape.used,
        remaining: shape.remaining,
        resetDate: shape.resetDate ?? null,
        companiesRemaining: Math.floor(shape.remaining / 10), // 10 credits per company
      },
    };
  } catch (error) {
    console.error('❌ Error getting credit balance:', error);
    return { success: false, error: 'fetch_failed', message: error.message };
  }
}
