import { useState, useRef } from 'react';
import { auth, db } from '../../firebase/config';
import { collection, addDoc, doc, setDoc, getDoc, updateDoc, query, where, getDocs } from 'firebase/firestore';
import { Camera, Upload, Edit3, Calendar, AlertCircle } from 'lucide-react';
import { startBackgroundEnrichment, assessEnrichmentViability } from '../../utils/contactEnrichment';

export default function BusinessCardCapture({ onContactAdded, onCancel }) {
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    website: '',
    event_name: '',
    date_met: ''
  });
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  // Real OCR extraction using Google Cloud Vision API
  const extractBusinessCardData = async (base64Image) => {
    setExtracting(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('You must be logged in');
      }

      const authToken = await user.getIdToken();

      console.log('📤 Sending OCR request to Netlify function...');

      const response = await fetch('/.netlify/functions/extractBusinessCard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          imageBase64: base64Image
        })
      });

      console.log('📥 OCR response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ OCR API error response:', errorText);
        throw new Error(`OCR service error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      console.log('📊 OCR response data:', data);

      if (!data.success) {
        throw new Error(data.error || 'OCR extraction failed');
      }

      console.log('✅ OCR extraction successful:', data.extractedData);

      setExtractedData(data.extractedData);
      setFormData(prev => ({
        ...prev,
        ...data.extractedData
      }));

    } catch (err) {
      console.error('❌ OCR extraction error:', err);
      console.error('Error details:', err.message);
      setError(err.message || 'Failed to extract card data. Please enter details manually.');
      // Set empty extracted data to allow manual entry
      setExtractedData({
        name: '',
        email: '',
        phone: '',
        company: '',
        title: '',
        website: ''
      });
    } finally {
      setExtracting(false);
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }

    // Preview image and extract data
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result;
      setImage(base64);
      setImageBase64(base64);
      extractBusinessCardData(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!formData.name || formData.name.trim() === '') {
      setError('Name is required');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      setError('You must be logged in to add contacts');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Step 1: Ensure company exists in Saved Companies (if company provided)
      let companyId = null;
      if (formData.company && formData.company.trim()) {
        companyId = await ensureCompanyExists(formData.company.trim(), formData.website, user.uid);
      }

      // Step 2: Save contact to /users/{uid}/contacts
      const contactData = {
        name: formData.name.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        company: formData.company.trim() || null,
        title: formData.title.trim() || null,

        // Company association
        company_id: companyId,
        company_name: formData.company.trim() || null,

        // Source tracking
        source: 'Scanned Business Card',
        capture_method: 'business_card_ocr',
        enrichment_status: 'ocr_extracted',

        // Networking context (optional)
        networking_context: {
          event_name: formData.event_name.trim() || null,
          date_met: formData.date_met || null
        },

        // Scout metadata
        lead_status: 'saved',
        export_ready: true,
        saved_at: new Date().toISOString(),
        addedAt: new Date().toISOString(),

        // Placeholder for future enrichment
        apollo_data: null,
        enriched: false,
        status: 'active'
      };

      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const docRef = await addDoc(contactsRef, contactData);

      console.log('✅ Business card contact added:', docRef.id);

      // Update company contact count if applicable
      if (companyId) {
        await updateCompanyContactCount(companyId, user.uid);
      }

      const savedContact = { id: docRef.id, ...contactData };

      // Assess enrichment viability and start background enrichment
      const viability = assessEnrichmentViability(savedContact);
      savedContact._enrichmentViability = viability;

      // Start background enrichment (non-blocking)
      startBackgroundEnrichment(
        [savedContact],
        (results) => {
          console.log('Business card contact enrichment complete:', results);
        }
      );

      onContactAdded([savedContact]);

    } catch (error) {
      console.error('Error saving business card contact:', error);
      setError(error.message || 'Failed to save contact. Please try again.');
      setSaving(false);
    }
  };

  const ensureCompanyExists = async (companyName, website, userId) => {
    if (!companyName) return null;

    // Check if company already exists by name (simple deduplication)
    const companiesRef = collection(db, 'users', userId, 'companies');
    const q = query(companiesRef, where('name', '==', companyName));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      return snapshot.docs[0].id;
    }

    // Create new company
    const companyId = `company_${Date.now()}`;
    const companyRef = doc(db, 'users', userId, 'companies', companyId);

    const companyData = {
      name: companyName,
      website_url: website || null,
      domain: website ? extractDomain(website) : null,

      // Metadata
      saved_at: new Date().toISOString(),
      source: 'Scanned Business Card',
      status: 'accepted',
      contact_count: 0,

      // For future enrichment
      apolloEnriched: false
    };

    await setDoc(companyRef, companyData);
    console.log('✅ Company created from business card:', companyId);

    return companyId;
  };

  const extractDomain = (url) => {
    if (!url) return null;
    try {
      const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      return domain;
    } catch {
      return null;
    }
  };

  const updateCompanyContactCount = async (companyId, userId) => {
    if (!companyId) return;

    try {
      const companyRef = doc(db, 'users', userId, 'companies', companyId);
      const companyDoc = await getDoc(companyRef);

      if (companyDoc.exists()) {
        const currentCount = companyDoc.data().contact_count || 0;
        await updateDoc(companyRef, {
          contact_count: currentCount + 1
        });
      }
    } catch (err) {
      console.error('Error updating company contact count:', err);
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
                  setImageBase64(null);
                  setExtractedData(null);
                  setError(null);
                  setFormData({
                    name: '',
                    email: '',
                    phone: '',
                    company: '',
                    title: '',
                    website: '',
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

          {/* Error Display */}
          {error && !extracting && (
            <div className="bg-red-50 rounded-xl p-4 border border-red-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Extraction Issue</h3>
                  <p className="text-sm text-gray-700">{error}</p>
                  <p className="text-sm text-gray-600 mt-1">You can still enter the details manually below.</p>
                </div>
              </div>
            </div>
          )}

          {/* Review & Edit Form */}
          {!extracting && extractedData && (
            <>
              {!error && (
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
              )}

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

                {/* Website */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Website
                  </label>
                  <input
                    type="url"
                    value={formData.website}
                    onChange={(e) => handleChange('website', e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-100 focus:outline-none transition-all"
                    placeholder="https://company.com"
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
