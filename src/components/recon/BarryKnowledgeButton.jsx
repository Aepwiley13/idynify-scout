import { useNavigate } from 'react-router-dom';
import { Brain } from 'lucide-react';

/**
 * "Update Barry Knowledge" quick-action button.
 *
 * Placed on Scout and Hunter pages to give users a clear path
 * back to RECON without hunting through navigation.
 *
 * Visually distinct (purple/RECON brand) but not disruptive —
 * uses a compact button style that sits alongside existing actions.
 *
 * Variants:
 * - "compact" (default): icon + short label, fits in header bars
 * - "full": icon + label + description, for empty states or callouts
 */

export default function BarryKnowledgeButton({ variant = 'compact' }) {
  const navigate = useNavigate();

  if (variant === 'full') {
    return (
      <button
        onClick={() => navigate('/recon')}
        className="inline-flex items-center gap-2.5 px-4 py-2.5 bg-purple-50 border-[1.5px] border-purple-200 rounded-lg hover:bg-purple-100 hover:border-purple-300 transition-all group"
        aria-label="Update Barry's training knowledge in RECON"
      >
        <div className="w-7 h-7 rounded-md bg-purple-100 border border-purple-200 flex items-center justify-center group-hover:bg-purple-200 transition-colors">
          <Brain size={14} className="text-purple-600" strokeWidth={2.5} />
        </div>
        <div className="text-left">
          <span className="text-xs font-semibold text-purple-700 block leading-tight">
            Update Barry Knowledge
          </span>
          <span className="text-[10px] text-purple-500 block leading-tight">
            Train Barry in RECON
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => navigate('/recon')}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 hover:border-purple-300 transition-all text-xs font-semibold text-purple-700"
      aria-label="Update Barry's training knowledge in RECON"
      title="Train Barry with your business context"
    >
      <Brain size={14} className="text-purple-600" strokeWidth={2.5} />
      <span>Train Barry</span>
    </button>
  );
}
