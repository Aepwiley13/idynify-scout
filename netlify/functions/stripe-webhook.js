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
        // Support Stripe Payment Links (client_reference_id) and legacy checkout sessions (metadata.userId)
        const userId = session.client_reference_id || session.metadata?.userId;

        // Determine tier from payment amount (Payment Links) or metadata (legacy)
        let tier = session.metadata?.tier;
        if (!tier) {
          if (session.amount_total === 2000) tier = 'starter';
          else if (session.amount_total === 5000) tier = 'pro';
          else tier = 'starter';
        }

        if (!userId) {
          console.error('❌ No userId in client_reference_id or session metadata');
          break;
        }

        console.log(`✅ Payment successful for user: ${userId}, tier: ${tier}`);

        // Map tier to credit allocation
        const tierCredits = {
          starter: {
            credits: 400,
            companies: 40,
            contacts: 120,
            support: '48-hour email'
          },
          pro: {
            credits: 1250,
            companies: 125,
            contacts: 375,
            support: '24-hour email'
          }
        };

        const tierConfig = tierCredits[tier] || tierCredits.starter;
        const billingDate = new Date();
        const nextBillingDate = new Date(billingDate);
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

        // Update user in Firestore with tier-based credit allocation
        await db.collection('users').doc(userId).update({
          hasCompletedPayment: true,
          paymentCompletedAt: billingDate.toISOString(),
          subscriptionTier: tier,
          subscriptionStatus: 'active',
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,

          // Credit allocation
          credits: {
            total: tierConfig.credits,
            used: 0,
            remaining: tierConfig.credits,
            resetDate: nextBillingDate.toISOString()
          },

          // Tier limits
          tierLimits: {
            creditsPerMonth: tierConfig.credits,
            companiesPerMonth: tierConfig.companies,
            contactsPerMonth: tierConfig.contacts,
            teamSeats: 1,
            support: tierConfig.support
          },

          // Feature flags per tier
          features: {
            mobilePhone: tier === 'pro'
          },

          // Billing cycle day of month for credit reset
          billingCycleDate: billingDate.getDate()
        });

        console.log(`💾 User ${userId} updated with ${tier} tier (${tierConfig.credits} credits)`);
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
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
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
            cancelAtPeriodEnd: false,
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
