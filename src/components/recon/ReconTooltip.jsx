import { useState, useRef, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';

/**
 * ReconTooltip — progressive disclosure tooltip for RECON form fields.
 *
 * Shows a small help icon next to form labels. On click (not hover),
 * expands to show "Why this matters" context explaining how Barry
 * uses the data.
 *
 * Progressive disclosure: users only see guidance when they ask for it,
 * avoiding overwhelm while ensuring context is always accessible.
 *
 * Accessibility: keyboard-navigable, aria-expanded, focus management.
 */

export default function ReconTooltip({ text, barryUses }) {
  const [open, setOpen] = useState(false);
  const tooltipRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open]);

  if (!text && !barryUses) return null;

  return (
    <span className="relative inline-flex" ref={tooltipRef}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors ${
          open
            ? 'text-purple-600 bg-purple-100'
            : 'text-gray-400 hover:text-purple-500 hover:bg-purple-50'
        }`}
        aria-expanded={open}
        aria-label="Show help for this field"
        tabIndex={0}
      >
        <HelpCircle size={13} strokeWidth={2.5} />
      </button>

      {open && (
        <div
          className="absolute left-6 top-0 z-50 w-64 bg-white border-[1.5px] border-purple-200 rounded-lg shadow-lg p-3 animate-in fade-in"
          role="tooltip"
        >
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wide">
              Why this matters
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Close tooltip"
              tabIndex={0}
            >
              <X size={12} />
            </button>
          </div>

          {text && (
            <p className="text-xs text-gray-600 leading-relaxed mb-2">{text}</p>
          )}

          {barryUses && (
            <div className="bg-purple-50 rounded-md p-2 border border-purple-100">
              <span className="text-[10px] font-semibold text-purple-700 block mb-0.5">
                Barry uses this to:
              </span>
              <p className="text-[11px] text-purple-600 leading-relaxed">{barryUses}</p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
