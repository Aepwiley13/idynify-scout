import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { collection, addDoc, writeBatch, doc } from 'firebase/firestore';
import { Upload, AlertTriangle, CheckCircle } from 'lucide-react';

export default function CSVUpload({ onContactsAdded, onCancel }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const rows = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });

    return { headers, rows };
  };

  const normalizeFieldName = (header) => {
    const mapping = {
      'name': 'name',
      'full name': 'name',
      'contact name': 'name',
      'email': 'email',
      'email address': 'email',
      'e-mail': 'email',
      'phone': 'phone',
      'phone number': 'phone',
      'mobile': 'phone',
      'company': 'company',
      'organization': 'company',
      'company name': 'company',
      'title': 'title',
      'job title': 'title',
      'position': 'title',
      'linkedin': 'linkedin_url',
      'linkedin url': 'linkedin_url',
      'linkedin profile': 'linkedin_url'
    };

    return mapping[header.toLowerCase()] || header;
  };

  const validateContacts = (contacts) => {
    const errors = [];
    const validated = [];

    contacts.forEach((contact, index) => {
      const rowNumber = index + 2; // +2 because header is row 1, data starts at row 2

      // Normalize field names
      const normalized = {};
      Object.keys(contact).forEach(key => {
        const normalizedKey = normalizeFieldName(key);
        normalized[normalizedKey] = contact[key];
      });

      // Required field: name
      if (!normalized.name || normalized.name.trim() === '') {
        errors.push(`Row ${rowNumber}: Name is required`);
        return;
      }

      // Email validation (if provided)
      if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
        errors.push(`Row ${rowNumber}: Invalid email format`);
      }

      validated.push(normalized);
    });

    return { validated, errors };
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    setFile(selectedFile);

    // Read and preview the file
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const { headers, rows } = parseCSV(text);

      // Limit to 25 contacts
      const limitedRows = rows.slice(0, 25);

      const { validated, errors } = validateContacts(limitedRows);

      setPreview({
        total: limitedRows.length,
        valid: validated.length,
        headers: headers,
        contacts: validated
      });

      setValidationErrors(errors);
    };

    reader.readAsText(selectedFile);
  };

  const handleUpload = async () => {
    if (!preview || preview.valid === 0) {
      alert('No valid contacts to upload');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert('You must be logged in to upload contacts');
      return;
    }

    setUploading(true);

    try {
      const batch = writeBatch(db);
      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const addedContacts = [];

      for (const contact of preview.contacts) {
        const contactData = {
          name: contact.name,
          email: contact.email || null,
          phone: contact.phone || null,
          company: contact.company || null,
          title: contact.title || null,
          linkedin_url: contact.linkedin_url || null,

          // Source tracking
          source: 'manual',
          enrichment_status: 'user_added',
          import_method: 'csv',

          // Scout metadata
          lead_status: 'saved',
          export_ready: true,
          addedAt: new Date().toISOString(),

          // Placeholder for future enrichment
          apollo_data: null,
          enriched: false
        };

        const newDocRef = doc(contactsRef);
        batch.set(newDocRef, contactData);
        addedContacts.push({ id: newDocRef.id, ...contactData });
      }

      await batch.commit();

      console.log(`✅ ${addedContacts.length} contacts uploaded from CSV`);

      // Notify parent
      onContactsAdded(addedContacts);

    } catch (error) {
      console.error('Error uploading contacts:', error);
      alert('Failed to upload contacts. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
        <h3 className="font-semibold text-gray-900 mb-2">CSV Upload Guidelines</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>• <strong>Required column:</strong> Name (or "Full Name")</li>
          <li>• <strong>Optional columns:</strong> Email, Phone, Company, Title, LinkedIn</li>
          <li>• <strong>Max 25 contacts</strong> per upload</li>
          <li>• Headers will be auto-mapped (flexible format)</li>
        </ul>
      </div>

      {/* File Upload */}
      {!file ? (
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition-colors">
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload CSV File</h3>
          <p className="text-sm text-gray-600 mb-4">
            Click to browse or drag and drop your CSV file
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
            id="csv-upload"
          />
          <label
            htmlFor="csv-upload"
            className="inline-block px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl cursor-pointer hover:bg-blue-700 transition-all"
          >
            Choose File
          </label>
        </div>
      ) : (
        <>
          {/* Preview */}
          <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Preview: {file.name}</h3>
                <p className="text-sm text-gray-600">
                  {preview?.total} contacts found (max 25)
                </p>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setValidationErrors([]);
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-semibold"
              >
                Change File
              </button>
            </div>

            {/* Validation Summary */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-green-100 rounded-lg p-4 border border-green-300">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-900">Valid Contacts</span>
                </div>
                <p className="text-2xl font-bold text-green-700">{preview?.valid || 0}</p>
              </div>

              <div className="bg-red-100 rounded-lg p-4 border border-red-300">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  <span className="font-semibold text-red-900">Errors</span>
                </div>
                <p className="text-2xl font-bold text-red-700">{validationErrors.length}</p>
              </div>
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="bg-red-50 rounded-lg p-4 border border-red-200 mb-4">
                <h4 className="font-semibold text-red-900 mb-2">Validation Errors</h4>
                <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
                  {validationErrors.map((error, index) => (
                    <li key={index}>⚠️ {error}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Contact Preview */}
            {preview && preview.contacts.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">
                  Sample Contacts ({Math.min(3, preview.contacts.length)} of {preview.valid})
                </h4>
                <div className="space-y-2">
                  {preview.contacts.slice(0, 3).map((contact, index) => (
                    <div key={index} className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="font-semibold text-gray-900">{contact.name}</p>
                      {contact.email && (
                        <p className="text-sm text-gray-600">{contact.email}</p>
                      )}
                      {contact.company && (
                        <p className="text-sm text-gray-600">{contact.company}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={uploading}
          className="flex-1 px-6 py-3 rounded-xl bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleUpload}
          disabled={!preview || preview.valid === 0 || uploading}
          className="flex-1 px-6 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
        >
          {uploading ? (
            <>
              <span className="animate-spin">⚙️</span>
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" />
              Upload {preview?.valid || 0} Contacts
            </>
          )}
        </button>
      </div>
    </div>
  );
}
