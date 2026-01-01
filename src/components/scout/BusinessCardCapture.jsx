import { useState, useRef } from 'react';
import { auth, db } from '../../firebase/config';
import { collection, addDoc } from 'firebase/firestore';
import { Camera, Upload, Edit3, Calendar } from 'lucide-react';

export default function BusinessCardCapture({ onContactAdded, onCancel }) {
  const [image, setImage] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    event_name: '',
    date_met: ''
  });
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef(null);

  // Mock OCR extraction - simulates what a real OCR service would return
  const mockOCRExtraction = (imageFile) => {
    setExtracting(true);

    // Simulate API delay
    setTimeout(() => {
      // Mock extracted data - in production, this would come from Google Vision, Textract, etc.
      const mockData = {
        name: '',
        email: '',
        phone: '',
        company: '',
        title: ''
      };

      setExtractedData(mockData);
      setFormData(prev => ({
        ...prev,
        ...mockData
      }));
      setExtracting(false);
    }, 1500);
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    // Preview image
    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(event.target.result);
      mockOCRExtraction(file);
    };
    reader.readAsDataURL(file);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!formData.name || formData.name.trim() === '') {
      alert('Name is required');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert('You must be logged in to add contacts');
      return;
    }

    setSaving(true);

    try {
      const contactData = {
        name: formData.name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        company: formData.company.trim() || null,
        title: formData.title.trim() || null,

        // Source tracking
        source: 'networking',
        capture_method: 'business_card',
        enrichment_status: 'ocr_extracted',

        // Networking context (optional)
        networking_context: {
          event_name: formData.event_name.trim() || null,
          date_met: formData.date_met || null
        },

        // Scout metadata
        lead_status: 'saved',
        export_ready: true,
        addedAt: new Date().toISOString(),

        // Placeholder for future enrichment
        apollo_data: null,
        enriched: false
      };

      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const docRef = await addDoc(contactsRef, contactData);

      console.log('✅ Networking contact added:', docRef.id);

      onContactAdded([{ id: docRef.id, ...contactData }]);

    } catch (error) {
      console.error('Error saving networking contact:', error);
      alert('Failed to save contact. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
        <h3 className="font-semibold text-gray-900 mb-2">Business Card Capture</h3>
        <p className="text-sm text-gray-700">
          Upload a photo of a business card. Review and edit the extracted information before saving.
        </p>
      </div>

      {/* Image Upload */}
      {!image ? (
        <div className="space-y-4">
          {/* Camera Capture (Mobile) */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-purple-400 transition-colors">
            <Camera className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Take Photo</h3>
            <p className="text-sm text-gray-600 mb-4">
              Use your camera to snap a photo of the business card
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageSelect}
              className="hidden"
              id="camera-capture"
            />
            <label
              htmlFor="camera-capture"
              className="inline-block px-6 py-3 bg-purple-600 text-white font-semibold rounded-xl cursor-pointer hover:bg-purple-700 transition-all"
            >
              Open Camera
            </label>
          </div>

          {/* File Upload */}
          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-purple-400 transition-colors">
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Image</h3>
            <p className="text-sm text-gray-600 mb-4">
              Or upload an existing image from your device
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="inline-block px-6 py-3 bg-white border border-gray-300 text-gray-700 font-semibold rounded-xl cursor-pointer hover:bg-gray-50 transition-all"
            >
              Choose Image
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Image Preview */}
          <div className="bg-gray-100 rounded-xl p-4 border border-gray-300">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Business Card Image</h3>
              <button
                onClick={() => {
                  setImage(null);
                  setExtractedData(null);
                  setFormData({
                    name: '',
                    email: '',
                    phone: '',
                    company: '',
                    title: '',
                    event_name: '',
                    date_met: ''
                  });
                }}
                className="text-sm text-purple-600 hover:text-purple-700 font-semibold"
              >
                Change Image
              </button>
            </div>
            <img
              src={image}
              alt="Business card"
              className="w-full h-auto rounded-lg"
            />
          </div>

          {/* Extracting State */}
          {extracting && (
            <div className="bg-purple-50 rounded-xl p-6 border border-purple-200 text-center">
              <div className="animate-spin text-4xl mb-3">⚙️</div>
              <p className="font-semibold text-gray-900">Extracting information...</p>
              <p className="text-sm text-gray-600">Using OCR to read the business card</p>
            </div>
          )}

          {/* Review & Edit Form */}
          {!extracting && extractedData && (
            <>
              <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                <div className="flex items-start gap-3">
                  <Edit3 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Review & Edit</h3>
                    <p className="text-sm text-gray-700">
                      OCR extraction complete. Please review and correct any fields before saving.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {/* Name (Required) */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Full Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                    placeholder="John Doe"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                    placeholder="john.doe@company.com"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                    placeholder="+1 (555) 123-4567"
                  />
                </div>

                {/* Company */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Company
                  </label>
                  <input
                    type="text"
                    value={formData.company}
                    onChange={(e) => handleChange('company', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                    placeholder="Acme Corporation"
                  />
                </div>

                {/* Title */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Title
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => handleChange('title', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                    placeholder="VP of Sales"
                  />
                </div>

                {/* Networking Context (Optional) */}
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-5 h-5 text-gray-600" />
                    <h4 className="font-semibold text-gray-900">Where You Met (Optional)</h4>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Event Name
                      </label>
                      <input
                        type="text"
                        value={formData.event_name}
                        onChange={(e) => handleChange('event_name', e.target.value)}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                        placeholder="TechCrunch Disrupt 2024"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Date Met
                      </label>
                      <input
                        type="date"
                        value={formData.date_met}
                        onChange={(e) => handleChange('date_met', e.target.value)}
                        className="w-full px-4 py-2 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Action Buttons */}
      {image && !extracting && extractedData && (
        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 px-6 py-3 rounded-xl bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-6 py-3 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <span className="animate-spin">⚙️</span>
                Saving...
              </>
            ) : (
              <>
                <Camera className="w-5 h-5" />
                Save Contact
              </>
            )}
          </button>
        </div>
      )}

      {!image && (
        <div className="flex gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-6 py-3 rounded-xl bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
