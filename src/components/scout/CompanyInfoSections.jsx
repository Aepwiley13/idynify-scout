/**
 * Company Snapshot, Company Overview and Links — the company-level sections
 * shared by the company detail modal and the company profile page that opens
 * from Saved Companies → Find Contacts, so both show the same thing the same way.
 *
 * Class names are prefixed `ci-` and styled only by CompanyInfoSections.css:
 * every page stylesheet ships in one global bundle, and the generic names the
 * modal used (`snapshot-grid`, `detail-section`, …) are restyled by other pages.
 */
import { Globe, Linkedin, ExternalLink } from 'lucide-react';
import { snapshotFacts } from './companyInfoFacts';
import './CompanyInfoSections.css';

export function CompanySnapshot({ company, snapshot }) {
  return (
    <div className="ci-section ci-snapshot" data-testid="company-snapshot">
      <h3 className="ci-title">Company Snapshot</h3>
      <div className="ci-snapshot-grid">
        {snapshotFacts(company, snapshot).map(fact => {
          const [label, value, Icon] = fact;
          return (
            <div className="ci-snapshot-item" key={label}>
              <Icon className="ci-snapshot-icon" />
              <div>
                <p className="ci-snapshot-label">{label}</p>
                <p className="ci-snapshot-value">{value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The description, or `placeholder` when there is none. Renders nothing when
 * there is neither. `children` (e.g. keywords) follow the text.
 */
export function CompanyOverview({ description, placeholder, children }) {
  if (!description && !placeholder) return null;
  return (
    <div className="ci-section" data-testid="company-overview">
      <h3 className="ci-title">Company Overview</h3>
      {description
        ? <p className="ci-overview-text">{description}</p>
        : <p className="ci-overview-text ci-overview-placeholder">{placeholder}</p>}
      {children}
    </div>
  );
}

/** Website and LinkedIn buttons; nothing when neither URL is known. */
export function CompanyLinks({ websiteUrl, linkedinUrl, onOpen }) {
  if (!websiteUrl && !linkedinUrl) return null;
  return (
    <div className="ci-section" data-testid="company-links">
      <h3 className="ci-title">Links</h3>
      <div className="ci-links">
        {websiteUrl && (
          <button className="ci-link ci-link--website" onClick={() => onOpen(websiteUrl)}>
            <Globe className="w-5 h-5" />
            <span>Visit Website</span>
            <ExternalLink className="w-4 h-4 ci-link-external" />
          </button>
        )}
        {linkedinUrl && (
          <button className="ci-link ci-link--linkedin" onClick={() => onOpen(linkedinUrl)}>
            <Linkedin className="w-5 h-5" />
            <span>View on LinkedIn</span>
            <ExternalLink className="w-4 h-4 ci-link-external" />
          </button>
        )}
      </div>
    </div>
  );
}
