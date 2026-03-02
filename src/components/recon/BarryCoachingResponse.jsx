import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import './BarryCoachingResponse.css';

/**
 * BarryCoachingResponse — displays Barry's structured feedback after a RECON
 * section is saved. Shows Mirror, Inference block, Gap Warning, and optional
 * on-demand Output Preview.
 *
 * Props:
 *   quality          'strong' | 'weak' | 'incomplete'
 *   headline         string
 *   mirror           string
 *   inference        string | null
 *   gapWarning       string | null  (replaces inference for incomplete+critical)
 *   outputPreview    string | null  (pre-computed, revealed on demand)
 *   confidenceImpact number
 *   sectionId        number
 */
export default function BarryCoachingResponse({
  quality,
  headline,
  mirror,
  inference,
  gapWarning,
  outputPreview,
  confidenceImpact,
  sectionId,
}) {
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!quality || !mirror) return null;

  const isGap = quality === 'incomplete' && gapWarning;
  const deltaPositive = confidenceImpact > 0;
  const deltaNeutral = confidenceImpact === 0;

  return (
    <div className={`barry-coaching-response bcr--${quality}`}>
      {/* Headline row */}
      <div className="bcr-headline-row">
        <span className="bcr-attribution">Barry</span>
        <span className="bcr-headline">{headline}</span>
        {!deltaNeutral && (
          <span className={`bcr-delta ${deltaPositive ? 'bcr-delta--up' : 'bcr-delta--down'}`}>
            {deltaPositive ? '↑' : '↓'} context
          </span>
        )}
      </div>

      {isGap ? (
        /* ── Gap Warning (incomplete + critical) ────────────────────────── */
        <div className="bcr-gap-warning">
          <AlertTriangle className="bcr-gap-icon" size={14} />
          <p className="bcr-gap-text">{gapWarning}</p>
          <button
            className="bcr-gap-link"
            onClick={() => {
              const el = document.querySelector('.section-form');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Complete this section →
          </button>
        </div>
      ) : (
        <>
          {/* ── Part 1: Mirror ─────────────────────────────────────────── */}
          <p className="bcr-mirror">{mirror}</p>

          {/* ── Divider ────────────────────────────────────────────────── */}
          {inference && <div className="bcr-divider" />}

          {/* ── Part 2: Inference ──────────────────────────────────────── */}
          {inference && (
            <p className={`bcr-inference ${quality === 'weak' ? 'bcr-inference--weak' : ''}`}>
              {inference}
            </p>
          )}

          {/* ── Part 3: Output Preview (on demand) ─────────────────────── */}
          {outputPreview && (
            <div className="bcr-preview-section">
              <button
                className="bcr-preview-toggle"
                onClick={() => setPreviewOpen((v) => !v)}
              >
                {previewOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                See what Barry says in the field →
              </button>
              {previewOpen && (
                <div className="bcr-preview-card">
                  <p className="bcr-preview-text">{outputPreview}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
