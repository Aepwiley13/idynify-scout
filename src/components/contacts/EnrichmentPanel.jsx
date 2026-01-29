import { useState } from 'react';
import {
  Sparkles,
  Loader,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Database,
  Globe,
  Search,
  Shield,
  XCircle,
  HardDrive
} from 'lucide-react';
import './EnrichmentPanel.css';

/**
 * EnrichmentPanel — User-initiated enrichment status & controls
 *
 * NO AI. Shows deterministic results:
 * - Found fields with source badges (Apollo / Google / Internal)
 * - Missing fields
 * - Confidence level (rule-based)
 * - Enrichment step history
 * - Data provenance (what came from where)
 */

const SOURCE_LABELS = {
  internal_db: 'Internal DB',
  apollo_match: 'Apollo (Exact)',
  apollo_search: 'Apollo (Search)',
  google_places: 'Google Places'
};

const SOURCE_ICONS = {
  internal_db: HardDrive,
  apollo_match: Database,
  apollo_search: Search,
  google_places: Globe
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
  education: 'Education',
  company_name: 'Company Name',
  company_phone: 'Company Phone',
  company_website: 'Company Website',
  company_address: 'Company Address',
  google_maps_url: 'Google Maps'
};

const CONFIDENCE_CONFIG = {
  high: { label: 'High', className: 'confidence-high' },
  medium: { label: 'Medium', className: 'confidence-medium' },
  low: { label: 'Low', className: 'confidence-low' }
};

export default function EnrichmentPanel({ contact, onEnrich, enriching, enrichResult }) {
  const [expanded, setExpanded] = useState(false);
  const [showProvenance, setShowProvenance] = useState(false);

  // Check what's missing
  const missingFields = getMissingFields(contact);
  const hasBeenEnriched = !!contact.last_enriched_at;
  const summary = enrichResult?.summary || contact.enrichment_summary;
  const provenance = enrichResult?.provenance || contact.enrichment_provenance || {};
  const steps = enrichResult?.steps || contact.enrichment_steps || [];
  const confidence = summary?.confidence || null;

  const isComplete = hasBeenEnriched && missingFields.length === 0;
  const needsEnrichment = !hasBeenEnriched || missingFields.length > 0;
  const fieldsFoundCount = summary?.fields_found?.length || Object.keys(provenance).length;

  return (
    <div className="enrichment-panel">
      {/* ── Header ─── */}
      <div className="enrichment-header" onClick={() => setExpanded(!expanded)}>
        <div className="enrichment-header-left">
          <Sparkles className="w-5 h-5 enrichment-icon" />
          <div>
            <h3 className="enrichment-title">Data Enrichment</h3>
            <p className="enrichment-subtitle">
              {enriching ? 'Enriching...' :
               isComplete ? 'All key fields populated' :
               hasBeenEnriched ? `${missingFields.length} field${missingFields.length > 1 ? 's' : ''} still missing` :
               'Not yet enriched'}
            </p>
          </div>
        </div>
        <div className="enrichment-header-right">
          {confidence && (
            <span className={`confidence-badge ${CONFIDENCE_CONFIG[confidence]?.className || ''}`}>
              <Shield className="w-3.5 h-3.5" />
              {CONFIDENCE_CONFIG[confidence]?.label || confidence}
            </span>
          )}
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </div>

      {/* ── Enrich Button ─── */}
      {needsEnrichment && !enriching && (
        <div className="enrichment-action">
          <button
            className="enrich-barry-btn"
            onClick={(e) => { e.stopPropagation(); onEnrich(); }}
          >
            <Sparkles className="w-5 h-5" />
            <span>Enrich Contact</span>
          </button>
          <p className="enrich-hint">
            Checks internal data, Apollo, and Google Places to fill missing fields.
          </p>
        </div>
      )}

      {/* ── Re-enrich Button (when already enriched but has gaps) ─── */}
      {hasBeenEnriched && !enriching && missingFields.length > 0 && (
        <div className="enrichment-action">
          <button
            className="enrich-barry-btn"
            onClick={(e) => { e.stopPropagation(); onEnrich(); }}
          >
            <Sparkles className="w-5 h-5" />
            <span>Re-enrich</span>
          </button>
        </div>
      )}

      {/* ── Live Progress ─── */}
      {enriching && (
        <div className="enrichment-progress">
          <div className="progress-steps">
            <EnrichmentStep label="Checking internal data" icon={HardDrive} status="running" />
            <EnrichmentStep label="Apollo person lookup" icon={Database} status="pending" />
            <EnrichmentStep label="Google Places fallback" icon={Globe} status="pending" />
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar-fill progress-bar-animated" />
          </div>
        </div>
      )}

      {/* ── Expanded Details ─── */}
      {expanded && !enriching && (
        <div className="enrichment-details">

          {/* Found / Missing Summary */}
          {(fieldsFoundCount > 0 || missingFields.length > 0) && (
            <div className="analysis-section">
              {/* Found fields */}
              {fieldsFoundCount > 0 && (
                <div className="analysis-findings">
                  <h4 className="findings-label">Found ({fieldsFoundCount})</h4>
                  <ul className="findings-list">
                    {(summary?.fields_found || Object.keys(provenance)).map((field, i) => (
                      <li key={i} className="finding-item finding-success">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>{FIELD_LABELS[field] || field}</span>
                        {provenance[field] && (
                          <span className="finding-source">{SOURCE_LABELS[provenance[field]] || provenance[field]}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Missing fields */}
              {missingFields.length > 0 && (
                <div className="analysis-findings">
                  <h4 className="findings-label">Not Found ({missingFields.length})</h4>
                  <ul className="findings-list">
                    {missingFields.map((field, i) => (
                      <li key={i} className="finding-item finding-missing">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{FIELD_LABELS[field] || field}</span>
                      </li>
                    ))}
                  </ul>
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
    skipped: { className: 'step-nodata', indicator: <AlertCircle className="w-4 h-4" /> },
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
