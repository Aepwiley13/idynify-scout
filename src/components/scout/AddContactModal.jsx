import { useState } from 'react';
import { X, UserPlus, Upload, Camera, Search } from 'lucide-react';
import ManualContactForm from './ManualContactForm';
import CSVUpload from './CSVUpload';
import BusinessCardCapture from './BusinessCardCapture';

export default function AddContactModal({ onClose, onContactAdded }) {
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'manual', 'csv', 'business-card'

  const handleBack = () => {
    setCurrentView('menu');
  };

  const handleContactAdded = (contacts) => {
    onContactAdded(contacts);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            {currentView !== 'menu' && (
              <button
                onClick={handleBack}
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                ← Back
              </button>
            )}
            <h2 className="text-2xl font-bold text-gray-900">
              {currentView === 'menu' && 'Add Contact'}
              {currentView === 'manual' && 'Add Manually'}
              {currentView === 'csv' && 'Upload CSV'}
              {currentView === 'business-card' && 'Scan Business Card'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
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

              {/* From Apollo (Existing Flow) */}
              <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gray-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Search className="w-6 h-6 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-700 mb-1">From Apollo</h3>
                    <p className="text-sm text-gray-600">
                      Already available in Scout → Search for companies and save contacts.
                    </p>
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
        </div>
      </div>
    </div>
  );
}
