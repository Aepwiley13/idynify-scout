import { useState } from 'react';
import Papa from 'papaparse';
import { db } from '../../firebase/config';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { Upload, AlertTriangle, CheckCircle, Users, Building2, Loader, Copy, XCircle, Info } from 'lucide-react';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { createCompanyRecord } from '../../schemas/companySchema';
import { resolveCompany } from '../../services/companyIdentityService';
import {
  parseContactCsv, classifyRows, summarizeRows, defaultImportName, buildImportTag,
  ROW_STATUS, MAX_IMPORT_ROWS,
} from '../../utils/csvContactImport';
import {
  previewCsvImport, commitCsvImport, summarizePreview, PREVIEW_OUTCOME, IMPORTABLE_OUTCOMES,
} from '../../services/csvImportService';

/**
 * Scout+ → Upload CSV.
 *
 * Two lists, one entry point:
 *   Lead / Contact List → ContactCsvImport (below): parse → check every row
 *     against the workspace → preview → import as a tagged group.
 *   Company List        → CompanyCsvUpload (below), unchanged in behavior.
 *
 * onContactsAdded(items, importResult)
 *   items         the contacts now in the import group (created + existing),
 *                 or the companies created
 *   importResult  contacts only: { batchId, tag, created, updated, failed }
 */
export default function CSVUpload({ onContactsAdded, onCancel }) {
  const [uploadType, setUploadType] = useState(null); // 'leads' | 'companies'

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

  const changeType = () => setUploadType(null);

  return uploadType === 'companies'
    ? <CompanyCsvUpload onContactsAdded={onContactsAdded} onCancel={onCancel} onChangeType={changeType} />
    : <ContactCsvImport onContactsAdded={onContactsAdded} onCancel={onCancel} onChangeType={changeType} />;
}

function TypeHeader({ title, subtitle, onChangeType }) {
  return (
    <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 border border-gray-200">
      <div>
        <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
        <p className="text-sm text-gray-600">{subtitle}</p>
      </div>
      <button
        onClick={onChangeType}
        className="text-sm text-blue-600 hover:text-blue-700 font-semibold whitespace-nowrap ml-4"
      >
        Change Type
      </button>
    </div>
  );
}

function FilePicker({ onFile, id }) {
  return (
    <div className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition-colors">
      <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload CSV File</h3>
      <p className="text-sm text-gray-600 mb-4">Click to browse for your CSV file</p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        className="hidden"
        id={id}
        data-testid={id}
      />
      <label
        htmlFor={id}
        className="inline-block px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl cursor-pointer hover:bg-blue-700 transition-all"
      >
        Choose File
      </label>
    </div>
  );
}

function readFileText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ─── Contacts ────────────────────────────────────────────────────────────────

/** Why a row will not be imported, or what is flagged about it. One line each. */
function attentionItems(rows) {
  const items = [];
  for (const r of rows) {
    if (r.status !== ROW_STATUS.READY) {
      items.push({ rowNumber: r.rowNumber, kind: r.status, text: r.reason });
      continue;
    }
    if (r.outcome && !IMPORTABLE_OUTCOMES.includes(r.outcome)) {
      items.push({ rowNumber: r.rowNumber, kind: r.outcome, text: r.reason });
      continue;
    }
    if (r.outcome === PREVIEW_OUTCOME.REVIEW) {
      items.push({ rowNumber: r.rowNumber, kind: 'review', text: `${r.contact.name}: same name and company as an existing contact — imported and flagged for review` });
    }
    for (const w of r.warnings ?? []) items.push({ rowNumber: r.rowNumber, kind: 'warning', text: w });
  }
  return items.sort((a, b) => a.rowNumber - b.rowNumber);
}

function StatTile({ label, value, sub, tone, testId }) {
  const tones = {
    green: 'bg-green-50 border-green-300 text-green-800',
    amber: 'bg-amber-50 border-amber-300 text-amber-800',
    red: 'bg-red-50 border-red-300 text-red-800',
    gray: 'bg-gray-50 border-gray-300 text-gray-700',
  };
  return (
    <div className={`rounded-lg p-4 border ${tones[tone]}`} data-testid={testId}>
      <div className="text-xs font-semibold uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs mt-1 opacity-80">{sub}</div>}
    </div>
  );
}

function ContactCsvImport({ onContactsAdded, onCancel, onChangeType }) {
  // select → checking → preview → importing
  const [stage, setStage] = useState('select');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);   // parseContactCsv output
  const [rows, setRows] = useState([]);         // classified + resolved rows
  const [progress, setProgress] = useState(null); // { done, total, label }
  const [error, setError] = useState(null);
  const [importName, setImportName] = useState('');

  const reset = () => {
    setStage('select'); setFile(null); setParsed(null); setRows([]);
    setProgress(null); setError(null); setImportName('');
  };

  async function handleFile(selected) {
    setError(null);
    if (!/\.csv$/i.test(selected.name)) {
      setError('Please choose a .csv file.');
      return;
    }
    const user = getEffectiveUser();
    if (!user) { setError('You must be logged in to import contacts.'); return; }

    setFile(selected);
    setImportName(defaultImportName(selected.name));
    setStage('checking');

    try {
      const text = await readFileText(selected);
      const result = parseContactCsv(text);
      setParsed(result);
      if (result.fatal) {
        setError(result.fatal);
        setStage('select');
        return;
      }
      const classified = classifyRows(result.rows, result.mappedHeaders);
      setProgress({ done: 0, total: classified.filter((r) => r.status === ROW_STATUS.READY).length, label: 'Checking for people already in IDYNIFY' });
      const resolved = await previewCsvImport(user.uid, classified, {
        onProgress: (done, total) => setProgress({ done, total, label: 'Checking for people already in IDYNIFY' }),
      });
      setRows(resolved);
      setStage('preview');
    } catch (err) {
      console.error('[CSVUpload] could not read file', err);
      setError('Could not read this file. Check that it is a CSV export and try again.');
      setStage('select');
    } finally {
      setProgress(null);
    }
  }

  async function handleImport() {
    const user = getEffectiveUser();
    if (!user) { setError('You must be logged in to import contacts.'); return; }
    setError(null);
    setStage('importing');
    try {
      const result = await commitCsvImport(user.uid, rows, {
        importName: importName.trim() || defaultImportName(file?.name),
        fileName: file?.name ?? null,
        onProgress: (done, total) => setProgress({ done, total, label: 'Importing' }),
      });
      const items = [...result.created, ...result.updated].map((c) => ({ ...c, _uploadType: 'leads' }));
      if (items.length === 0) {
        setError(`Nothing was imported. ${result.failed.length} row${result.failed.length !== 1 ? 's' : ''} failed to save — try again.`);
        setStage('preview');
        return;
      }
      onContactsAdded(items, result);
    } catch (err) {
      console.error('[CSVUpload] import failed', err);
      setError('The import did not finish. Contacts saved before the error are in People with this import\'s tag.');
      setStage('preview');
    } finally {
      setProgress(null);
    }
  }

  const fileCounts = summarizeRows(rows);
  const outcome = summarizePreview(rows);
  const readyNew = outcome[PREVIEW_OUTCOME.NEW] + outcome[PREVIEW_OUTCOME.REVIEW];
  const readyExisting = outcome[PREVIEW_OUTCOME.EXISTING];
  const readyTotal = readyNew + readyExisting;
  const possibleDuplicates = outcome[PREVIEW_OUTCOME.REVIEW]
    + fileCounts[ROW_STATUS.DUPLICATE_IN_FILE] + outcome[PREVIEW_OUTCOME.DUPLICATE];
  const invalid = fileCounts[ROW_STATUS.INVALID]
    + outcome[PREVIEW_OUTCOME.CONFLICT] + outcome[PREVIEW_OUTCOME.LOOKUP_FAILED];
  const missing = fileCounts[ROW_STATUS.MISSING];
  const overLimit = fileCounts[ROW_STATUS.OVER_LIMIT];
  const attention = attentionItems(rows);
  const sample = rows.filter((r) => IMPORTABLE_OUTCOMES.includes(r.outcome)).slice(0, 3);
  const busy = stage === 'checking' || stage === 'importing';

  return (
    <div className="space-y-6">
      <TypeHeader
        title="Lead / Contact Upload"
        subtitle="Required: a Name (or First + Last Name) or an Email."
        onChangeType={onChangeType}
      />

      {stage === 'select' && (
        <div className="bg-green-50 rounded-xl p-4 border border-green-200">
          <h3 className="font-semibold text-gray-900 mb-2">CSV Upload Guidelines</h3>
          <ul className="text-sm text-gray-700 space-y-1">
            <li>• <strong>Required:</strong> Name, Full Name, or First + Last Name — or an Email</li>
            <li>• <strong>Optional:</strong> Email, Phone, Company, Title, LinkedIn, Industry / Vertical, State, Location, Notes</li>
            <li>• <strong>Up to {MAX_IMPORT_ROWS} contacts</strong> per upload</li>
            <li>• Columns can be in any order; common header names are recognized automatically</li>
            <li>• People already in IDYNIFY are updated, never duplicated</li>
          </ul>
        </div>
      )}

      {error && (
        <div className="bg-red-50 rounded-xl p-4 border border-red-200 text-sm text-red-800 flex gap-2" role="alert">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {stage === 'select' && <FilePicker onFile={handleFile} id="csv-upload" />}

      {busy && (
        <div className="bg-gray-50 rounded-xl p-8 border border-gray-200 text-center" data-testid="csv-progress">
          <Loader className="w-8 h-8 text-blue-600 mx-auto mb-3 animate-spin" />
          <p className="font-semibold text-gray-900">{progress?.label || (stage === 'importing' ? 'Importing' : 'Reading file')}…</p>
          {progress?.total > 0 && (
            <p className="text-sm text-gray-600 mt-1">{progress.done} of {progress.total}</p>
          )}
        </div>
      )}

      {stage === 'preview' && (
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Preview: {file?.name}</h3>
              <p className="text-sm text-gray-600">{rows.length} row{rows.length !== 1 ? 's' : ''} in file</p>
            </div>
            <button onClick={reset} className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
              Change File
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile
              testId="tile-ready" tone="green" label="Ready to import" value={readyTotal}
              sub={readyExisting > 0 ? `${readyNew} new · ${readyExisting} already in IDYNIFY (updated, not duplicated)` : `${readyNew} new`}
            />
            <StatTile
              testId="tile-duplicates" tone="amber" label="Possible duplicates" value={possibleDuplicates}
              sub="Repeats in this file are skipped; name + company matches import flagged"
            />
            <StatTile testId="tile-invalid" tone="red" label="Invalid rows" value={invalid} sub="Not imported" />
            <StatTile testId="tile-missing" tone="gray" label="Missing required information" value={missing} sub="Not imported" />
          </div>

          {overLimit > 0 && (
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-300 text-sm text-amber-900 flex gap-2" role="alert">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                {overLimit} row{overLimit !== 1 ? 's are' : ' is'} over the {MAX_IMPORT_ROWS}-contact limit and will not be imported.
                Split the file and upload the rest separately.
              </span>
            </div>
          )}

          {parsed?.ignoredHeaders?.length > 0 && (
            <div className="text-xs text-gray-600 flex gap-2">
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>Columns not imported (no matching contact field): {parsed.ignoredHeaders.join(', ')}</span>
            </div>
          )}

          {attention.length > 0 && (
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <h4 className="font-semibold text-gray-900 mb-2 text-sm">Rows needing attention ({attention.length})</h4>
              <ul className="text-sm space-y-1 max-h-40 overflow-y-auto" data-testid="csv-attention">
                {attention.map((a, i) => (
                  <li key={`${a.rowNumber}-${i}`} className="flex gap-2 text-gray-700">
                    {a.kind === 'review' || a.kind === ROW_STATUS.DUPLICATE_IN_FILE || a.kind === PREVIEW_OUTCOME.DUPLICATE
                      ? <Copy className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      : a.kind === 'warning'
                        ? <Info className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        : <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
                    <span><strong>Row {a.rowNumber}:</strong> {a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sample.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2 text-sm">Sample ({sample.length} of {readyTotal})</h4>
              <div className="space-y-2">
                {sample.map((r) => (
                  <div key={r.rowNumber} className="bg-white rounded-lg p-3 border border-gray-200">
                    <p className="font-semibold text-gray-900">
                      {r.contact.name}
                      {r.outcome === PREVIEW_OUTCOME.EXISTING && (
                        <span className="ml-2 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded">Already in IDYNIFY</span>
                      )}
                    </p>
                    <p className="text-sm text-gray-600">
                      {[r.contact.title, r.contact.company, r.contact.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="csv-import-name" className="block text-sm font-semibold text-gray-900 mb-1">Name this import</label>
            <input
              id="csv-import-name"
              type="text"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm"
              maxLength={80}
            />
            <p className="text-xs text-gray-600 mt-1">
              Every imported contact is tagged <strong>{buildImportTag(importName || defaultImportName(file?.name))}</strong> so you can find this group in People.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex-1 px-6 py-3 rounded-xl bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        {stage === 'preview' && (
          <button
            type="button"
            onClick={handleImport}
            disabled={readyTotal === 0}
            className="flex-1 px-6 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
          >
            <CheckCircle className="w-5 h-5" />
            Import {readyTotal} contact{readyTotal !== 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Companies (unchanged behavior; parser fixed) ───────────────────────────

const COMPANY_UPLOAD_LIMIT = 25;

const COMPANY_HEADER_MAP = {
  'company name': 'name',
  'company': 'name',
  'account name': 'name',
  'organization': 'name',
  'name': 'name',
  'website': 'website_url',
  'website url': 'website_url',
  'domain': 'website_url',
  'url': 'website_url',
  'vertical': 'industry',
  'industry': 'industry',
  'linkedin': 'linkedin_url',
  'linkedin url': 'linkedin_url',
  'linkedin company page': 'linkedin_url',
  'company linkedin': 'linkedin_url',
  'state': 'state',
  'hq location': 'state',
  'hq state': 'state',
  'location': 'state',
};

function CompanyCsvUpload({ onContactsAdded, onCancel, onChangeType }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  async function handleFile(selected) {
    if (!/\.csv$/i.test(selected.name)) {
      alert('Please upload a CSV file');
      return;
    }
    setFile(selected);
    const text = await readFileText(selected);
    const { data } = Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => String(h ?? '').replace(/^\uFEFF/, '').trim().toLowerCase(),
    });

    const errors = [];
    const validated = [];
    data.forEach((row, index) => {
      const normalized = {};
      Object.keys(row).forEach((key) => {
        const field = COMPANY_HEADER_MAP[key] || key;
        const value = String(row[key] ?? '').trim();
        if (!normalized[field]) normalized[field] = value;
      });
      if (!normalized.name) {
        errors.push(`Row ${index + 2}: Company Name is required`);
        return;
      }
      validated.push(normalized);
    });

    if (validated.length > COMPANY_UPLOAD_LIMIT) {
      errors.push(`Only the first ${COMPANY_UPLOAD_LIMIT} companies will be uploaded — ${validated.length - COMPANY_UPLOAD_LIMIT} more are in this file.`);
    }
    const items = validated.slice(0, COMPANY_UPLOAD_LIMIT);
    setPreview({ total: data.length, valid: items.length, items });
    setValidationErrors(errors);
  }

  const handleUpload = async () => {
    if (!preview || preview.valid === 0) return;
    const user = getEffectiveUser();
    if (!user) {
      alert('You must be logged in to upload');
      return;
    }
    setUploading(true);
    try {
      const batch = writeBatch(db);
      const addedItems = [];
      let skippedCount = 0;
      const companiesRef = collection(db, 'users', user.uid, 'companies');

      for (const company of preview.items) {
        // Name is the only signal a CSV row carries. Skipping rather than
        // creating keeps a re-uploaded file from doubling the list, which is
        // the single most common way this collection got duplicates.
        const match = await resolveCompany(user.uid, { name: company.name },
          { source: 'CSVUpload.companies' });
        if (match.companyId) { skippedCount += 1; continue; }

        const companyData = createCompanyRecord({
          name: company.name,
          website_url: company.website_url || null,
          industry: company.industry || null,
          linkedin_url: company.linkedin_url || null,
          state: company.state || null,
          status: 'accepted',
          source: 'csv_import',
          found_at: new Date().toISOString(),
          archived_at: null,
          apollo_organization_id: null,
          revenue: null,
          founded_year: null,
          phone: null,
          logo_url: null,
          employee_count: null,
        });

        const newDocRef = doc(companiesRef);
        batch.set(newDocRef, companyData);
        addedItems.push({ id: newDocRef.id, ...companyData, _uploadType: 'companies' });
      }

      await batch.commit();
      if (skippedCount > 0) {
        alert(`${addedItems.length} compan${addedItems.length !== 1 ? 'ies' : 'y'} imported. ${skippedCount} already in your list ${skippedCount !== 1 ? 'were' : 'was'} skipped.`);
      }
      onContactsAdded(addedItems);
    } catch (error) {
      console.error('Error uploading CSV:', error);
      alert('Failed to upload. Please try again.');
      setUploading(false);
    }
  };

  const resetFile = () => { setFile(null); setPreview(null); setValidationErrors([]); };

  return (
    <div className="space-y-6">
      <TypeHeader
        title="Company List Upload"
        subtitle="Upload a CSV of companies. Required: Company Name."
        onChangeType={onChangeType}
      />

      <div className="bg-green-50 rounded-xl p-4 border border-green-200">
        <h3 className="font-semibold text-gray-900 mb-2">CSV Upload Guidelines</h3>
        <ul className="text-sm text-gray-700 space-y-1">
          <li>• <strong>Required column:</strong> Company Name (or "Account Name")</li>
          <li>• <strong>Optional columns:</strong> Website, Industry, LinkedIn, State</li>
          <li>• <strong>Max {COMPANY_UPLOAD_LIMIT} companies</strong> per upload</li>
          <li>• Headers will be auto-mapped (flexible format)</li>
        </ul>
      </div>

      {!file ? (
        <FilePicker onFile={handleFile} id="csv-company-upload" />
      ) : (
        <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Preview: {file.name}</h3>
              <p className="text-sm text-gray-600">{preview?.total ?? 0} rows in file</p>
            </div>
            <button onClick={resetFile} className="text-sm text-blue-600 hover:text-blue-700 font-semibold">
              Change File
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-green-100 rounded-lg p-4 border border-green-300">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-900">Valid Companies</span>
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

          {validationErrors.length > 0 && (
            <div className="bg-red-50 rounded-lg p-4 border border-red-200 mb-4">
              <h4 className="font-semibold text-red-900 mb-2">Validation Errors</h4>
              <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
                {validationErrors.map((error, index) => <li key={index}>{error}</li>)}
              </ul>
            </div>
          )}

          {preview?.items?.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-900 mb-2">
                Sample Companies ({Math.min(3, preview.items.length)} of {preview.valid})
              </h4>
              <div className="space-y-2">
                {preview.items.slice(0, 3).map((item, index) => (
                  <div key={index} className="bg-white rounded-lg p-3 border border-gray-200">
                    <p className="font-semibold text-gray-900">{item.name}</p>
                    {item.industry && <p className="text-sm text-gray-600">{item.industry}</p>}
                    {item.website_url && <p className="text-sm text-gray-600">{item.website_url}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
            <><Loader className="w-5 h-5 animate-spin" />Uploading...</>
          ) : (
            <><Upload className="w-5 h-5" />Upload {preview?.valid || 0} Companies</>
          )}
        </button>
      </div>
    </div>
  );
}
