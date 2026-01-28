import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { initializeDashboard } from '../../utils/dashboardUtils';
import {
  Brain,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Target,
  MessageSquare,
  Shield,
  Swords,
  Zap,
  Users,
  Mail,
  ArrowRight
} from 'lucide-react';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';

const TRAINING_DIMENSIONS = [
  {
    id: 'identity',
    label: 'Business Identity',
    sections: [1, 2],
    description: 'Barry knows who you are, what you sell, and what problem you solve.',
    notTrainedDescription: 'Barry has no context about your business or product.',
    impactWhenTrained: 'All context generation references your actual product and positioning.',
    impactWhenMissing: 'Barry generates generic context with no business awareness.'
  },
  {
    id: 'icp',
    label: 'Ideal Customer Profile',
    sections: [3, 4],
    description: 'Barry knows your target market, firmographics, and psychographics.',
    notTrainedDescription: 'Barry cannot assess whether a prospect matches your ICP.',
    impactWhenTrained: 'Scout lead scoring reflects your actual ideal customer characteristics.',
    impactWhenMissing: 'All leads are treated equally — no qualification intelligence.'
  },
  {
    id: 'pain-points',
    label: 'Pain Points & Motivations',
    sections: [5, 6],
    description: 'Barry understands what keeps your customers up at night and what drives purchases.',
    notTrainedDescription: 'Barry cannot anticipate objections or speak to customer pain.',
    impactWhenTrained: 'Hunter messages address real pain points. Barry anticipates objections.',
    impactWhenMissing: 'Outreach is generic. Follow-ups miss underlying concerns.'
  },
  {
    id: 'decisions',
    label: 'Decision Process',
    sections: [7],
    description: 'Barry knows how your customers evaluate and make buying decisions.',
    notTrainedDescription: 'Barry has no insight into the buyer journey.',
    impactWhenTrained: 'Outreach timing and multi-touch sequences match buyer readiness.',
    impactWhenMissing: 'Messages ignore where the prospect is in their journey.'
  },
  {
    id: 'competitive',
    label: 'Competitive Landscape',
    sections: [8],
    description: 'Barry knows your competitors and can position against alternatives.',
    notTrainedDescription: 'Barry cannot differentiate you from alternatives.',
    impactWhenTrained: 'Barry references competitive advantages. Hunter messaging differentiates.',
    impactWhenMissing: 'No competitive awareness in any generated content.'
  },
  {
    id: 'messaging',
    label: 'Messaging Framework',
    sections: [9],
    description: 'Barry uses your value proposition, messaging pillars, and brand voice.',
    notTrainedDescription: 'Barry uses generic messaging with no brand awareness.',
    impactWhenTrained: 'All generated content reflects your actual voice and positioning.',
    impactWhenMissing: 'Messages sound template-driven. No brand consistency.'
  },
  {
    id: 'signals',
    label: 'Behavioral Signals',
    sections: [10],
    description: 'Barry detects timing signals and behavioral triggers that indicate readiness.',
    notTrainedDescription: 'Barry cannot detect buying signals or timing indicators.',
    impactWhenTrained: 'Scout prioritizes leads showing active buying signals.',
    impactWhenMissing: 'No signal-based prioritization. All prospects treated equally.'
  }
];

export default function BarryTraining() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      await initializeDashboard(user.uid);
      const dashboardRef = doc(db, 'dashboards', user.uid);
      const dashboardDoc = await getDoc(dashboardRef);

      if (dashboardDoc.exists()) {
        const data = dashboardDoc.data();
        const recon = data.modules.find(m => m.id === 'recon');
        setSections(recon?.sections || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDimensionStatus = (dimension) => {
    const dimSections = dimension.sections.map(id => sections.find(s => s.sectionId === id));
    const completed = dimSections.filter(s => s?.status === 'completed').length;
    const total = dimSections.length;
    if (completed === total) return 'trained';
    if (completed > 0) return 'partial';
    return 'untrained';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-purple-600 text-lg font-semibold animate-pulse">Loading Barry Training Status...</div>
      </div>
    );
  }

  const totalSections = sections.length;
  const completedSections = sections.filter(s => s.status === 'completed').length;
  const overallProgress = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;
  const trainedDimensions = TRAINING_DIMENSIONS.filter(d => getDimensionStatus(d) === 'trained').length;
  const totalDimensions = TRAINING_DIMENSIONS.length;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumbs */}
      <ReconBreadcrumbs />

      {/* Header */}
      <div className="mb-6">

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-purple-100 border-2 border-purple-200 flex items-center justify-center">
            <Brain className="w-5 h-5 text-purple-600" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Barry Training Status</h1>
            <p className="text-sm text-gray-500">What Barry knows and what he's missing</p>
          </div>
        </div>
      </div>

      {/* Overall Status */}
      <div className="bg-white rounded-xl border-[1.5px] border-gray-200 p-5 mb-6">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 font-medium mb-1">Training Progress</p>
            <p className="text-3xl font-bold text-purple-600">{overallProgress}%</p>
          </div>
          <div className="text-center border-x border-gray-100">
            <p className="text-xs text-gray-500 font-medium mb-1">Dimensions Trained</p>
            <p className="text-3xl font-bold text-gray-900">{trainedDimensions}/{totalDimensions}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 font-medium mb-1">Confidence Level</p>
            <p className={`text-3xl font-bold ${
              overallProgress >= 80 ? 'text-emerald-600' :
              overallProgress >= 40 ? 'text-amber-600' : 'text-red-500'
            }`}>
              {overallProgress >= 80 ? 'High' : overallProgress >= 40 ? 'Medium' : 'Low'}
            </p>
          </div>
        </div>
        <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-violet-600 rounded-full transition-all duration-700"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Training Dimensions */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Training Dimensions</h2>
        <div className="space-y-3">
          {TRAINING_DIMENSIONS.map((dimension) => {
            const status = getDimensionStatus(dimension);
            const isTrained = status === 'trained';
            const isPartial = status === 'partial';

            return (
              <div
                key={dimension.id}
                className={`bg-white rounded-xl border-[1.5px] p-5 ${
                  isTrained ? 'border-emerald-200' :
                  isPartial ? 'border-amber-200' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Status */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isTrained ? 'bg-emerald-100 border border-emerald-200' :
                    isPartial ? 'bg-amber-100 border border-amber-200' :
                    'bg-gray-100 border border-gray-200'
                  }`}>
                    {isTrained ? (
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" />
                    ) : (
                      <AlertCircle className={`w-4.5 h-4.5 ${isPartial ? 'text-amber-500' : 'text-gray-400'}`} />
                    )}
                  </div>

                  <div className="flex-1">
                    {/* Label and status badge */}
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold text-gray-900">{dimension.label}</h3>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                        isTrained ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        isPartial ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        'bg-gray-50 text-gray-500 border-gray-200'
                      }`}>
                        {isTrained ? 'Trained' : isPartial ? 'Partial' : 'Untrained'}
                      </span>
                    </div>

                    {/* Description based on status */}
                    <p className="text-xs text-gray-600 mb-2">
                      {isTrained ? dimension.description : dimension.notTrainedDescription}
                    </p>

                    {/* Impact */}
                    <div className={`text-xs px-3 py-2 rounded-lg ${
                      isTrained ? 'bg-emerald-50 text-emerald-700' :
                      isPartial ? 'bg-amber-50 text-amber-700' :
                      'bg-red-50 text-red-600'
                    }`}>
                      <span className="font-semibold">Impact: </span>
                      {isTrained ? dimension.impactWhenTrained : dimension.impactWhenMissing}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* What Barry Can Do Today */}
      <div className="bg-purple-50 rounded-xl border-[1.5px] border-purple-200 p-5 mb-8">
        <h3 className="text-sm font-bold text-purple-900 mb-3">What Barry Can Do Today</h3>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-purple-800">
              Generate contextual intelligence about contacts using their public profile data (always available)
            </p>
          </div>
          {completedSections > 0 && (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-purple-800">
                Reference your RECON training data ({completedSections} sections) when generating context
              </p>
            </div>
          )}
          {trainedDimensions >= 3 && (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-purple-800">
                Assess prospect-to-ICP fit and provide qualification insights
              </p>
            </div>
          )}
          {overallProgress < 100 && (
            <div className="flex items-start gap-2 mt-3 pt-3 border-t border-purple-200">
              <AlertCircle className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-purple-700">
                Complete remaining RECON modules to unlock:{' '}
                {overallProgress < 40 && 'ICP-based lead scoring, competitive positioning, personalized messaging'}
                {overallProgress >= 40 && overallProgress < 80 && 'buying signal detection, full competitive positioning, objection handling'}
                {overallProgress >= 80 && 'full training across all dimensions'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
