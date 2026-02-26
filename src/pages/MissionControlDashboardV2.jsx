import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { isUserAdmin } from '../utils/adminAuth';
import { initializeDashboard, getDashboardState } from '../utils/dashboardUtils';
import { generateDashboardRecommendations, dismissRecommendation } from '../utils/recommendationEngine';
import BarryChatPanel from '../components/dashboard/BarryChatPanel';
import QuickLaunchStrip from '../components/dashboard/QuickLaunchStrip';
import MissionCardDeck from '../components/dashboard/MissionCardDeck';
import AttentionCarousel from '../components/dashboard/AttentionCarousel';

export default function MissionControlDashboardV2() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
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
  }, []);

  const loadDashboardStats = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;
      setUserId(userId);

      // Check if user is admin
      const adminStatus = await isUserAdmin(userId);
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
    <div className="min-h-screen bg-black relative overflow-hidden text-white">
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

      {/* LOGOUT and ADMIN Buttons */}
      <div className="absolute top-6 right-6 z-50 flex items-center gap-3">
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
      <header className="relative z-40 pt-12 pb-8 border-b border-cyan-500/20 backdrop-blur-sm bg-black/30">
        <div className="max-w-7xl mx-auto px-6">
          {/* Barry the AI Assistant - Top Left */}
          <div className="absolute left-8 top-8 flex items-center gap-3 group">
            <div className="relative">
              <div className="flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-6xl">🐻</span>
              </div>
              {/* Star decoration */}
              <div className="absolute -top-2 -right-2 text-2xl animate-pulse">⭐</div>
            </div>
            <div className="hidden md:block">
              <p className="text-white font-semibold text-sm">Barry the AI Assistant</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-cyan-400 font-mono text-xs">Online</span>
              </div>
            </div>
          </div>

          <div className="text-center">
            <h1 className="text-6xl font-bold tracking-wider font-mono text-white mb-3" style={{
              textShadow: '0 0 20px rgba(6, 182, 212, 0.8), 0 0 40px rgba(139, 92, 246, 0.4)',
              letterSpacing: '0.15em'
            }}>
              MISSION CONTROL
            </h1>
            <div className="flex items-center justify-center gap-3 text-cyan-400 font-mono text-sm">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>System ready for deployment</span>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="max-w-7xl mx-auto px-6 py-16 relative z-10">
        {/* BARRY CHAT PANEL — Mission Co-pilot */}
        {userId && <BarryChatPanel userId={userId} />}

        {/* QUICK LAUNCH STRIP — Horizontal carousel, navigates to Daily Lead Insights */}
        <QuickLaunchStrip
          stats={stats}
          activeModule={activeModule}
          onModuleSelect={(id) => {
            if (id === 'scout') navigate('/scout?tab=daily-leads');
            else setActiveModule(prev => prev === id ? null : id);
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

        {/* ATTENTION REQUIRED — Barry's pipeline signals */}
        <AttentionCarousel
          recommendations={recommendations}
          userId={userId}
          loading={recommendationsLoading}
        />

        {/* MODULES */}
        <section>
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="h-px w-24 bg-gradient-to-r from-transparent to-cyan-500"></div>
            <h3 className="text-2xl font-mono text-white">Modules</h3>
            <div className="h-px w-24 bg-gradient-to-l from-transparent to-cyan-500"></div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {/* SCOUT - Active */}
            <div
              onClick={handleScoutClick}
              className="group cursor-pointer bg-black/50 backdrop-blur-xl rounded-2xl p-6 border-2 border-cyan-500/50 hover:border-cyan-400 transition-all duration-300 relative overflow-hidden"
              style={{
                boxShadow: '0 0 30px rgba(6, 182, 212, 0.3), inset 0 0 30px rgba(6, 182, 212, 0.05)'
              }}
            >
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

              {/* Scout Icon - Tactical Map */}
              <div className="relative mb-4 h-32 flex items-center justify-center">
                <div className="relative">
                  {/* Map base */}
                  <div className="w-24 h-24 rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-600/30 border-2 border-cyan-400/50 transform rotate-3 shadow-lg shadow-cyan-500/50">
                    {/* Grid lines */}
                    <div className="absolute inset-2 border border-cyan-400/30"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-1 h-full bg-cyan-400/20"></div>
                      <div className="h-1 w-full bg-cyan-400/20 absolute"></div>
                    </div>
                  </div>
                  {/* Location Pin */}
                  <div className="absolute -top-2 -right-2 text-4xl animate-bounce" style={{ animationDuration: '2s' }}>📍</div>
                  {/* Glow rings */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full border-2 border-cyan-400/20 animate-ping"></div>
                </div>
              </div>

              <h4 className="font-mono text-2xl mb-3 text-white font-bold">SCOUT</h4>

              <span className="inline-block text-xs bg-emerald-500 text-white px-3 py-1 rounded-full font-mono font-semibold">
                ACTIVE
              </span>

              <p className="text-sm text-gray-300 mt-4 mb-5">
                Discover and track your ideal customers
              </p>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-black/60 rounded-lg p-3 border border-cyan-500/30">
                  <p className="text-xs text-gray-400 font-mono">Companies</p>
                  <p className="text-3xl font-mono text-cyan-400 font-bold">{stats.scoutCompanies}</p>
                </div>
                <div className="bg-black/60 rounded-lg p-3 border border-cyan-500/30">
                  <p className="text-xs text-gray-400 font-mono">Contacts</p>
                  <p className="text-3xl font-mono text-cyan-400 font-bold">{stats.scoutContacts}</p>
                </div>
              </div>

              <button className="relative w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-mono text-sm font-bold transition-all shadow-lg shadow-cyan-500/50">
                Enter Scout →
              </button>
            </div>

            {/* HUNTER - Active */}
            <div
              onClick={() => navigate('/hunter')}
              className="bg-gradient-to-br from-pink-900/30 via-purple-900/30 to-pink-800/30 backdrop-blur-xl rounded-2xl p-6 border-2 border-pink-500/30 relative overflow-hidden cursor-pointer hover:scale-105 transition-all duration-300 hover:border-pink-400/50 group"
            >
              {/* Active Badge */}
              <div className="absolute top-4 right-4">
                <span className="inline-block text-xs bg-gradient-to-r from-pink-500 to-purple-600 text-white px-3 py-1 rounded-full font-mono font-semibold animate-pulse">
                  ACTIVE
                </span>
              </div>

              {/* Hunter Icon - Crosshair */}
              <div className="relative mb-4 h-32 flex items-center justify-center">
                <div className="relative">
                  {/* Crosshair */}
                  <div className="relative w-24 h-24 rounded-full border-4 border-pink-400 flex items-center justify-center group-hover:border-pink-300 transition-colors">
                    <div className="w-1 h-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors"></div>
                    <div className="h-1 w-full bg-pink-400 absolute group-hover:bg-pink-300 transition-colors"></div>
                    <div className="w-8 h-8 rounded-full border-2 border-pink-400 group-hover:border-pink-300 transition-colors"></div>
                    <div className="w-2 h-2 rounded-full bg-pink-400 group-hover:bg-pink-300 transition-colors animate-pulse"></div>
                  </div>
                  {/* Targeting marks */}
                  <div className="absolute top-0 left-1/2 w-px h-4 bg-pink-400 group-hover:bg-pink-300 transition-colors"></div>
                  <div className="absolute bottom-0 left-1/2 w-px h-4 bg-pink-400 group-hover:bg-pink-300 transition-colors"></div>
                  <div className="absolute left-0 top-1/2 h-px w-4 bg-pink-400 group-hover:bg-pink-300 transition-colors"></div>
                  <div className="absolute right-0 top-1/2 h-px w-4 bg-pink-400 group-hover:bg-pink-300 transition-colors"></div>
                </div>
              </div>

              <h4 className="font-mono text-2xl mb-3 text-white font-bold">HUNTER</h4>

              <p className="text-sm text-pink-200/80 mt-4 mb-8">
                Automated outreach campaigns
              </p>

              {/* Action Button */}
              <button className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 text-white font-mono text-sm font-bold hover:from-pink-600 hover:to-purple-700 transition-all shadow-lg">
                Launch Hunter →
              </button>
            </div>

            {/* RECON - Active (Optional) */}
            <div
              onClick={() => navigate('/mission-control-v2/recon')}
              className="group cursor-pointer bg-black/50 backdrop-blur-xl rounded-2xl p-6 border-2 border-purple-500/50 hover:border-purple-400 transition-all duration-300 relative overflow-hidden"
              style={{
                boxShadow: '0 0 30px rgba(168, 85, 247, 0.3), inset 0 0 30px rgba(168, 85, 247, 0.05)'
              }}
            >
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

              {/* Recon Icon - AI Brain */}
              <div className="relative mb-4 h-32 flex items-center justify-center">
                <div className="relative">
                  {/* Brain glow */}
                  <div className="absolute inset-0 bg-pink-500/30 rounded-full blur-xl animate-pulse"></div>
                  {/* Brain */}
                  <div className="relative text-7xl" style={{
                    filter: 'drop-shadow(0 0 10px rgba(236, 72, 153, 0.8))',
                    animation: 'brainPulse 2s ease-in-out infinite'
                  }}>
                    🧠
                  </div>
                  {/* Neural connections */}
                  <div className="absolute top-0 left-0 w-full h-full">
                    <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-pink-400 rounded-full animate-ping"></div>
                    <div className="absolute top-3/4 right-1/4 w-2 h-2 bg-purple-400 rounded-full animate-ping" style={{ animationDelay: '0.5s' }}></div>
                    <div className="absolute top-1/2 right-1/3 w-2 h-2 bg-cyan-400 rounded-full animate-ping" style={{ animationDelay: '1s' }}></div>
                  </div>
                </div>
              </div>

              <h4 className="font-mono text-2xl mb-3 text-white font-bold">RECON</h4>

              <div className="flex gap-2 mb-4">
                <span className="inline-block text-xs bg-emerald-500 text-white px-3 py-1 rounded-full font-mono font-semibold">
                  ACTIVE
                </span>
                <span className="inline-block text-xs bg-yellow-500 text-white px-3 py-1 rounded-full font-mono font-semibold">
                  OPTIONAL
                </span>
              </div>

              <p className="text-sm text-gray-300 mt-4 mb-5">
                Train your AI Assistant
              </p>

              <div className="mb-6">
                <div className="bg-black/60 rounded-lg p-4 border border-purple-500/30">
                  <p className="text-xs text-gray-400 font-mono mb-2">Completion</p>
                  <p className="text-3xl font-mono text-purple-400 font-bold mb-3">
                    {stats.reconCompletion}%
                  </p>
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-2 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-full transition-all duration-500"
                      style={{ width: `${stats.reconCompletion}%` }}
                    />
                  </div>
                </div>
              </div>

              <button className="relative w-full py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white font-mono text-sm font-bold transition-all shadow-lg shadow-purple-500/50">
                Train AI →
              </button>
            </div>

            {/* SNIPER - Locked */}
            <div className="bg-black/40 backdrop-blur-xl rounded-2xl p-6 border-2 border-gray-600/30 relative overflow-hidden opacity-70">
              {/* Lock Icon */}
              <div className="absolute top-4 right-4 text-3xl">🔒</div>

              {/* Sniper Icon - Scope View */}
              <div className="relative mb-4 h-32 flex items-center justify-center">
                <div className="relative grayscale opacity-50">
                  {/* Scope outer ring */}
                  <div className="relative w-24 h-24 rounded-full border-4 border-gray-500 flex items-center justify-center bg-black/80">
                    {/* Crosshair */}
                    <div className="w-px h-full bg-gray-500 absolute"></div>
                    <div className="h-px w-full bg-gray-500 absolute"></div>
                    {/* Center dot */}
                    <div className="w-3 h-3 rounded-full bg-gray-500"></div>
                    {/* Range markers */}
                    <div className="absolute top-1/2 left-6 h-px w-2 bg-gray-500"></div>
                    <div className="absolute top-1/2 right-6 h-px w-2 bg-gray-500"></div>
                    <div className="absolute left-1/2 top-6 w-px h-2 bg-gray-500"></div>
                    <div className="absolute left-1/2 bottom-6 w-px h-2 bg-gray-500"></div>
                  </div>
                </div>
              </div>

              <h4 className="font-mono text-2xl mb-3 text-white font-bold">SNIPER</h4>

              <span className="inline-block text-xs bg-gray-600 text-white px-3 py-1 rounded-full font-mono font-semibold">
                COMING SOON
              </span>

              <p className="text-sm text-gray-400 mt-4 mb-8">
                Advanced targeting & personalization
              </p>

              {/* Lock icon in button area */}
              <div className="flex flex-col items-center gap-3 mt-12">
                <div className="text-5xl opacity-50">🔒</div>
                <button className="w-full py-3 rounded-xl bg-gray-700/50 text-gray-400 font-mono text-sm font-bold cursor-not-allowed border border-gray-600/50">
                  Unlock Sniper
                </button>
              </div>
            </div>
          </div>
        </section>
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
      `}</style>
    </div>
  );
}
