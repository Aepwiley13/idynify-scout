import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Upload, Camera, CheckCircle, Eye, PlusCircle, Linkedin, ArrowLeft, Building2 } from 'lucide-react';
import ManualContactForm from '../../components/scout/ManualContactForm';
import CSVUpload from '../../components/scout/CSVUpload';
import BusinessCardCapture from '../../components/scout/BusinessCardCapture';
import LinkedInLinkSearch from '../../components/scout/LinkedInLinkSearch';
import { useT } from '../../theme/ThemeContext';

export default function ScoutPlus() {
  const navigate = useNavigate();
  const T = useT();
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'manual', 'csv', 'business-card', 'linkedin-link', 'success'
  const [addedItems, setAddedItems] = useState([]);
  const [lastUploadType, setLastUploadType] = useState(null); // 'leads' or 'companies'

  const handleBack = () => {
    setCurrentView('menu');
  };

  const handleContactAdded = (items) => {
    setAddedItems(items);
    // Detect upload type from the _uploadType flag set by CSVUpload
    const isCompanyUpload = items.length > 0 && items[0]?._uploadType === 'companies';
    setLastUploadType(isCompanyUpload ? 'companies' : 'leads');
    setCurrentView('success');
  };

  const handleViewResults = () => {
    if (lastUploadType === 'companies') {
      navigate('/scout', { state: { activeTab: 'saved-companies' } });
    } else if (addedItems.length === 1 && addedItems[0]?.id) {
      navigate(`/scout/contact/${addedItems[0].id}`);
    } else {
      navigate('/scout', { state: { activeTab: 'all-leads' } });
    }
  };

  const handleAddMore = () => {
    setAddedItems([]);
    setLastUploadType(null);
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
            {currentView === 'success' && (lastUploadType === 'companies' ? 'Companies Added Successfully!' : 'Contact Added Successfully!')}
          </h2>
        </div>
      </div>

      {/* Page Content */}
      <div style={{ maxWidth: 672, margin: '0 auto', padding: 24, width: '100%' }}>
        {currentView === 'menu' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              onMouseEnter={e => e.currentTarget.style.borderColor = '#22c55e'}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 48, height: 48, background: '#dcfce7', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Upload className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Upload CSV</h3>
                  <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Import up to 25 contacts from a spreadsheet. Fast bulk upload.</p>
                </div>
              </div>
            </button>

            {/* Business Card Capture */}
            <button
              onClick={() => setCurrentView('business-card')}
              style={{ width: '100%', background: T.cardBg, border: `2px solid ${T.border}`, borderRadius: 14, padding: 24, textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#a855f7'}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 48, height: 48, background: '#f3e8ff', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Camera className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>Scan Business Card</h3>
                  <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>Take a photo or upload an image. Perfect for post-event follow-ups.</p>
                </div>
              </div>
            </button>

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
              {lastUploadType === 'companies'
                ? (addedItems.length === 1 ? 'Company Added!' : `${addedItems.length} Companies Added!`)
                : (addedItems.length === 1 ? 'Contact Added!' : `${addedItems.length} Contacts Added!`)}
            </h3>
            <p style={{ color: T.textMuted, marginBottom: 32, fontSize: 13 }}>
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
          </div>
        )}
      </div>
    </div>
  );
}
