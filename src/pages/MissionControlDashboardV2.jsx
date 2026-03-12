import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { isUserAdmin } from '../utils/adminAuth';
import { useActiveUserId, useImpersonation } from '../context/ImpersonationContext';
import { initializeDashboard, getDashboardState } from '../utils/dashboardUtils';
import { generateDashboardRecommendations, dismissRecommendation } from '../utils/recommendationEngine';
import BarryChatPanel from '../components/dashboard/BarryChatPanel';
import QuickLaunchStrip from '../components/dashboard/QuickLaunchStrip';
import MissionCardDeck from '../components/dashboard/MissionCardDeck';
import AttentionCarousel from '../components/dashboard/AttentionCarousel';
import ModuleNavigationGrid from '../components/dashboard/ModuleNavigationGrid';
import BottomNav from '../components/layout/BottomNav';
import MoreSheet from '../components/layout/MoreSheet';

export default function MissionControlDashboardV2() {
  const navigate = useNavigate();
  const activeUserId = useActiveUserId();
  const { isImpersonating, isReadOnly } = useImpersonation();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [hasCompletedICP, setHasCompletedICP] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [stats, setStats] = useState({
    scoutCompanies: 0,
    scoutContacts: 0,
    reconCompletion: 0,
    hunterMissions: 0
  });
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [activeModule, setActiveModule] = useState(null);

  useEffect(() => {
    loadDashboardStats();
  }, [activeUserId]);

  const loadDashboardStats = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Use activeUserId (target user when impersonating, real user otherwise)
      const userId = activeUserId || user.uid;
      setUserId(userId);

      // Check if real user is admin (not the impersonated user)
      const adminStatus = await isUserAdmin(user.uid);
      setIsAdmin(adminStatus);

      // Initialize dashboard if it doesn't exist
      console.log('🔄 Initializing dashboard...');
      const initResult = await initializeDashboard(userId);
      console.log('✅ Dashboard initialization result:', initResult);

      // Count accepted companies
      const companiesQuery = query(
        collection(db, 'users', userId, 'companies'),
        where('status', '==', 'accepted')
      );
      const companiesSnapshot = await getDocs(companiesQuery);

      // Count contacts
      const contactsSnapshot = await getDocs(
        collection(db, 'users', userId, 'contacts')
      );

      // Get RECON completion from dashboard
      const dashboardState = await getDashboardState(userId);
      const reconModule = dashboardState?.modules?.find(m => m.id === 'recon');
      const reconCompletion = reconModule?.progressPercentage || 0;

      // Count active Hunter missions (status: 'autopilot' or 'draft')
      const missionsSnapshot = await getDocs(
        collection(db, 'users', userId, 'missions')
      );
      const hunterMissions = missionsSnapshot.docs.filter(d => {
        const s = d.data().status;
        return s === 'autopilot' || s === 'draft';
      }).length;

      // Check if user has completed ICP settings
      // ICP data is stored at users/{uid}/companyProfile/current (set by ICPSettings + BarryOnboarding)
      const icpDoc = await getDoc(doc(db, 'users', userId, 'companyProfile', 'current'));
      const hasICP = icpDoc.exists() && (icpDoc.data().industries?.length > 0 || icpDoc.data().managedByBarry);
      setHasCompletedICP(hasICP);

      // Check if user has seen the welcome popup
      const userDoc = await getDoc(doc(db, 'users', userId));
      const hasSeenWelcome = userDoc.exists() && userDoc.data().hasSeenWelcomePopup === true;

      // Show welcome modal only for first-time users (never seen before AND no ICP set up)
      if (!hasSeenWelcome && !hasICP) {
        setShowWelcomeModal(true);
      }

      setStats({
        scoutCompanies: companiesSnapshot.size,
        scoutContacts: contactsSnapshot.size,
        reconCompletion,
        hunterMissions
      });

      setLoading(false);

      // Load Barry's proactive recommendations (non-blocking)
      loadRecommendations(userId);
    } catch (error) {
      console.error('❌ Error loading dashboard stats:', error);
      setLoading(false);
    }
  };

  const loadRecommendations = async (userId) => {
    try {
      setRecommendationsLoading(true);
      const recs = await generateDashboardRecommendations(userId);
      setRecommendations(recs);
    } catch (error) {
      console.error('[Dashboard] Failed to load recommendations:', error);
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const handleDismissRecommendation = async (recommendationId, reason) => {
    const user = auth.currentUser;
    if (!user) return;
    const success = await dismissRecommendation(user.uid, recommendationId, reason);
    if (success) {
      setRecommendations(prev => prev.filter(r => r.id !== recommendationId));
    }
  };

  const handleRecommendationAction = (recommendation) => {
    // Route to the appropriate surface based on action type
    if (recommendation.contactId) {
      navigate(`/scout/contact/${recommendation.contactId}`);
    } else if (recommendation.missionId) {
      navigate(`/hunter/mission/${recommendation.missionId}`);
    } else if (recommendation.campaignId) {
      navigate('/hunter');
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Log out of Mission Control?')) {
      try {
        await signOut(auth);
        navigate('/login');
      } catch (error) {
        console.error('Error logging out:', error);
      }
    }
  };

  const handleCloseWelcomeModal = async () => {
    const user = auth.currentUser;
    if (user) {
      try {
        // Mark welcome popup as seen in Firestore
        await updateDoc(doc(db, 'users', user.uid), {
          hasSeenWelcomePopup: true
        });
        console.log('✅ Welcome popup marked as seen');
      } catch (error) {
        console.error('Error updating welcome popup flag:', error);
      }
    }
    setShowWelcomeModal(false);
  };

  const handleScoutClick = () => {
    // Always route to Daily Leads (default tab)
    navigate('/scout?tab=daily-leads');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-400 text-2xl font-mono animate-pulse">
          [INITIALIZING MISSION CONTROL...]
        </div>
      </div>
    );
  }

  return (
    <div className="mc-v2-root min-h-screen bg-black relative overflow-hidden text-white">
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

      {/* Galaxy Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-blue-900/20 to-pink-900/30"></div>

      {/* Grid Pattern at Bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-96 bg-gradient-to-t from-cyan-900/20 to-transparent" style={{ perspective: '1000px' }}>
        <svg className="w-full h-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ transform: 'rotateX(60deg) translateY(20%)' }}>
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="cyan" strokeWidth="0.3" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>
      </div>

      {/* LOGOUT and ADMIN Buttons — hidden on mobile (accessible via More sheet) */}
      <div className="mc-top-actions absolute top-6 right-6 z-50 flex items-center gap-3">
        {isAdmin && (
          <button
            onClick={() => navigate('/admin')}
            className="bg-cyan-900/40 hover:bg-cyan-900/60 border border-cyan-500/50 text-cyan-300 px-4 py-2 rounded-lg font-mono text-xs transition-all flex items-center gap-2"
          >
            <span>🔧</span> ADMIN
          </button>
        )}
        <button
          onClick={handleLogout}
          className="bg-red-900/40 hover:bg-red-900/60 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg font-mono text-xs transition-all flex items-center gap-2"
        >
          <span>👤</span> LOGOUT
        </button>
      </div>

      {/* HEADER */}
      <header className="relative z-40 pt-10 pb-6 md:pt-12 md:pb-8 border-b border-cyan-500/20 backdrop-blur-sm bg-black/30">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          {/* Barry the AI Assistant - Top Left */}
          <div className="hidden md:flex absolute left-8 top-8 items-center gap-3 group">
            <div className="relative">
              <div className="flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-6xl">🐻</span>
              </div>
              <div className="absolute -top-2 -right-2 text-2xl animate-pulse">⭐</div>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">Barry the AI Assistant</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-cyan-400 font-mono text-xs">Online</span>
              </div>
            </div>
          </div>

          <div className="text-center">
            <h1 className="mc-title text-3xl md:text-6xl font-bold tracking-wider font-mono text-white mb-2 md:mb-3" style={{
              textShadow: '0 0 20px rgba(6, 182, 212, 0.8), 0 0 40px rgba(139, 92, 246, 0.4)',
              letterSpacing: '0.1em'
            }}>
              MISSION CONTROL
            </h1>
            <div className="flex items-center justify-center gap-3 text-cyan-400 font-mono text-xs md:text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>System ready for deployment</span>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-16 relative z-10">
        {/* BARRY CHAT PANEL — Mission Co-pilot */}
        {userId && <BarryChatPanel userId={userId} />}

        {/* QUICK LAUNCH STRIP — Horizontal carousel, opens inline deck (Scout, Hunter, RECON) */}
        <QuickLaunchStrip
          stats={stats}
          activeModule={activeModule}
          onModuleSelect={(id) => {
            setActiveModule(prev => prev === id ? null : id);
          }}
        />

        {/* MISSION CARD DECK — Inline, below carousel */}
        {activeModule && userId && (
          <MissionCardDeck
            module={activeModule}
            userId={userId}
            onClose={() => setActiveModule(null)}
          />
        )}

        {/* MODULE NAVIGATION GRID — 4-card prominent launcher above Attention Required */}
        <ModuleNavigationGrid
          stats={stats}
          onScoutClick={handleScoutClick}
          onNavigate={(route) => navigate(route)}
        />

        {/* ATTENTION REQUIRED — Barry's pipeline signals */}
        <AttentionCarousel
          recommendations={recommendations}
          userId={userId}
          loading={recommendationsLoading}
        />
      </main>

      {/* Welcome Modal for First-Time Users */}
      {showWelcomeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative max-w-2xl w-full bg-gradient-to-br from-gray-900 to-black rounded-2xl border-2 border-cyan-500/50 shadow-2xl shadow-cyan-500/30 p-8 animate-fadeIn">
            {/* Close button */}
            <button
              onClick={handleCloseWelcomeModal}
              className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-all text-3xl md:text-2xl"
              aria-label="Close welcome popup"
            >
              ×
            </button>

            {/* Welcome Header with Barry */}
            <div className="text-center mb-6">
              <div className="inline-block relative mb-4">
                <div className="flex items-center justify-center mx-auto">
                  <span className="text-6xl">🐻</span>
                </div>
                <div className="absolute -top-2 -right-2 text-3xl animate-pulse">⭐</div>
              </div>
              <h2 className="text-4xl font-bold text-white mb-2 font-mono">Welcome to Mission Control!</h2>
              <p className="text-cyan-400 text-lg font-semibold">Barry is ready to help you find your ideal customers</p>
            </div>

            {/* Mission Briefing */}
            <div className="bg-black/50 rounded-xl p-6 border border-cyan-500/30 mb-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🎯</span> Your First Mission
              </h3>
              <p className="text-gray-300 mb-4 leading-relaxed">
                Before Barry can start finding companies for you, you need to define your <span className="text-cyan-400 font-semibold">Ideal Customer Profile (ICP)</span>.
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-cyan-500/20 border border-cyan-400/50 rounded-lg flex items-center justify-center">
                    <span className="text-cyan-300 font-bold text-sm">1</span>
                  </div>
                  <p className="text-gray-300 text-sm pt-1">Answer 5 quick questions about your ideal customer</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-500/20 border border-purple-400/50 rounded-lg flex items-center justify-center">
                    <span className="text-purple-300 font-bold text-sm">2</span>
                  </div>
                  <p className="text-gray-300 text-sm pt-1">Barry uses this to find companies that match your profile</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 bg-pink-500/20 border border-pink-400/50 rounded-lg flex items-center justify-center">
                    <span className="text-pink-300 font-bold text-sm">3</span>
                  </div>
                  <p className="text-gray-300 text-sm pt-1">Start receiving daily leads of companies ready to engage with</p>
                </div>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={async () => {
                  await handleCloseWelcomeModal();
                  handleScoutClick();
                }}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg shadow-cyan-500/50 font-mono text-lg"
              >
                🚀 Set Up My ICP
              </button>
              <button
                onClick={handleCloseWelcomeModal}
                className="flex-1 sm:flex-none bg-gray-700/50 hover:bg-gray-700 text-gray-300 hover:text-white font-semibold py-4 px-6 rounded-xl transition-all border border-gray-600/50 font-mono"
              >
                I'll Do This Later
              </button>
            </div>

            <p className="text-gray-500 text-xs text-center mt-4 font-mono">
              Takes ~2 minutes • You can change this anytime in Scout → ICP Settings
            </p>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      <BottomNav onOpenMore={() => setMoreSheetOpen(true)} />

      {/* Mobile More Sheet */}
      <MoreSheet isOpen={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} isAdmin={isAdmin} />

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes rocketFloat {
          0%, 100% { transform: translateY(0px) rotate(-45deg); }
          50% { transform: translateY(-15px) rotate(-45deg); }
        }
        @keyframes brainPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes qlBounce {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }
        @keyframes qlBrainPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        .grayscale {
          filter: grayscale(100%);
        }
        /* Mobile: add bottom padding so content isn't hidden behind bottom nav */
        @media (max-width: 768px) {
          .mc-v2-root {
            padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
          }
          .mc-top-actions {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
