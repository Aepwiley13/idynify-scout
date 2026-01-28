import { useState, useEffect } from 'react';
import { CheckCircle2, Brain, Sparkles, X } from 'lucide-react';

/**
 * ReconFeedbackToast - Shows contextual feedback when RECON sections are saved.
 *
 * Displays what Barry learned from the saved data, reinforcing the value
 * of completing RECON modules.
 */

const SECTION_FEEDBACK = {
  1: {
    learned: 'Business Identity',
    impact: 'Barry now knows your company, product, and the problem you solve.',
    barryQuote: "I can now reference your business accurately in every context generation."
  },
  2: {
    learned: 'Product Deep Dive',
    impact: 'Barry understands your product features and differentiation.',
    barryQuote: "I'll highlight relevant product benefits when profiling prospects."
  },
  3: {
    learned: 'Target Market',
    impact: 'Barry knows your ideal company firmographics.',
    barryQuote: "I can now score leads based on how well they match your target market."
  },
  4: {
    learned: 'Customer Psychographics',
    impact: 'Barry understands who your buyers are and how they think.',
    barryQuote: "I'll tailor context to speak directly to your buyer personas."
  },
  5: {
    learned: 'Pain Points',
    impact: 'Barry knows what keeps your customers up at night.',
    barryQuote: "I can identify when prospects are experiencing problems you solve."
  },
  6: {
    learned: 'Buying Triggers',
    impact: 'Barry recognizes signals that indicate purchase readiness.',
    barryQuote: "I'll prioritize leads showing active buying behavior."
  },
  7: {
    learned: 'Decision Process',
    impact: 'Barry understands how your customers evaluate and buy.',
    barryQuote: "I'll align follow-up timing with where prospects are in their journey."
  },
  8: {
    learned: 'Competitive Landscape',
    impact: 'Barry knows your competitors and your advantages.',
    barryQuote: "I can position you against alternatives in conversation starters."
  },
  9: {
    learned: 'Messaging Framework',
    impact: 'Barry uses your value proposition and brand voice.',
    barryQuote: "All generated content will now reflect your actual messaging."
  },
  10: {
    learned: 'Behavioral Signals',
    impact: 'Barry detects timing indicators and buying signals.',
    barryQuote: "I'll flag prospects showing urgency signals for immediate follow-up."
  }
};

export default function ReconFeedbackToast({ sectionId, isVisible, onClose, variant = 'save' }) {
  const [isShowing, setIsShowing] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setIsShowing(true);
      // Auto-hide after 5 seconds
      const timer = setTimeout(() => {
        setIsShowing(false);
        setTimeout(onClose, 300); // Wait for animation
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  const feedback = SECTION_FEEDBACK[sectionId] || {
    learned: 'Section Data',
    impact: 'Barry has been updated with your information.',
    barryQuote: "Thanks for training me!"
  };

  if (!isVisible) return null;

  return (
    <div
      className={`fixed bottom-6 right-6 max-w-sm bg-white rounded-xl shadow-2xl border-2 border-emerald-200 overflow-hidden z-50 transition-all duration-300 ${
        isShowing ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-white" />
          <span className="text-sm font-bold text-white">
            {variant === 'complete' ? 'Section Completed!' : 'Progress Saved'}
          </span>
        </div>
        <button
          onClick={() => {
            setIsShowing(false);
            setTimeout(onClose, 300);
          }}
          className="text-white/70 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-100 border-2 border-purple-200 flex items-center justify-center flex-shrink-0">
            <Brain className="w-5 h-5 text-purple-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-900 mb-1">
              Barry learned: {feedback.learned}
            </p>
            <p className="text-xs text-gray-600 mb-2">
              {feedback.impact}
            </p>
            <div className="bg-purple-50 rounded-lg px-3 py-2 border border-purple-100">
              <div className="flex items-start gap-1.5">
                <Sparkles className="w-3 h-3 text-purple-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-purple-700 italic">
                  "{feedback.barryQuote}"
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="h-1 bg-gray-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-[5000ms] ease-linear"
          style={{ width: isShowing ? '0%' : '100%' }}
        />
      </div>
    </div>
  );
}
