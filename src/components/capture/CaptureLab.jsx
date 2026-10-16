/**
 * Capture Lab — an internal, admin-only test surface for Relationship
 * Capture. Not the scanner UI.
 *
 *   Take Photo → Prepare Image → Quality Warning → Extract → Fields + Confidence
 *
 * READ-ONLY. It prepares a photo on this device (PR 5), sends it to
 * captureExtract (PR 6) and shows what came back, with the diagnostics needed
 * to judge it: prepared size and dimensions, preparation time on this device,
 * quality warnings, extraction latency, every field with its confidence, and
 * the extractor, model and prompt that read it. It never saves, matches or
 * modifies a contact, company or relationship, shows no secret or raw
 * provider response (the endpoint never returns one), and logs nothing.
 * Whatever extractor the deploy is configured with answers: the fake until
 * CAPTURE_EXTRACTOR names claude-vision.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Camera, ImagePlus, RotateCcw, Send, ClipboardCopy, FlaskConical } from 'lucide-react';
import { prepareCardImage, useAnyway as keepDespiteWarnings, MESSAGES, PrepareImageError } from './imagePrep.js';
import { fetchCaptureConfig, extractCard, newOperationId } from './captureLabApi.js';
import { extractionRows, diagnostics } from './captureLabView.js';

const LEVEL_COLORS = {
  confirmed: { bg: '#dcfce7', fg: '#166534' },
  likely: { bg: '#dbeafe', fg: '#1e40af' },
  possible: { bg: '#fef9c3', fg: '#854d0e' },
  unknown: { bg: '#f1f5f9', fg: '#64748b' },
};

const styles = {
  page: { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif' },
  body: { maxWidth: 760, margin: '0 auto', padding: '16px 16px 48px' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginTop: 12 },
  h2: { fontSize: 15, fontWeight: 600, margin: '0 0 10px' },
  muted: { color: '#64748b', fontSize: 13 },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  button: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 14, cursor: 'pointer' },
  primary: { background: '#0f172a', color: '#fff', border: '1px solid #0f172a' },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', fontSize: 13, margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  td: { borderTop: '1px solid #f1f5f9', padding: '6px 4px', verticalAlign: 'top' },
  warn: { background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 10, fontSize: 14 },
  error: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 10, fontSize: 14 },
};

const kb = bytes => `${(bytes / 1024).toFixed(0)} KB`;
const seconds = ms => (typeof ms === 'number' ? `${(ms / 1000).toFixed(2)} s` : '–');

/** What each endpoint error means here, by code. */
const EXTRACT_ERRORS = {
  capture_disabled: 'Capture is not on for this account on this deploy.',
  image_rejected: 'The server refused this image.',
  no_text: 'No text could be read on this photo. Retake it.',
  operation_conflict: 'This scan is already finished. Take a new photo.',
  config_error: 'No extractor is configured on this deploy.',
  rate_limited: 'The extractor is busy. Retry in a moment.',
  timeout: 'The extractor took too long. Retry.',
  unavailable: 'The extractor is unavailable. Retry.',
  network: 'The network request failed. Retry.',
  invalid_output: 'The extractor answered with something unusable. Retry.',
  unauthorized: 'Sign in again.',
  forbidden: 'Not allowed for this account.',
};

function Level({ level }) {
  const color = LEVEL_COLORS[level] ?? LEVEL_COLORS.unknown;
  return <span style={{ background: color.bg, color: color.fg, borderRadius: 999, padding: '1px 8px', fontSize: 12, whiteSpace: 'nowrap' }}>{level}</span>;
}

export default function CaptureLab({ prepare = prepareCardImage }) {
  const [config, setConfig] = useState({ loading: true });
  const [original, setOriginal] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [prepError, setPrepError] = useState(null);
  const [busy, setBusy] = useState(null);                 // 'preparing' | 'extracting'
  const [operationId, setOperationId] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetchCaptureConfig()
      .then(({ status, body }) => { if (live) setConfig({ loading: false, status, enabled: body?.enabled === true, stage: body?.stage ?? null }); })
      .catch(() => { if (live) setConfig({ loading: false, status: 0, enabled: null, stage: null }); });
    return () => { live = false; };
  }, []);

  const reset = () => {
    setOriginal(null);
    setPrepared(null);
    setPrepError(null);
    setOperationId(null);
    setResult(null);
    setCopied(false);
  };

  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    reset();
    setOriginal({ type: file.type, size: file.size });
    setBusy('preparing');
    try {
      setPrepared(await prepare(file));
      setOperationId(newOperationId());
    } catch (error) {
      setPrepError(error instanceof PrepareImageError ? error.code : 'decode_failed');
    } finally {
      setBusy(null);
    }
  };

  const extract = async () => {
    if (!prepared || !operationId) return;
    setBusy('extracting');
    setResult(null);
    setResult(await extractCard({ operationId, image: prepared.image }));
    setBusy(null);
  };

  const warnings = prepared?.image.preflight.warnings ?? [];
  const needsDecision = warnings.length > 0 && !prepared.image.preflight.userOverrode;
  const extraction = result?.status === 200 ? result.body?.extraction : null;
  const failure = result && result.status !== 200 ? result.body ?? { error: 'internal_error' } : null;
  // A finished scan (read, or failed for good) needs a new photo; a retryable failure can be sent again as the same scan.
  const finished = Boolean(extraction) || Boolean(failure && !failure.retryable);
  const canExtract = Boolean(prepared) && !needsDecision && !busy && !finished && config.enabled !== false;

  const copyDiagnostics = async () => {
    const text = JSON.stringify(diagnostics({ original, prepared, result, device: navigator.userAgent }), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.body}>
        <div style={{ ...styles.row, justifyContent: 'space-between' }}>
          <Link to="/admin" style={{ ...styles.muted, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
            <ArrowLeft size={16} /> Admin
          </Link>
          <span style={styles.muted}>Internal test surface · nothing is saved</span>
        </div>
        <h1 style={{ fontSize: 22, margin: '12px 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FlaskConical size={22} /> Capture Lab
        </h1>
        <p style={{ ...styles.muted, margin: 0 }}>
          {config.loading ? 'Checking capture for this account…'
            : config.enabled ? `Capture is on for you (${config.stage}).`
              : config.enabled === false ? 'Capture is off for this account on this deploy: you can prepare photos, but extraction will be refused.'
                : 'Could not check capture for this account.'}
        </p>

        {/* 1. Take photo */}
        <section style={styles.card}>
          <h2 style={styles.h2}>1. Photo</h2>
          <div style={styles.row}>
            <label style={{ ...styles.button, ...styles.primary }}>
              <Camera size={16} /> Take photo
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} data-testid="take-photo" />
            </label>
            <label style={styles.button}>
              <ImagePlus size={16} /> Choose file
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} data-testid="choose-file" />
            </label>
            {(prepared || prepError) && (
              <button type="button" style={styles.button} onClick={reset}><RotateCcw size={16} /> Start over</button>
            )}
          </div>
          {busy === 'preparing' && <p style={styles.muted}>Preparing on this device…</p>}
          {prepError && <p style={{ ...styles.error, marginTop: 10 }}>{MESSAGES[prepError] ?? 'This photo could not be prepared.'} <code>{prepError}</code></p>}
        </section>

        {/* 2. Prepared image and quality */}
        {prepared && (
          <section style={styles.card}>
            <h2 style={styles.h2}>2. Prepared image</h2>
            <div style={{ ...styles.row, alignItems: 'flex-start' }}>
              <img src={`data:image/jpeg;base64,${prepared.image.data}`} alt="Prepared card" style={{ width: 220, maxWidth: '100%', borderRadius: 6, border: '1px solid #e2e8f0' }} />
              <dl style={styles.dl}>
                <dt>Dimensions</dt><dd style={{ margin: 0 }}>{prepared.image.widthPx} × {prepared.image.heightPx}</dd>
                <dt>Size</dt><dd style={{ margin: 0 }}>{kb(prepared.image.bytes)}{original ? ` (from ${kb(original.size)} ${original.type || 'unknown type'})` : ''}</dd>
                <dt>Prep time</dt><dd style={{ margin: 0 }} data-testid="prep-ms">{prepared.prepMs} ms {prepared.prepMs > 700 ? '(over the 700 ms target)' : ''}</dd>
                <dt>Blur</dt><dd style={{ margin: 0 }}>{prepared.image.preflight.blur}</dd>
                <dt>Brightness</dt><dd style={{ margin: 0 }}>{prepared.image.preflight.brightness}</dd>
                <dt>Glare</dt><dd style={{ margin: 0 }}>{(prepared.image.preflight.glareRatio * 100).toFixed(2)}%</dd>
                <dt>Warnings</dt><dd style={{ margin: 0 }}>{warnings.length ? warnings.join(', ') : 'none'}{prepared.image.preflight.userOverrode ? ' (kept: Use anyway)' : ''}</dd>
              </dl>
            </div>
            {needsDecision && (
              <div style={{ ...styles.warn, marginTop: 10 }}>
                {warnings.map(w => MESSAGES[w]).join(' ')} Fields read from this photo will be capped at likely.
                <div style={{ ...styles.row, marginTop: 8 }}>
                  <button type="button" style={styles.button} onClick={() => setPrepared({ ...prepared, image: keepDespiteWarnings(prepared.image) })}>Use anyway</button>
                  <label style={styles.button}>
                    <Camera size={16} /> Retake
                    <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>
            )}
            <div style={{ ...styles.row, marginTop: 12 }}>
              <button type="button" style={{ ...styles.button, ...styles.primary, opacity: canExtract ? 1 : 0.5 }} disabled={!canExtract} onClick={extract}>
                <Send size={16} /> {busy === 'extracting' ? 'Extracting…' : 'Extract'}
              </button>
            </div>
          </section>
        )}

        {/* 3. Failure */}
        {failure && (
          <section style={styles.card}>
            <h2 style={styles.h2}>3. Extraction failed</h2>
            <p style={styles.error}>
              {EXTRACT_ERRORS[failure.error] ?? 'Something went wrong.'} <code>{failure.error}{failure.reason ? ` · ${failure.reason}` : ''}</code> · HTTP {result.status} · {seconds(result.ms)}
            </p>
            {failure.retryable && <button type="button" style={styles.button} onClick={extract}><RotateCcw size={16} /> Retry this scan</button>}
          </section>
        )}

        {/* 3. Result */}
        {extraction && (
          <section style={styles.card}>
            <h2 style={styles.h2}>3. Extracted</h2>
            <dl style={styles.dl}>
              <dt>Status</dt><dd style={{ margin: 0 }}>{extraction.capture.status}</dd>
              <dt>Extractor</dt><dd style={{ margin: 0 }}>{extraction.capture.provider.id} · model {extraction.capture.provider.modelId ?? '–'} · prompt {extraction.capture.provider.promptVersion} · adapter {extraction.capture.provider.adapterVersion}</dd>
              <dt>Latency</dt><dd style={{ margin: 0 }} data-testid="latency">{seconds(result.ms)} round trip · extractor {seconds(extraction.capture.timing.providerMs)} · server total {seconds(extraction.capture.timing.totalMs)}</dd>
              <dt>Tokens</dt><dd style={{ margin: 0 }}>{extraction.capture.usage.inputTokens ?? '–'} in · {extraction.capture.usage.outputTokens ?? '–'} out</dd>
              <dt>Fields</dt><dd style={{ margin: 0 }}>{extraction.capture.counts.fields} · {extraction.capture.counts.confirmed} confirmed · {extraction.capture.counts.likely} likely · {extraction.capture.counts.possible} to review</dd>
            </dl>
            <table style={{ ...styles.table, marginTop: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b' }}><th style={styles.td}>Field</th><th style={styles.td}>Value</th><th style={styles.td}>Confidence</th></tr>
              </thead>
              <tbody>
                {extractionRows(extraction).map(({ label, field, note }) => (
                  <tr key={label} data-testid="field-row">
                    <td style={{ ...styles.td, whiteSpace: 'nowrap', color: '#475569' }}>{label}</td>
                    <td style={{ ...styles.td, wordBreak: 'break-word' }}>
                      {field.value ?? <span style={styles.muted}>not on the card</span>}
                      {note && <div style={styles.muted}>{note}</div>}
                      {field.extraction.checks.length > 0 && <div style={{ ...styles.muted, fontSize: 11 }}>{field.extraction.checks.join(', ')}</div>}
                    </td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}><Level level={field.extraction.level} /> {field.value !== null ? <span style={styles.muted}>{field.extraction.score}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {extraction.company.safeguards.length > 0 && <p style={styles.muted}>Company safeguards: {extraction.company.safeguards.join(', ')}</p>}
          </section>
        )}

        {(prepared || result) && (
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button type="button" style={styles.button} onClick={copyDiagnostics}><ClipboardCopy size={16} /> {copied ? 'Copied' : 'Copy diagnostics (no card values)'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
