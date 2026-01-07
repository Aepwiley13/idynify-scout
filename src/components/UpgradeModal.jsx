// Module 15: Credit System - UpgradeModal Component
// Modal that appears when user runs out of credits

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase/config';

export default function UpgradeModal({ isOpen, onClose, currentCredits = 0 }) {
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(false);

  if (!isOpen) return null;

  const handleUpgrade = async (tier) => {
    setProcessing(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Redirect to checkout with selected tier
      navigate(`/checkout?tier=${tier}`);
    } catch (error) {
      console.error('Upgrade error:', error);
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gradient-to-br from-gray-900 to-black border-2 border-cyan-500/50 rounded-3xl max-w-5xl w-full relative overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition-all"
        >
          ✕
        </button>

        {/* Header */}
        <div className="text-center p-8 pb-4">
          <div className="text-6xl mb-4">🚀</div>
          <h2 className="text-4xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono mb-2">
            OUT OF CREDITS
          </h2>
          <p className="text-gray-300 text-lg">
            You have <span className="text-red-400 font-bold">{currentCredits} credits</span> remaining
          </p>
          <p className="text-gray-400 mt-2">
            Upgrade your plan to unlock more enrichments and continue finding your ideal clients!
          </p>
        </div>

        {/* Pricing Comparison */}
        <div className="grid md:grid-cols-2 gap-6 p-8 pt-4">
          {/* Starter Plan */}
          <div className="bg-black/40 backdrop-blur-xl rounded-2xl p-8 border-2 border-gray-600 hover:border-purple-500/50 transition-all relative">
            <div className="text-center mb-6">
              <div className="text-sm text-gray-400 font-mono mb-2">STARTER</div>
              <div className="text-5xl font-bold text-white mb-2">
                $20<span className="text-2xl text-gray-400">/mo</span>
              </div>
              <div className="text-gray-400 text-sm">Perfect for getting started</div>
            </div>

            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-400 text-xl">✓</span>
                <div>
                  <span className="text-white font-semibold">400 credits/month</span>
                  <span className="text-gray-400"> (40 enriched companies)</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-400 text-xl">✓</span>
                <span className="text-gray-300">Unlimited company browsing</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-400 text-xl">✓</span>
                <span className="text-gray-300">120 contact details/month</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-400 text-xl">✓</span>
                <span className="text-gray-300">Full RECON access</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-400 text-xl">✓</span>
                <span className="text-gray-300">CSV exports (basic)</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-400 text-xl">✓</span>
                <span className="text-gray-300">48hr email support</span>
              </div>
            </div>

            <button
              onClick={() => handleUpgrade('starter')}
              disabled={processing}
              className={`w-full py-4 px-6 rounded-xl font-bold text-lg font-mono transition-all ${
                processing
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 shadow-lg shadow-purple-500/50'
              } text-white`}
            >
              {processing ? 'PROCESSING...' : 'UPGRADE TO STARTER'}
            </button>
          </div>

          {/* Pro Plan - Recommended */}
          <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border-2 border-cyan-500 hover:border-cyan-400 transition-all relative">
            {/* Popular Badge */}
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <div className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white px-4 py-1 rounded-full text-xs font-bold">
                ⭐ RECOMMENDED
              </div>
            </div>

            <div className="text-center mb-6">
              <div className="text-sm text-gray-400 font-mono mb-2">PRO</div>
              <div className="text-5xl font-bold text-white mb-2">
                $50<span className="text-2xl text-gray-400">/mo</span>
              </div>
              <div className="text-gray-400 text-sm">Best value for serious prospecting</div>
            </div>

            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-cyan-400 text-xl">✓</span>
                <div>
                  <span className="text-white font-semibold">1,250 credits/month</span>
                  <span className="text-gray-400"> (125 enriched companies)</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-cyan-400 text-xl">✓</span>
                <span className="text-gray-300">Unlimited company browsing</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-cyan-400 text-xl">✓</span>
                <span className="text-gray-300">375 contact details/month</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-cyan-400 text-xl">✓</span>
                <span className="text-gray-300">Full RECON access + PDF export</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-cyan-400 text-xl">✓</span>
                <span className="text-gray-300">CSV exports (unlimited)</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-cyan-400 text-xl">✓</span>
                <span className="text-gray-300">24hr email support</span>
              </div>
            </div>

            <button
              onClick={() => handleUpgrade('pro')}
              disabled={processing}
              className={`w-full py-4 px-6 rounded-xl font-bold text-lg font-mono transition-all ${
                processing
                  ? 'bg-gray-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-2xl shadow-cyan-500/50'
              } text-white`}
            >
              {processing ? 'PROCESSING...' : 'UPGRADE TO PRO'}
            </button>

            {/* Savings Badge */}
            <div className="mt-4 text-center">
              <div className="inline-block bg-green-500/10 border border-green-500/30 rounded-full px-4 py-1">
                <span className="text-green-400 text-sm font-semibold">💰 Save $12.50 vs monthly</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 text-center">
          <p className="text-gray-500 text-sm mb-4">
            🔒 Secure checkout • Cancel anytime • 30-day money-back guarantee
          </p>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-sm underline transition-all"
          >
            Not now, continue with {currentCredits} credits
          </button>
        </div>
      </div>
    </div>
  );
}
