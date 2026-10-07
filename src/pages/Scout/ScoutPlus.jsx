import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { openContact, ENTRY_POINTS, DISPLAY_MODES } from '../../utils/navigation';
import { UserPlus, Upload, Camera, CheckCircle, Eye, PlusCircle, Linkedin, ArrowLeft, Building2, Search, RefreshCw, Tag, AlertTriangle } from 'lucide-react';
import ManualContactForm from '../../components/scout/ManualContactForm';
import CSVUpload from '../../components/scout/CSVUpload';
import BusinessCardCapture from '../../components/scout/BusinessCardCapture';
import LinkedInLinkSearch from '../../components/scout/LinkedInLinkSearch';
import CompanySearch from './CompanySearch';
import CadencePickerModal from '../../components/cadences/CadencePickerModal';
import { useT } from '../../theme/ThemeContext';

export default function ScoutPlus() {
  const navigate = useNavigate();
  const location = useLocation();
  const T = useT();
  // Allow callers to deep-link into a specific view via location state (e.g. initialView: 'company-search')
  const validViews = ['menu', 'manual', 'csv', 'business-card', 'linkedin-link', 'company-search'];
  const initialView = validViews.includes(location.state?.initialView) ? location.state.initialView : 'menu';
  const [currentView, setCurrentView] = useState(initialView); // 'menu', 'manual', 'csv', 'business-card', 'linkedin-link', 'company-search', 'success'
  const [addedItems, setAddedItems] = useState([]);
  const [lastUploadType, setLastUploadType] = useState(null); // 'leads' or 'companies'
  // CSV contact imports only: { batchId, tag, created, updated, failed }
  const [importResult, setImportResult] = useState(null);
  const [showCadencePicker, setShowCadencePicker] = useState(false);

  const handleBack = () => {
    setCurrentView('menu');
  };

  const handleContactAdded = (items, csvImportResult = null) => {
    // Detect upload type from the _uploadType flag set by CSVUpload
    const isCompanyUpload = items.length > 0 && items[0]?._uploadType === 'companies';
    // Auto-navigate to the contact profile when a single LinkedIn contact is saved
    if (currentView === 'linkedin-link' && items.length === 1 && items[0]?.id && !isCompanyUpload) {
      openSavedContact(items[0].id);
      return;
    }
    setAddedItems(items);
    setLastUploadType(isCompanyUpload ? 'companies' : 'leads');
    setImportResult(csvImportResult);
    setCurrentView('success');
  };

  /**
   * Open a contact the user just saved here. PAGE mode, deliberately.
   *
   * This was PANEL, and panel mode routes to /scout/contact/:id — a CHILD of
   * /scout, which mounts ScoutMain underneath. Scout opens on its default tab,
   * so saving a contact through Scout+ dropped the user onto Daily Lead
   * Insights with their new contact in a panel over a list they had never
   * looked at. Staging caught it.
   *
   * The panel exists to preserve a list the user built — filters, sort, scroll.
   * Scout+ is a FORM. There is no list behind it, so there is nothing to
   * preserve and everything to be confused by. Same reasoning as Mission
   * Control: no list → page. See ADR-001.
   *
   * returnTo is `/scout?tab=scout-plus`, which is the real route. Scout's views
   * are query params (App.jsx redirects /scout-plus → /scout?tab=scout-plus);
   * a path-style `/scout/scout-plus` matches nothing and falls through to the
   * catch-all, which would send Back to the homepage.
   */
  const openSavedContact = (contactId) => {
    openContact({
      navigate,
      contactId,
      entryPoint: ENTRY_POINTS.SCOUT_PLUS,
      returnTo: '/scout?tab=scout-plus',
      displayMode: DISPLAY_MODES.PAGE,
    });
  };

  /**
   * People, filtered to this import's tag. /command-center is People's real
   * route (/people redirects there); AllLeads reads `tag` from the URL into its
   * existing tag filter.
   */
  const viewImportedPeople = () => {
    const params = new URLSearchParams({ tab: 'people', tag: importResult.tag });
    navigate(`/command-center?${params.toString()}`);
  };

  const handleViewResults = () => {
    if (importResult?.tag) {
      viewImportedPeople();
    } else if (lastUploadType === 'companies') {
      navigate('/scout', { state: { activeTab: 'saved-companies' } });
    } else if (addedItems.length === 1 && addedItems[0]?.id) {
      openSavedContact(addedItems[0].id);
    } else {
      navigate('/scout', { state: { activeTab: 'all-leads' } });
    }
  };

  const emailConflictCount = importResult ? addedItems.filter(c => c._emailConflict).length : 0;
  const archivedCount = importResult ? addedItems.filter(c => c._archived).length : 0;

  const handleAddMore = () => {
    setAddedItems([]);
    setLastUploadType(null);
    setImportResult(null);
    setShowCadencePicker(false);
    setCurrentView('menu');
  };

  const handleNavigateBack = () => {
    navigate(-1);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: T.appBg, color: T.text }}>
      {/* Page Header */}
      <div style={{ borderBottom: `1px solid ${T.border}`, background: T.navBg, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={currentView === 'menu' ? handleNavigateBack : handleBack}
            style={{ color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
          >
            <ArrowLeft className="w-5 h-5" />
            {currentView !== 'menu' && <span>Back</span>}
          </button>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0 }}>
            {currentView === 'menu' && 'Scout+'}
            {currentView === 'manual' && 'Add Manually'}
            {currentView === 'csv' && 'Upload CSV'}
            {currentView === 'business-card' && 'Scan Business Card'}
            {currentView === 'linkedin-link' && 'LinkedIn Link'}
            {currentView === 'company-search' && 'Company Search'}
            {currentView === 'success' && (importResult ? 'Import Complete' : lastUploadType === 'companies' ? 'Companies Added Successfully!' : 'Contact Added Successfully!')}
          </h2>
        </div>
      </div>

      {/* Page Content */}
      <div style={{ maxWidth: 672, margin: '0 auto', padding: 24, width: '100%' }}>
        {currentView === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* LinkedIn Link */}
            <button
              onClick={() => setCurrentView('linkedin-link')}
              style={{ width: '100%', background: T.cardBg, border: `2px solid ${T.border}`, borderRadius: 14, padding: 24, textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#0077b5'}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 48, height: 48, background: '#dbeafe', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Linkedin className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>LinkedIn Link</h3>
                  <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Paste a LinkedIn profile URL and let Barry find the contact instantly.</p>
                </div>
              </div>
            </button>

            {/* Company Search */}
            <button
              onClick={() => setCurrentView('company-search')}
              style={{ width: '100%', background: T.cardBg, border: `2px solid ${T.border}`, borderRadius: 14, padding: 24, textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#f59e0b'}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 48, height: 48, background: '#fef3c7', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Search className="w-6 h-6 text-amber-500" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Company Search</h3>
                  <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Search by company name or website URL to find and save companies.</p>
                </div>
              </div>
            </button>

            {/* Manual Entry */}
            <button
              onClick={() => setCurrentView('manual')}
              style={{ width: '100%', background: T.cardBg, border: `2px solid ${T.border}`, borderRadius: 14, padding: 24, textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 48, height: 48, background: '#dbeafe', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <UserPlus className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Add Manually</h3>
                  <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Enter contact details one at a time. Perfect for quick adds.</p>
                </div>
              </div>
            </button>

            {/* CSV Upload */}
            <button
              onClick={() => setCurrentView('csv')}
              style={{ width: '100%', background: T.cardBg, border: `2px solid ${T.border}`, borderRadius: 14, padding: 24, textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#16a34a'}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 48, height: 48, background: '#dcfce7', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Upload className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Upload CSV</h3>
                  <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Import a list of people from a spreadsheet, then add them to a cadence.</p>
                </div>
              </div>
            </button>

            {/* Coming soon group — kept below the working options so the live
                add paths are the first thing a user reaches. */}
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 12 }}>
              Coming soon
            </div>

            {/* Business Card Capture — Coming Soon */}
            <div
              style={{ width: '100%', background: T.cardBg, border: `2px solid ${T.border}`, borderRadius: 14, padding: 24, textAlign: 'left', opacity: 0.55, cursor: 'default', position: 'relative' }}
            >
              <div style={{ position: 'absolute', top: 12, right: 14, background: '#f59e0b', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, letterSpacing: 0.5 }}>COMING SOON</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 48, height: 48, background: '#f3e8ff', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Camera className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Scan Business Card</h3>
                  <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Capture contacts from business cards. Available soon.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'manual' && (
          <ManualContactForm onContactAdded={handleContactAdded} onCancel={handleBack} />
        )}

        {currentView === 'csv' && (
          <CSVUpload onContactsAdded={handleContactAdded} onCancel={handleBack} />
        )}

        {currentView === 'business-card' && (
          <BusinessCardCapture onContactAdded={handleContactAdded} onCancel={handleBack} />
        )}

        {currentView === 'linkedin-link' && (
          <LinkedInLinkSearch onContactAdded={handleContactAdded} onCancel={handleBack} />
        )}

        {currentView === 'company-search' && (
          <CompanySearch onCompanyAdded={handleContactAdded} />
        )}

        {currentView === 'success' && (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            {/* Success Icon */}
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: 80, height: 80, background: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle className="w-12 h-12 text-green-600" />
              </div>
            </div>

            {/* Success Message */}
            <h3 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>
              {importResult ? `${addedItems.length} contact${addedItems.length !== 1 ? 's' : ''} imported successfully` : lastUploadType === 'companies'
                ? (addedItems.length === 1 ? 'Company Added!' : `${addedItems.length} Companies Added!`)
                : (addedItems.length === 1 ? 'Contact Added!' : `${addedItems.length} Contacts Added!`)}
            </h3>
            {importResult && (
              <div data-testid="import-summary" style={{ marginBottom: 20, fontSize: 13, color: T.textMuted, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <span>
                  {importResult.created.length} new
                  {importResult.updated.length > 0 && ` · ${importResult.updated.length} already in IDYNIFY (updated, not duplicated)`}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: T.statBg, border: `1px solid ${T.border}`, color: T.text, fontWeight: 600, fontSize: 12 }}>
                  <Tag className="w-3.5 h-3.5" />{importResult.tag}
                </span>
                {emailConflictCount > 0 && (
                  <span data-testid="import-email-conflicts" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#b45309' }}>
                    <AlertTriangle className="w-4 h-4" />
                    {emailConflictCount} email conflict{emailConflictCount !== 1 ? 's' : ''} — kept their IDYNIFY email and won't be added to a cadence until checked in People
                  </span>
                )}
                {archivedCount > 0 && (
                  <span data-testid="import-archived">
                    {archivedCount} {archivedCount === 1 ? 'is' : 'are'} archived — shown in this import's People view, still archived
                  </span>
                )}
                {importResult.failed.length > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#dc2626' }}>
                    <AlertTriangle className="w-4 h-4" />
                    {importResult.failed.length} row{importResult.failed.length !== 1 ? 's' : ''} could not be saved
                    (row{importResult.failed.length !== 1 ? 's' : ''} {importResult.failed.map(f => f.rowNumber).join(', ')})
                  </span>
                )}
              </div>
            )}
            <p style={{ color: T.textMuted, marginBottom: 32, fontSize: 13, display: importResult ? 'none' : undefined }}>
              {lastUploadType === 'companies'
                ? (addedItems.length === 1
                    ? 'Your company has been saved to Saved Companies.'
                    : 'Your companies have been saved to Saved Companies.')
                : (addedItems.length === 1
                    ? 'Your contact has been saved to your leads.'
                    : 'Your contacts have been saved to your leads.')}
            </p>

            {/* Item Summary */}
            <div style={{ marginBottom: 32, background: T.statBg, borderRadius: 14, padding: 16, textAlign: 'left', maxHeight: 192, overflowY: 'auto', border: `1px solid ${T.border}` }}>
              {addedItems.map((item, index) => (
                <div
                  key={index}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: index < addedItems.length - 1 ? `1px solid ${T.border}` : 'none' }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, background: lastUploadType === 'companies' ? '#cffafe' : '#dbeafe', color: lastUploadType === 'companies' ? '#0891b2' : '#2563eb', flexShrink: 0 }}>
                    {lastUploadType === 'companies'
                      ? <Building2 className="w-5 h-5" />
                      : (item.name ? item.name.charAt(0).toUpperCase() : '?')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{item.name}</p>
                    <p style={{ fontSize: 12, color: T.textFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                      {lastUploadType === 'companies'
                        ? (item.industry || item.website_url || 'Company')
                        : (<>{item.title || 'No title'} {item.company && `· ${item.company}`}</>)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            {importResult ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 12 }}>What would you like to do next?</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={viewImportedPeople}
                    style={{ flex: 1, padding: '12px 24px', borderRadius: 12, background: T.surface, border: `2px solid ${T.border}`, color: T.text, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <Eye className="w-5 h-5" />
                    View People
                  </button>
                  <button
                    onClick={() => setShowCadencePicker(true)}
                    style={{ flex: 1, padding: '12px 24px', borderRadius: 12, background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <RefreshCw className="w-5 h-5" />
                    Add to Cadence
                  </button>
                </div>
                <button
                  onClick={handleAddMore}
                  style={{ marginTop: 14, background: 'none', border: 'none', color: T.textMuted, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <PlusCircle className="w-4 h-4" />
                  Add more contacts
                </button>
              </>
            ) : (
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleViewResults}
                style={{ flex: 1, padding: '12px 24px', borderRadius: 12, background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Eye className="w-5 h-5" />
                {lastUploadType === 'companies'
                  ? 'View Saved Companies'
                  : (addedItems.length === 1 ? 'Go to Lead' : 'View in Leads')}
              </button>
              <button
                onClick={handleAddMore}
                style={{ flex: 1, padding: '12px 24px', borderRadius: 12, background: T.surface, border: `2px solid ${T.border}`, color: T.textMuted, fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <PlusCircle className="w-5 h-5" />
                Add More
              </button>
            </div>
            )}

            {showCadencePicker && (
              <CadencePickerModal
                contacts={addedItems}
                onClose={() => setShowCadencePicker(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
