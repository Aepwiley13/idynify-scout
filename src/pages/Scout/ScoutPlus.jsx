import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Upload, Camera, CheckCircle, Eye, PlusCircle, Linkedin, ArrowLeft, Building2 } from 'lucide-react';
import ManualContactForm from '../../components/scout/ManualContactForm';
import CSVUpload from '../../components/scout/CSVUpload';
import BusinessCardCapture from '../../components/scout/BusinessCardCapture';
import LinkedInLinkSearch from '../../components/scout/LinkedInLinkSearch';

export default function ScoutPlus() {
  const navigate = useNavigate();
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
    <div className="min-h-full bg-white">
      {/* Page Header */}
      <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={currentView === 'menu' ? handleNavigateBack : handleBack}
            className="text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-1"
          >
            <ArrowLeft className="w-5 h-5" />
            {currentView !== 'menu' && <span>Back</span>}
          </button>
          <h2 className="text-2xl font-bold text-gray-900">
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
      <div className="max-w-2xl mx-auto p-6">
        {currentView === 'menu' && (
          <div className="space-y-4">
            {/* Manual Entry */}
            <button
              onClick={() => setCurrentView('manual')}
              className="w-full bg-white hover:bg-blue-50 border-2 border-gray-200 hover:border-blue-400 rounded-xl p-6 text-left transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                  <UserPlus className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Add Manually</h3>
                  <p className="text-sm text-gray-600">
                    Enter contact details one at a time. Perfect for quick adds.
                  </p>
                </div>
              </div>
            </button>

            {/* CSV Upload */}
            <button
              onClick={() => setCurrentView('csv')}
              className="w-full bg-white hover:bg-green-50 border-2 border-gray-200 hover:border-green-400 rounded-xl p-6 text-left transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 transition-colors">
                  <Upload className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Upload CSV</h3>
                  <p className="text-sm text-gray-600">
                    Import up to 25 contacts from a spreadsheet. Fast bulk upload.
                  </p>
                </div>
              </div>
            </button>

            {/* Business Card Capture */}
            <button
              onClick={() => setCurrentView('business-card')}
              className="w-full bg-white hover:bg-purple-50 border-2 border-gray-200 hover:border-purple-400 rounded-xl p-6 text-left transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-purple-200 transition-colors">
                  <Camera className="w-6 h-6 text-purple-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">Scan Business Card</h3>
                  <p className="text-sm text-gray-600">
                    Take a photo or upload an image. Perfect for post-event follow-ups.
                  </p>
                </div>
              </div>
            </button>

            {/* LinkedIn Link */}
            <button
              onClick={() => setCurrentView('linkedin-link')}
              className="w-full bg-white hover:bg-blue-50 border-2 border-gray-200 hover:border-blue-400 rounded-xl p-6 text-left transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                  <Linkedin className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">LinkedIn Link</h3>
                  <p className="text-sm text-gray-600">
                    Paste a LinkedIn profile URL and let Barry find the contact instantly.
                  </p>
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
          <div className="py-8 text-center">
            {/* Success Icon */}
            <div className="mb-6 flex justify-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-12 h-12 text-green-600" />
              </div>
            </div>

            {/* Success Message */}
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              {lastUploadType === 'companies'
                ? (addedItems.length === 1 ? 'Company Added!' : `${addedItems.length} Companies Added!`)
                : (addedItems.length === 1 ? 'Contact Added!' : `${addedItems.length} Contacts Added!`)}
            </h3>
            <p className="text-gray-600 mb-8">
              {lastUploadType === 'companies'
                ? (addedItems.length === 1
                    ? 'Your company has been saved to Saved Companies.'
                    : 'Your companies have been saved to Saved Companies.')
                : (addedItems.length === 1
                    ? 'Your contact has been saved to your leads.'
                    : 'Your contacts have been saved to your leads.')}
            </p>

            {/* Item Summary */}
            <div className="mb-8 bg-gray-50 rounded-xl p-4 text-left max-h-48 overflow-y-auto">
              {addedItems.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 py-2 border-b border-gray-200 last:border-0"
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                    lastUploadType === 'companies'
                      ? 'bg-cyan-100 text-cyan-600'
                      : 'bg-blue-100 text-blue-600'
                  }`}>
                    {lastUploadType === 'companies'
                      ? <Building2 className="w-5 h-5" />
                      : (item.name ? item.name.charAt(0).toUpperCase() : '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{item.name}</p>
                    <p className="text-sm text-gray-600 truncate">
                      {lastUploadType === 'companies'
                        ? (item.industry || item.website_url || 'Company')
                        : (<>{item.title || 'No title'} {item.company && `\u2022 ${item.company}`}</>)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleViewResults}
                className="flex-1 px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-all shadow-md flex items-center justify-center gap-2"
              >
                <Eye className="w-5 h-5" />
                {lastUploadType === 'companies'
                  ? 'View Saved Companies'
                  : (addedItems.length === 1 ? 'Go to Lead' : 'View in Leads')}
              </button>
              <button
                onClick={handleAddMore}
                className="flex-1 px-6 py-3 rounded-xl bg-white border-2 border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
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
