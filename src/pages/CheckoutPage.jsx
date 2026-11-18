import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { planOf, isPaidPlan } from '../utils/accountPlan';
import { blocksNewSubscription } from '../utils/billingEntitlement';
import { FREE_PLAN, FREE_PLAN_HOME } from '../constants/freePlan';
import { supportMailto } from '../constants/support';

/**
 * Billing Phase 1b. Every purchase goes through the authenticated Checkout
 * Session (netlify/functions/create-checkout-session.js): it reuses the
 * account's existing Stripe customer and refuses a second subscription. The
 * Stripe Payment Links this page used to redirect to are retired: they could
 * not attach to an existing customer, so an existing subscriber who used one
 * was charged for a second subscription the webhook then refused to honour.
 *
 * What a server error means to the customer. None of these charged anything:
 * a checkout session that never opened cannot take a payment.
 */
export function checkoutErrorMessage(status, code) {
  if (status === 401) return 'Your session has expired. Sign in again to continue.';
  switch (code) {
    case 'already_subscribed':
      return 'You already have a subscription, so a new one can’t be started. You can see it in Settings → Billing.';
    case 'subscription_needs_recovery':
      return 'Your existing subscription needs attention — a payment may not have gone through. Contact support and we’ll sort it out. You have not been charged.';
    case 'checkout_in_progress':
      return 'A checkout is already being prepared for your account. Wait a moment, then try again.';
    case 'checkout_needs_manual_reconciliation':
    case 'checkout_operation_superseded':
    case 'customer_binding_conflict':
    case 'contact_support':
      return 'We couldn’t start checkout for your account. Contact support and we’ll sort it out. You have not been charged.';
    default:
      return 'We couldn’t start checkout. Please try again in a moment. You have not been charged.';
  }
}

export default function CheckoutPage({ account = null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  // Only the two paid tiers exist; anything else in the link is Starter.
  const tier = searchParams.get('tier') === 'pro' ? 'pro' : 'starter';

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
        '120 contact details (email only)',
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
        'Mobile phone numbers unlocked',
        'Full RECON access',
        'Unlimited CSV exports',
        'Enhanced RECON reports with PDF',
        'Priority support (24-hour response)'
      ]
    }
  };

  const selectedTier = tierConfig[tier];

  // An existing subscriber never sees a purchase here: their plan lives in
  // Settings → Billing. The /checkout route already requires the server's own
  // answer about the account, so this is never decided from a saved copy.
  if (isPaidPlan(planOf(account))) {
    // A Starter customer who chose Pro goes straight to the in-app upgrade (W3): same
    // subscription, payment first. Never a second checkout.
    const upgrading = planOf(account) === 'starter' && tier === 'pro';
    return <Navigate to={upgrading ? '/settings?tab=billing&upgrade=pro' : '/settings?tab=billing'} replace />;
  }
  // A subscription on file without paid access (a failed payment, or one still
  // being confirmed): the server would refuse a new one, so say so up front.
  const subscriptionOnFile = blocksNewSubscription(account?.data);

  const handleCheckout = async () => {
    if (processing) return;
    setProcessing(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check if Stripe is configured (production mode)
      const isStripeConfigured = import.meta.env.VITE_STRIPE_ENABLED === 'true';

      if (isStripeConfigured) {
        const idToken = await user.getIdToken();
        const response = await fetch('/.netlify/functions/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ tier }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.url) {
          setError(checkoutErrorMessage(response.status, result.error));
          setProcessing(false);
          return;
        }
        window.location.href = result.url;
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
          features: {
            mobilePhone: tier === 'pro'
          },
          billingCycleDate: new Date().getDate()
        });

        // Redirect to success page
        navigate('/checkout/success');
      }
    } catch (err) {
      console.error('Checkout could not start:', err);
      setError(checkoutErrorMessage(null, null));
      setProcessing(false);
    }
  };

  const handleBackToHome = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
      navigate('/');
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

      {/* Back. With the Free plan on, a free customer goes back to their
          Contact Hub, still signed in. Without it there is nothing an unpaid
          account can open, so this signs out, as it always has. */}
      <div className="absolute top-6 left-6 z-20">
        {FREE_PLAN.enabled ? (
          <Link
            to={FREE_PLAN_HOME}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 font-mono text-sm transition-all hover:scale-105"
          >
            <span aria-hidden="true">←</span>
            <span>BACK TO CONTACT HUB</span>
          </Link>
        ) : (
          <button
            onClick={handleBackToHome}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-cyan-400 font-mono text-sm transition-all hover:scale-105"
          >
            <span className="text-xl">🚀</span>
            <span>BACK TO HOME</span>
          </button>
        )}
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
              Get instant access to Scout & Recon intelligence and lead generation
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

            {subscriptionOnFile && (
              <div role="status" className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100 text-sm">
                <p className="font-semibold mb-1">You already have a subscription on file</p>
                <p>
                  A new one can’t be started while it’s there. It may be waiting on a payment, or still being
                  confirmed. <a className="underline" href={supportMailto()}>Contact support</a> and we’ll sort it out.
                </p>
              </div>
            )}

            {error && (
              <div role="alert" className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-100 text-sm">
                <p>{error}</p>
                <p className="mt-2">
                  <Link className="underline" to="/settings?tab=billing">Settings → Billing</Link>
                  {' · '}
                  <a className="underline" href={supportMailto()}>Contact support</a>
                </p>
              </div>
            )}

            {/* Checkout Button */}
            <button
              onClick={handleCheckout}
              disabled={processing || subscriptionOnFile}
              className={`w-full py-4 px-8 rounded-xl font-bold text-lg font-mono transition-all ${
                processing || subscriptionOnFile
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
              🔐 Secure payment powered by Stripe
            </p>
          </div>

          {/* Security Badge */}
          <div className="text-center">
            <p className="text-gray-500 text-sm font-mono">
              🔒 Secure checkout • Cancel anytime
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
