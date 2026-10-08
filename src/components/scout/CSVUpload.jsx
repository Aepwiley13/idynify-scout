import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { db } from '../../firebase/config';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { Upload, AlertTriangle, CheckCircle, Users, Building2, Loader, Copy, XCircle, Info, FileText, X, UserX } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, STATUS } from '../../theme/tokens';
import { contactDisplayName } from '../../utils/contactDisplayName';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { createCompanyRecord } from '../../schemas/companySchema';
import { resolveCompany } from '../../services/companyIdentityService';
import {
  parseContactCsv, classifyRows, summarizeRows, incompleteRows, defaultImportName, buildImportTag,
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
  const T = useT();
  const [uploadType, setUploadType] = useState(null); // 'leads' | 'companies'

  if (!uploadType) {
    return (
      <div style={stack(24)}>
        <Panel>
          <h3 style={heading(T)}>What are you uploading?</h3>
          <p style={muted(T)}>Choose the type of list so we can validate and store it correctly.</p>
        </Panel>

        <div style={stack(12)}>
          <TypeOption
            accent={BRAND.pink}
            icon={<Users size={20} />}
            title="Lead / Contact List"
            text={'People with names, emails, titles, companies. Supports "First Name + Last Name" or "Full Name". Rows with only an email are welcome too.'}
            onClick={() => setUploadType('leads')}
          />
          <TypeOption
            accent={BRAND.cyan}
            icon={<Building2 size={20} />}
            title="Company List"
            text="Companies only — no individual contacts. Great for target account lists."
            onClick={() => setUploadType('companies')}
          />
        </div>

        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
      </div>
    );
  }

  const changeType = () => setUploadType(null);

  return uploadType === 'companies'
    ? <CompanyCsvUpload onContactsAdded={onContactsAdded} onCancel={onCancel} onChangeType={changeType} />
    : <ContactCsvImport onContactsAdded={onContactsAdded} onCancel={onCancel} onChangeType={changeType} />;
}

// ─── Shared pieces (theme tokens only — same palette as the rest of Scout+) ──

const stack = (gap) => ({ display: 'flex', flexDirection: 'column', gap });
const heading = (T, size = 15) => ({ fontSize: size, fontWeight: 700, color: T.text, margin: '0 0 4px' });
const muted = (T, size = 13) => ({ fontSize: size, color: T.textMuted, margin: 0 });
const tint = (color, alpha = '14') => `${color}${alpha}`;

function Panel({ children, style, testId, tone }) {
  const T = useT();
  const toneColor = tone ? STATUS[tone] : null;
  return (
    <div
      data-testid={testId}
      style={{
        background: toneColor ? tint(toneColor) : T.cardBg,
        border: `1px solid ${toneColor ? tint(toneColor, '55') : T.border}`,
        borderRadius: 14, padding: 16, color: T.text, ...style,
      }}
    >
      {children}
    </div>
  );
}

function TypeOption({ accent, icon, title, text, onClick }) {
  const T = useT();
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', padding: 20, borderRadius: 14,
        background: hover ? tint(accent, '10') : T.cardBg,
        border: `2px solid ${hover ? accent : T.border}`, transition: 'border-color 0.15s, background 0.15s',
        display: 'flex', gap: 16, alignItems: 'flex-start', color: T.text,
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tint(accent, '22'), color: accent }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 2 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 13, color: T.textMuted }}>{text}</span>
      </span>
    </button>
  );
}

function SecondaryButton({ children, style, ...props }) {
  const T = useT();
  return (
    <button
      type="button"
      {...props}
      style={{
        flex: 1, padding: '12px 24px', borderRadius: 12, fontWeight: 600, fontSize: 14,
        background: 'transparent', border: `1px solid ${T.border2 || T.border}`, color: T.text,
        cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.5 : 1, ...style,
      }}
    >
      {children}
    </button>
  );
}

function PrimaryButton({ children, style, ...props }) {
  return (
    <button
      type="button"
      {...props}
      style={{
        flex: 1, padding: '12px 24px', borderRadius: 12, fontWeight: 700, fontSize: 14, border: 'none',
        background: BRAND.pink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        cursor: props.disabled ? 'not-allowed' : 'pointer', opacity: props.disabled ? 0.45 : 1, ...style,
      }}
    >
      {children}
    </button>
  );
}

function LinkButton({ children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      style={{ background: 'none', border: 'none', padding: 0, color: BRAND.pink, fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
    >
      {children}
    </button>
  );
}

function TypeHeader({ title, subtitle, onChangeType }) {
  const T = useT();
  return (
    <Panel style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <h3 style={heading(T)}>{title}</h3>
        <p style={muted(T)}>{subtitle}</p>
      </div>
      <LinkButton onClick={onChangeType}>Change Type</LinkButton>
    </Panel>
  );
}

function Guidelines({ items }) {
  const T = useT();
  return (
    <Panel>
      <h3 style={heading(T, 14)}>CSV Upload Guidelines</h3>
      <ul style={{ ...muted(T), listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, i) => (
          <li key={i} style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: BRAND.cyan }}>•</span><span>{item}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ErrorBanner({ children }) {
  return (
    <Panel tone="red" style={{ display: 'flex', gap: 8, fontSize: 13 }}>
      <span role="alert" style={{ display: 'flex', gap: 8 }}>
        <AlertTriangle size={18} style={{ color: STATUS.red, flexShrink: 0 }} />
        <span>{children}</span>
      </span>
    </Panel>
  );
}

const isCsvFile = (file) => Boolean(file) && /\.csv$/i.test(file.name || '');

/**
 * Pick a CSV by clicking (or Enter/Space), or by dropping it anywhere on the
 * zone. Both routes hand the File to the same `onFile` — one parse path.
 * A non-CSV is rejected here, with its name, before anything is read.
 */
function FilePicker({ onFile, id }) {
  const T = useT();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState(null);
  const depth = useRef(0); // dragenter/leave fire for children too

  const accept = (file) => {
    if (!file) return;
    if (!isCsvFile(file)) {
      setRejected(`"${file.name}" is not a CSV file. Choose a .csv file — in Excel or Google Sheets use File → Download / Save As → CSV.`);
      return;
    }
    setRejected(null);
    onFile(file);
  };

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

  return (
    <div style={stack(12)}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file: drop a file here or press Enter to browse"
        data-testid={`${id}-dropzone`}
        data-dragging={dragging ? 'true' : 'false'}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setDragging(true); }}
        onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          const files = Array.from(e.dataTransfer?.files || []);
          if (files.length > 1) { setRejected('Drop one CSV file at a time.'); return; }
          accept(files[0]);
        }}
        style={{
          border: `2px dashed ${dragging ? BRAND.pink : (T.border2 || T.border)}`,
          background: dragging ? T.accentBg || tint(BRAND.pink) : T.surface || 'transparent',
          borderRadius: 14, padding: '44px 24px', textAlign: 'center', cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s', outlineColor: BRAND.pink,
        }}
      >
        <Upload size={44} style={{ color: dragging ? BRAND.pink : T.textFaint, margin: '0 auto 14px', display: 'block' }} />
        <h3 style={{ ...heading(T, 17), marginBottom: 6 }}>{dragging ? 'Drop your CSV to upload' : 'Drag & drop your CSV here'}</h3>
        <p style={{ ...muted(T), marginBottom: 16 }}>or</p>
        <span style={{ display: 'inline-block', padding: '10px 22px', borderRadius: 12, background: BRAND.pink, color: '#fff', fontWeight: 700, fontSize: 14 }}>
          Browse files
        </span>
        <p style={{ ...muted(T, 12), color: T.textFaint, marginTop: 12 }}>.csv files only</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }}
          style={{ display: 'none' }}
          id={id}
          data-testid={id}
          tabIndex={-1}
        />
      </div>
      {rejected && <ErrorBanner>{rejected}</ErrorBanner>}
    </div>
  );
}

/** The chosen file, with Replace / Remove. */
function FileBar({ file, detail, onReplace, onRemove, disabled }) {
  const T = useT();
  return (
    <div
      data-testid="csv-file-bar"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: T.surface || T.cardBg, border: `1px solid ${T.border}` }}
    >
      <FileText size={20} style={{ color: BRAND.cyan, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: T.text, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
        {detail && <div style={{ ...muted(T, 12) }}>{detail}</div>}
      </div>
      <LinkButton onClick={onReplace} disabled={disabled}>Replace file</LinkButton>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove file"
        style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', display: 'flex', padding: 4 }}
      >
        <X size={16} />
      </button>
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
    if (r.outcome === PREVIEW_OUTCOME.EMAIL_CONFLICT) {
      items.push({ rowNumber: r.rowNumber, kind: 'email_conflict', text: r.reason });
    }
    if (r.outcome === PREVIEW_OUTCOME.REVIEW) {
      items.push({ rowNumber: r.rowNumber, kind: 'review', text: `${contactDisplayName(r.contact)}: same name and company as an existing contact — imported and flagged for review` });
    }
    for (const w of r.warnings ?? []) items.push({ rowNumber: r.rowNumber, kind: 'warning', text: w });
  }
  return items.sort((a, b) => a.rowNumber - b.rowNumber);
}

function StatTile({ label, value, sub, tone, testId }) {
  const T = useT();
  const color = tone === 'gray' ? T.textMuted : tone === 'cyan' ? BRAND.cyan : STATUS[tone];
  return (
    <div
      data-testid={testId}
      style={{ borderRadius: 12, padding: 14, background: tone === 'gray' ? T.statBg || T.surface : tint(color), border: `1px solid ${tone === 'gray' ? T.border : tint(color, '55')}` }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: T.text }}>{value}</div>
      {sub && <div style={{ ...muted(T, 12), marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const NEW_OUTCOMES = [PREVIEW_OUTCOME.NEW, PREVIEW_OUTCOME.REVIEW];

function ContactCsvImport({ onContactsAdded, onCancel, onChangeType }) {
  const T = useT();
  // select → checking → preview → importing
  const [stage, setStage] = useState('select');
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);   // parseContactCsv output
  const [rows, setRows] = useState([]);         // classified + resolved rows
  const [progress, setProgress] = useState(null); // { done, total, label }
  const [error, setError] = useState(null);
  const [importName, setImportName] = useState('');
  const replaceRef = useRef(null);

  const reset = () => {
    setStage('select'); setFile(null); setParsed(null); setRows([]);
    setProgress(null); setError(null); setImportName('');
  };

  async function handleFile(selected) {
    setError(null);
    if (!isCsvFile(selected)) {
      setError(`"${selected?.name}" is not a CSV file. Please choose a .csv file.`);
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
        setFile(null);
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
      setFile(null);
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
  const emailConflicts = outcome[PREVIEW_OUTCOME.EMAIL_CONFLICT];
  // Email-conflict contacts are existing people: they join the group, with
  // their stored email untouched, but are not handed to a cadence.
  const readyExisting = outcome[PREVIEW_OUTCOME.EXISTING] + emailConflicts;
  const readyTotal = readyNew + readyExisting;
  const possibleDuplicates = outcome[PREVIEW_OUTCOME.REVIEW]
    + fileCounts[ROW_STATUS.DUPLICATE_IN_FILE] + outcome[PREVIEW_OUTCOME.DUPLICATE];
  const invalid = fileCounts[ROW_STATUS.INVALID]
    + outcome[PREVIEW_OUTCOME.CONFLICT] + outcome[PREVIEW_OUTCOME.LOOKUP_FAILED];
  const missing = fileCounts[ROW_STATUS.MISSING];
  const overLimit = fileCounts[ROW_STATUS.OVER_LIMIT];
  // New contacts whose name is incomplete: imported and sendable, just thin.
  // (A row that matched an existing contact keeps that contact's name.)
  const incomplete = incompleteRows(rows).filter((r) => NEW_OUTCOMES.includes(r.outcome));
  const attention = attentionItems(rows);
  const sample = rows.filter((r) => IMPORTABLE_OUTCOMES.includes(r.outcome)).slice(0, 3);
  const busy = stage === 'checking' || stage === 'importing';

  return (
    <div style={stack(20)}>
      <TypeHeader
        title="Lead / Contact Upload"
        subtitle="Required: a Name (or First + Last Name) or an Email."
        onChangeType={onChangeType}
      />

      {stage === 'select' && (
        <Guidelines
          items={[
            <><strong style={{ color: T.text }}>Required:</strong> Name, Full Name, or First + Last Name — or an Email</>,
            <><strong style={{ color: T.text }}>Optional:</strong> Email, Phone, Company, Title, LinkedIn, Industry / Vertical, State, Location, Notes</>,
            <>Rows with only an email are imported and marked <strong style={{ color: T.text }}>Needs name</strong> — they greet as "Hi,"</>,
            <><strong style={{ color: T.text }}>Up to {MAX_IMPORT_ROWS} contacts</strong> per upload</>,
            <>Columns can be in any order; common header names are recognized automatically</>,
            <>People already in IDYNIFY are updated, never duplicated</>,
          ]}
        />
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {stage === 'select' && <FilePicker onFile={handleFile} id="csv-upload" />}

      {file && stage !== 'select' && (
        <>
          <FileBar
            file={file}
            detail={stage === 'preview' ? `${rows.length} row${rows.length !== 1 ? 's' : ''} in file` : 'Reading…'}
            onReplace={() => replaceRef.current?.click()}
            onRemove={reset}
            disabled={busy}
          />
          <input
            ref={replaceRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            data-testid="csv-replace-input"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }}
          />
        </>
      )}

      {busy && (
        <Panel testId="csv-progress" style={{ textAlign: 'center', padding: 32 }}>
          <Loader size={30} className="animate-spin" style={{ color: BRAND.pink, margin: '0 auto 12px', display: 'block' }} />
          <p style={{ fontWeight: 600, color: T.text, margin: 0 }}>{progress?.label || (stage === 'importing' ? 'Importing' : 'Reading file')}…</p>
          {progress?.total > 0 && (
            <p style={{ ...muted(T), marginTop: 4 }}>{progress.done} of {progress.total}</p>
          )}
        </Panel>
      )}

      {stage === 'preview' && (
        <Panel style={{ ...stack(18), padding: 20 }}>
          <h3 style={{ ...heading(T, 17), margin: 0 }}>Preview: {file?.name}</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <StatTile
              testId="tile-ready" tone="green" label="Ready to import" value={readyTotal}
              sub={readyExisting > 0 ? `${readyNew} new · ${readyExisting} already in IDYNIFY (updated, not duplicated)` : `${readyNew} new`}
            />
            <StatTile
              testId="tile-incomplete" tone="cyan" label="Incomplete profiles" value={incomplete.length}
              sub="Imported — valid email, name missing. Add it later in People."
            />
            <StatTile
              testId="tile-duplicates" tone="amber" label="Possible duplicates" value={possibleDuplicates}
              sub="Repeats in this file are skipped; name + company matches import flagged"
            />
            <StatTile testId="tile-invalid" tone="red" label="Invalid rows" value={invalid} sub="Not imported" />
            <StatTile testId="tile-missing" tone="gray" label="Missing required information" value={missing} sub="Not imported" />
          </div>

          {emailConflicts > 0 && (
            <Panel tone="amber" testId="email-conflict-banner" style={{ display: 'flex', gap: 8, fontSize: 13, padding: 12 }}>
              <AlertTriangle size={16} style={{ color: STATUS.amber, flexShrink: 0, marginTop: 2 }} />
              <span role="alert">
                <strong>{emailConflicts} email conflict{emailConflicts !== 1 ? 's' : ''}.</strong>{' '}
                {emailConflicts === 1 ? 'This person matches' : 'These people match'} an existing contact by phone or LinkedIn, but the CSV email is different.
                The IDYNIFY email is kept, and they will <strong>not</strong> be added to a cadence until you check the email in People.
                Details are listed below.
              </span>
            </Panel>
          )}

          {overLimit > 0 && (
            <Panel tone="amber" style={{ display: 'flex', gap: 8, fontSize: 13, padding: 12 }}>
              <AlertTriangle size={16} style={{ color: STATUS.amber, flexShrink: 0, marginTop: 2 }} />
              <span role="alert">
                {overLimit} row{overLimit !== 1 ? 's are' : ' is'} over the {MAX_IMPORT_ROWS}-contact limit and will not be imported.
                Split the file and upload the rest separately.
              </span>
            </Panel>
          )}

          {parsed?.ignoredHeaders?.length > 0 && (
            <div style={{ ...muted(T, 12), display: 'flex', gap: 8 }}>
              <Info size={16} style={{ flexShrink: 0 }} />
              <span>Columns not imported (no matching contact field): {parsed.ignoredHeaders.join(', ')}</span>
            </div>
          )}

          {attention.length > 0 && (
            <div style={{ background: T.surface || T.cardBg, borderRadius: 12, padding: 14, border: `1px solid ${T.border}` }}>
              <h4 style={heading(T, 13)}>Rows needing attention ({attention.length})</h4>
              <ul data-testid="csv-attention" style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, maxHeight: 160, overflowY: 'auto', ...stack(4) }}>
                {attention.map((a, i) => (
                  <li key={`${a.rowNumber}-${i}`} style={{ display: 'flex', gap: 8, color: T.textMuted }}>
                    {a.kind === 'review' || a.kind === 'email_conflict' || a.kind === ROW_STATUS.DUPLICATE_IN_FILE || a.kind === PREVIEW_OUTCOME.DUPLICATE
                      ? <Copy size={16} style={{ color: STATUS.amber, flexShrink: 0 }} />
                      : a.kind === 'warning'
                        ? <Info size={16} style={{ color: T.textFaint, flexShrink: 0 }} />
                        : <XCircle size={16} style={{ color: STATUS.red, flexShrink: 0 }} />}
                    <span><strong style={{ color: T.text }}>Row {a.rowNumber}:</strong> {a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {incomplete.length > 0 && (
            <div style={{ background: T.surface || T.cardBg, borderRadius: 12, padding: 14, border: `1px solid ${T.border}` }}>
              <h4 style={heading(T, 13)}>Incomplete profiles — will import ({incomplete.length})</h4>
              <p style={{ ...muted(T, 12), marginBottom: 8 }}>
                Valid contacts with part of the name missing. They can be added to a cadence now; the greeting uses the first name when there is one and "Hi," otherwise.
              </p>
              <ul data-testid="csv-incomplete" style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, maxHeight: 160, overflowY: 'auto', ...stack(6) }}>
                {incomplete.map((r) => (
                  <li key={r.rowNumber} data-testid={`csv-incomplete-row-${r.rowNumber}`} style={{ display: 'flex', gap: 8, color: T.textMuted }}>
                    <UserX size={16} style={{ color: BRAND.cyan, flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong style={{ color: T.text }}>Row {r.rowNumber}: {contactDisplayName(r.contact, { email: false })}</strong>
                      {r.contact.email && <> · {r.contact.email}</>}
                      <span style={{ display: 'block', fontSize: 12, color: T.textFaint }}>Missing: {r.missing.join(', ')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sample.length > 0 && (
            <div>
              <h4 style={heading(T, 13)}>Sample ({sample.length} of {readyTotal})</h4>
              <div style={stack(8)}>
                {sample.map((r) => (
                  <div key={r.rowNumber} style={{ background: T.surface || T.cardBg, borderRadius: 10, padding: 12, border: `1px solid ${T.border}` }}>
                    <p style={{ fontWeight: 600, color: T.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {contactDisplayName(r.contact, { email: false })}
                      {r.outcome === PREVIEW_OUTCOME.EMAIL_CONFLICT && <Badge color={STATUS.amber}>Email conflict</Badge>}
                      {r.outcome === PREVIEW_OUTCOME.EXISTING && <Badge color={BRAND.cyan}>Already in IDYNIFY</Badge>}
                      {NEW_OUTCOMES.includes(r.outcome) && r.missing?.length > 0 && <Badge color={BRAND.cyan}>Incomplete profile</Badge>}
                    </p>
                    <p style={{ ...muted(T), marginTop: 2 }}>
                      {[r.contact.title, r.contact.company, r.contact.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="csv-import-name" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 6 }}>Name this import</label>
            <input
              id="csv-import-name"
              type="text"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              maxLength={80}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: `1px solid ${T.border2 || T.border}`, background: T.input || T.surface, color: T.text, fontSize: 14, boxSizing: 'border-box' }}
            />
            <p style={{ ...muted(T, 12), marginTop: 6 }}>
              Every imported contact is tagged <strong style={{ color: T.text }}>{buildImportTag(importName || defaultImportName(file?.name))}</strong> so you can find this group in People.
            </p>
          </div>
        </Panel>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <SecondaryButton onClick={onCancel} disabled={busy}>Cancel</SecondaryButton>
        {stage === 'preview' && (
          <PrimaryButton onClick={handleImport} disabled={readyTotal === 0}>
            <CheckCircle size={18} />
            Import {readyTotal} contact{readyTotal !== 1 ? 's' : ''}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function Badge({ color, children }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: tint(color, '1f'), border: `1px solid ${tint(color, '55')}`, padding: '1px 8px', borderRadius: 999 }}>
      {children}
    </span>
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
  const T = useT();
  const [file, setFile] = useState(null);
  const [notice, setNotice] = useState(null);
  const replaceRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  async function handleFile(selected) {
    setNotice(null);
    if (!isCsvFile(selected)) {
      setNotice(`"${selected?.name}" is not a CSV file. Please choose a .csv file.`);
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
      setNotice('You must be logged in to upload.');
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
      setNotice('Failed to upload. Please try again.');
      setUploading(false);
    }
  };

  const resetFile = () => { setFile(null); setPreview(null); setValidationErrors([]); setNotice(null); };

  return (
    <div style={stack(20)}>
      <TypeHeader
        title="Company List Upload"
        subtitle="Upload a CSV of companies. Required: Company Name."
        onChangeType={onChangeType}
      />

      <Guidelines
        items={[
          <><strong style={{ color: T.text }}>Required column:</strong> Company Name (or "Account Name")</>,
          <><strong style={{ color: T.text }}>Optional columns:</strong> Website, Industry, LinkedIn, State</>,
          <><strong style={{ color: T.text }}>Max {COMPANY_UPLOAD_LIMIT} companies</strong> per upload</>,
          <>Headers will be auto-mapped (flexible format)</>,
        ]}
      />

      {notice && <ErrorBanner>{notice}</ErrorBanner>}

      {!file ? (
        <FilePicker onFile={handleFile} id="csv-company-upload" />
      ) : (
        <Panel style={{ ...stack(16), padding: 20 }}>
          <FileBar
            file={file}
            detail={`${preview?.total ?? 0} rows in file`}
            onReplace={() => replaceRef.current?.click()}
            onRemove={resetFile}
            disabled={uploading}
          />
          <input
            ref={replaceRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleFile(f); }}
          />
          <h3 style={{ ...heading(T, 17), margin: 0 }}>Preview: {file.name}</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <StatTile tone="green" label="Valid Companies" value={preview?.valid || 0} />
            <StatTile tone="red" label="Errors" value={validationErrors.length} />
          </div>

          {validationErrors.length > 0 && (
            <Panel tone="red" style={{ padding: 14 }}>
              <h4 style={heading(T, 13)}>Validation Errors</h4>
              <ul style={{ ...muted(T), listStyle: 'none', padding: 0, margin: 0, maxHeight: 128, overflowY: 'auto', ...stack(4) }}>
                {validationErrors.map((error, index) => <li key={index}>{error}</li>)}
              </ul>
            </Panel>
          )}

          {preview?.items?.length > 0 && (
            <div>
              <h4 style={heading(T, 13)}>
                Sample Companies ({Math.min(3, preview.items.length)} of {preview.valid})
              </h4>
              <div style={stack(8)}>
                {preview.items.slice(0, 3).map((item, index) => (
                  <div key={index} style={{ background: T.surface || T.cardBg, borderRadius: 10, padding: 12, border: `1px solid ${T.border}` }}>
                    <p style={{ fontWeight: 600, color: T.text, margin: 0 }}>{item.name}</p>
                    {item.industry && <p style={muted(T)}>{item.industry}</p>}
                    {item.website_url && <p style={muted(T)}>{item.website_url}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <SecondaryButton onClick={onCancel} disabled={uploading}>Cancel</SecondaryButton>
        <PrimaryButton onClick={handleUpload} disabled={!preview || preview.valid === 0 || uploading}>
          {uploading ? (
            <><Loader size={18} className="animate-spin" />Uploading...</>
          ) : (
            <><Upload size={18} />Upload {preview?.valid || 0} Companies</>
          )}
        </PrimaryButton>
      </div>
    </div>
  );
}
