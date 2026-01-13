import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Brain } from 'lucide-react';
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
import Section10BehavioralSignals from '../components/recon/Section10BehavioralSignals';

export default function RECONSectionPage() {
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const [section, setSection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({});

  // Reload section data whenever sectionId changes
  useEffect(() => {
    console.log(`🔄 Loading section ${sectionId}...`);
    setLoading(true); // Show loading state when switching sections
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

  const handleSave = async (data) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Use data parameter if provided, otherwise use formData state
      const dataToSave = data || formData;

      await saveSectionData(user.uid, 'recon', parseInt(sectionId), dataToSave);

      // Update local state if data was passed in
      if (data) {
        setFormData(data);
      }

      console.log('✅ Progress saved!');
    } catch (error) {
      console.error('❌ Error saving:', error);
      throw error; // Re-throw so child components can handle
    }
  };

  const handleComplete = async (data) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Use data parameter if provided, otherwise use formData state
      const dataToSave = data || formData;

      console.log(`🎯 Completing section ${sectionId}...`);
      const result = await completeSection(user.uid, 'recon', parseInt(sectionId), dataToSave);

      console.log('✅ Section completion result:', result);
      if (result.nextSection) {
        console.log(`🔓 Next section unlocked: Section ${result.nextSection.sectionId}`);
      }

      alert('✅ Section completed! Moving to RECON overview...');
      navigate('/mission-control-v2/recon');
    } catch (error) {
      console.error('❌ Error completing section:', error);
      alert(`❌ Failed to complete section: ${error.message}`);
      throw error; // Re-throw so child components can handle
    }
  };

  const navigateBack = () => {
    navigate('/mission-control-v2/recon');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-blue-600 text-2xl font-semibold animate-pulse">
          Loading Section...
        </div>
      </div>
    );
  }

  if (!section) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-red-600 text-xl font-semibold">Error: Section not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header - Enterprise Style matching Scout */}
      <header className="sticky top-0 z-50 bg-white border-b-[1.5px] border-gray-200 shadow-sm backdrop-filter backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={navigateBack}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border-[1.5px] border-gray-300 rounded-lg hover:bg-gray-50 hover:border-purple-500 hover:text-purple-600 transition-all font-semibold text-sm text-gray-700"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to RECON</span>
              </button>
              <div className="inline-flex items-center gap-2 ml-2">
                <Brain className="w-5 h-5 text-purple-600" strokeWidth={2.5} />
                <span className="text-lg font-bold text-gray-900">RECON</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="flex items-center gap-2 justify-end mb-1">
                  <span className="text-xs text-gray-600 font-semibold">Section {section.order}</span>
                  {section.required && (
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-semibold border border-red-300">
                      Required
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 font-semibold">Estimated Time</p>
                <p className="text-lg font-bold text-blue-600">{section.estimatedTime}</p>
              </div>
            </div>
          </div>
          <div className="mt-3">
            <h1 className="text-xl font-bold text-gray-900">{section.title}</h1>
            <p className="text-sm text-gray-600 mt-1">{section.description}</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[900px] mx-auto px-6 py-8">

        {/* Section Instructions - Enterprise Style */}
        <section className="mb-6">
          <div className="bg-gray-50 rounded-xl p-5 border-[1.5px] border-gray-200">
            <h2 className="text-base font-bold text-gray-900 mb-2 flex items-center gap-2">
              <span className="text-blue-600">📋</span>
              Instructions
            </h2>
            <p className="text-sm text-gray-700 mb-3">
              Answer the questions below to complete this section. Your responses will be used to build your comprehensive ICP.
            </p>
            <p className="text-xs text-gray-600">
              You can save your progress at any time and return later to finish.
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
          ) : parseInt(sectionId) === 10 ? (
            <Section10BehavioralSignals
              initialData={formData}
              onSave={handleSave}
              onComplete={handleComplete}
            />
          ) : (
            <div className="bg-red-50 border border-red-300 rounded-xl p-8">
              <h3 className="text-red-700 font-bold text-xl">❌ Section {sectionId} not found</h3>
              <p className="text-gray-700 mt-2">This section does not exist. Please return to the RECON module.</p>
            </div>
          )}
        </section>

        {/* Debug Info */}
        <details className="mt-8">
          <summary className="cursor-pointer text-blue-600 hover:text-blue-700 text-xs">
            [Debug: View section state]
          </summary>
          <pre className="mt-4 bg-gray-50 p-4 rounded-lg overflow-auto text-gray-700 border border-gray-200 text-xs">
            {JSON.stringify(section, null, 2)}
          </pre>
        </details>

      </main>
    </div>
  );
}