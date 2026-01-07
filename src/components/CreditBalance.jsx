// Module 15: Credit System - CreditBalance Component
// Reusable UI component to display user's credit balance with visual meter

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';

export default function CreditBalance({ showDetails = false, size = 'medium' }) {
  const [credits, setCredits] = useState(0);
  const [monthlyAllotment, setMonthlyAllotment] = useState(400); // Default to Starter
  const [resetDate, setResetDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  useEffect(() => {
    loadCredits();
  }, []);

  const loadCredits = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));

      if (userDoc.exists()) {
        const data = userDoc.data();

        // Get current credits
        setCredits(data.credits || 0);

        // Determine monthly allotment based on subscription tier
        const tier = data.subscriptionTier || 'starter';
        const allotment = tier === 'pro' ? 1250 : 400;
        setMonthlyAllotment(allotment);

        // Calculate reset date (first day of next month)
        const today = new Date();
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        setResetDate(nextMonth);

        // Show upgrade prompt if credits are low
        if (data.credits < 10) {
          setShowUpgradePrompt(true);
        }
      }
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoading(false);
    }
  };

  const percentage = Math.min((credits / monthlyAllotment) * 100, 100);
  const isLow = credits < monthlyAllotment * 0.1; // Less than 10%
  const isOut = credits < 10; // Less than 10 credits (can't enrich)

  // Size variants
  const sizeClasses = {
    small: {
      container: 'p-3',
      title: 'text-sm',
      creditText: 'text-lg',
      bar: 'h-2'
    },
    medium: {
      container: 'p-4',
      title: 'text-base',
      creditText: 'text-2xl',
      bar: 'h-3'
    },
    large: {
      container: 'p-6',
      title: 'text-lg',
      creditText: 'text-4xl',
      bar: 'h-4'
    }
  };

  const currentSize = sizeClasses[size] || sizeClasses.medium;

  if (loading) {
    return (
      <div className={`bg-gray-900 border border-gray-700 rounded-lg ${currentSize.container}`}>
        <div className="text-gray-400 text-sm">Loading credits...</div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900 border border-gray-700 rounded-lg ${currentSize.container}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className={`text-gray-300 font-semibold ${currentSize.title}`}>
          💳 Credits
        </div>
        <div className={`font-bold ${isOut ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-cyan-400'} ${currentSize.creditText}`}>
          {credits.toLocaleString()}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className={`${currentSize.bar} rounded-full transition-all duration-500 ${
            isOut ? 'bg-red-500' : isLow ? 'bg-yellow-500' : 'bg-cyan-400'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Details */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-gray-700 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Monthly Allotment:</span>
            <span className="text-white font-semibold">{monthlyAllotment.toLocaleString()} credits</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Resets on:</span>
            <span className="text-white font-semibold">
              {resetDate ? resetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Cost per company:</span>
            <span className="text-white font-semibold">10 credits</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Remaining enrichments:</span>
            <span className="text-cyan-400 font-bold">{Math.floor(credits / 10)} companies</span>
          </div>
        </div>
      )}

      {/* Low Credit Warning */}
      {isLow && !isOut && showUpgradePrompt && (
        <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
          <div className="text-yellow-400 text-sm font-semibold mb-2">⚠️ Credits Running Low</div>
          <p className="text-gray-300 text-xs mb-3">
            You have {Math.floor(credits / 10)} enrichments left. Upgrade for more credits!
          </p>
          <button
            onClick={() => window.location.href = '/checkout'}
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-cyan-600 text-white rounded-lg hover:from-purple-500 hover:to-cyan-500 transition-all font-bold text-sm"
          >
            Upgrade Now
          </button>
        </div>
      )}

      {/* Out of Credits */}
      {isOut && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <div className="text-red-400 text-sm font-semibold mb-2">🚫 Out of Credits</div>
          <p className="text-gray-300 text-xs mb-3">
            You need at least 10 credits to enrich a company. Upgrade your plan!
          </p>
          <button
            onClick={() => window.location.href = '/checkout'}
            className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-cyan-600 text-white rounded-lg hover:from-purple-500 hover:to-cyan-500 transition-all font-bold text-sm"
          >
            Upgrade Now
          </button>
        </div>
      )}

      {/* Credit Explainer (if showDetails) */}
      {showDetails && (
        <details className="mt-4">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
            How credits work
          </summary>
          <div className="mt-2 bg-black/50 p-3 rounded border border-gray-700 text-xs text-gray-400 space-y-1">
            <p>• <strong>Browse companies:</strong> FREE (no credits)</p>
            <p>• <strong>Enrich 1 company:</strong> 10 credits total</p>
            <p className="pl-4">- Company data: 1 credit</p>
            <p className="pl-4">- 3 contact names: 3 credits</p>
            <p className="pl-4">- 3 emails: 3 credits</p>
            <p className="pl-4">- 3 phone numbers: 3 credits</p>
            <p className="mt-2">• <strong>Starter ($20/mo):</strong> 400 credits = 40 companies</p>
            <p>• <strong>Pro ($50/mo):</strong> 1,250 credits = 125 companies</p>
          </div>
        </details>
      )}
    </div>
  );
}
