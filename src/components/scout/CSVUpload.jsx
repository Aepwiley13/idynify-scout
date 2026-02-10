import { useState } from 'react';
import { auth, db } from '../../firebase/config';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { Upload, AlertTriangle, CheckCircle, Users, Building2 } from 'lucide-react';
import { startBackgroundEnrichment, assessEnrichmentViability } from '../../utils/contactEnrichment';

export default function CSVUpload({ onContactsAdded, onCancel }) {
  const [uploadType, setUploadType] = useState(null); // 'leads' or 'companies'
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

  // --- Lead field normalization (existing + first/last name support) ---
  const normalizeLeadFieldName = (header) => {
    const mapping = {
      // Name fields (existing)
      'name': 'name',
      'full name': 'name',
      'contact name': 'name',
      // First / Last name (NEW)
      'first name': 'first_name',
      'first': 'first_name',
      'fname': 'first_name',
      'last name': 'last_name',
      'last': 'last_name',
      'lname': 'last_name',
      // Email
      'email': 'email',
      'email address': 'email',
      'e-mail': 'email',
      // Phone
      'phone': 'phone',
      'phone number': 'phone',
      'mobile': 'phone',
      // Company
      'company': 'company',
      'organization': 'company',
      'company name': 'company',
      'account name': 'company',
      // Title
      'title': 'title',
      'job title': 'title',
      'position': 'title',
      // LinkedIn
      'linkedin': 'linkedin_url',
      'linkedin url': 'linkedin_url',
      'linkedin profile': 'linkedin_url',
      // Additional supported fields
      'vertical': 'industry',
      'industry': 'industry',
      'state': 'state',
    };

    return mapping[header.toLowerCase()] || header;
  };

  // --- Company field normalization (NEW) ---
  const normalizeCompanyFieldName = (header) => {
    const mapping = {
      // Company name
      'company name': 'name',
      'company': 'name',
      'account name': 'name',
      'organization': 'name',
      'name': 'name',
      // Website / Domain
      'website': 'website_url',
      'website url': 'website_url',
      'domain': 'website_url',
      'url': 'website_url',
      // Industry
      'vertical': 'industry',
      'industry': 'industry',
      // LinkedIn
      'linkedin': 'linkedin_url',
      'linkedin url': 'linkedin_url',
      'linkedin company page': 'linkedin_url',
      'company linkedin': 'linkedin_url',
      // Location
      'state': 'state',
      'hq location': 'state',
      'hq state': 'state',
      'location': 'state',
    };

    return mapping[header.toLowerCase()] || header;
  };

  const validateLeads = (rows) => {
    const errors = [];
    const validated = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2; // +2 because header is row 1, data starts at row 2

      // Normalize field names
      const normalized = {};
      Object.keys(row).forEach(key => {
        const normalizedKey = normalizeLeadFieldName(key);
        // If multiple raw headers map to the same key, keep the first non-empty value
        if (!normalized[normalizedKey] || normalized[normalizedKey].trim() === '') {
          normalized[normalizedKey] = row[key];
        }
      });

      // Merge first_name + last_name into name
      // Split fields take precedence over full name
      if (normalized.first_name && normalized.first_name.trim()) {
        const first = normalized.first_name.trim();
        const last = (normalized.last_name || '').trim();
        normalized.name = last ? `${first} ${last}` : first;
      }

      // Required field: name (either from full name or first+last)
      if (!normalized.name || normalized.name.trim() === '') {
        errors.push(`Row ${rowNumber}: Name is required (provide "Name", "Full Name", or "First Name" + "Last Name")`);
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

  const validateCompanies = (rows) => {
    const errors = [];
    const validated = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 2;

      // Normalize field names
      const normalized = {};
      Object.keys(row).forEach(key => {
        const normalizedKey = normalizeCompanyFieldName(key);
        if (!normalized[normalizedKey] || normalized[normalizedKey].trim() === '') {
          normalized[normalizedKey] = row[key];
        }
      });

      // Required field: company name
      if (!normalized.name || normalized.name.trim() === '') {
        errors.push(`Row ${rowNumber}: Company Name is required`);
        return;
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
      const { rows } = parseCSV(text);

      // Limit to 25 rows
      const limitedRows = rows.slice(0, 25);

      const { validated, errors } = uploadType === 'companies'
        ? validateCompanies(limitedRows)
        : validateLeads(limitedRows);

      setPreview({
        total: limitedRows.length,
        valid: validated.length,
        items: validated,
        // Keep legacy key for contact preview compatibility
        contacts: uploadType === 'leads' ? validated : undefined,
      });

      setValidationErrors(errors);
    };

    reader.readAsText(selectedFile);
  };

  const handleUpload = async () => {
    if (!preview || preview.valid === 0) {
      alert(`No valid ${uploadType === 'companies' ? 'companies' : 'contacts'} to upload`);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert('You must be logged in to upload');
      return;
    }

    setUploading(true);

    try {
      const batch = writeBatch(db);
      const addedItems = [];

      if (uploadType === 'companies') {
        const companiesRef = collection(db, 'users', user.uid, 'companies');

        for (const company of preview.items) {
          const companyData = {
            name: company.name,
            website_url: company.website_url || null,
            industry: company.industry || null,
            linkedin_url: company.linkedin_url || null,
            state: company.state || null,

            // Status & source
            status: 'accepted',
            source: 'csv_import',

            // Metadata
            found_at: new Date().toISOString(),
            archived_at: null,

            // Enrichment placeholders
            apollo_organization_id: null,
            revenue: null,
            founded_year: null,
            phone: null,
            logo_url: null,
            employee_count: null,
          };

          const newDocRef = doc(companiesRef);
          batch.set(newDocRef, companyData);
          addedItems.push({ id: newDocRef.id, ...companyData, _uploadType: 'companies' });
        }
      } else {
        // Lead / Contact upload (existing flow preserved)
        const contactsRef = collection(db, 'users', user.uid, 'contacts');

        for (const contact of preview.items) {
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
          addedItems.push({ id: newDocRef.id, ...contactData, _uploadType: 'leads' });
        }
      }

      await batch.commit();

      const label = uploadType === 'companies' ? 'companies' : 'contacts';
      console.log(`${addedItems.length} ${label} uploaded from CSV`);

      // For lead uploads, assess enrichment viability and start background enrichment
      if (uploadType === 'leads') {
        const enrichmentInfo = addedItems.map(item => ({
          ...item,
          _enrichmentViability: assessEnrichmentViability(item)
        }));

        // Start background enrichment (non-blocking)
        startBackgroundEnrichment(
          addedItems,
          (results) => {
            console.log('CSV enrichment complete:', results);
          },
          (progress) => {
            console.log(`Enriching ${progress.current}/${progress.total}: ${progress.contact}`);
          }
        );

        // Notify parent with enrichment info
        onContactsAdded(enrichmentInfo);
      } else {
        // Company uploads - notify parent directly
        onContactsAdded(addedItems);
      }

    } catch (error) {
      console.error('Error uploading CSV:', error);
      alert('Failed to upload. Please try again.');
      setUploading(false);
    }
  };

  const resetFile = () => {
    setFile(null);
    setPreview(null);
    setValidationErrors([]);
  };

  const itemLabel = uploadType === 'companies' ? 'Companies' : 'Contacts';
  const itemLabelLower = uploadType === 'companies' ? 'companies' : 'contacts';

  // --- Upload Type Selector ---
  if (!uploadType) {
    return (
      <div className="space-y-6">
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-1">What are you uploading?</h3>
          <p className="text-sm text-gray-600">Choose the type of list so we can validate and store it correctly.</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setUploadType('leads')}
            className="w-full bg-white hover:bg-blue-50 border-2 border-gray-200 hover:border-blue-400 rounded-xl p-5 text-left transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-base font-bold text-gray-900 mb-0.5">Lead / Contact List</h4>
                <p className="text-sm text-gray-600">
                  People with names, emails, titles, companies. Supports "First Name + Last Name" or "Full Name".
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setUploadType('companies')}
            className="w-full bg-white hover:bg-cyan-50 border-2 border-gray-200 hover:border-cyan-400 rounded-xl p-5 text-left transition-all group"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-cyan-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-cyan-200 transition-colors">
                <Building2 className="w-5 h-5 text-cyan-600" />
              </div>
              <div className="flex-1">
                <h4 className="text-base font-bold text-gray-900 mb-0.5">Company List</h4>
                <p className="text-sm text-gray-600">
                  Companies only — no individual contacts. Great for target account lists.
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* Cancel */}
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-6 py-3 rounded-xl bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- Main Upload Flow ---
  return (
    <div className="space-y-6">
      {/* Upload type indicator + change button */}
      <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 border border-gray-200">
        <div>
          <h3 className="font-semibold text-gray-900 mb-1">
            {uploadType === 'companies' ? 'Company List Upload' : 'Lead / Contact Upload'}
          </h3>
          <p className="text-sm text-gray-600">
            {uploadType === 'companies'
              ? 'Upload a CSV of companies. Required: Company Name.'
              : 'Upload a CSV of contacts. Required: Name (or First Name + Last Name).'}
          </p>
        </div>
        <button
          onClick={() => { setUploadType(null); resetFile(); }}
          className="text-sm text-blue-600 hover:text-blue-700 font-semibold whitespace-nowrap ml-4"
        >
          Change Type
        </button>
      </div>

      {/* Instructions */}
      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
        <h3 className="font-semibold text-gray-900 mb-2">CSV Upload Guidelines</h3>
        {uploadType === 'companies' ? (
          <ul className="text-sm text-gray-700 space-y-1">
            <li>• <strong>Required column:</strong> Company Name (or "Account Name")</li>
            <li>• <strong>Optional columns:</strong> Website, Industry, LinkedIn, State</li>
            <li>• <strong>Max 25 companies</strong> per upload</li>
            <li>• Headers will be auto-mapped (flexible format)</li>
          </ul>
        ) : (
          <ul className="text-sm text-gray-700 space-y-1">
            <li>• <strong>Required column:</strong> Name, Full Name, or First Name + Last Name</li>
            <li>• <strong>Optional columns:</strong> Email, Phone, Company, Title, LinkedIn, Industry, State</li>
            <li>• <strong>Max 25 contacts</strong> per upload</li>
            <li>• Headers will be auto-mapped (flexible format)</li>
          </ul>
        )}
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
                  {preview?.total} {itemLabelLower} found (max 25)
                </p>
              </div>
              <button
                onClick={resetFile}
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
                  <span className="font-semibold text-green-900">Valid {itemLabel}</span>
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
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Item Preview */}
            {preview && preview.items.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-2">
                  Sample {itemLabel} ({Math.min(3, preview.items.length)} of {preview.valid})
                </h4>
                <div className="space-y-2">
                  {preview.items.slice(0, 3).map((item, index) => (
                    <div key={index} className="bg-white rounded-lg p-3 border border-gray-200">
                      <p className="font-semibold text-gray-900">{item.name}</p>
                      {uploadType === 'leads' && item.email && (
                        <p className="text-sm text-gray-600">{item.email}</p>
                      )}
                      {uploadType === 'leads' && item.company && (
                        <p className="text-sm text-gray-600">{item.company}</p>
                      )}
                      {uploadType === 'companies' && item.industry && (
                        <p className="text-sm text-gray-600">{item.industry}</p>
                      )}
                      {uploadType === 'companies' && item.website_url && (
                        <p className="text-sm text-gray-600">{item.website_url}</p>
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
              <span className="animate-spin">&#9881;</span>
              Uploading...
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" />
              Upload {preview?.valid || 0} {itemLabel}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
