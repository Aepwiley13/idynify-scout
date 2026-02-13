import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { initializeDashboard } from '../../utils/dashboardUtils';
import {
  Brain,
  Target,
  MessageSquare,
  Shield,
  Swords,
  Zap,
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertCircle,
  TrendingUp,
  Users,
  Mail,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';
import ImpactPreviewPanel from '../../components/recon/ImpactPreviewPanel';
import './ReconOverview.css';

// Map RECON sections to the new module structure
const RECON_MODULES = [
  {
    id: 'icp-intelligence',
    title: 'ICP Intelligence',
    description: 'Define your ideal customer profile — who they are, where they work, and what they look like.',
    icon: Target,
    color: 'purple',
    sections: [1, 2, 3, 4],
    sectionNames: ['Business Foundation', 'Product Deep Dive', 'Target Market', 'Customer Psychographics'],
    impactAreas: ['Scout lead scoring', 'Barry prospect matching', 'Hunter targeting'],
    path: '/recon/icp-intelligence'
  },
  {
    id: 'messaging',
    title: 'Messaging & Voice',
    description: 'Define your value proposition, messaging framework, and brand voice for all outreach.',
    icon: MessageSquare,
    color: 'blue',
    sections: [9],
    sectionNames: ['Messaging & Value Proposition'],
    impactAreas: ['Hunter message quality', 'Barry conversation starters', 'Campaign personalization'],
    path: '/recon/messaging'
  },
  {
    id: 'objections',
    title: 'Objections & Constraints',
    description: 'Map customer pain points, motivations, and buying behavior to handle objections.',
    icon: Shield,
    color: 'amber',
    sections: [5, 6],
    sectionNames: ['Pain Points & Motivations', 'Buying Behavior & Triggers'],
    impactAreas: ['Barry objection handling', 'Hunter follow-up intelligence', 'Conversation depth'],
    path: '/recon/objections'
  },
  {
    id: 'competitive-intel',
    title: 'Competitive Intel',
    description: 'Map your competitive landscape so Barry knows how to position against alternatives.',
    icon: Swords,
    color: 'red',
    sections: [8],
    sectionNames: ['Competitive Landscape'],
    impactAreas: ['Barry competitive positioning', 'Hunter differentiation', 'Prospect qualification'],
    path: '/recon/competitive-intel'
  },
  {
    id: 'buying-signals',
    title: 'Buying Signals',
    description: 'Define decision processes and behavioral triggers that indicate readiness to buy.',
    icon: Zap,
    color: 'emerald',
    sections: [7, 10],
    sectionNames: ['Decision Process', 'Behavioral & Timing Signals'],
    impactAreas: ['Scout lead prioritization', 'Hunter timing optimization', 'Barry urgency detection'],
    path: '/recon/buying-signals'
  }
];

// Training dimensions for confidence heatmap
const TRAINING_DIMENSIONS = [
  {
    id: 'identity',
    label: 'Business Identity',
    sections: [1, 2],
    icon: '🏢',
    description: 'Who you are, what you sell, what problem you solve',
    criticalFor: ['All context generation', 'Brand voice'],
    priority: 1
  },
  {
    id: 'icp',
    label: 'Ideal Customer Profile',
    sections: [3, 4],
    icon: '🎯',
    description: 'Target market, firmographics, psychographics',
    criticalFor: ['Lead scoring', 'Prospect matching'],
    priority: 2
  },
  {
    id: 'pain-points',
    label: 'Pain & Motivations',
    sections: [5, 6],
    icon: '💡',
    description: 'Customer pain points and buying triggers',
    criticalFor: ['Message personalization', 'Objection handling'],
    priority: 3
  },
  {
    id: 'decisions',
    label: 'Decision Process',
    sections: [7],
    icon: '🔄',
    description: 'How customers evaluate and decide',
    criticalFor: ['Follow-up timing', 'Multi-touch sequences'],
    priority: 4
  },
  {
    id: 'competitive',
    label: 'Competitive Intel',
    sections: [8],
    icon: '⚔️',
    description: 'Competitors and positioning',
    criticalFor: ['Differentiation', 'Competitive positioning'],
    priority: 5
  },
  {
    id: 'messaging',
    label: 'Messaging Framework',
    sections: [9],
    icon: '💬',
    description: 'Value proposition and brand voice',
    criticalFor: ['All outreach content', 'Conversation starters'],
    priority: 6
  },
  {
    id: 'signals',
    label: 'Behavioral Signals',
    sections: [10],
    icon: '📊',
    description: 'Timing indicators and buying signals',
    criticalFor: ['Lead prioritization', 'Urgency detection'],
    priority: 7
  }
];

// Platform impact mapping
const PLATFORM_IMPACTS = [
  {
    system: 'Scout',
    icon: Users,
    color: 'cyan',
    impacts: [
      { source: 'ICP Intelligence', effect: 'Better lead scoring — Barry matches prospects against your actual ICP' },
      { source: 'Buying Signals', effect: 'Prioritizes leads showing real purchase intent' },
      { source: 'Competitive Intel', effect: 'Filters out prospects already locked into competitors' }
    ]
  },
  {
    system: 'Hunter',
    icon: Mail,
    color: 'pink',
    impacts: [
      { source: 'Messaging & Voice', effect: 'Messages use your real value proposition, not generic templates' },
      { source: 'Objections & Constraints', effect: 'Follow-ups address actual concerns before they surface' },
      { source: 'Buying Signals', effect: 'Outreach timing matches buyer readiness signals' }
    ]
  },
  {
    system: 'Barry',
    icon: Brain,
    color: 'purple',
    impacts: [
      { source: 'All RECON Modules', effect: 'Context generation informed by your business, not just contact data' },
      { source: 'Competitive Intel', effect: 'Conversation starters reference relevant industry dynamics' },
      { source: 'ICP Intelligence', effect: 'Qualification assessment based on your actual customer patterns' }
    ]
  }
];

export default function ReconOverview() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reconModule, setReconModule] = useState(null);
  const [sections, setSections] = useState([]);

  useEffect(() => {
    loadReconData();
  }, []);

  const loadReconData = async () => {
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
        setReconModule(recon);
        setSections(recon?.sections || []);
      }
    } catch (error) {
      console.error('Error loading RECON data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getModuleStatus = (mod) => {
    const moduleSections = mod.sections.map(id => sections.find(s => s.sectionId === id));
    const completed = moduleSections.filter(s => s?.status === 'completed').length;
    const total = moduleSections.length;

    if (completed === total) return 'complete';
    if (completed > 0) return 'in-progress';
    return 'not-started';
  };

  const getModuleProgress = (mod) => {
    const moduleSections = mod.sections.map(id => sections.find(s => s.sectionId === id));
    const completed = moduleSections.filter(s => s?.status === 'completed').length;
    return { completed, total: moduleSections.length };
  };

  // Get status for a training dimension
  const getDimensionStatus = (dimension) => {
    const dimSections = dimension.sections.map(id => sections.find(s => s.sectionId === id));
    const completed = dimSections.filter(s => s?.status === 'completed').length;
    const total = dimSections.length;
    if (completed === total) return 'trained';
    if (completed > 0) return 'partial';
    return 'untrained';
  };

  // Find the best next dimension to train (by priority)
  const getNextRecommendedDimension = () => {
    const incomplete = TRAINING_DIMENSIONS
      .filter(d => getDimensionStatus(d) !== 'trained')
      .sort((a, b) => a.priority - b.priority);
    return incomplete[0] || null;
  };

  // Map dimension to its parent module path
  const getDimensionModulePath = (dimension) => {
    const sectionToModule = {
      1: '/recon/icp-intelligence',
      2: '/recon/icp-intelligence',
      3: '/recon/icp-intelligence',
      4: '/recon/icp-intelligence',
      5: '/recon/objections',
      6: '/recon/objections',
      7: '/recon/buying-signals',
      8: '/recon/competitive-intel',
      9: '/recon/messaging',
      10: '/recon/buying-signals'
    };
    return sectionToModule[dimension.sections[0]] || '/recon';
  };

  // Finding 9: Scout spinner loading state replaces pulsing text
  if (loading) {
    return (
      <div className="recon-loading">
        <div className="loading-spinner" />
        <p className="loading-text">Loading RECON...</p>
      </div>
    );
  }

  const totalSections = sections.length;
  const completedSections = sections.filter(s => s.status === 'completed').length;
  const overallProgress = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;
  const barryConfidence = overallProgress >= 80 ? 'High' : overallProgress >= 40 ? 'Medium' : 'Low';
  const barryConfidenceColorClass = overallProgress >= 80 ? 'emerald' : overallProgress >= 40 ? 'amber' : 'red';

  return (
    <div className="recon-overview">
      {/* Breadcrumbs */}
      <ReconBreadcrumbs />

      {/* Header Section */}
      <div className="recon-overview-header">
        <div className="recon-header-row">
          <div className="recon-header-icon">
            <Brain />
          </div>
          <div>
            <h1 className="recon-page-title">RECON</h1>
            <p className="recon-page-subtitle">Barry's Training Intelligence</p>
          </div>
        </div>
        <p className="recon-description">
          RECON is how you train Barry. Every module you complete gives Barry deeper context about your business,
          customers, and market — making Scout smarter, Hunter sharper, and every interaction more relevant.
        </p>
      </div>

      {/* Finding 12: KPI cards matching Scout's .kpi-card pattern */}
      <div className="recon-training-status">
        <div className="recon-training-status-header">
          <div className="recon-training-status-label">
            <Activity />
            <h2>Training Status</h2>
          </div>
          <div className="recon-training-stats">
            <div className="recon-training-stat">
              <p className="recon-training-stat-label">Overall</p>
              <p className="recon-training-stat-value purple">{overallProgress}%</p>
            </div>
            <div className="recon-training-stat">
              <p className="recon-training-stat-label">Barry Confidence</p>
              <p className={`recon-training-stat-value ${barryConfidenceColorClass}`}>{barryConfidence}</p>
            </div>
            <div className="recon-training-stat">
              <p className="recon-training-stat-label">Sections</p>
              <p className="recon-training-stat-value dark">{completedSections}/{totalSections}</p>
            </div>
          </div>
        </div>
        <div className="recon-progress-bar">
          <div
            className="recon-progress-fill"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        {overallProgress < 100 && (
          <p className="recon-progress-hint">
            Complete more modules to increase Barry's confidence and improve results across Scout and Hunter.
          </p>
        )}
      </div>

      {/* Confidence Heatmap & Train Next - Side by Side */}
      <div className="recon-heatmap-grid">
        {/* Confidence Heatmap */}
        <div className="recon-heatmap-card">
          <div className="recon-heatmap-header">
            <div className="recon-heatmap-title">
              <Sparkles />
              <h2>Barry's Knowledge Map</h2>
            </div>
            <div className="recon-heatmap-legend">
              <span className="recon-legend-item">
                <span className="recon-legend-dot trained"></span> Trained
              </span>
              <span className="recon-legend-item">
                <span className="recon-legend-dot partial"></span> Partial
              </span>
              <span className="recon-legend-item">
                <span className="recon-legend-dot untrained"></span> Untrained
              </span>
            </div>
          </div>
          <div className="recon-heatmap-tiles">
            {TRAINING_DIMENSIONS.map((dimension) => {
              const status = getDimensionStatus(dimension);
              const isTrained = status === 'trained';
              const isPartial = status === 'partial';

              return (
                <div
                  key={dimension.id}
                  onClick={() => navigate(getDimensionModulePath(dimension))}
                  className={`recon-heatmap-tile ${status}`}
                >
                  <div className="recon-heatmap-tile-emoji">{dimension.icon}</div>
                  <div className={`recon-heatmap-tile-label ${status}`}>
                    {dimension.label}
                  </div>
                  {/* Hover tooltip */}
                  <div className="recon-heatmap-tooltip">
                    <div className="recon-heatmap-tooltip-content">
                      <p className="recon-heatmap-tooltip-title">{dimension.description}</p>
                      <p className="recon-heatmap-tooltip-status">
                        {isTrained ? '✓ Fully trained' : isPartial ? '◐ Partially trained' : '○ Not started'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="recon-heatmap-footer">
            Click any dimension to train Barry in that area
          </p>
        </div>

        {/* Train Next Recommendation */}
        {(() => {
          const nextDimension = getNextRecommendedDimension();
          if (!nextDimension) return (
            <div className="recon-train-next-complete">
              <CheckCircle2 />
              <h3>Fully Trained!</h3>
              <p>Barry has complete knowledge of your business context.</p>
            </div>
          );

          const status = getDimensionStatus(nextDimension);
          const isPartial = status === 'partial';

          return (
            <div className="recon-train-next">
              <div className="recon-train-next-header">
                {isPartial ? (
                  <AlertTriangle className="amber" />
                ) : (
                  <Target className="purple" />
                )}
                <h3>
                  {isPartial ? 'Continue Training' : 'Train Next'}
                </h3>
              </div>

              <div className="recon-train-next-inner">
                <div className="recon-train-next-dimension-row">
                  <span className="recon-train-next-dimension-emoji">{nextDimension.icon}</span>
                  <span className="recon-train-next-dimension-name">{nextDimension.label}</span>
                </div>
                <p className="recon-train-next-dimension-desc">{nextDimension.description}</p>
                <div className="recon-train-next-tags">
                  {nextDimension.criticalFor.map((item) => (
                    <span key={item} className="recon-train-next-tag">
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={() => navigate(getDimensionModulePath(nextDimension))}
                className="recon-train-next-btn"
              >
                {isPartial ? 'Continue' : 'Start'} Training
                <ArrowRight />
              </button>

              {isPartial && (
                <p className="recon-train-next-warning">
                  Incomplete training limits Barry's effectiveness
                </p>
              )}
            </div>
          );
        })()}
      </div>

      {/* RECON Modules Grid */}
      <div className="recon-modules-section">
        <h2 className="recon-section-title">Training Modules</h2>
        <div className="recon-modules-grid">
          {RECON_MODULES.map((mod) => {
            const status = getModuleStatus(mod);
            const progress = getModuleProgress(mod);
            const IconComponent = mod.icon;
            // High priority modules that need alerts when incomplete
            const isHighPriority = ['icp-intelligence', 'messaging'].includes(mod.id);
            const needsAlert = isHighPriority && status !== 'complete';

            return (
              <div
                key={mod.id}
                onClick={() => navigate(mod.path)}
                className={`recon-module-card ${
                  status === 'complete' ? 'complete' :
                  needsAlert ? 'alert' : ''
                }`}
              >
                {/* High Priority Alert Badge */}
                {needsAlert && (
                  <div className="recon-module-alert-badge">
                    <AlertTriangle />
                    High Impact
                  </div>
                )}

                {/* Module Header */}
                <div className="recon-module-header">
                  <div className={`recon-module-icon ${mod.color}`}>
                    <IconComponent />
                  </div>
                  <div>
                    {status === 'complete' ? (
                      <span className="recon-module-status-badge complete">
                        <CheckCircle2 /> Complete
                      </span>
                    ) : status === 'in-progress' ? (
                      <span className={`recon-module-status-badge in-progress ${mod.color}`}>
                        <Circle /> {progress.completed}/{progress.total}
                      </span>
                    ) : (
                      <span className="recon-module-status-badge not-started">
                        <AlertCircle /> Not started
                      </span>
                    )}
                  </div>
                </div>

                {/* Module Info */}
                <h3 className="recon-module-title">{mod.title}</h3>
                <p className="recon-module-description">{mod.description}</p>

                {/* Progress Bar */}
                <div className="recon-module-progress">
                  <div className="recon-module-progress-track">
                    <div
                      className={`recon-module-progress-fill ${status === 'complete' ? 'complete' : mod.color}`}
                      style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Impact Areas */}
                <div className="recon-module-tags">
                  {mod.impactAreas.map((area) => (
                    <span key={area} className="recon-module-tag">
                      {area}
                    </span>
                  ))}
                </div>

                {/* CTA */}
                <div className="recon-module-cta">
                  <span>{status === 'complete' ? 'Review' : status === 'in-progress' ? 'Continue' : 'Start'} module</span>
                  <ArrowRight />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Platform Impact Section */}
      <div className="recon-impact-section">
        <h2 className="recon-section-title">
          How RECON Improves Everything
        </h2>
        <div className="recon-impact-grid">
          {PLATFORM_IMPACTS.map((impact) => {
            const IconComponent = impact.icon;

            return (
              <div key={impact.system} className="recon-impact-card">
                <div className="recon-impact-card-header">
                  <div className={`recon-impact-icon ${impact.color}`}>
                    <IconComponent />
                  </div>
                  <h3>{impact.system}</h3>
                </div>
                <div className="recon-impact-list">
                  {impact.impacts.map((item, idx) => (
                    <div key={idx} className="recon-impact-item">
                      <span className={`recon-impact-item-source ${impact.color}`}>{item.source}:</span>
                      <p className="recon-impact-item-effect">{item.effect}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Impact Preview Panel */}
      <div className="recon-preview-section">
        <ImpactPreviewPanel
          reconProgress={overallProgress}
          trainedDimensions={TRAINING_DIMENSIONS
            .filter(d => getDimensionStatus(d) === 'trained')
            .map(d => d.id)}
        />
      </div>

      {/* Confidence Explanation */}
      {overallProgress < 100 && (
        <div className="recon-confidence-banner">
          <div className="recon-confidence-content">
            <Brain />
            <div>
              <h3 className="recon-confidence-title">
                Barry's confidence is currently {barryConfidence.toLowerCase()}
              </h3>
              <p className="recon-confidence-text">
                {overallProgress < 40
                  ? 'Barry is operating with limited context. He can generate basic contact intelligence, but cannot personalize based on your business, product, or ideal customer. Complete more RECON modules to unlock deeper intelligence.'
                  : overallProgress < 80
                  ? 'Barry has a working understanding of your business and market. His context generation is improving. Complete the remaining modules to unlock full personalization, competitive positioning, and buying signal detection.'
                  : 'Barry has strong context about your business. Just a few more sections to reach full training. At 100%, Barry will use your complete ICP, messaging framework, and competitive positioning in every interaction.'
                }
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
