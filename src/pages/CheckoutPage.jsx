import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [processing, setProcessing] = useState(false);

  // Read tier from URL parameter (default to 'starter')
  const tier = searchParams.get('tier') || 'starter';

  // Tier configuration
  const tierConfig = {
    starter: {
      name: 'Scout Starter',
      price: 20,
      credits: 400,
      companies: 40,
      contacts: 120,
      features: [
        'Browse unlimited companies',
        '40 enriched companies/month',
        '120 contact details (email + phone)',
        'Full RECON access',
        'CSV exports',
        'Email support (48-hour response)'
      ]
    },
    pro: {
      name: 'Scout Pro',
      price: 50,
      credits: 1250,
      companies: 125,
      contacts: 375,
      features: [
        'Browse unlimited companies',
        '125 enriched companies/month',
        '375 contact details (email + phone)',
        'Full RECON access',
        'Unlimited CSV exports',
        'Enhanced RECON reports with PDF',
        'Priority support (24-hour response)'
      ]
    }
  };

  const selectedTier = tierConfig[tier];

  const handleCheckout = async () => {
    setProcessing(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check if Stripe is configured (production mode)
      const isStripeConfigured = import.meta.env.VITE_STRIPE_ENABLED === 'true';

      if (isStripeConfigured) {
        // PRODUCTION MODE: Use real Stripe integration
        console.log('🔐 Redirecting to Stripe Checkout...');

        // Call Netlify function to create Stripe Checkout Session
        const response = await fetch('/.netlify/functions/create-checkout-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: user.uid,
            tier: tier, // Pass the selected tier (starter or pro)
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create checkout session');
        }

        const { url } = await response.json();

        // Redirect to Stripe Checkout
        window.location.href = url;
      } else {
        // DEVELOPMENT MODE: Simulate payment (for testing without Stripe)
        console.log('⚠️ DEV MODE: Simulating payment (Stripe not configured)');

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Mark payment as completed in Firestore (DEV MODE ONLY)
        await updateDoc(doc(db, 'users', user.uid), {
          hasCompletedPayment: true,
          paymentCompletedAt: new Date().toISOString(),
          subscriptionTier: tier,
          subscriptionStatus: 'active',
          credits: {
            total: selectedTier.credits,
            used: 0,
            remaining: selectedTier.credits,
            resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          },
          tierLimits: {
            creditsPerMonth: selectedTier.credits,
            companiesPerMonth: selectedTier.companies,
            contactsPerMonth: selectedTier.contacts,
            teamSeats: 1,
            support: tier === 'starter' ? '48-hour email' : '24-hour email'
          },
          billingCycleDate: new Date().getDate()
        });

        // Redirect to success page
        navigate('/checkout/success');
      }
    } catch (error) {
      console.error('Payment error:', error);
      alert(`Payment failed: ${error.message}\n\nPlease try again or contact support.`);
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Starfield Background */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(200)].map((_, i) => (
          <div
            key={i}
            className="absolute bg-white rounded-full"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              top: Math.random() * 100 + '%',
              left: Math.random() * 100 + '%',
              opacity: Math.random() * 0.7 + 0.3,
              animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="text-6xl mb-4">💳</div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono mb-4">
              Complete Your Purchase
            </h1>
            <p className="text-gray-400 text-lg">
              Get instant access to RECON intelligence and lead generation
            </p>
          </div>

          {/* Pricing Card */}
          <div className={`bg-black/60 backdrop-blur-xl rounded-2xl p-8 mb-8 ${
            tier === 'pro'
              ? 'border-2 border-cyan-500'
              : 'border-2 border-gray-700'
          }`}>
            <div className="text-center mb-6">
              <div className="text-sm text-gray-400 font-mono mb-2">{selectedTier.name.toUpperCase()}</div>
              <div className="text-5xl font-bold text-white mb-2">
                ${selectedTier.price}
                <span className="text-2xl text-gray-400">/mo</span>
              </div>
              <div className="text-gray-400 text-sm">{selectedTier.credits} credits • Billed monthly • Cancel anytime</div>
            </div>

            <div className="space-y-4 mb-8">
              {selectedTier.features.map((feature, index) => (
                <div key={index} className="flex items-start gap-3">
                  <span className="text-green-400 text-xl">✓</span>
                  <div>
                    <p className="text-white">{feature}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Checkout Button */}
            <button
              onClick={handleCheckout}
              disabled={processing}
              className={`w-full py-4 px-8 rounded-xl font-bold text-lg font-mono transition-all ${
                processing
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-2xl shadow-cyan-500/50'
              } text-white`}
            >
              {processing ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  PROCESSING...
                </span>
              ) : (
                '🚀 COMPLETE PURCHASE'
              )}
            </button>

            <p className="text-center text-xs text-gray-500 mt-4 font-mono">
              {import.meta.env.VITE_STRIPE_ENABLED === 'true'
                ? '🔐 Secure payment powered by Stripe'
                : '⚠️ DEV MODE: Payment simulation (Stripe not configured)'}
            </p>
          </div>

          {/* Security Badge */}
          <div className="text-center">
            <p className="text-gray-500 text-sm font-mono">
              🔒 Secure checkout • 30-day money-back guarantee
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
