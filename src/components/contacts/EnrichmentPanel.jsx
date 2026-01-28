import { useState } from 'react';
import {
  Sparkles,
  Loader,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Database,
  Brain,
  Search,
  Shield,
  Info,
  ExternalLink,
  XCircle
} from 'lucide-react';
import './EnrichmentPanel.css';

/**
 * EnrichmentPanel - User-initiated enrichment with Barry AI
 *
 * Shows:
 * - Enrich button (user-triggered)
 * - Real-time step progress
 * - Data provenance (what came from where)
 * - Barry's analysis summary
 * - Confidence indicator
 * - Missing data explanation
 */

const SOURCE_LABELS = {
  apollo_match: 'Apollo (Exact Match)',
  apollo_search: 'Apollo (Search)',
  barry_ai: 'Barry AI Analysis'
};

const SOURCE_ICONS = {
  apollo_match: Database,
  apollo_search: Search,
  barry_ai: Brain
};

const FIELD_LABELS = {
  email: 'Email',
  phone: 'Phone',
  linkedin_url: 'LinkedIn',
  twitter_url: 'Twitter',
  facebook_url: 'Facebook',
  seniority: 'Seniority',
  departments: 'Department',
  functions: 'Functions',
  headline: 'Headline',
  photo_url: 'Photo',
  location: 'Location',
  employment_history: 'Work History',
  education: 'Education'
};

const CONFIDENCE_CONFIG = {
  high: { label: 'High Confidence', className: 'confidence-high', description: 'Data verified across sources' },
  medium: { label: 'Medium Confidence', className: 'confidence-medium', description: 'Partial verification' },
  low: { label: 'Low Confidence', className: 'confidence-low', description: 'Limited data available' }
};

export default function EnrichmentPanel({ contact, onEnrich, enriching, enrichResult }) {
  const [expanded, setExpanded] = useState(false);
  const [showProvenance, setShowProvenance] = useState(false);

  // Check what's missing
  const missingFields = getMissingFields(contact);
  const hasBeenEnriched = !!contact.last_enriched_at;
  const hasEnrichmentSteps = !!contact.enrichment_steps;
  const analysis = enrichResult?.analysis || contact.enrichment_analysis;
  const provenance = enrichResult?.provenance || contact.enrichment_provenance || {};
  const steps = enrichResult?.steps || contact.enrichment_steps || [];

  // Show enrichment status
  const isComplete = hasBeenEnriched && missingFields.length === 0;
  const isPartial = hasBeenEnriched && missingFields.length > 0;
  const needsEnrichment = !hasBeenEnriched || missingFields.length > 0;

  return (
    <div className="enrichment-panel">
      {/* ── Header ─── */}
      <div className="enrichment-header" onClick={() => setExpanded(!expanded)}>
        <div className="enrichment-header-left">
          <Sparkles className="w-5 h-5 enrichment-icon" />
          <div>
            <h3 className="enrichment-title">Data Enrichment</h3>
            <p className="enrichment-subtitle">
              {enriching ? 'Barry is enriching this contact...' :
               isComplete ? 'All key fields populated' :
               isPartial ? `${missingFields.length} field${missingFields.length > 1 ? 's' : ''} still missing` :
               'Click to enrich with Barry AI'}
            </p>
          </div>
        </div>
        <div className="enrichment-header-right">
          {/* Confidence badge */}
          {analysis?.confidence && (
            <span className={`confidence-badge ${CONFIDENCE_CONFIG[analysis.confidence]?.className || ''}`}>
              <Shield className="w-3.5 h-3.5" />
              {CONFIDENCE_CONFIG[analysis.confidence]?.label || analysis.confidence}
            </span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </div>

      {/* ── Enrichment Action ─── */}
      {needsEnrichment && !enriching && (
        <div className="enrichment-action">
          <button
            className="enrich-barry-btn"
            onClick={(e) => { e.stopPropagation(); onEnrich(); }}
          >
            <Brain className="w-5 h-5" />
            <span>Enrich with Barry</span>
          </button>
          <p className="enrich-hint">
            Barry will check Apollo and analyze available data to fill in missing fields.
          </p>
        </div>
      )}

      {/* ── Live Progress (while enriching) ─── */}
      {enriching && (
        <div className="enrichment-progress">
          <div className="progress-steps">
            <EnrichmentStep
              label="Checking Apollo database"
              icon={Database}
              status="running"
            />
            <EnrichmentStep
              label="Searching supplemental sources"
              icon={Search}
              status="pending"
            />
            <EnrichmentStep
              label="Barry analyzing results"
              icon={Brain}
              status="pending"
            />
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill progress-bar-animated" />
          </div>
        </div>
      )}

      {/* ── Expanded Details ─── */}
      {expanded && !enriching && (
        <div className="enrichment-details">
          {/* Barry's Analysis Summary */}
          {analysis && (
            <div className="analysis-section">
              <div className="analysis-summary">
                <Brain className="w-4 h-4 analysis-icon" />
                <p>{analysis.summary}</p>
              </div>

              {/* What was found */}
              {analysis.found && analysis.found.length > 0 && (
                <div className="analysis-findings">
                  <h4 className="findings-label">Found</h4>
                  <ul className="findings-list">
                    {analysis.found.map((item, i) => (
                      <li key={i} className="finding-item finding-success">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* What's missing */}
              {analysis.notFound && analysis.notFound.length > 0 && (
                <div className="analysis-findings">
                  <h4 className="findings-label">Not Found</h4>
                  <ul className="findings-list">
                    {analysis.notFound.map((item, i) => (
                      <li key={i} className="finding-item finding-missing">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Confidence explanation */}
              {analysis.confidenceReason && (
                <div className="confidence-explanation">
                  <Info className="w-3.5 h-3.5" />
                  <span>{analysis.confidenceReason}</span>
                </div>
              )}

              {/* Next step suggestion */}
              {analysis.suggestion && (
                <div className="suggestion-box">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{analysis.suggestion}</span>
                </div>
              )}
            </div>
          )}

          {/* Data Provenance Toggle */}
          {Object.keys(provenance).length > 0 && (
            <div className="provenance-section">
              <button
                className="provenance-toggle"
                onClick={(e) => { e.stopPropagation(); setShowProvenance(!showProvenance); }}
              >
                <Database className="w-4 h-4" />
                <span>Data Sources</span>
                {showProvenance ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showProvenance && (
                <div className="provenance-list">
                  {Object.entries(provenance).map(([field, source]) => {
                    const SourceIcon = SOURCE_ICONS[source] || Database;
                    return (
                      <div key={field} className="provenance-item">
                        <span className="provenance-field">{FIELD_LABELS[field] || field}</span>
                        <span className="provenance-source">
                          <SourceIcon className="w-3 h-3" />
                          {SOURCE_LABELS[source] || source}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Enrichment Steps History */}
          {steps.length > 0 && (
            <div className="steps-history">
              <h4 className="steps-label">Enrichment Steps</h4>
              {steps.map((step, i) => {
                const StepIcon = SOURCE_ICONS[step.source] || Database;
                return (
                  <EnrichmentStep
                    key={i}
                    label={SOURCE_LABELS[step.source] || step.source}
                    icon={StepIcon}
                    status={step.status}
                    fieldsFound={step.fieldsFound}
                    message={step.message}
                  />
                );
              })}
            </div>
          )}

          {/* Missing Fields Summary */}
          {missingFields.length > 0 && (
            <div className="missing-fields">
              <h4 className="missing-label">Still Missing</h4>
              <div className="missing-tags">
                {missingFields.map(field => (
                  <span key={field} className="missing-tag">
                    {FIELD_LABELS[field] || field}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Last enriched timestamp */}
          {contact.last_enriched_at && (
            <div className="enrichment-timestamp">
              Last enriched: {new Date(contact.last_enriched_at).toLocaleDateString()} at{' '}
              {new Date(contact.last_enriched_at).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function EnrichmentStep({ label, icon: Icon, status, fieldsFound, message }) {
  const statusConfig = {
    running: { className: 'step-running', indicator: <Loader className="w-4 h-4 spinner" /> },
    success: { className: 'step-success', indicator: <CheckCircle className="w-4 h-4" /> },
    error: { className: 'step-error', indicator: <AlertCircle className="w-4 h-4" /> },
    no_data: { className: 'step-nodata', indicator: <AlertCircle className="w-4 h-4" /> },
    no_match: { className: 'step-nodata', indicator: <AlertCircle className="w-4 h-4" /> },
    no_results: { className: 'step-nodata', indicator: <AlertCircle className="w-4 h-4" /> },
    parse_error: { className: 'step-error', indicator: <AlertCircle className="w-4 h-4" /> },
    pending: { className: 'step-pending', indicator: <div className="step-dot" /> }
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <div className={`enrichment-step ${config.className}`}>
      <div className="step-indicator">{config.indicator}</div>
      <div className="step-content">
        <div className="step-label">
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </div>
        {fieldsFound && fieldsFound.length > 0 && (
          <div className="step-fields">
            {fieldsFound.map(f => (
              <span key={f} className="step-field-tag">{FIELD_LABELS[f] || f}</span>
            ))}
          </div>
        )}
        {message && <p className="step-message">{message}</p>}
      </div>
    </div>
  );
}

// ─── Helpers ───

function getMissingFields(contact) {
  const missing = [];
  if (!contact.email && !contact.work_email) missing.push('email');
  if (!contact.phone && !contact.phone_mobile && !contact.phone_direct) missing.push('phone');
  if (!contact.linkedin_url) missing.push('linkedin_url');
  if (!contact.city && !contact.state) missing.push('location');
  if (!contact.seniority) missing.push('seniority');
  if (!contact.departments || contact.departments.length === 0) missing.push('departments');
  return missing;
}
