import { useState } from 'react';
import { X, UserPlus, Upload, Camera, CheckCircle, Eye, PlusCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ManualContactForm from './ManualContactForm';
import CSVUpload from './CSVUpload';
import BusinessCardCapture from './BusinessCardCapture';

export default function AddContactModal({ onClose, onContactAdded }) {
  const navigate = useNavigate();
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'manual', 'csv', 'business-card', 'success'
  const [addedContacts, setAddedContacts] = useState([]);

  const handleBack = () => {
    setCurrentView('menu');
  };

  const handleContactAdded = (contacts) => {
    setAddedContacts(contacts);
    setCurrentView('success');
    // Notify parent without closing
    onContactAdded(contacts);
  };

  const handleViewLeads = () => {
    onClose();
    navigate('/scout/all-leads');
  };

  const handleAddMore = () => {
    setAddedContacts([]);
    setCurrentView('menu');
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
              {currentView === 'menu' && 'Scout+'}
              {currentView === 'manual' && 'Add Manually'}
              {currentView === 'csv' && 'Upload CSV'}
              {currentView === 'business-card' && 'Scan Business Card'}
              {currentView === 'success' && 'Contact Added Successfully!'}
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
                {addedContacts.length === 1 ? 'Contact Added!' : `${addedContacts.length} Contacts Added!`}
              </h3>
              <p className="text-gray-600 mb-8">
                {addedContacts.length === 1
                  ? 'Your contact has been saved to your leads.'
                  : 'Your contacts have been saved to your leads.'}
              </p>

              {/* Contact Summary */}
              <div className="mb-8 bg-gray-50 rounded-xl p-4 text-left max-h-48 overflow-y-auto">
                {addedContacts.map((contact, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 py-2 border-b border-gray-200 last:border-0"
                  >
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold">
                      {contact.name ? contact.name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{contact.name}</p>
                      <p className="text-sm text-gray-600 truncate">
                        {contact.title || 'No title'} {contact.company && `• ${contact.company}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleViewLeads}
                  className="flex-1 px-6 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <Eye className="w-5 h-5" />
                  View in Leads
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
    </div>
  );
}
