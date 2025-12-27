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
    const { userId } = JSON.parse(event.body);

    if (!userId) {
      throw new Error('User ID is required');
    }

    // Verify Stripe API key is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Stripe is not configured. Please add STRIPE_SECRET_KEY to environment variables.');
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Get user email from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }
    const userData = userDoc.data();

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer_email: userData.email,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Idynify Scout Pro',
              description: 'AI-Powered B2B Intelligence & Lead Generation Platform',
              images: ['https://your-domain.com/logo.png'], // Update with your logo
            },
            recurring: {
              interval: 'month',
            },
            unit_amount: 9700, // $97.00 in cents
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${event.headers.origin || 'https://your-domain.netlify.app'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${event.headers.origin || 'https://your-domain.netlify.app'}/checkout/cancel`,
      metadata: {
        userId: userId,
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
