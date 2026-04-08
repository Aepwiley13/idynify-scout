import Stripe from 'stripe';
import admin from 'firebase-admin';
import { verifyAuthToken } from './utils/verifyAuthToken.js';
import { logAuditEvent, getIpAddress, getUserAgent, AUDIT_ACTIONS } from './utils/auditLog.js';

// Initialize Firebase Admin (only once)
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

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { userId, idToken } = JSON.parse(event.body);

    if (!userId || !idToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'userId and idToken are required' })
      };
    }

    // Verify Firebase auth token
    await verifyAuthToken(idToken, userId);

    // Look up the user's Stripe subscription ID
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const userData = userDoc.data();
    const { stripeSubscriptionId } = userData;

    if (!stripeSubscriptionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No active subscription found' })
      };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Stripe is not configured' })
      };
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Cancel at period end so the user keeps access until their paid period ends
    await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Optimistically update Firestore so the UI reflects pending cancellation immediately
    await userDoc.ref.update({ cancelAtPeriodEnd: true });

    // Audit log
    await logAuditEvent({
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELED,
      logType: 'user_action',
      actorUserId: userId,
      targetUserId: userId,
      targetResource: 'subscription',
      resourceId: stripeSubscriptionId,
      status: 'success',
      ipAddress: getIpAddress(event),
      userAgent: getUserAgent(event),
    });

    console.log(`✅ Subscription set to cancel at period end for user: ${userId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('❌ Error canceling subscription:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Failed to cancel subscription' })
    };
  }
};
