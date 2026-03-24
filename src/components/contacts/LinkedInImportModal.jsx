/**
 * LINKEDIN IMPORT MODAL (Phase 2)
 *
 * Lets users upload their LinkedIn connections CSV export and import
 * it into Barry's persistent network for ICP matching.
 *
 * How to export from LinkedIn:
 *   Settings > Data Privacy > Get a copy of your data > Connections
 *
 * CSV format: First Name, Last Name, URL, Email Address, Company, Position, Connected On
 *
 * Flow:
 *   idle → file_selected (parse + score) → previewing → uploading → success | error
 *
 * The scoring happens frontend-side using scoreLinkedInConnection.js so we don't
 * need to port that logic to the Netlify function. The function receives pre-scored
 * rows and only writes them to Firestore.
 *
 * Props: { isOpen, onClose, onImportComplete }
 */

import { useState, useRef } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Linkedin } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { useActiveUser } from '../../context/ImpersonationContext';
import { scoreLinkedInConnection } from '../../utils/scoreLinkedInConnection';

// ── CSV parsing ───────────────────────────────────────────────────

/**
 * Split a single CSV row, respecting double-quoted fields.
 */
function splitCsvRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parse a LinkedIn connections CSV string into row objects.
 * LinkedIn adds 1–3 note lines before the header — we detect the
 * header by looking for the "First Name" column.
 */
function parseLinkedInCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Find header row (may not be line 0 — LinkedIn prepends notes)
  const headerIdx = lines.findIndex(l => /First Name/i.test(l));
  if (headerIdx === -1) return [];

  const headers = splitCsvRow(lines[headerIdx]).map(h => h.trim());
  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const vals = splitCsvRow(lines[i]);
    if (vals.every(v => !v.trim())) continue; // skip blank rows

    const row = {};
    headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });

    // Skip rows with no company AND no position
    if (!row['Company'] && !row['Position']) continue;

    rows.push({
      first_name:   row['First Name']  || '',
      last_name:    row['Last Name']   || '',
      company:      row['Company']     || '',
      title:        row['Position']    || '',
      connected_on: row['Connected On']|| '',
    });
  }

  return rows;
}

// ── Netlify function call ─────────────────────────────────────────

async function callImportFunction(idToken, connections) {
  const res = await fetch('/.netlify/functions/import-linkedin-connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, connections }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json(); // { imported, total }
}

// ── Modal ─────────────────────────────────────────────────────────

export default function LinkedInImportModal({ isOpen, onClose, onImportComplete }) {
  const T = useT();
  const user = useActiveUser();
  const fileRef = useRef(null);

  const [step, setStep] = useState('idle'); // idle | previewing | uploading | success | error
  const [scoredRows, setScoredRows] = useState([]);
  const [stats, setStats] = useState({ hot: 0, warm: 0, unscored: 0, total: 0 });
  const [importResult, setImportResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');

  if (!isOpen) return null;

  function reset() {
    setStep('idle');
    setScoredRows([]);
    setStats({ hot: 0, warm: 0, unscored: 0, total: 0 });
    setImportResult(null);
    setErrorMsg('');
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      setErrorMsg('Please select a .csv file.');
      setStep('error');
      return;
    }

    setFileName(file.name);
    setErrorMsg('');

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const rows = parseLinkedInCSV(evt.target.result);
        if (rows.length === 0) {
          setErrorMsg('No connections found. Make sure this is a LinkedIn connections CSV (Settings > Data Privacy > Get a copy of your data > Connections).');
          setStep('error');
          return;
        }

        // Score each row
        const scored = rows.map(r => {
          const { icp_match_score, icp_tier } = scoreLinkedInConnection(r);
          return { ...r, icp_match_score, icp_tier };
        });

        const counts = scored.reduce((acc, r) => {
          acc[r.icp_tier] = (acc[r.icp_tier] || 0) + 1;
          return acc;
        }, { hot: 0, warm: 0, unscored: 0 });

        setScoredRows(scored);
        setStats({ ...counts, total: scored.length });
        setStep('previewing');
      } catch (err) {
        setErrorMsg('Could not parse this CSV. Check that it is a LinkedIn connections export.');
        setStep('error');
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!user || scoredRows.length === 0) return;
    setStep('uploading');
    try {
      const idToken = await user.getIdToken();
      const result = await callImportFunction(idToken, scoredRows);
      setImportResult(result);
      setStep('success');
      onImportComplete?.();
    } catch (err) {
      setErrorMsg(err.message || 'Import failed. Please try again.');
      setStep('error');
    }
  }

  // ── Styles ──────────────────────────────────────────────────────

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  };

  const modalStyle = {
    background: T.cardBg || T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 16, padding: 28,
    width: '100%', maxWidth: 460,
    position: 'relative',
    boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
  };

  const statPillStyle = (color, bg) => ({
    padding: '6px 14px', borderRadius: 20,
    background: bg, color, fontSize: 13, fontWeight: 700,
  });

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div style={modalStyle}>

        {/* Close button */}
        <button
          onClick={handleClose}
          style={{
            position: 'absolute', top: 14, right: 14,
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.textMuted, padding: 4, borderRadius: 6,
          }}
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: '#0077b518', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Linkedin size={18} color="#0077b5" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>Import LinkedIn Connections</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
              Barry stores your network for persistent ICP matching
            </div>
          </div>
        </div>

        {/* ── idle ─────────────────────────────────────────── */}
        {step === 'idle' && (
          <>
            <div style={{
              border: `2px dashed ${T.border}`,
              borderRadius: 12, padding: '28px 20px',
              textAlign: 'center', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
              onClick={() => fileRef.current?.click()}
              onMouseEnter={e => e.currentTarget.style.borderColor = BRAND.pink}
              onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
            >
              <Upload size={22} color={T.textMuted} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>
                Drop your LinkedIn CSV here
              </div>
              <div style={{ fontSize: 11, color: T.textMuted }}>
                or click to browse — .csv files only
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 9, background: T.surface, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 4 }}>How to export from LinkedIn:</div>
              <ol style={{ fontSize: 11, color: T.textMuted, margin: 0, paddingLeft: 16, lineHeight: 1.7 }}>
                <li>Go to LinkedIn Settings</li>
                <li>Data Privacy → Get a copy of your data</li>
                <li>Select "Connections" → Request archive</li>
                <li>Download the CSV when the email arrives</li>
              </ol>
            </div>
          </>
        )}

        {/* ── previewing ────────────────────────────────────── */}
        {step === 'previewing' && (
          <>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14 }}>
              {fileName}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 4 }}>
              Found {stats.total.toLocaleString()} connections
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {stats.hot > 0 && (
                <span style={statPillStyle('#22c55e', '#22c55e18')}>
                  {stats.hot} hot
                </span>
              )}
              {stats.warm > 0 && (
                <span style={statPillStyle('#f59e0b', '#f59e0b18')}>
                  {stats.warm} warm
                </span>
              )}
              <span style={statPillStyle(T.textMuted, T.surface)}>
                {stats.unscored} unscored
              </span>
            </div>
            <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 20 }}>
              Hot and warm connections are decision-makers Barry will surface for intros.
              Scoring improves as you add ICP target companies.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleImport}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 9, border: 'none',
                  background: BRAND.pink, color: '#fff',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Import {stats.total.toLocaleString()} connections →
              </button>
              <button
                onClick={reset}
                style={{
                  padding: '10px 16px', borderRadius: 9,
                  border: `1px solid ${T.border}`, background: 'transparent',
                  color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ── uploading ─────────────────────────────────────── */}
        {step === 'uploading' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              border: `3px solid ${BRAND.pink}30`,
              borderTopColor: BRAND.pink,
              margin: '0 auto 16px',
              animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
              Importing {stats.total.toLocaleString()} connections…
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
              Barry is storing your network. This may take a few seconds.
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* ── success ───────────────────────────────────────── */}
        {step === 'success' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <CheckCircle size={40} color="#22c55e" style={{ marginBottom: 14 }} />
            <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 6 }}>
              {(importResult?.imported || stats.total).toLocaleString()} connections imported
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 24 }}>
              Barry now has your LinkedIn network and will surface ICP matches in the network scan.
            </div>
            <button
              onClick={handleClose}
              style={{
                padding: '9px 28px', borderRadius: 9, border: 'none',
                background: BRAND.pink, color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        )}

        {/* ── error ─────────────────────────────────────────── */}
        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <AlertCircle size={36} color="#dc2626" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 24 }}>
              {errorMsg}
            </div>
            <button
              onClick={reset}
              style={{
                padding: '9px 22px', borderRadius: 9, border: 'none',
                background: BRAND.pink, color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
