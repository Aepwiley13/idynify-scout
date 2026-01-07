// Module 15: Credit System - Admin Analytics Component
// Dashboard for tracking credit usage across all users

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/config';

export default function AdminCreditAnalytics() {
  const [analytics, setAnalytics] = useState({
    totalCreditsUsed: 0,
    totalEnrichments: 0,
    activeUsers: 0,
    starterUsers: 0,
    proUsers: 0,
    averageCreditsPerUser: 0,
    topUsers: []
  });
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('7d'); // 7d, 30d, all

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = async () => {
    setLoading(true);

    try {
      // Fetch all users
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);

      let totalCreditsUsed = 0;
      let totalEnrichments = 0;
      let starterCount = 0;
      let proCount = 0;
      const userStats = [];

      // Process each user
      for (const userDoc of usersSnapshot.docs) {
        const userData = userDoc.data();
        const userId = userDoc.id;

        // Get subscription info
        const tier = userData.subscriptionTier || 'starter';
        if (tier === 'starter') starterCount++;
        if (tier === 'pro') proCount++;

        // Calculate credits used (monthly allotment - current credits)
        const monthlyAllotment = tier === 'pro' ? 1250 : 400;
        const currentCredits = userData.credits || 0;
        const creditsUsed = monthlyAllotment - currentCredits;

        totalCreditsUsed += creditsUsed;

        // Get enrichment events
        const eventsRef = collection(db, `users/${userId}/events`);
        const eventsQuery = query(
          eventsRef,
          where('type', '==', 'company_enrichment'),
          orderBy('timestamp', 'desc')
        );

        const eventsSnapshot = await getDocs(eventsQuery);
        const enrichmentCount = eventsSnapshot.size;
        totalEnrichments += enrichmentCount;

        // Store user stats
        userStats.push({
          userId,
          email: userData.email || 'N/A',
          tier,
          creditsUsed,
          enrichments: enrichmentCount,
          creditsRemaining: currentCredits
        });
      }

      // Sort top users by credits used
      const topUsers = userStats
        .sort((a, b) => b.creditsUsed - a.creditsUsed)
        .slice(0, 10);

      setAnalytics({
        totalCreditsUsed,
        totalEnrichments,
        activeUsers: usersSnapshot.size,
        starterUsers: starterCount,
        proUsers: proCount,
        averageCreditsPerUser: usersSnapshot.size > 0 ? Math.round(totalCreditsUsed / usersSnapshot.size) : 0,
        topUsers
      });

    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-8">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-gray-400">Loading analytics...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-white">💳 Credit Analytics</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setTimeRange('7d')}
            className={`px-4 py-2 rounded-lg font-mono text-sm ${
              timeRange === '7d'
                ? 'bg-cyan-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            7 Days
          </button>
          <button
            onClick={() => setTimeRange('30d')}
            className={`px-4 py-2 rounded-lg font-mono text-sm ${
              timeRange === '30d'
                ? 'bg-cyan-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            30 Days
          </button>
          <button
            onClick={() => setTimeRange('all')}
            className={`px-4 py-2 rounded-lg font-mono text-sm ${
              timeRange === 'all'
                ? 'bg-cyan-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            All Time
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 rounded-xl p-6">
          <div className="text-gray-300 text-sm mb-2">Total Credits Used</div>
          <div className="text-4xl font-bold text-cyan-400">{analytics.totalCreditsUsed.toLocaleString()}</div>
          <div className="text-xs text-gray-400 mt-2">
            ~{Math.floor(analytics.totalCreditsUsed / 10)} companies enriched
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-xl p-6">
          <div className="text-gray-300 text-sm mb-2">Total Enrichments</div>
          <div className="text-4xl font-bold text-purple-400">{analytics.totalEnrichments.toLocaleString()}</div>
          <div className="text-xs text-gray-400 mt-2">
            Across all users
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-xl p-6">
          <div className="text-gray-300 text-sm mb-2">Active Users</div>
          <div className="text-4xl font-bold text-green-400">{analytics.activeUsers}</div>
          <div className="text-xs text-gray-400 mt-2">
            {analytics.starterUsers} Starter • {analytics.proUsers} Pro
          </div>
        </div>

        <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30 rounded-xl p-6">
          <div className="text-gray-300 text-sm mb-2">Avg Credits/User</div>
          <div className="text-4xl font-bold text-yellow-400">{analytics.averageCreditsPerUser}</div>
          <div className="text-xs text-gray-400 mt-2">
            Per user average
          </div>
        </div>
      </div>

      {/* Top Users Table */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-4">🏆 Top Credit Users</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-400 font-mono text-sm">Rank</th>
                <th className="text-left py-3 px-4 text-gray-400 font-mono text-sm">User</th>
                <th className="text-left py-3 px-4 text-gray-400 font-mono text-sm">Tier</th>
                <th className="text-right py-3 px-4 text-gray-400 font-mono text-sm">Credits Used</th>
                <th className="text-right py-3 px-4 text-gray-400 font-mono text-sm">Enrichments</th>
                <th className="text-right py-3 px-4 text-gray-400 font-mono text-sm">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {analytics.topUsers.map((user, index) => (
                <tr key={user.userId} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 px-4 text-gray-300 font-mono">#{index + 1}</td>
                  <td className="py-3 px-4 text-white">{user.email}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      user.tier === 'pro'
                        ? 'bg-cyan-500/20 text-cyan-400'
                        : 'bg-purple-500/20 text-purple-400'
                    }`}>
                      {user.tier.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-cyan-400 font-bold">{user.creditsUsed.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-gray-300">{user.enrichments}</td>
                  <td className="py-3 px-4 text-right text-gray-400">{user.creditsRemaining.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revenue Estimation */}
      <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-6">
        <h3 className="text-xl font-bold text-white mb-4">💰 Revenue Estimate</h3>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-gray-400 text-sm mb-1">Starter MRR</div>
            <div className="text-2xl font-bold text-green-400">
              ${(analytics.starterUsers * 20).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-sm mb-1">Pro MRR</div>
            <div className="text-2xl font-bold text-green-400">
              ${(analytics.proUsers * 50).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-sm mb-1">Total MRR</div>
            <div className="text-2xl font-bold text-cyan-400">
              ${((analytics.starterUsers * 20) + (analytics.proUsers * 50)).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
