import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Brain, CheckCircle2, Circle, AlertCircle, ChevronRight, Info, Sparkles, Lightbulb, Trophy } from 'lucide-react';
import { auth, db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { initializeDashboard } from '../../utils/dashboardUtils';
import SectionOutputModal from '../../components/recon/SectionOutputModal';
import ReconBreadcrumbs from '../../components/recon/ReconBreadcrumbs';

// Contextual tips based on module completion state
const CONTEXTUAL_TIPS = {
  'icp-intelligence': {
    notStarted: {
      icon: Lightbulb,
      title: 'Getting Started Tip',
      content: 'Start with Section 1 (Business Foundation). This gives Barry the context he needs to understand everything else you tell him.'
    },
    inProgress: {
      icon: Sparkles,
      title: 'Keep Going!',
      content: 'You\'re building Barry\'s core understanding of your business. Each section you complete makes Scout\'s lead scoring more accurate.'
    },
    completed: {
      icon: Trophy,
      title: 'Module Complete!',
      content: 'Barry now has a strong foundation. He can match prospects against your ICP and generate business-aware context. Consider completing Messaging next for maximum impact.'
    }
  },
  'messaging': {
    notStarted: {
      icon: Lightbulb,
      title: 'Why Start Here?',
      content: 'Your messaging framework transforms Barry\'s output. Without it, generated content sounds generic. With it, every message reflects your actual voice and positioning.'
    },
    inProgress: {
      icon: Sparkles,
      title: 'You\'re Shaping Barry\'s Voice',
      content: 'The value proposition and tone you define here will appear in Hunter messages and Barry\'s conversation starters. Be specific — Barry takes direction literally.'
    },
    completed: {
      icon: Trophy,
      title: 'Messaging Trained!',
      content: 'Barry now writes like you. Hunter messages will use your value prop, and conversation starters reflect your brand voice. Major upgrade unlocked.'
    }
  },
  'objections': {
    notStarted: {
      icon: Lightbulb,
      title: 'Pain is Power',
      content: 'The pain points you describe here become Barry\'s secret weapon. He\'ll identify when prospects are experiencing problems you solve and address objections before they surface.'
    },
    inProgress: {
      icon: Sparkles,
      title: 'Teaching Barry Empathy',
      content: 'The buying behaviors and motivations you\'re defining help Barry understand the "why" behind prospect actions. This makes follow-up sequences dramatically more effective.'
    },
    completed: {
      icon: Trophy,
      title: 'Objection Handling Unlocked!',
      content: 'Barry can now anticipate concerns and speak to what actually drives purchase decisions. Your Hunter follow-ups just got a lot smarter.'
    }
  },
  'competitive-intel': {
    notStarted: {
      icon: Lightbulb,
      title: 'Know Your Battlefield',
      content: 'Prospects are always comparing you to alternatives. Teach Barry the competitive landscape so he can position you effectively and filter out competitor-locked leads.'
    },
    inProgress: {
      icon: Sparkles,
      title: 'Building Competitive Awareness',
      content: 'The differentiation points you define will appear in Hunter messaging. Barry will also flag prospects who mention competitor keywords in their profiles.'
    },
    completed: {
      icon: Trophy,
      title: 'Competitive Intel Active!',
      content: 'Barry now knows how to position you against alternatives. Scout will deprioritize competitor-locked leads, and Hunter messaging will differentiate effectively.'
    }
  },
  'buying-signals': {
    notStarted: {
      icon: Lightbulb,
      title: 'Timing is Everything',
      content: 'The signals you define here teach Barry when to prioritize. A prospect showing buying signals is worth 10x a cold lead — but only if Barry knows what to look for.'
    },
    inProgress: {
      icon: Sparkles,
      title: 'Calibrating Barry\'s Radar',
      content: 'The decision process and behavioral triggers you\'re mapping will help Barry detect urgency. Scout will surface high-intent leads faster.'
    },
    completed: {
      icon: Trophy,
      title: 'Signal Detection Online!',
      content: 'Barry now recognizes when prospects are ready to buy. Scout will prioritize high-intent leads, and Hunter timing will adapt to buyer readiness. Full system upgrade complete.'
    }
  }
};

/**
 * Generic RECON Module Page — renders any module's sections
 * based on the route-provided sectionIds and module metadata.
 */

const MODULE_CONFIG = {
  'icp-intelligence': {
    title: 'ICP Intelligence',
    description: 'Define your ideal customer profile — who they are, where they work, and what drives their decisions.',
    sections: [1, 2, 3, 4],
    color: 'purple',
    guidance: {
      why: 'This is the foundation of everything Barry does. Without ICP Intelligence, Barry treats every prospect the same — no qualification, no prioritization, no business awareness.',
      what: 'You\'ll describe your business identity, product offering, target market firmographics, and ideal customer psychographics. Barry uses this to understand who you sell to and why.'
    },
    feedsInto: [
      'Scout uses your ICP to score and rank every prospect',
      'Barry references your target market when generating contact context',
      'Hunter targets outreach based on the firmographics you define here'
    ]
  },
  'messaging': {
    title: 'Messaging & Voice',
    description: 'Define your value proposition, messaging framework, and brand voice that Barry uses across all outreach.',
    sections: [9],
    color: 'blue',
    guidance: {
      why: 'Without your messaging framework, Hunter generates template-sounding messages and Barry\'s conversation starters lack your voice. This module gives Barry your actual positioning.',
      what: 'You\'ll define your value proposition, key messaging pillars, tone of voice, and how you want to be perceived. Barry weaves this into every generated message and context.'
    },
    feedsInto: [
      'Hunter generates messages using your actual value proposition',
      'Barry incorporates your voice and positioning in conversation starters',
      'Campaign personalization depth increases significantly'
    ]
  },
  'objections': {
    title: 'Objections & Constraints',
    description: 'Map the pain points, motivations, and buying behaviors that define how your customers make decisions.',
    sections: [5, 6],
    color: 'amber',
    guidance: {
      why: 'Prospects don\'t buy because of features — they buy because of pain. Without this module, Barry can\'t anticipate concerns or speak to what actually drives purchase decisions.',
      what: 'You\'ll map the pain points your customers experience, what motivates them to act, and the buying behaviors that indicate readiness. Barry uses this for objection handling and follow-up intelligence.'
    },
    feedsInto: [
      'Barry can proactively address common objections in context generation',
      'Hunter follow-up sequences adapt based on likely objections',
      'Conversation depth improves with pain-point awareness'
    ]
  },
  'competitive-intel': {
    title: 'Competitive Intel',
    description: 'Map your competitive landscape so Barry knows how to position you against alternatives.',
    sections: [8],
    color: 'red',
    guidance: {
      why: 'If Barry doesn\'t know your competitors, he can\'t help you differentiate. Prospects are always evaluating alternatives — Barry needs to know the landscape to position you effectively.',
      what: 'You\'ll identify your key competitors, how you differentiate, and what prospects typically compare you against. Barry uses this to sharpen messaging and filter out competitor-locked leads.'
    },
    feedsInto: [
      'Barry positions your product against known alternatives',
      'Hunter differentiates messaging based on competitive context',
      'Scout filters out prospects locked into competitor ecosystems'
    ]
  },
  'buying-signals': {
    title: 'Buying Signals',
    description: 'Define the decision processes and behavioral triggers that indicate a prospect is ready to engage.',
    sections: [7, 10],
    color: 'emerald',
    guidance: {
      why: 'Timing matters as much as targeting. Without signal awareness, Barry can\'t distinguish a cold prospect from one actively evaluating solutions. This module teaches Barry when to prioritize.',
      what: 'You\'ll describe how your customers make decisions, who\'s involved, what triggers evaluation, and what behavioral signals indicate readiness. Barry uses this for timing optimization and urgency detection.'
    },
    feedsInto: [
      'Scout prioritizes leads showing real purchase intent signals',
      'Hunter optimizes outreach timing based on buyer readiness',
      'Barry detects urgency signals and adapts context accordingly'
    ]
  }
};

export default function ReconModulePage() {
  const navigate = useNavigate();
  const { moduleId } = useParams();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState([]);
  const [viewingSection, setViewingSection] = useState(null);
  const [guidanceOpen, setGuidanceOpen] = useState(false);

  const config = MODULE_CONFIG[moduleId];

  useEffect(() => {
    if (!config) {
      navigate('/recon');
      return;
    }
    loadSections();
  }, [moduleId]);

  const loadSections = async () => {
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
        const allSections = recon?.sections || [];
        // Filter to only this module's sections
        const moduleSections = config.sections
          .map(id => allSections.find(s => s.sectionId === id))
          .filter(Boolean);
        setSections(moduleSections);
      }
    } catch (error) {
      console.error('Error loading module sections:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!config) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-purple-600 text-lg font-semibold animate-pulse">Loading module...</div>
      </div>
    );
  }

  const completedCount = sections.filter(s => s.status === 'completed').length;
  const totalCount = sections.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const colorMap = {
    purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', fill: 'bg-purple-600', icon: 'text-purple-600', light: 'bg-purple-100' },
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', fill: 'bg-blue-600', icon: 'text-blue-600', light: 'bg-blue-100' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', fill: 'bg-amber-500', icon: 'text-amber-600', light: 'bg-amber-100' },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', fill: 'bg-red-600', icon: 'text-red-600', light: 'bg-red-100' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', fill: 'bg-emerald-600', icon: 'text-emerald-600', light: 'bg-emerald-100' }
  };

  const colors = colorMap[config.color] || colorMap.purple;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Breadcrumbs */}
      <ReconBreadcrumbs />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className={`w-10 h-10 rounded-xl ${colors.bg} border-2 ${colors.border} flex items-center justify-center`}>
            <Brain className={`w-5 h-5 ${colors.icon}`} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{config.title}</h1>
            <p className="text-sm text-gray-500">{completedCount}/{totalCount} sections complete</p>
          </div>
        </div>
        <p className="text-gray-600 text-sm leading-relaxed mt-2">{config.description}</p>
      </div>

      {/* Guidance Banner — Progressive Disclosure */}
      {config.guidance && (
        <div className={`rounded-xl border-[1.5px] mb-6 transition-all ${
          guidanceOpen ? `${colors.bg} ${colors.border} p-5` : 'border-gray-200 p-3'
        }`}>
          <button
            onClick={() => setGuidanceOpen(!guidanceOpen)}
            className="flex items-center gap-2 w-full text-left"
            aria-expanded={guidanceOpen}
          >
            <Info size={16} className={guidanceOpen ? colors.icon : 'text-gray-400'} />
            <span className={`text-xs font-semibold ${guidanceOpen ? colors.text : 'text-gray-500'}`}>
              {guidanceOpen ? 'Why this module matters' : 'Why does this matter? (click to learn)'}
            </span>
          </button>
          {guidanceOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-700 leading-relaxed">
                <span className="font-semibold">Why:</span> {config.guidance.why}
              </p>
              <p className="text-xs text-gray-700 leading-relaxed">
                <span className="font-semibold">What you'll do:</span> {config.guidance.what}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      <div className="bg-white rounded-xl border-[1.5px] border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Module Progress</span>
          <span className={`text-sm font-bold ${colors.text}`}>{progressPercent}%</span>
        </div>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${progressPercent === 100 ? 'bg-emerald-500' : colors.fill} rounded-full transition-all duration-500`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Contextual Tip */}
      {(() => {
        const moduleTips = CONTEXTUAL_TIPS[moduleId];
        if (!moduleTips) return null;

        const tipState = progressPercent === 100 ? 'completed' : progressPercent > 0 ? 'inProgress' : 'notStarted';
        const tip = moduleTips[tipState];
        if (!tip) return null;

        const TipIcon = tip.icon;
        const tipColors = {
          notStarted: { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-500', text: 'text-blue-700', title: 'text-blue-800' },
          inProgress: { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-500', text: 'text-purple-700', title: 'text-purple-800' },
          completed: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-500', text: 'text-emerald-700', title: 'text-emerald-800' }
        };
        const tc = tipColors[tipState];

        return (
          <div className={`${tc.bg} rounded-xl border-[1.5px] ${tc.border} p-4 mb-6`}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0`}>
                <TipIcon className={`w-4 h-4 ${tc.icon}`} />
              </div>
              <div>
                <h4 className={`text-sm font-bold ${tc.title} mb-1`}>{tip.title}</h4>
                <p className={`text-xs ${tc.text} leading-relaxed`}>{tip.content}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sections */}
      <div className="space-y-3 mb-8">
        {sections.map((section) => {
          const isComplete = section.status === 'completed';
          const isInProgress = section.status === 'in_progress';

          return (
            <div
              key={section.sectionId}
              className={`bg-white rounded-xl border-[1.5px] ${
                isComplete ? 'border-emerald-200' : 'border-gray-200'
              } p-5 transition-all hover:shadow-md`}
            >
              <div className="flex items-start gap-4">
                {/* Status Icon */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isComplete ? 'bg-emerald-100 border border-emerald-200' :
                  isInProgress ? `${colors.light} border ${colors.border}` :
                  'bg-gray-100 border border-gray-200'
                }`}>
                  {isComplete ? (
                    <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" />
                  ) : isInProgress ? (
                    <Circle className={`w-4.5 h-4.5 ${colors.icon}`} />
                  ) : (
                    <AlertCircle className="w-4.5 h-4.5 text-gray-400" />
                  )}
                </div>

                {/* Section Info */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-bold text-gray-900">{section.title}</h3>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                      isComplete ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      isInProgress ? `${colors.bg} ${colors.text} ${colors.border}` :
                      'bg-gray-50 text-gray-500 border-gray-200'
                    }`}>
                      {isComplete ? 'Complete' : isInProgress ? 'In Progress' : 'Not Started'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">{section.description}</p>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/recon/section/${section.sectionId}`)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                        isComplete
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                          : isInProgress
                          ? `${colors.bg} ${colors.text} border ${colors.border} hover:opacity-90`
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                    >
                      {isComplete ? 'Edit Section' : isInProgress ? 'Continue' : 'Start Section'}
                      <ChevronRight size={14} />
                    </button>

                    {isComplete && (
                      <button
                        onClick={() => setViewingSection(section)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-all"
                      >
                        View Output
                      </button>
                    )}

                    {section.estimatedTime && (
                      <span className="text-[10px] text-gray-400 ml-2">{section.estimatedTime}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* How This Module Feeds the Platform */}
      <div className="bg-white rounded-xl border-[1.5px] border-gray-200 p-5 mb-8">
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide mb-3">
          What This Module Trains
        </h3>
        <div className="space-y-2">
          {config.feedsInto.map((impact, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <ChevronRight className={`w-3.5 h-3.5 ${colors.icon} mt-0.5 flex-shrink-0`} />
              <p className="text-xs text-gray-600 leading-relaxed">{impact}</p>
            </div>
          ))}
        </div>
      </div>

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
