/**
 * BARRY REASONING DISPLAY (Step 7)
 *
 * Reusable component that shows Barry's reasoning for a recommendation.
 * Displays four elements:
 *   - Observed: What Barry noticed (the trigger condition)
 *   - Why it matters: Connected to strategic_value, campaign objective, or mission timeframe
 *   - Suggestion: Single specific action
 *   - Rationale: One sentence explaining why Barry suggests it
 *
 * This transparency is non-negotiable — recommendations must never feel random.
 */

import { Eye, AlertTriangle, Lightbulb, MessageCircle } from 'lucide-react';
import './BarryReasoningDisplay.css';

export default function BarryReasoningDisplay({ reasoning, compact = false }) {
  if (!reasoning) return null;

  const { observed, whyItMatters, suggestion, rationale } = reasoning;

  if (compact) {
    return (
      <div className="barry-reasoning-compact">
        <div className="barry-reasoning-compact-row">
          <Eye className="w-3 h-3 text-cyan-400 flex-shrink-0 mt-0.5" />
          <span className="text-gray-300 text-xs">{observed}</span>
        </div>
        <div className="barry-reasoning-compact-row">
          <Lightbulb className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
          <span className="text-gray-300 text-xs">{suggestion}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="barry-reasoning-display">
      <div className="barry-reasoning-item">
        <div className="barry-reasoning-label">
          <Eye className="w-3.5 h-3.5 text-cyan-400" />
          <span>Observed</span>
        </div>
        <p className="barry-reasoning-text">{observed}</p>
      </div>

      <div className="barry-reasoning-item">
        <div className="barry-reasoning-label">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span>Why it matters</span>
        </div>
        <p className="barry-reasoning-text">{whyItMatters}</p>
      </div>

      <div className="barry-reasoning-item">
        <div className="barry-reasoning-label">
          <Lightbulb className="w-3.5 h-3.5 text-emerald-400" />
          <span>Suggestion</span>
        </div>
        <p className="barry-reasoning-text">{suggestion}</p>
      </div>

      <div className="barry-reasoning-item">
        <div className="barry-reasoning-label">
          <MessageCircle className="w-3.5 h-3.5 text-purple-400" />
          <span>Rationale</span>
        </div>
        <p className="barry-reasoning-text barry-reasoning-rationale">{rationale}</p>
      </div>
    </div>
  );
}
