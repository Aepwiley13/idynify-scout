import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Brain } from 'lucide-react';
import { auth } from '../../firebase/config';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';
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

  const sectionNum = parseInt(sectionId);
  const parentModule = SECTION_TO_MODULE[sectionNum];
  const SectionComponent = SECTION_COMPONENTS[sectionNum];

  useEffect(() => {
    setLoading(true);
    loadSection();
  }, [sectionId]);

  const loadSection = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const sectionData = await getSectionData(user.uid, 'recon', sectionNum);

      if (!sectionData) {
        navigate(`/recon/${parentModule || ''}`);
        return;
      }

      if (!sectionData.unlocked) {
        navigate(`/recon/${parentModule || ''}`);
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
      setLoading(false);
    }
  };

  const handleSave = async (data) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const dataToSave = data || formData;
      await saveSectionData(user.uid, 'recon', sectionNum, dataToSave);

      if (data) {
        setFormData(data);
      }
    } catch (error) {
      console.error('Error saving:', error);
      throw error;
    }
  };

  const handleComplete = async (data) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const dataToSave = data || formData;
      const result = await completeSection(user.uid, 'recon', sectionNum, dataToSave);

      alert('Section completed!');
      // Navigate back to parent module
      navigate(`/recon/${parentModule || ''}`);
    } catch (error) {
      console.error('Error completing section:', error);
      alert(`Failed to complete section: ${error.message}`);
      throw error;
    }
  };

  const navigateBack = () => {
    navigate(`/recon/${parentModule || ''}`);
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
      <SectionComponent
        initialData={formData}
        onSave={handleSave}
        onComplete={handleComplete}
      />
    </div>
  );
}
