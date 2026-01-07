import admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = admin.firestore();

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
 * Deduct credits from user account
 *
 * @param {string} userId - Firebase user UID
 * @param {string} action - Action type from creditCosts
 * @param {number} quantity - Number of times to deduct (default 1)
 * @returns {Promise<{success: boolean, creditsUsed?: number, remaining?: number, error?: string, message?: string}>}
 */
export async function deductCredits(userId, action, quantity = 1) {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return {
        success: false,
        error: 'user_not_found',
        message: 'User account not found'
      };
    }

    const userData = userDoc.data();
    const cost = creditCosts[action] * quantity;

    // Check if user has credits object (for backwards compatibility)
    if (!userData.credits) {
      return {
        success: false,
        error: 'credits_not_initialized',
        message: 'Credit system not initialized for this account. Please contact support.'
      };
    }

    // Check if user has enough credits
    if (userData.credits.remaining < cost) {
      return {
        success: false,
        error: 'insufficient_credits',
        remaining: userData.credits.remaining,
        required: cost,
        message: `You need ${cost} credits but only have ${userData.credits.remaining} remaining. Upgrade your plan or wait for monthly reset.`
      };
    }

    // Deduct credits
    const newUsed = userData.credits.used + cost;
    const newRemaining = userData.credits.remaining - cost;

    await userRef.update({
      'credits.used': newUsed,
      'credits.remaining': newRemaining
    });

    // Log credit transaction
    await db.collection('users').doc(userId).collection('creditTransactions').add({
      action,
      quantity,
      cost,
      timestamp: new Date().toISOString(),
      remainingAfter: newRemaining
    });

    console.log(`✅ Deducted ${cost} credits from user ${userId} (action: ${action}). Remaining: ${newRemaining}`);

    return {
      success: true,
      creditsUsed: cost,
      remaining: newRemaining
    };
  } catch (error) {
    console.error('❌ Error deducting credits:', error);
    return {
      success: false,
      error: 'deduction_failed',
      message: `Failed to deduct credits: ${error.message}`
    };
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
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return {
        success: false,
        error: 'user_not_found'
      };
    }

    const userData = userDoc.data();

    if (!userData.credits) {
      return {
        success: false,
        error: 'credits_not_initialized'
      };
    }

    const newUsed = Math.max(0, userData.credits.used - amount);
    const newRemaining = userData.credits.remaining + amount;

    await userRef.update({
      'credits.used': newUsed,
      'credits.remaining': newRemaining
    });

    // Log refund transaction
    await db.collection('users').doc(userId).collection('creditTransactions').add({
      action: 'refund',
      cost: -amount,
      timestamp: new Date().toISOString(),
      remainingAfter: newRemaining
    });

    console.log(`✅ Refunded ${amount} credits to user ${userId}. New remaining: ${newRemaining}`);

    return {
      success: true,
      refunded: amount,
      remaining: newRemaining
    };
  } catch (error) {
    console.error('❌ Error refunding credits:', error);
    return {
      success: false,
      error: 'refund_failed',
      message: error.message
    };
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

    if (!userDoc.exists) {
      return {
        success: false,
        error: 'user_not_found'
      };
    }

    const userData = userDoc.data();

    if (!userData.credits) {
      return {
        success: false,
        error: 'credits_not_initialized'
      };
    }

    return {
      success: true,
      credits: {
        total: userData.credits.total,
        used: userData.credits.used,
        remaining: userData.credits.remaining,
        resetDate: userData.credits.resetDate,
        companiesRemaining: Math.floor(userData.credits.remaining / 10) // 10 credits per company
      }
    };
  } catch (error) {
    console.error('❌ Error getting credit balance:', error);
    return {
      success: false,
      error: 'fetch_failed',
      message: error.message
    };
  }
}
