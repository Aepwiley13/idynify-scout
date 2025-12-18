import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);

  const handleCheckout = async () => {
    setProcessing(true);

    try {
      // TODO: Replace with actual Stripe integration
      // For now, simulate payment and mark as completed
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Simulate payment processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mark payment as completed in Firestore
      await updateDoc(doc(db, 'users', user.uid), {
        hasCompletedPayment: true,
        paymentCompletedAt: new Date().toISOString(),
        subscriptionTier: 'pro',
        subscriptionStatus: 'active'
      });

      // Redirect to success page
      navigate('/checkout/success');
    } catch (error) {
      console.error('Payment error:', error);
      alert('Payment failed. Please try again.');
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
          <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border-2 border-cyan-500/30 mb-8">
            <div className="text-center mb-6">
              <div className="text-sm text-gray-400 font-mono mb-2">IDYNIFY SCOUT PRO</div>
              <div className="text-5xl font-bold text-white mb-2">$97<span className="text-2xl text-gray-400">/mo</span></div>
              <div className="text-gray-400 text-sm">Billed monthly • Cancel anytime</div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-start gap-3">
                <span className="text-green-400 text-xl">✓</span>
                <div>
                  <p className="text-white font-semibold">RECON Module</p>
                  <p className="text-gray-400 text-sm">AI-powered ICP definition & market intelligence</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-green-400 text-xl">✓</span>
                <div>
                  <p className="text-white font-semibold">SCOUT Module</p>
                  <p className="text-gray-400 text-sm">Unlimited lead generation & contact discovery</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-green-400 text-xl">✓</span>
                <div>
                  <p className="text-white font-semibold">SNIPER Module</p>
                  <p className="text-gray-400 text-sm">Precision outreach campaigns & analytics</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-green-400 text-xl">✓</span>
                <div>
                  <p className="text-white font-semibold">Priority Support</p>
                  <p className="text-gray-400 text-sm">Email support within 24 hours</p>
                </div>
              </div>
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
              ⚠️ PLACEHOLDER: Replace with actual Stripe integration
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
