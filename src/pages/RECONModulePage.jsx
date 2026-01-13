import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import SectionOutputModal from '../components/recon/SectionOutputModal';
import { initializeDashboard } from '../utils/dashboardUtils';

export default function RECONModulePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [dashboardState, setDashboardState] = useState(null);
  const [reconModule, setReconModule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewingSection, setViewingSection] = useState(null);

  // Reload dashboard state when component mounts or location key changes (navigation)
  // location.key changes on every navigation, even to the same path
  useEffect(() => {
    console.log('🔄 RECONModulePage: Loading dashboard state (location.key changed)...');
    loadDashboardState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]); // Reload on navigation, but location.key only changes on actual navigation events

  const loadDashboardState = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Try to initialize dashboard if it doesn't exist
      console.log('🔄 Checking if dashboard exists...');
      await initializeDashboard(user.uid);

      const dashboardRef = doc(db, 'dashboards', user.uid);
      const dashboardDoc = await getDoc(dashboardRef);

      if (dashboardDoc.exists()) {
        console.log('✅ Dashboard loaded successfully');
        const data = dashboardDoc.data();
        setDashboardState(data);
        const recon = data.modules.find(m => m.id === 'recon');
        setReconModule(recon);
      } else {
        console.error('❌ Dashboard not initialized - please check Firestore rules');
        alert('Unable to load RECON. Please ensure Firestore security rules are deployed. Check console for details.');
        navigate('/mission-control-v2');
      }
    } catch (error) {
      console.error('❌ Error loading dashboard:', error);
      alert(`Error loading RECON: ${error.message}. Please check Firestore rules are deployed.`);
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-blue-600 text-2xl font-semibold animate-pulse">
          Loading RECON Module...
        </div>
      </div>
    );
  }

  if (!reconModule) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-red-600 text-xl font-semibold">Error: RECON module not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
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
                <h1 className="text-xl font-bold text-gray-900">
                  RECON Module
                </h1>
                <p className="text-sm text-gray-600">{reconModule.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  console.log('🔄 Manual refresh triggered...');
                  setLoading(true);
                  loadDashboardState();
                }}
                className="bg-white hover:bg-gray-50 text-blue-600 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold transition-all"
              >
                🔄 Refresh
              </button>
              <div className="text-right">
                <p className="text-xs text-gray-600 font-semibold">Progress</p>
                <p className="text-2xl font-bold text-blue-600">{reconModule.progressPercentage}%</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">

        {/* Module Overview */}
        <section className="mb-12">
          <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-sm">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Reconnaissance Intelligence</h2>
            <p className="text-gray-700 text-lg mb-6">
              Complete all 10 sections to build your comprehensive Ideal Customer Profile (ICP).
              All sections are available - complete them in any order you prefer.
            </p>

            {/* Progress Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                <p className="text-xs text-gray-600 font-semibold mb-1 uppercase tracking-wide">Completed</p>
                <p className="text-3xl font-bold text-green-600">{reconModule.completedSections}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                <p className="text-xs text-gray-600 font-semibold mb-1 uppercase tracking-wide">Remaining</p>
                <p className="text-3xl font-bold text-blue-600">{reconModule.totalSections - reconModule.completedSections}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <p className="text-xs text-gray-600 font-semibold mb-1 uppercase tracking-wide">Total</p>
                <p className="text-3xl font-bold text-gray-900">{reconModule.totalSections}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Sections List */}
        <section>
          <h3 className="text-2xl font-bold text-gray-900 mb-6">Sections</h3>

          <div className="space-y-4">
            {reconModule.sections.map((section, index) => {
              const isLast = index === reconModule.sections.length - 1;

              return (
                <div key={section.sectionId}>
                  <div
                    className="relative bg-white rounded-2xl p-6 border border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer transition-all"
                    onClick={() => navigateToSection(section.sectionId)}
                  >

                    <div className="flex items-start gap-6">
                      {/* Section Number */}
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-bold text-2xl flex-shrink-0 ${
                        section.status === 'completed' ? 'bg-green-100 text-green-600 border-2 border-green-300' :
                        section.status === 'in_progress' ? 'bg-blue-100 text-blue-600 border-2 border-blue-300' :
                        'bg-gray-100 text-gray-500 border-2 border-gray-300'
                      }`}>
                        {section.status === 'completed' ? '✓' : section.order}
                      </div>

                      {/* Section Info */}
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="text-xl font-bold text-gray-900 mb-1">{section.title}</h4>
                            <p className="text-gray-600 text-sm mb-2">{section.description}</p>
                            <div className="flex items-center gap-4 text-xs">
                              <span className="text-gray-500">⏱️ {section.estimatedTime}</span>
                              {section.status === 'completed' && section.completedAt && (
                                <span className="text-green-600">
                                  ✓ Completed {new Date(section.completedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Status Badge */}
                          <div className={`px-4 py-2 rounded-lg text-xs font-semibold ${
                            section.status === 'completed' ? 'bg-green-100 text-green-700 border border-green-300' :
                            section.status === 'in_progress' ? 'bg-blue-100 text-blue-700 border border-blue-300' :
                            'bg-gray-100 text-gray-600 border border-gray-300'
                          }`}>
                            {section.status.replace('_', ' ').toUpperCase()}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToSection(section.sectionId);
                            }}
                            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                              section.status === 'completed'
                                ? 'bg-green-100 text-green-700 border border-green-300 hover:bg-green-200'
                                : section.status === 'in_progress'
                                ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                : 'bg-blue-600 text-white border border-blue-600 hover:bg-blue-700'
                            }`}
                          >
                            {section.status === 'completed' ? '✏️ Edit Section' :
                             section.status === 'in_progress' ? '▶️ Continue Section' :
                             '🚀 Start Section'} →
                          </button>

                          {section.status === 'completed' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewingSection(section);
                              }}
                              className="px-4 py-3 rounded-lg font-semibold bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-200 transition-all"
                            >
                              📊 View Output
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Connector Line */}
                  {!isLast && (
                    <div className="flex justify-center py-2">
                      <div className="w-0.5 h-8 bg-gray-300" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Completion Message (show when all complete) */}
        {reconModule.status === 'completed' && (
          <section className="mt-12">
            <div className="bg-green-50 rounded-2xl p-10 text-center border border-green-200">
              <div className="text-6xl mb-6">🎯</div>
              <h3 className="text-4xl font-bold text-gray-900 mb-4">RECON Complete!</h3>
              <p className="text-gray-700 mb-6 text-lg max-w-2xl mx-auto">
                All 10 sections completed! Each section has generated AI intelligence based on your inputs.
              </p>
              <div className="bg-white rounded-xl p-6 max-w-2xl mx-auto border border-gray-200 shadow-sm">
                <p className="text-blue-600 font-semibold mb-3">📊 View Your Intelligence Reports</p>
                <p className="text-gray-700 text-sm">
                  Click the <span className="text-purple-700 font-semibold">"📊 View Output"</span> button on any completed section above to see the AI-generated intelligence for that section.
                </p>
              </div>
            </div>
          </section>
        )}

      </main>

      {/* Section Output Modal */}
      {viewingSection && (
        <SectionOutputModal
          section={viewingSection}
          onClose={() => setViewingSection(null)}
        />
      )}
    </div>
  );
}