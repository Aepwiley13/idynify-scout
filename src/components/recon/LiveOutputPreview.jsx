import { useState } from 'react';
import './LiveOutputPreview.css';

/**
 * LiveOutputPreview — threshold-gated dynamic preview of what Barry outputs
 * at the user's current context confidence level.
 *
 * Five bands: 0–39, 40–64, 65–84, 85–94, 95–100
 * Content updates only when score crosses a band boundary.
 * Always uses the same hypothetical contact (PREVIEW_PERSONA) so the user
 * can see the delta between training levels.
 */

// ─── Constant preview persona (never changes across threshold levels) ─────────
const PREVIEW_PERSONA = {
  name: 'Marcus Reyes',
  title: 'Director of Operations',
  company: 'HealthOps',
  size: '130 employees',
  sector: 'healthcare SaaS',
};

// ─── Threshold band definitions ───────────────────────────────────────────────

const THRESHOLDS = [
  {
    id: 't0',
    min: 0,
    max: 39,
    label: 'Not enough context',
    description: 'Generic, role-based orientation only.',
  },
  {
    id: 't40',
    min: 40,
    max: 64,
    label: 'Basic orientation',
    description: 'Industry and role-aware. Knows your product category.',
  },
  {
    id: 't65',
    min: 65,
    max: 84,
    label: 'ICP-aware',
    description: 'ICP fit assessment available. Use-case-specific starters.',
  },
  {
    id: 't85',
    min: 85,
    max: 94,
    label: 'Capable',
    description: 'Full product awareness, tone-matched, competitive context if trained.',
  },
  {
    id: 't95',
    min: 95,
    max: 100,
    label: 'Full context',
    description: 'Complete orientation across all dimensions.',
  },
];

function getThresholdIndex(score) {
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= THRESHOLDS[i].min) return i;
  }
  return 0;
}

// ─── Preview content per threshold ───────────────────────────────────────────

function PreviewContent({ thresholdIndex, persona }) {
  const { name, title, company, size, sector } = persona;

  if (thresholdIndex === 0) {
    return (
      <>
        <PreviewLine label="Who you're meeting">
          {name} is {title} at {company}, a mid-sized company in the {sector}.
        </PreviewLine>
        <PreviewLine label="What this role typically focuses on">
          <ul>
            <li>Often responsible for vendor relationships and process efficiency</li>
            <li>Usually evaluated on cost management and operational throughput</li>
            <li>Commonly involved in tool adoption decisions</li>
          </ul>
        </PreviewLine>
        <PreviewLine label="Conversation starters">
          <ul>
            <li>"What's driving your team's priorities this quarter?"</li>
            <li>"How are you thinking about process improvements heading into next year?"</li>
          </ul>
        </PreviewLine>
        <PreviewAnnotation>
          These starters are role-based. Barry has no product, ICP, or use case context to personalize further.
        </PreviewAnnotation>
        <GreySlots slots={[
          { label: 'ICP fit assessment', unlock: 'Complete Business Identity to unlock' },
          { label: 'Product relevance',  unlock: 'Complete Product Deep Dive to unlock' },
          { label: 'Competitive context',unlock: 'Complete Competitive Intel to unlock' },
        ]} />
      </>
    );
  }

  if (thresholdIndex === 1) {
    return (
      <>
        <PreviewLine label="Who you're meeting">
          {name} is {title} at {company}.
        </PreviewLine>
        <PreviewLine label="What this role typically focuses on">
          <ul>
            <li>Often responsible for vendor management and process standardization</li>
            <li>Usually measured on operational efficiency and cost of delivery</li>
            <li>Commonly evaluating tools that reduce manual workflow overhead</li>
          </ul>
        </PreviewLine>
        <PreviewLine label="Product relevance">
          {name} is in an industry and role that commonly encounters the problems your product category addresses.
        </PreviewLine>
        <PreviewLine label="Conversation starters">
          <ul>
            <li>"What's creating the most friction in your operations workflows right now?"</li>
            <li>"How is your team handling operational overhead — manually or through tools?"</li>
          </ul>
        </PreviewLine>
        <GreySlots slots={[
          { label: 'ICP fit (size/revenue)', unlock: 'Add company size criteria in Section 3' },
          { label: 'Use case specificity',   unlock: 'Complete Product Deep Dive' },
          { label: 'Competitive context',    unlock: 'Complete Section 8' },
        ]} />
      </>
    );
  }

  if (thresholdIndex === 2) {
    return (
      <>
        <PreviewLine label="Who you're meeting">
          {name} is {title} at {company} (estimated {size}) — within your target firmographic.
        </PreviewLine>
        <PreviewLine label="ICP fit">
          {company} matches your target company profile on industry and size.
        </PreviewLine>
        <PreviewLine label="Conversation starters">
          <ul>
            <li>"[Use-case-specific opener from your training data]"</li>
            <li>"How are you managing the workflow challenges your product addresses?"</li>
          </ul>
        </PreviewLine>
        <PreviewLine label="What they're probably focused on">
          Based on their growth stage and your ICP data, this company is likely navigating the operational complexity your platform addresses.
        </PreviewLine>
        <GreySlots slots={[
          { label: 'Competitive context', unlock: 'Complete Section 8' },
          { label: 'Messaging voice',     unlock: 'Complete Section 9 for tone-matched starters' },
        ]} />
      </>
    );
  }

  if (thresholdIndex === 3) {
    return (
      <>
        <PreviewLine label="Who you're meeting">
          {name} is {title} at {company} ({size}, {sector}) — squarely inside your target firmographic.
        </PreviewLine>
        <PreviewLine label="Conversation starters (using your messaging voice)">
          <ul>
            <li>"[Specific opener using your differentiator — not generic]"</li>
            <li>"[Second opener referencing a real use case from your Section 2 training]"</li>
          </ul>
        </PreviewLine>
        <PreviewLine label="ICP fit">Strong match on industry and size.</PreviewLine>
        <PreviewLine label="Barry's note">
          I'm not generating this from a template. Your RECON training is informing the specifics here.
        </PreviewLine>
        <PreviewAnnotation>
          Complete Section 8 to also unlock competitive context for this contact.
        </PreviewAnnotation>
      </>
    );
  }

  // thresholdIndex === 4 — Full context
  return (
    <>
      <PreviewLine label="Who you're meeting">
        {name} is {title} at {company} ({size}, {sector}) — squarely inside your target firmographic.
      </PreviewLine>
      <PreviewLine label="What this role cares about">
        <ul>
          <li>Often accountable for the specific pain point your product addresses</li>
          <li>Usually evaluating vendors on your trained decision criteria</li>
          <li>Commonly frustrated by the friction point your platform solves</li>
        </ul>
      </PreviewLine>
      <PreviewLine label="Conversation starters">
        <ul>
          <li>"[Specific opener that uses your differentiator]"</li>
          <li>"[Second opener referencing your core value proposition]"</li>
        </ul>
      </PreviewLine>
      <PreviewLine label="ICP fit">Strong match. Industry, size, and role all align.</PreviewLine>
      <PreviewLine label="Competitive context">
        If {company} is evaluating alternatives, your positioning angle is your trained differentiation statement.
      </PreviewLine>
      <p className="lop-footnote">
        This is what Barry generates for every contact when your RECON training is complete.
      </p>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PreviewLine({ label, children }) {
  return (
    <div className="lop-line">
      <p className="lop-line-label">{label}:</p>
      <div className="lop-line-body">{children}</div>
    </div>
  );
}

function PreviewAnnotation({ children }) {
  return <p className="lop-annotation">{children}</p>;
}

function GreySlots({ slots }) {
  return (
    <div className="lop-grey-slots">
      {slots.map((s) => (
        <div key={s.label} className="lop-grey-slot">
          <span className="lop-grey-slot-label">{s.label}:</span>
          <span className="lop-grey-slot-unlock">[{s.unlock}]</span>
        </div>
      ))}
    </div>
  );
}

// ─── Threshold progress indicator ────────────────────────────────────────────

function ThresholdProgress({ activeIndex, onSelect }) {
  return (
    <div className="lop-threshold-progress">
      {THRESHOLDS.map((t, i) => (
        <button
          key={t.id}
          className={`lop-threshold-dot ${
            i < activeIndex ? 'lop-dot--achieved' :
            i === activeIndex ? 'lop-dot--current' : 'lop-dot--future'
          }`}
          onClick={() => onSelect(i)}
          title={t.label}
          aria-label={`Threshold: ${t.label}`}
        />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LiveOutputPreview({ score = 0 }) {
  const defaultIndex = getThresholdIndex(score);
  const [viewIndex, setViewIndex] = useState(null); // null = follow score

  const activeIndex = viewIndex !== null ? viewIndex : defaultIndex;
  const activeThreshold = THRESHOLDS[activeIndex];
  const isLiveView = viewIndex === null || viewIndex === defaultIndex;

  return (
    <div className="live-output-preview">
      {/* Header */}
      <div className="lop-header">
        <div className="lop-header-left">
          <p className="lop-section-label">Live Output Preview</p>
          <p className="lop-threshold-label">{activeThreshold.label}</p>
          <p className="lop-threshold-desc">{activeThreshold.description}</p>
        </div>
        {!isLiveView && (
          <button className="lop-back-to-live" onClick={() => setViewIndex(null)}>
            ← Back to current
          </button>
        )}
      </div>

      {/* Preview card */}
      <div className={`lop-card ${isLiveView ? 'lop-card--live' : 'lop-card--historical'}`}>
        <div className="lop-card-persona">
          <span className="lop-persona-label">Sample contact:</span>
          <span className="lop-persona-name">{PREVIEW_PERSONA.name}</span>
          <span className="lop-persona-role">
            {PREVIEW_PERSONA.title} · {PREVIEW_PERSONA.company}
          </span>
        </div>
        <div className="lop-card-body">
          <PreviewContent thresholdIndex={activeIndex} persona={PREVIEW_PERSONA} />
        </div>
      </div>

      {/* Threshold progress indicator */}
      <div className="lop-progress-row">
        <ThresholdProgress activeIndex={activeIndex} onSelect={setViewIndex} />
        <p className="lop-progress-hint">
          {isLiveView
            ? `Score ${score} — ${activeThreshold.label}`
            : `Viewing: ${activeThreshold.label} (${activeThreshold.min}–${activeThreshold.max})`}
        </p>
      </div>

      {score === 0 && (
        <p className="lop-zero-cta">
          This is what Barry says about a contact right now, with no training.
          The greyed sections show what becomes available as you train.
        </p>
      )}
    </div>
  );
}
