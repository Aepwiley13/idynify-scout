import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import dashboardSchema from '../schemas/dashboardSchema.json';

export default function MissionControlDashboardV2() {
  const navigate = useNavigate();
  const [dashboardState, setDashboardState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('overview');

  useEffect(() => {
    initializeDashboard();
  }, []);

  const initializeDashboard = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Try to load existing dashboard state
      const dashboardRef = doc(db, 'dashboards', user.uid);
      const dashboardDoc = await getDoc(dashboardRef);

      if (dashboardDoc.exists()) {
        console.log('✅ Dashboard state loaded from Firestore');
        setDashboardState(dashboardDoc.data());
      } else {
        // Initialize new dashboard from schema
        console.log('🆕 Creating new dashboard state from schema');
        const initialState = {
          ...dashboardSchema.dashboard,
          userId: user.uid,
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          userState: {
            ...dashboardSchema.dashboard.userState,
            accountCreatedAt: user.metadata.creationTime,
            lastLoginAt: new Date().toISOString(),
            totalSessions: 1
          }
        };

        await setDoc(dashboardRef, initialState);
        setDashboardState(initialState);
      }
    } catch (error) {
      console.error('❌ Error initializing dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to log out?')) {
      try {
        await signOut(auth);
        navigate('/login');
      } catch (error) {
        console.error('Error logging out:', error);
      }
    }
  };

  const navigateToModule = (moduleId) => {
    navigate(`/mission-control-v2/${moduleId}`);
  };

  const navigateToSection = (moduleId, sectionId) => {
    navigate(`/mission-control-v2/${moduleId}/section/${sectionId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
        {/* Starfield */}
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
        <div className="relative z-10 text-cyan-400 text-2xl font-mono animate-pulse">
          [INITIALIZING MISSION CONTROL...]
        </div>
      </div>
    );
  }

  if (!dashboardState) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-red-400 text-xl font-mono">[ERROR: Dashboard state not loaded]</div>
      </div>
    );
  }

  const reconModule = dashboardState.modules.find(m => m.id === 'recon');

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

      {/* Grid Pattern at Bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-cyan-900/20 to-transparent">
        <svg className="w-full h-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="cyan" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>
      </div>

      {/* Top Right - Logout */}
      <div className="absolute top-6 right-6 z-50">
        <button
          onClick={handleLogout}
          className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg font-mono text-xs transition-all"
        >
          🚪 LOGOUT
        </button>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-black/80 border-b border-cyan-500/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-4xl" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🎯</div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
                  MISSION CONTROL
                </h1>
                <p className="text-xs text-gray-400 font-mono">Modular Intelligence System v{dashboardState.version}</p>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs text-gray-500 font-mono">Overall Progress</p>
                <p className="text-2xl font-bold text-cyan-400 font-mono">{dashboardState.progressTracking.overallProgress}%</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">

        {/* Welcome Section */}
        <section className="mb-12">
          <div className="bg-gradient-to-br from-purple-900/20 to-cyan-900/20 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
            <h2 className="text-3xl font-bold text-white mb-4 font-mono">Welcome to Mission Control</h2>
            <p className="text-gray-300 text-lg mb-6">
              Your modular intelligence platform. Complete each module to unlock advanced capabilities.
            </p>

            {/* Milestones */}
            <div className="flex flex-wrap gap-3">
              {dashboardState.progressTracking.milestones.map((milestone) => (
                <div
                  key={milestone.id}
                  className={`px-4 py-2 rounded-lg font-mono text-sm border ${
                    milestone.achieved
                      ? 'bg-green-500/20 border-green-500/30 text-green-300'
                      : 'bg-gray-500/10 border-gray-500/20 text-gray-500'
                  }`}
                >
                  {milestone.achieved ? '✓' : '○'} {milestone.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Modules Grid */}
        <section className="mb-12">
          <h3 className="text-2xl font-bold text-white mb-6 font-mono">Available Modules</h3>

          <div className="grid md:grid-cols-3 gap-6">
            {dashboardState.modules.map((module) => (
              <div
                key={module.id}
                className={`relative bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 transition-all ${
                  module.unlocked
                    ? 'border-cyan-500/30 hover:border-cyan-500/60 cursor-pointer'
                    : 'border-gray-500/20 opacity-60'
                }`}
                onClick={() => module.unlocked && navigateToModule(module.id)}
              >
                {/* Lock Icon if locked */}
                {!module.unlocked && (
                  <div className="absolute top-4 right-4 text-3xl">🔒</div>
                )}

                {/* Module Header */}
                <div className="mb-4">
                  <h4 className="text-2xl font-bold text-white mb-2 font-mono">{module.name}</h4>
                  <p className="text-gray-400 text-sm">{module.description}</p>
                </div>

                {/* Progress Bar */}
                {module.unlocked && (
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-gray-400 font-mono">Progress</span>
                      <span className="text-xs text-cyan-400 font-mono font-bold">{module.progressPercentage}%</span>
                    </div>
                    <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 transition-all duration-500"
                        style={{ width: `${module.progressPercentage}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Stats */}
                {module.unlocked && module.totalSections > 0 && (
                  <div className="flex gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500 font-mono">Sections</p>
                      <p className="text-lg font-bold text-white font-mono">
                        {module.completedSections}/{module.totalSections}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 font-mono">Status</p>
                      <p className={`text-sm font-bold font-mono ${
                        module.status === 'completed' ? 'text-green-400' :
                        module.status === 'in-progress' ? 'text-cyan-400' :
                        'text-gray-400'
                      }`}>
                        {module.status.toUpperCase()}
                      </p>
                    </div>
                  </div>
                )}

                {/* Action Button */}
                {module.unlocked && (
                  <button
                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all font-mono"
                  >
                    {module.status === 'completed' ? 'REVIEW MODULE' :
                     module.status === 'in-progress' ? 'CONTINUE MODULE' :
                     'START MODULE'} →
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* RECON Quick View (if in progress) */}
        {reconModule && reconModule.unlocked && (
          <section className="mb-12">
            <h3 className="text-2xl font-bold text-white mb-6 font-mono flex items-center gap-2">
              <span>🔍</span> RECON Sections
            </h3>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reconModule.sections.map((section) => (
                <div
                  key={section.sectionId}
                  className={`bg-black/60 backdrop-blur-xl rounded-xl p-4 border transition-all ${
                    section.unlocked
                      ? 'border-cyan-500/30 hover:border-cyan-500/60 cursor-pointer'
                      : 'border-gray-500/20 opacity-50'
                  }`}
                  onClick={() => section.unlocked && navigateToSection('recon', section.sectionId)}
                >
                  {/* Section Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold font-mono ${
                        section.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        section.status === 'in_progress' ? 'bg-cyan-500/20 text-cyan-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {section.status === 'completed' ? '✓' : section.order}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white font-mono">{section.title}</h4>
                        <p className="text-xs text-gray-500 font-mono">{section.estimatedTime}</p>
                      </div>
                    </div>
                    {!section.unlocked && <span className="text-lg">🔒</span>}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-gray-400 mb-3">{section.description}</p>

                  {/* Action Button */}
                  {section.unlocked && (
                    <button
                      className={`w-full py-2 px-4 rounded-lg font-mono text-xs font-bold transition-all ${
                        section.status === 'completed'
                          ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                          : section.status === 'in_progress'
                          ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30'
                          : 'bg-cyan-500 text-white hover:bg-cyan-600'
                      }`}
                    >
                      {section.status === 'completed' ? 'EDIT' :
                       section.status === 'in_progress' ? 'CONTINUE' :
                       'START'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

      </main>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes floatBear {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
      `}</style>
    </div>
  );
}