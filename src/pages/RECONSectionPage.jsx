import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth } from '../firebase/config';
import { getSectionData, startSection, completeSection, saveSectionData } from '../utils/dashboardUtils';
import Section1Foundation from '../components/recon/Section1Foundation';
import Section2ProductDeepDive from '../components/recon/Section2ProductDeepDive';
import Section3TargetMarketFirmographics from '../components/recon/Section3TargetMarketFirmographics';
import Section4IdealCustomerPsychographics from '../components/recon/Section4IdealCustomerPsychographics';
import Section5PainPointsMotivations from '../components/recon/Section5PainPointsMotivations';
import Section6BuyingBehaviorTriggers from '../components/recon/Section6BuyingBehaviorTriggers';
import Section7DecisionProcess from '../components/recon/Section7DecisionProcess';
import Section8CompetitiveLandscape from '../components/recon/Section8CompetitiveLandscape';
import Section9Messaging from '../components/recon/Section9Messaging';

export default function RECONSectionPage() {
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const [section, setSection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({});

  useEffect(() => {
    loadSection();
  }, [sectionId]);

  const loadSection = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const sectionData = await getSectionData(user.uid, 'recon', parseInt(sectionId));

      if (!sectionData) {
        console.error('❌ Section not found');
        navigate('/mission-control-v2/recon');
        return;
      }

      if (!sectionData.unlocked) {
        console.warn('⚠️ Section is locked');
        navigate('/mission-control-v2/recon');
        return;
      }

      setSection(sectionData);

      // Initialize form data from section.data or empty object
      setFormData(sectionData.data || {});

      // Mark as in-progress if not started
      if (sectionData.status === 'not_started') {
        await startSection(user.uid, 'recon', parseInt(sectionId));
      }
    } catch (error) {
      console.error('❌ Error loading section:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      await saveSectionData(user.uid, 'recon', parseInt(sectionId), formData);
      alert('✅ Progress saved!');
    } catch (error) {
      console.error('❌ Error saving:', error);
      alert('❌ Error saving progress');
    }
  };

  const handleComplete = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      await completeSection(user.uid, 'recon', parseInt(sectionId), formData);
      alert('✅ Section completed!');
      navigate('/mission-control-v2/recon');
    } catch (error) {
      console.error('❌ Error completing section:', error);
      alert('❌ Error completing section');
    }
  };

  const navigateBack = () => {
    navigate('/mission-control-v2/recon');
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
          [LOADING SECTION...]
        </div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-red-400 text-xl font-mono">[ERROR: Section not found]</div>
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
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-500 font-mono">SECTION {section.order}</span>
                  {section.required && (
                    <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs font-mono border border-red-500/30">
                      REQUIRED
                    </span>
                  )}
                </div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
                  {section.title}
                </h1>
                <p className="text-xs text-gray-400 font-mono">{section.description}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 font-mono">Estimated Time</p>
              <p className="text-lg font-bold text-cyan-400 font-mono">{section.estimatedTime}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">

        {/* Section Instructions */}
        <section className="mb-8">
          <div className="bg-gradient-to-br from-purple-900/20 to-cyan-900/20 backdrop-blur-xl rounded-2xl p-6 border border-cyan-500/30">
            <h2 className="text-2xl font-bold text-white mb-3 font-mono">📋 Instructions</h2>
            <p className="text-gray-300 mb-4">
              Answer the questions below to complete this section. Your responses will be used to build your comprehensive ICP.
            </p>
            <p className="text-sm text-gray-400 font-mono">
              💡 You can save your progress at any time and return later to finish.
            </p>
          </div>
        </section>

        {/* Section Content */}
        <section className="mb-8">
          {parseInt(sectionId) === 1 ? (
            <Section1Foundation
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 2 ? (
            <Section2ProductDeepDive
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 3 ? (
            <Section3TargetMarketFirmographics
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 4 ? (
            <Section4IdealCustomerPsychographics
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 5 ? (
            <Section5PainPointsMotivations
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 6 ? (
            <Section6BuyingBehaviorTriggers
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 7 ? (
            <Section7DecisionProcess
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 8 ? (
            <Section8CompetitiveLandscape
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : parseInt(sectionId) === 9 ? (
            <Section9Messaging
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : (
            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
              <h3 className="text-2xl font-bold text-white mb-6 font-mono">Section Content</h3>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6 mb-6">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">⚠️</div>
                  <div>
                    <h4 className="text-yellow-400 font-bold font-mono mb-2">Section Not Found</h4>
                    <p className="text-gray-300 text-sm">
                      Section {section.order} does not exist or has not been implemented yet.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Debug Info */}
        <details className="mt-8">
          <summary className="cursor-pointer text-cyan-500/50 hover:text-cyan-400 font-mono text-xs">
            [DEBUG: VIEW SECTION STATE]
          </summary>
          <pre className="mt-4 bg-black/80 p-4 rounded-lg overflow-auto text-cyan-400/70 border border-cyan-500/20 font-mono text-xs">
            {JSON.stringify(section, null, 2)}
          </pre>
        </details>

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
