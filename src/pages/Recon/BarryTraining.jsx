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
import './BarryTraining.css';

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

  // Finding 9: Scout spinner loading state replaces pulsing text
  if (loading) {
    return (
      <div className="barry-training-loading">
        <div className="loading-spinner" />
        <p className="loading-text">Loading Barry Training Status...</p>
      </div>
    );
  }

  const totalSections = sections.length;
  const completedSections = sections.filter(s => s.status === 'completed').length;
  const overallProgress = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;
  const trainedDimensions = TRAINING_DIMENSIONS.filter(d => getDimensionStatus(d) === 'trained').length;
  const totalDimensions = TRAINING_DIMENSIONS.length;
  const confidenceColorClass = overallProgress >= 80 ? 'emerald' : overallProgress >= 40 ? 'amber' : 'red';

  return (
    <div className="barry-training">
      {/* Breadcrumbs */}
      <ReconBreadcrumbs />

      {/* Header */}
      <div className="barry-training-header">
        <div className="barry-training-header-row">
          <div className="barry-training-icon">
            <Brain />
          </div>
          <div>
            <h1 className="barry-training-title">Barry Training Status</h1>
            <p className="barry-training-subtitle">What Barry knows and what he's missing</p>
          </div>
        </div>
      </div>

      {/* Finding 12: KPI stats aligned to Scout's grid pattern */}
      <div className="barry-training-status">
        <div className="barry-training-stats-grid">
          <div className="barry-training-stat">
            <p className="barry-training-stat-label">Training Progress</p>
            <p className="barry-training-stat-value purple">{overallProgress}%</p>
          </div>
          <div className="barry-training-stat bordered">
            <p className="barry-training-stat-label">Dimensions Trained</p>
            <p className="barry-training-stat-value dark">{trainedDimensions}/{totalDimensions}</p>
          </div>
          <div className="barry-training-stat">
            <p className="barry-training-stat-label">Confidence Level</p>
            <p className={`barry-training-stat-value ${confidenceColorClass}`}>
              {overallProgress >= 80 ? 'High' : overallProgress >= 40 ? 'Medium' : 'Low'}
            </p>
          </div>
        </div>
        <div className="barry-training-progress-bar">
          <div
            className="barry-training-progress-fill"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Training Dimensions */}
      <div className="barry-training-dimensions">
        <h2 className="barry-training-section-title">Training Dimensions</h2>
        <div className="barry-training-dimensions-list">
          {TRAINING_DIMENSIONS.map((dimension) => {
            const status = getDimensionStatus(dimension);
            const isTrained = status === 'trained';
            const isPartial = status === 'partial';

            return (
              <div
                key={dimension.id}
                className={`barry-dimension-card ${status}`}
              >
                <div className="barry-dimension-content">
                  {/* Status */}
                  <div className={`barry-dimension-status-icon ${status}`}>
                    {isTrained ? (
                      <CheckCircle2 />
                    ) : (
                      <AlertCircle />
                    )}
                  </div>

                  <div className="barry-dimension-info">
                    {/* Label and status badge */}
                    <div className="barry-dimension-header">
                      <h3 className="barry-dimension-label">{dimension.label}</h3>
                      <span className={`barry-dimension-badge ${status}`}>
                        {isTrained ? 'Trained' : isPartial ? 'Partial' : 'Untrained'}
                      </span>
                    </div>

                    {/* Description based on status */}
                    <p className="barry-dimension-description">
                      {isTrained ? dimension.description : dimension.notTrainedDescription}
                    </p>

                    {/* Impact */}
                    <div className={`barry-dimension-impact ${
                      isTrained ? 'trained' : isPartial ? 'partial' : 'untrained'
                    }`}>
                      <span>Impact: </span>
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
      <div className="barry-capabilities">
        <h3>What Barry Can Do Today</h3>
        <div className="barry-capabilities-list">
          <div className="barry-capability-item">
            <CheckCircle2 className="success" />
            <p>
              Generate contextual intelligence about contacts using their public profile data (always available)
            </p>
          </div>
          {completedSections > 0 && (
            <div className="barry-capability-item">
              <CheckCircle2 className="success" />
              <p>
                Reference your RECON training data ({completedSections} sections) when generating context
              </p>
            </div>
          )}
          {trainedDimensions >= 3 && (
            <div className="barry-capability-item">
              <CheckCircle2 className="success" />
              <p>
                Assess prospect-to-ICP fit and provide qualification insights
              </p>
            </div>
          )}
          {overallProgress < 100 && (
            <div className="barry-capability-item barry-capabilities-divider">
              <AlertCircle className="info" />
              <p>
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
