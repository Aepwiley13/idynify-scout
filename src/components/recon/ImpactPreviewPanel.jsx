import { useState } from 'react';
import { Brain, ArrowRight, Eye, EyeOff, Sparkles } from 'lucide-react';

/**
 * ImpactPreviewPanel - Shows before/after examples of how RECON training
 * improves Barry's context generation output.
 *
 * This component creates a compelling visual demonstration of the value
 * of completing RECON modules.
 */

const IMPACT_EXAMPLES = [
  {
    id: 'context',
    label: 'Contact Context',
    dimension: 'identity',
    before: {
      title: 'Without RECON Training',
      content: `Sarah is a VP of Sales at TechCorp, a mid-sized technology company. She has been in her role for 2 years and previously worked at similar companies in the industry.

Consider discussing industry trends or recent company news when reaching out.`
    },
    after: {
      title: 'With RECON Training',
      content: `Sarah is a VP of Sales at TechCorp (Series B, $15M ARR), exactly matching your ICP firmographics. Her background suggests familiarity with the pipeline visibility challenges your platform solves.

Her recent LinkedIn post about "scaling without losing deal quality" directly aligns with your core value prop. She's likely evaluating tools to help her team close faster without adding headcount.

Opening angle: Reference her post and offer a specific example of how similar VPs have improved win rates by 23%.`
    }
  },
  {
    id: 'messaging',
    label: 'Outreach Message',
    dimension: 'messaging',
    before: {
      title: 'Without RECON Training',
      content: `Hi Sarah,

I wanted to reach out about our sales platform that helps teams improve their performance.

Would you be open to a quick call to discuss how we might help TechCorp?

Best regards`
    },
    after: {
      title: 'With RECON Training',
      content: `Hi Sarah,

Your recent post about scaling without losing deal quality resonated—it's the exact tension we help VPs navigate.

Our customers like [Similar Company] saw 23% higher win rates within 90 days by giving reps real-time visibility into deal health.

Given TechCorp's growth trajectory, this might be worth a 15-minute conversation. Open to it?`
    }
  },
  {
    id: 'objections',
    label: 'Objection Handling',
    dimension: 'pain-points',
    before: {
      title: 'Without RECON Training',
      content: `If Sarah mentions budget concerns, acknowledge the constraint and offer to discuss ROI.

Generic follow-up: "I understand budget is a consideration. Happy to walk through the value we provide."`
    },
    after: {
      title: 'With RECON Training',
      content: `Sarah may raise concerns about implementation time—TechCorp's Q4 push makes this likely.

Pre-emptive response: "We've designed a 2-week implementation specifically for teams in growth mode. [Competitor A] took 3 months—we can have your reps productive before your quarter ends."

If she mentions existing tools: Lead with integration, not replacement. Your Salesforce native approach is a key differentiator she'll value.`
    }
  }
];

export default function ImpactPreviewPanel({ reconProgress = 0, trainedDimensions = [] }) {
  const [activeExample, setActiveExample] = useState(0);
  const [showBefore, setShowBefore] = useState(false);

  const example = IMPACT_EXAMPLES[activeExample];
  const isThisDimensionTrained = trainedDimensions.includes(example.dimension);

  return (
    <div className="bg-white rounded-xl border-[1.5px] border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-violet-600 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-white/80" />
            <h3 className="text-sm font-bold text-white">Impact Preview</h3>
          </div>
          <span className="text-xs font-medium text-white/70">
            See how RECON training improves Barry's output
          </span>
        </div>
      </div>

      {/* Example Tabs */}
      <div className="flex border-b border-gray-200">
        {IMPACT_EXAMPLES.map((ex, idx) => (
          <button
            key={ex.id}
            onClick={() => setActiveExample(idx)}
            className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeExample === idx
                ? 'bg-purple-50 text-purple-700 border-b-2 border-purple-600'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="p-5">
        {/* Toggle */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-600" />
            <span className="text-xs font-semibold text-gray-700">
              {showBefore ? 'Generic Output' : 'RECON-Enhanced Output'}
            </span>
          </div>
          <button
            onClick={() => setShowBefore(!showBefore)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              showBefore
                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
            }`}
          >
            {showBefore ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                Show Enhanced
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                Show Generic
              </>
            )}
          </button>
        </div>

        {/* Example Content */}
        <div className={`rounded-lg border-2 p-4 transition-all ${
          showBefore
            ? 'bg-gray-50 border-gray-200'
            : 'bg-purple-50 border-purple-200'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs font-bold uppercase tracking-wide ${
              showBefore ? 'text-gray-500' : 'text-purple-600'
            }`}>
              {showBefore ? example.before.title : example.after.title}
            </span>
            {!showBefore && (
              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                Enhanced
              </span>
            )}
          </div>
          <div className={`text-sm leading-relaxed whitespace-pre-line ${
            showBefore ? 'text-gray-600' : 'text-gray-800'
          }`}>
            {showBefore ? example.before.content : example.after.content}
          </div>
        </div>

        {/* Call to Action */}
        {reconProgress < 100 && (
          <div className="mt-4 flex items-center justify-between bg-gradient-to-r from-purple-50 to-violet-50 rounded-lg px-4 py-3 border border-purple-200">
            <div>
              <p className="text-xs font-semibold text-purple-800">
                {isThisDimensionTrained
                  ? 'This dimension is trained!'
                  : `Train the "${example.dimension}" dimension to unlock this`}
              </p>
              <p className="text-[10px] text-purple-600 mt-0.5">
                Your current training progress: {reconProgress}%
              </p>
            </div>
            {!isThisDimensionTrained && (
              <ArrowRight className="w-4 h-4 text-purple-500" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
