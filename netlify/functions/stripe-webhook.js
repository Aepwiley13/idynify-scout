import Stripe from 'stripe';
import admin from 'firebase-admin';

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
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe is not configured');
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('Stripe webhook secret is not configured');
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sig = event.headers['stripe-signature'];

    let stripeEvent;

    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Webhook Error: ${err.message}` })
      };
    }

    // Handle the event
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId = session.metadata.userId;

        if (!userId) {
          console.error('❌ No userId in session metadata');
          break;
        }

        console.log(`✅ Payment successful for user: ${userId}`);

        // Update user in Firestore
        await db.collection('users').doc(userId).update({
          hasCompletedPayment: true,
          paymentCompletedAt: new Date().toISOString(),
          subscriptionTier: 'pro',
          subscriptionStatus: 'active',
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
        });

        console.log(`💾 User ${userId} updated with payment status`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = stripeEvent.data.object;

        // Find user by Stripe customer ID
        const usersSnapshot = await db.collection('users')
          .where('stripeCustomerId', '==', subscription.customer)
          .limit(1)
          .get();

        if (!usersSnapshot.empty) {
          const userDoc = usersSnapshot.docs[0];
          await userDoc.ref.update({
            subscriptionStatus: subscription.status,
          });
          console.log(`✅ Updated subscription status for user: ${userDoc.id}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;

        // Find user by Stripe customer ID
        const usersSnapshot = await db.collection('users')
          .where('stripeCustomerId', '==', subscription.customer)
          .limit(1)
          .get();

        if (!usersSnapshot.empty) {
          const userDoc = usersSnapshot.docs[0];
          await userDoc.ref.update({
            subscriptionStatus: 'canceled',
            hasCompletedPayment: false,
          });
          console.log(`❌ Subscription canceled for user: ${userDoc.id}`);
        }
        break;
      }

      default:
        console.log(`ℹ️ Unhandled event type: ${stripeEvent.type}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true })
    };
  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
