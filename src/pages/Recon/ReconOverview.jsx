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

  const getColorClasses = (color) => {
    const colors = {
      purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'text-purple-600', fill: 'bg-purple-600', badge: 'bg-purple-100 text-purple-700 border-purple-200' },
      blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-600', fill: 'bg-blue-600', badge: 'bg-blue-100 text-blue-700 border-blue-200' },
      amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: 'text-amber-600', fill: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
      red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'text-red-600', fill: 'bg-red-600', badge: 'bg-red-100 text-red-700 border-red-200' },
      emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: 'text-emerald-600', fill: 'bg-emerald-600', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
      cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', icon: 'text-cyan-600', fill: 'bg-cyan-600', badge: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
      pink: { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', icon: 'text-pink-600', fill: 'bg-pink-600', badge: 'bg-pink-100 text-pink-700 border-pink-200' }
    };
    return colors[color] || colors.purple;
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-purple-600 text-lg font-semibold animate-pulse">Loading RECON...</div>
      </div>
    );
  }

  const totalSections = sections.length;
  const completedSections = sections.filter(s => s.status === 'completed').length;
  const overallProgress = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;
  const barryConfidence = overallProgress >= 80 ? 'High' : overallProgress >= 40 ? 'Medium' : 'Low';
  const barryConfidenceColor = overallProgress >= 80 ? 'text-emerald-600' : overallProgress >= 40 ? 'text-amber-600' : 'text-red-500';

  return (
    <div className="max-w-7xl mx-auto">
      {/* Breadcrumbs */}
      <ReconBreadcrumbs />

      {/* Header Section */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-purple-100 border-2 border-purple-200 flex items-center justify-center">
            <Brain className="w-5 h-5 text-purple-600" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">RECON</h1>
            <p className="text-sm text-gray-500 font-medium">Barry's Training Intelligence</p>
          </div>
        </div>
        <p className="text-gray-600 mt-3 max-w-2xl text-sm leading-relaxed">
          RECON is how you train Barry. Every module you complete gives Barry deeper context about your business,
          customers, and market — making Scout smarter, Hunter sharper, and every interaction more relevant.
        </p>
      </div>

      {/* Training Status Bar */}
      <div className="bg-white rounded-xl border-[1.5px] border-gray-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-purple-600" />
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Training Status</h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium">Overall</p>
              <p className="text-xl font-bold text-purple-600">{overallProgress}%</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium">Barry Confidence</p>
              <p className={`text-xl font-bold ${barryConfidenceColor}`}>{barryConfidence}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium">Sections</p>
              <p className="text-xl font-bold text-gray-900">{completedSections}/{totalSections}</p>
            </div>
          </div>
        </div>
        <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-violet-600 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
        {overallProgress < 100 && (
          <p className="text-xs text-gray-500 mt-2">
            Complete more modules to increase Barry's confidence and improve results across Scout and Hunter.
          </p>
        )}
      </div>

      {/* Confidence Heatmap & Train Next - Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Confidence Heatmap */}
        <div className="lg:col-span-2 bg-white rounded-xl border-[1.5px] border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Barry's Knowledge Map</h2>
            </div>
            <div className="flex items-center gap-3 text-[10px] font-medium text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-emerald-500"></span> Trained
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-amber-400"></span> Partial
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded bg-gray-200"></span> Untrained
              </span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-2">
            {TRAINING_DIMENSIONS.map((dimension) => {
              const status = getDimensionStatus(dimension);
              const isTrained = status === 'trained';
              const isPartial = status === 'partial';

              return (
                <div
                  key={dimension.id}
                  onClick={() => navigate(getDimensionModulePath(dimension))}
                  className={`relative cursor-pointer group transition-all rounded-lg p-3 text-center ${
                    isTrained
                      ? 'bg-emerald-100 border-2 border-emerald-300 hover:border-emerald-400'
                      : isPartial
                      ? 'bg-amber-100 border-2 border-amber-300 hover:border-amber-400'
                      : 'bg-gray-100 border-2 border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <div className="text-xl mb-1">{dimension.icon}</div>
                  <div className={`text-[10px] font-semibold leading-tight ${
                    isTrained ? 'text-emerald-700' : isPartial ? 'text-amber-700' : 'text-gray-500'
                  }`}>
                    {dimension.label}
                  </div>
                  {/* Hover tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <div className="bg-gray-900 text-white text-[10px] px-2 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
                      <p className="font-semibold mb-0.5">{dimension.description}</p>
                      <p className="text-gray-400">
                        {isTrained ? '✓ Fully trained' : isPartial ? '◐ Partially trained' : '○ Not started'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 text-center">
            Click any dimension to train Barry in that area
          </p>
        </div>

        {/* Train Next Recommendation */}
        {(() => {
          const nextDimension = getNextRecommendedDimension();
          if (!nextDimension) return (
            <div className="bg-emerald-50 rounded-xl border-[1.5px] border-emerald-200 p-5 flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
              <h3 className="text-sm font-bold text-emerald-800 mb-1">Fully Trained!</h3>
              <p className="text-xs text-emerald-600">Barry has complete knowledge of your business context.</p>
            </div>
          );

          const status = getDimensionStatus(nextDimension);
          const isPartial = status === 'partial';

          return (
            <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-xl border-[1.5px] border-purple-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                {isPartial ? (
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                ) : (
                  <Target className="w-4 h-4 text-purple-600" />
                )}
                <h3 className="text-sm font-bold text-gray-900">
                  {isPartial ? 'Continue Training' : 'Train Next'}
                </h3>
              </div>

              <div className="bg-white rounded-lg border border-purple-200 p-3 mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xl">{nextDimension.icon}</span>
                  <span className="text-sm font-bold text-gray-900">{nextDimension.label}</span>
                </div>
                <p className="text-xs text-gray-500 mb-2">{nextDimension.description}</p>
                <div className="flex flex-wrap gap-1">
                  {nextDimension.criticalFor.map((item) => (
                    <span key={item} className="text-[10px] font-medium bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={() => navigate(getDimensionModulePath(nextDimension))}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                {isPartial ? 'Continue' : 'Start'} Training
                <ArrowRight size={14} />
              </button>

              {isPartial && (
                <p className="text-[10px] text-amber-600 mt-2 text-center font-medium">
                  Incomplete training limits Barry's effectiveness
                </p>
              )}
            </div>
          );
        })()}
      </div>

      {/* RECON Modules Grid */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">Training Modules</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {RECON_MODULES.map((mod) => {
            const status = getModuleStatus(mod);
            const progress = getModuleProgress(mod);
            const colors = getColorClasses(mod.color);
            const IconComponent = mod.icon;
            // High priority modules that need alerts when incomplete
            const isHighPriority = ['icp-intelligence', 'messaging'].includes(mod.id);
            const needsAlert = isHighPriority && status !== 'complete';

            return (
              <div
                key={mod.id}
                onClick={() => navigate(mod.path)}
                className={`relative bg-white rounded-xl border-[1.5px] ${
                  status === 'complete' ? 'border-emerald-300' :
                  needsAlert ? 'border-amber-300' :
                  'border-gray-200 hover:border-purple-300'
                } p-5 cursor-pointer transition-all hover:shadow-md group`}
              >
                {/* High Priority Alert Badge */}
                {needsAlert && (
                  <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
                    <AlertTriangle size={10} />
                    High Impact
                  </div>
                )}

                {/* Module Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-9 h-9 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                    <IconComponent className={`w-4.5 h-4.5 ${colors.icon}`} strokeWidth={2} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {status === 'complete' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        <CheckCircle2 size={12} /> Complete
                      </span>
                    ) : status === 'in-progress' ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold ${colors.badge} px-2 py-0.5 rounded-full border`}>
                        <Circle size={12} /> {progress.completed}/{progress.total}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
                        <AlertCircle size={12} /> Not started
                      </span>
                    )}
                  </div>
                </div>

                {/* Module Info */}
                <h3 className="text-base font-bold text-gray-900 mb-1">{mod.title}</h3>
                <p className="text-xs text-gray-500 mb-3 leading-relaxed">{mod.description}</p>

                {/* Progress Bar */}
                <div className="mb-3">
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${status === 'complete' ? 'bg-emerald-500' : colors.fill} rounded-full transition-all duration-500`}
                      style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Impact Areas */}
                <div className="flex flex-wrap gap-1.5">
                  {mod.impactAreas.map((area) => (
                    <span key={area} className="text-[10px] font-medium text-gray-500 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                      {area}
                    </span>
                  ))}
                </div>

                {/* CTA */}
                <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>{status === 'complete' ? 'Review' : status === 'in-progress' ? 'Continue' : 'Start'} module</span>
                  <ArrowRight size={12} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Platform Impact Section */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-4">
          How RECON Improves Everything
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLATFORM_IMPACTS.map((impact) => {
            const colors = getColorClasses(impact.color);
            const IconComponent = impact.icon;

            return (
              <div key={impact.system} className={`bg-white rounded-xl border-[1.5px] border-gray-200 p-5`}>
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-8 h-8 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                    <IconComponent className={`w-4 h-4 ${colors.icon}`} strokeWidth={2} />
                  </div>
                  <h3 className="text-sm font-bold text-gray-900">{impact.system}</h3>
                </div>
                <div className="space-y-3">
                  {impact.impacts.map((item, idx) => (
                    <div key={idx} className="text-xs">
                      <span className={`font-semibold ${colors.text}`}>{item.source}:</span>
                      <p className="text-gray-600 mt-0.5 leading-relaxed">{item.effect}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Confidence Explanation */}
      {overallProgress < 100 && (
        <div className="bg-purple-50 rounded-xl border-[1.5px] border-purple-200 p-5 mb-8">
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-purple-900 mb-1">
                Barry's confidence is currently {barryConfidence.toLowerCase()}
              </h3>
              <p className="text-xs text-purple-700 leading-relaxed">
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
