import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Brain } from 'lucide-react';
import { auth } from '../../firebase/config';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';
import ReconFeedbackToast from '../../components/recon/ReconFeedbackToast';
import BarryCoachingResponse from '../../components/recon/BarryCoachingResponse';
import { getSectionData, startSection, completeSection, saveSectionData } from '../../utils/dashboardUtils';
import Section1Foundation from '../../components/recon/Section1Foundation';
import Section2ProductDeepDive from '../../components/recon/Section2ProductDeepDive';
import Section3TargetMarketFirmographics from '../../components/recon/Section3TargetMarketFirmographics';
import Section4IdealCustomerPsychographics from '../../components/recon/Section4IdealCustomerPsychographics';
import Section5PainPointsMotivations from '../../components/recon/Section5PainPointsMotivations';
import Section6BuyingBehaviorTriggers from '../../components/recon/Section6BuyingBehaviorTriggers';
import Section7DecisionProcess from '../../components/recon/Section7DecisionProcess';
import Section8CompetitiveLandscape from '../../components/recon/Section8CompetitiveLandscape';
import Section9Messaging from '../../components/recon/Section9Messaging';
import Section10BehavioralSignals from '../../components/recon/Section10BehavioralSignals';
import { getEffectiveUser } from '../../context/ImpersonationContext';

// Map sections to their parent modules for back-navigation
const SECTION_TO_MODULE = {
  1: 'icp-intelligence',
  2: 'icp-intelligence',
  3: 'icp-intelligence',
  4: 'icp-intelligence',
  5: 'objections',
  6: 'objections',
  7: 'buying-signals',
  8: 'competitive-intel',
  9: 'messaging',
  10: 'buying-signals'
};

const SECTION_COMPONENTS = {
  1: Section1Foundation,
  2: Section2ProductDeepDive,
  3: Section3TargetMarketFirmographics,
  4: Section4IdealCustomerPsychographics,
  5: Section5PainPointsMotivations,
  6: Section6BuyingBehaviorTriggers,
  7: Section7DecisionProcess,
  8: Section8CompetitiveLandscape,
  9: Section9Messaging,
  10: Section10BehavioralSignals
};

export default function ReconSectionEditor() {
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const [section, setSection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({});
  const [showToast, setShowToast] = useState(false);
  const [toastVariant, setToastVariant] = useState('save');

  // Barry coaching response state
  const [coaching, setCoaching] = useState(null);
  const [coachingLoading, setCoachingLoading] = useState(false);

  const sectionNum = parseInt(sectionId);
  const parentModule = SECTION_TO_MODULE[sectionNum];
  const SectionComponent = SECTION_COMPONENTS[sectionNum];

  useEffect(() => {
    setLoading(true);
    setCoaching(null);
    loadSection();
  }, [sectionId]);

  const loadSection = async () => {
    let navigatedAway = false;
    try {
      const user = getEffectiveUser();
      if (!user) {
        navigatedAway = true;
        navigate('/login');
        return;
      }

      const sectionData = await getSectionData(user.uid, 'recon', sectionNum);

      if (!sectionData) {
        navigatedAway = true;
        navigate(parentModule ? `/recon/${parentModule}` : '/recon');
        return;
      }

      if (!sectionData.unlocked) {
        navigatedAway = true;
        navigate(parentModule ? `/recon/${parentModule}` : '/recon');
        return;
      }

      setSection(sectionData);
      setFormData(sectionData.data || {});

      if (sectionData.status === 'not_started') {
        await startSection(user.uid, 'recon', sectionNum);
      }
    } catch (error) {
      console.error('Error loading section:', error);
    } finally {
      if (!navigatedAway) {
        setLoading(false);
      }
    }
  };

  // ── Call the Barry coaching endpoint after a save ────────────────────────
  const fetchCoaching = async (savedData) => {
    setCoachingLoading(true);
    setCoaching(null);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barry-coach-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          sectionId: sectionNum,
          sectionData: savedData,
        }),
      });

      if (!res.ok) throw new Error(`Coaching fetch failed: ${res.status}`);
      const { coaching: c } = await res.json();
      setCoaching(c);
    } catch (err) {
      console.error('[ReconSectionEditor] coaching fetch error:', err);
      // Coaching is non-blocking — a failure should not break the save flow
    } finally {
      setCoachingLoading(false);
    }
  };

  const handleSave = async (data) => {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const dataToSave = data || formData;
      await saveSectionData(user.uid, 'recon', sectionNum, dataToSave);

      if (data) setFormData(data);

      setToastVariant('save');
      setShowToast(true);

      // Fetch coaching asynchronously — non-blocking
      fetchCoaching(dataToSave);
    } catch (error) {
      console.error('Error saving:', error);
      throw error;
    }
  };

  const handleComplete = async (data) => {
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const dataToSave = data || formData;
      await completeSection(user.uid, 'recon', sectionNum, dataToSave);

      setToastVariant('complete');
      setShowToast(true);

      // Fetch coaching, then navigate after short delay so user sees response
      await fetchCoaching(dataToSave);

      setTimeout(() => {
        navigate(parentModule ? `/recon/${parentModule}` : '/recon');
      }, coaching ? 3500 : 2000);
    } catch (error) {
      console.error('Error completing section:', error);
      alert(`Failed to complete section: ${error.message}`);
      throw error;
    }
  };

  const navigateBack = () => {
    navigate(parentModule ? `/recon/${parentModule}` : '/recon');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-purple-600 text-lg font-semibold animate-pulse">Loading Section...</div>
      </div>
    );
  }

  if (!section || !SectionComponent) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-red-600 text-lg font-semibold">Section not found</div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto">
      {/* Breadcrumbs */}
      <ReconBreadcrumbs sectionTitle={section?.title} />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={navigateBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border-[1.5px] border-gray-200 rounded-lg hover:bg-gray-50 hover:border-purple-300 transition-all text-sm font-semibold text-gray-600"
          >
            <ArrowLeft size={16} />
            Back to Module
          </button>
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-600" strokeWidth={2.5} />
            <span className="text-sm font-bold text-gray-900">RECON</span>
            <span className="text-xs text-gray-400">Section {section.order}</span>
          </div>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-1">{section.title}</h1>
        <p className="text-sm text-gray-500">{section.description}</p>

        {section.estimatedTime && (
          <p className="text-xs text-gray-400 mt-1">Estimated time: {section.estimatedTime}</p>
        )}
      </div>

      {/* Instructions */}
      <div className="bg-gray-50 rounded-xl p-4 border-[1.5px] border-gray-200 mb-6">
        <h2 className="text-sm font-bold text-gray-900 mb-1">Instructions</h2>
        <p className="text-xs text-gray-600">
          Answer the questions below. Your responses directly train Barry and improve results
          across Scout and Hunter. Save progress anytime.
        </p>
      </div>

      {/* Section Content */}
      <div className="section-form">
        <SectionComponent
          initialData={formData}
          onSave={handleSave}
          onComplete={handleComplete}
        />
      </div>

      {/* Barry Coaching Response — appears below the form after save */}
      {coachingLoading && (
        <div className="mt-6 text-xs text-purple-500 font-medium animate-pulse">
          Barry is reviewing your training data...
        </div>
      )}
      {coaching && !coachingLoading && (
        <BarryCoachingResponse
          quality={coaching.quality}
          headline={coaching.headline}
          mirror={coaching.mirror}
          inference={coaching.inference}
          gapWarning={coaching.gap_warning}
          outputPreview={coaching.output_preview}
          confidenceImpact={coaching.confidenceImpact}
          sectionId={sectionNum}
        />
      )}

      {/* Feedback Toast */}
      <ReconFeedbackToast
        sectionId={sectionNum}
        isVisible={showToast}
        onClose={() => setShowToast(false)}
        variant={toastVariant}
      />
    </div>
  );
}
