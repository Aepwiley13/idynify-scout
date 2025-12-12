// Module 15: Quota Display & Dashboard - QuotaDisplay Component

import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { getPath } from '../firebase/schema';

export default function QuotaDisplay({ companyId, companyName }) {
  const [dailyQuota, setDailyQuota] = useState({ used: 0, limit: 5 });
  const [weeklyQuota, setWeeklyQuota] = useState({ used: 0, limit: 50 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQuotas();
  }, [companyId]);

  const loadQuotas = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      // Fetch quotas from Firestore
      const quotasPath = getPath.userQuotas(user.uid);
      const quotasRef = doc(db, quotasPath);
      const quotasDoc = await getDoc(quotasRef);

      if (quotasDoc.exists()) {
        const quotasData = quotasDoc.data();
        const today = new Date().toISOString().split('T')[0];

        // Calculate daily quota for current company
        let dailyUsed = 0;
        if (companyId && quotasData.daily_enrichments) {
          const companyDailyData = quotasData.daily_enrichments[companyId];
          if (companyDailyData && companyDailyData[today]) {
            dailyUsed = companyDailyData[today];
          }
        }

        // Calculate weekly quota
        let weeklyUsed = 0;
        if (quotasData.weekly_enrichments) {
          const weekStart = getWeekStart();
          weeklyUsed = quotasData.weekly_enrichments[weekStart] || 0;
        }

        setDailyQuota({ used: dailyUsed, limit: 5 });
        setWeeklyQuota({ used: weeklyUsed, limit: 50 });
      }
    } catch (error) {
      console.error('Error loading quotas:', error);
    } finally {
      setLoading(false);
    }
  };

  const getWeekStart = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return monday.toISOString().split('T')[0];
  };

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <div className="text-gray-400 text-sm">Loading quotas...</div>
      </div>
    );
  }

  const dailyPercentage = (dailyQuota.used / dailyQuota.limit) * 100;
  const weeklyPercentage = (weeklyQuota.used / weeklyQuota.limit) * 100;

  const dailyExceeded = dailyQuota.used >= dailyQuota.limit;
  const weeklyExceeded = weeklyQuota.used >= weeklyQuota.limit;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
      <h3 className="text-xl font-bold text-white mb-4">Quota Status</h3>

      {/* Daily Quota */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <div className="text-gray-300 text-sm">
            {companyName ? (
              <>Daily contacts for <span className="text-cyan-400">{companyName}</span></>
            ) : (
              'Daily contacts'
            )}
          </div>
          <div className={`font-bold ${dailyExceeded ? 'text-red-400' : 'text-cyan-400'}`}>
            {dailyQuota.used}/{dailyQuota.limit}
          </div>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              dailyExceeded ? 'bg-red-500' : 'bg-cyan-400'
            }`}
            style={{ width: `${Math.min(dailyPercentage, 100)}%` }}
          />
        </div>
        {dailyExceeded && (
          <div className="text-red-400 text-xs mt-1">Daily limit reached for this company</div>
        )}
      </div>

      {/* Weekly Quota */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <div className="text-gray-300 text-sm">Weekly leads enriched</div>
          <div className={`font-bold ${weeklyExceeded ? 'text-red-400' : 'text-cyan-400'}`}>
            {weeklyQuota.used}/{weeklyQuota.limit}
          </div>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              weeklyExceeded ? 'bg-red-500' : 'bg-cyan-400'
            }`}
            style={{ width: `${Math.min(weeklyPercentage, 100)}%` }}
          />
        </div>
        {weeklyExceeded && (
          <div className="text-red-400 text-xs mt-1">Weekly limit reached</div>
        )}
      </div>

      {/* Upgrade CTA */}
      {(dailyExceeded || weeklyExceeded) && (
        <div className="mt-6 pt-4 border-t border-gray-700">
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-3">
              Need more leads? Upgrade your plan
            </p>
            <button className="px-6 py-2 bg-gradient-to-r from-purple-600 to-cyan-600 text-white rounded-lg hover:from-purple-500 hover:to-cyan-500 transition-all font-bold">
              Upgrade Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
