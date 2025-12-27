import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';

export default function RECONModulePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dashboardState, setDashboardState] = useState(null);
  const [reconModule, setReconModule] = useState(null);
  const [loading, setLoading] = useState(true);

  // Reload dashboard state whenever we navigate to this page
  useEffect(() => {
    console.log('🔄 RECONModulePage mounted/updated, reloading dashboard state...');
    loadDashboardState();
  }, [location.pathname]); // Reload when pathname changes

  const loadDashboardState = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const dashboardRef = doc(db, 'dashboards', user.uid);
      const dashboardDoc = await getDoc(dashboardRef);

      if (dashboardDoc.exists()) {
        const data = dashboardDoc.data();
        setDashboardState(data);
        const recon = data.modules.find(m => m.id === 'recon');
        setReconModule(recon);
      } else {
        console.error('❌ Dashboard not initialized');
        navigate('/mission-control-v2');
      }
    } catch (error) {
      console.error('❌ Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const navigateToSection = (sectionId) => {
    navigate(`/mission-control-v2/recon/section/${sectionId}`);
  };

  const navigateBack = () => {
    navigate('/mission-control-v2');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
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
          [LOADING RECON MODULE...]
        </div>
      </div>
    );
  }

  if (!reconModule) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-red-400 text-xl font-mono">[ERROR: RECON module not found]</div>
      </div>
    );
  }

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

      {/* Grid Pattern */}
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

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-black/80 border-b border-cyan-500/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={navigateBack}
                className="text-2xl hover:scale-110 transition-transform"
              >
                ⬅️
              </button>
              <div className="text-4xl">🔍</div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
                  RECON MODULE
                </h1>
                <p className="text-xs text-gray-400 font-mono">{reconModule.description}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 font-mono">Progress</p>
              <p className="text-2xl font-bold text-cyan-400 font-mono">{reconModule.progressPercentage}%</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">

        {/* Module Overview */}
        <section className="mb-12">
          <div className="bg-gradient-to-br from-purple-900/20 to-cyan-900/20 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
            <h2 className="text-3xl font-bold text-white mb-4 font-mono">Reconnaissance Intelligence</h2>
            <p className="text-gray-300 text-lg mb-6">
              Complete all 10 sections to build your comprehensive Ideal Customer Profile (ICP).
              Each section must be completed in order to unlock the next.
            </p>

            {/* Progress Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-black/40 rounded-xl p-4 border border-cyan-500/20">
                <p className="text-xs text-gray-400 font-mono mb-1">COMPLETED</p>
                <p className="text-3xl font-bold text-green-400 font-mono">{reconModule.completedSections}</p>
              </div>
              <div className="bg-black/40 rounded-xl p-4 border border-cyan-500/20">
                <p className="text-xs text-gray-400 font-mono mb-1">REMAINING</p>
                <p className="text-3xl font-bold text-cyan-400 font-mono">{reconModule.totalSections - reconModule.completedSections}</p>
              </div>
              <div className="bg-black/40 rounded-xl p-4 border border-cyan-500/20">
                <p className="text-xs text-gray-400 font-mono mb-1">TOTAL</p>
                <p className="text-3xl font-bold text-white font-mono">{reconModule.totalSections}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Sections List */}
        <section>
          <h3 className="text-2xl font-bold text-white mb-6 font-mono">Sections</h3>

          <div className="space-y-4">
            {reconModule.sections.map((section, index) => {
              const isLast = index === reconModule.sections.length - 1;

              return (
                <div key={section.sectionId}>
                  <div
                    className={`relative bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 transition-all ${
                      section.unlocked
                        ? 'border-cyan-500/30 hover:border-cyan-500/60 cursor-pointer'
                        : 'border-gray-500/20 opacity-60'
                    }`}
                    onClick={() => section.unlocked && navigateToSection(section.sectionId)}
                  >
                    {/* Lock Overlay */}
                    {!section.unlocked && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl backdrop-blur-sm">
                        <div className="text-center">
                          <div className="text-5xl mb-2">🔒</div>
                          <p className="text-gray-400 font-mono text-sm">Complete previous section to unlock</p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-start gap-6">
                      {/* Section Number */}
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-2xl flex-shrink-0 ${
                        section.status === 'completed' ? 'bg-green-500/20 text-green-400 border-2 border-green-500/30' :
                        section.status === 'in_progress' ? 'bg-cyan-500/20 text-cyan-400 border-2 border-cyan-500/30' :
                        'bg-gray-500/20 text-gray-400 border-2 border-gray-500/20'
                      }`}>
                        {section.status === 'completed' ? '✓' : section.order}
                      </div>

                      {/* Section Info */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="text-xl font-bold text-white mb-1 font-mono">{section.title}</h4>
                            <p className="text-gray-400 text-sm mb-2">{section.description}</p>
                            <div className="flex items-center gap-4 text-xs font-mono">
                              <span className="text-gray-500">⏱️ {section.estimatedTime}</span>
                              {section.required && (
                                <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/30">
                                  REQUIRED
                                </span>
                              )}
                              {section.status === 'completed' && section.completedAt && (
                                <span className="text-green-400">
                                  ✓ Completed {new Date(section.completedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Status Badge */}
                          <div className={`px-4 py-2 rounded-lg font-mono text-xs font-bold ${
                            section.status === 'completed' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                            section.status === 'in_progress' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                            'bg-gray-500/20 text-gray-400 border border-gray-500/20'
                          }`}>
                            {section.status.replace('_', ' ').toUpperCase()}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        {section.unlocked && (
                          <div className="flex gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigateToSection(section.sectionId);
                              }}
                              className={`px-6 py-3 rounded-lg font-mono font-bold transition-all ${
                                section.status === 'completed'
                                  ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30'
                                  : section.status === 'in_progress'
                                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30'
                                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700'
                              }`}
                            >
                              {section.status === 'completed' ? '✏️ EDIT SECTION' :
                               section.status === 'in_progress' ? '▶️ CONTINUE SECTION' :
                               '🚀 START SECTION'} →
                            </button>

                            {section.status === 'completed' && (
                              <button
                                className="px-4 py-3 rounded-lg font-mono font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-all"
                              >
                                📊 VIEW DATA
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Connector Line */}
                  {!isLast && (
                    <div className="flex justify-center py-2">
                      <div className={`w-0.5 h-8 ${
                        reconModule.sections[index + 1].unlocked ? 'bg-cyan-500/50' : 'bg-gray-500/30'
                      }`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Generate Intelligence CTA (show when all complete) */}
        {reconModule.status === 'completed' && (
          <section className="mt-12">
            <div className="bg-gradient-to-br from-emerald-500/20 to-teal-600/20 rounded-2xl p-10 text-center border-2 border-emerald-500/30 backdrop-blur-xl">
              <div className="text-6xl mb-6">🎯</div>
              <h3 className="text-4xl font-bold text-white mb-4 font-mono">RECON Complete!</h3>
              <p className="text-gray-300 mb-8 text-lg max-w-2xl mx-auto">
                All sections completed. Generate your comprehensive intelligence reports.
              </p>

              <div className="flex gap-4 justify-center">
                <button className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-4 px-8 rounded-xl transition-all font-mono">
                  🚀 GENERATE ICP BRIEF
                </button>
                <button className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-bold py-4 px-8 rounded-xl transition-all font-mono">
                  📊 GENERATE ALL REPORTS
                </button>
              </div>
            </div>
          </section>
        )}

      </main>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}