import Stripe from 'stripe';
import { admin, db } from './firebase-admin.js';
import { extractAuthToken } from './utils/extractAuthToken.js';

export const handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Verify auth token
  const authToken = extractAuthToken(event);
  if (!authToken) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Authentication required' })
    };
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(authToken);
  } catch {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid or expired authentication token' })
    };
  }

  try {
    const { userId, tier } = JSON.parse(event.body);

    if (!userId) {
      throw new Error('User ID is required');
    }

    // Ensure the authenticated user matches the requested userId
    if (decodedToken.uid !== userId) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Forbidden: user ID mismatch' })
      };
    }

    // Default to starter if tier not specified
    const selectedTier = tier || 'starter';

    // Verify Stripe API key is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables.');
    }

    // Map tier to Stripe Price ID
    const priceIds = {
      starter: process.env.STRIPE_PRICE_STARTER,
      pro: process.env.STRIPE_PRICE_PRO
    };

    const priceId = priceIds[selectedTier];

    if (!priceId) {
      throw new Error(`Invalid tier: ${selectedTier}. Price ID not found.`);
    }

    console.log(`Creating checkout session for tier: ${selectedTier}, priceId: ${priceId}`);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Get user email from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    const userData = userDoc.data();

    // Create Stripe Checkout Session using Price ID
    const session = await stripe.checkout.sessions.create({
      customer_email: userData.email,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId, // Use the Price ID from environment variables
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${event.headers.origin || 'https://idynify.com'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${event.headers.origin || 'https://idynify.com'}/checkout/cancel`,
      metadata: {
        userId: userId,
        tier: selectedTier, // Store tier in metadata for webhook
      },
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        sessionId: session.id,
        url: session.url,
      }),
    };
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Failed to create checkout session',
      }),
    };
  }
};
