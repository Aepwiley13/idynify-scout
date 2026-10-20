/**
 * Scan Business Card: the internal capture flow behind the Scout+ card.
 *
 *   Take or upload a photo → prepare it on this device → quality warning
 *   (Use anyway / Retake) → read it (captureExtract) → review
 *
 * Built from the Capture Lab's parts, unchanged: prepareCardImage for the
 * photo and its quality checks, and captureExtract through captureLabApi, as
 * the signed-in user, with one new scan (operationId) per photo and a retry of
 * the same scan only when the endpoint says the failure is retryable.
 *
 * This step saves nothing. The only record a scan leaves is captureExtract's
 * own values-free operation record. The photo stays in memory on this screen
 * and is never stored or logged.
 */
import { useState } from 'react';
import { Camera, ImagePlus, RotateCcw, Loader, PencilLine } from 'lucide-react';
import { prepareCardImage, useAnyway as keepDespiteWarnings, MESSAGES, PrepareImageError } from './imagePrep.js';
import { extractCard, newOperationId } from './captureLabApi.js';
import { draftsFromExtraction, emptyDraft } from './captureDraft.js';
import CaptureReview from './CaptureReview.jsx';
import { useT } from '../../theme/ThemeContext';

/** What each captureExtract error means to the person scanning. */
const READ_ERRORS = Object.freeze({
  capture_disabled: 'Scanning is not available for this account right now.',
  image_rejected: "This photo couldn't be used. Take another one.",
  no_text: 'No text could be read on this photo. Take another one, or enter the details yourself.',
  operation_conflict: 'This scan has already finished. Take a new photo.',
  config_error: 'Card reading is not set up on this deploy.',
  rate_limited: 'Card reading is busy. Try again in a moment.',
  timeout: 'Reading the card took too long. Try again.',
  unavailable: 'Card reading is unavailable right now. Try again.',
  network: 'The connection dropped. Try again.',
  invalid_output: "The card couldn't be read cleanly. Try again.",
  unauthorized: 'Your session has expired. Sign in again.',
  forbidden: 'This account cannot scan cards.',
});

function PhotoButtons({ onPhoto, primaryLabel = 'Take photo', T }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px',
    borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer', flex: '1 1 160px',
  };
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <label style={{ ...base, background: '#7c3aed', color: '#fff', border: '1px solid #7c3aed' }}>
        <Camera size={18} /> {primaryLabel}
        <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} data-testid="capture-take-photo" />
      </label>
      <label style={{ ...base, background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}>
        <ImagePlus size={18} /> Upload photo
        <input type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} data-testid="capture-upload-photo" />
      </label>
    </div>
  );
}

/**
 * @param {object}   props
 * @param {Function} [props.prepare]  the photo preparation (injectable for tests)
 * @param {Function} [props.renderActions]  ({ people, setPeople, startOver }) => node, shown under review
 */
export default function CaptureFlow({ prepare = prepareCardImage, renderActions = null }) {
  const T = useT();
  const [step, setStep] = useState('photo');          // photo | preparing | warn | reading | failed | review
  const [prepared, setPrepared] = useState(null);
  const [prepError, setPrepError] = useState(null);
  const [operationId, setOperationId] = useState(null);
  const [failure, setFailure] = useState(null);
  const [readStatus, setReadStatus] = useState(null);
  const [people, setPeople] = useState([]);

  const startOver = () => {
    setStep('photo');
    setPrepared(null);
    setPrepError(null);
    setOperationId(null);
    setFailure(null);
    setReadStatus(null);
    setPeople([]);
  };

  const read = async (image, id) => {
    setStep('reading');
    setFailure(null);
    const result = await extractCard({ operationId: id, image });
    const extraction = result.status === 200 ? result.body?.extraction : null;
    if (!extraction) {
      setFailure(result.body?.error ? result.body : { error: 'internal_error' });
      setStep('failed');
      return;
    }
    const drafts = extraction.capture?.status === 'unreadable' ? [] : draftsFromExtraction(extraction);
    setReadStatus(extraction.capture?.status ?? null);
    setPeople(drafts.length ? drafts : [emptyDraft()]);
    setStep('review');
  };

  const onPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    startOver();
    setStep('preparing');
    let next;
    try {
      next = await prepare(file);
    } catch (error) {
      setPrepError(error instanceof PrepareImageError ? error.code : 'decode_failed');
      setStep('photo');
      return;
    }
    const id = newOperationId();
    setPrepared(next);
    setOperationId(id);
    if (next.image.preflight.warnings.length > 0) {
      setStep('warn');
      return;
    }
    await read(next.image, id);
  };

  const readAnyway = async () => {
    const image = keepDespiteWarnings(prepared.image);
    setPrepared({ ...prepared, image });
    await read(image, operationId);
  };

  const enterByHand = () => {
    setFailure(null);
    setReadStatus('manual');
    setPeople([emptyDraft()]);
    setStep('review');
  };

  const muted = { fontSize: 14, color: T.textMuted, margin: 0 };
  const button = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, fontSize: 14,
    fontWeight: 600, cursor: 'pointer', background: T.cardBg, color: T.text, border: `1px solid ${T.border}`,
  };
  const notice = (color) => ({ borderRadius: 12, padding: 12, fontSize: 14, border: `1px solid ${color}55`, background: `${color}14`, color: T.text });
  const warnings = prepared?.image.preflight.warnings ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="capture-flow">
      {(step === 'photo' || step === 'preparing') && (
        <>
          <p style={muted}>Take a photo of the front of the card, flat on a table in normal light.</p>
          {step === 'preparing'
            ? <p style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}><Loader size={16} className="animate-spin" /> Preparing the photo…</p>
            : <PhotoButtons onPhoto={onPhoto} T={T} />}
          {prepError && <div role="alert" style={notice('#ef4444')}>{MESSAGES[prepError] ?? 'This photo could not be prepared. Try again.'}</div>}
        </>
      )}

      {prepared && step !== 'photo' && step !== 'preparing' && (
        <img
          src={`data:image/jpeg;base64,${prepared.image.data}`}
          alt="The card you photographed"
          style={{ width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 12, border: `1px solid ${T.border}` }}
        />
      )}

      {step === 'warn' && (
        <div style={notice('#f59e0b')}>
          {warnings.map(w => MESSAGES[w]).join(' ')} You can retake it, or read it anyway and check the details closely.
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" style={button} onClick={readAnyway}>Use anyway</button>
            <label style={button}>
              <Camera size={16} /> Retake
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} data-testid="capture-retake" />
            </label>
          </div>
        </div>
      )}

      {step === 'reading' && (
        <p style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }} role="status">
          <Loader size={16} className="animate-spin" /> Reading the card…
        </p>
      )}

      {step === 'failed' && failure && (
        <div role="alert" style={notice('#ef4444')}>
          {READ_ERRORS[failure.error] ?? 'Something went wrong reading the card.'}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {failure.retryable && (
              <button type="button" style={button} onClick={() => read(prepared.image, operationId)}>
                <RotateCcw size={16} /> Try again
              </button>
            )}
            {failure.error === 'no_text' && (
              <button type="button" style={button} onClick={enterByHand}><PencilLine size={16} /> Enter details</button>
            )}
            <label style={button}>
              <Camera size={16} /> New photo
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} data-testid="capture-new-photo" />
            </label>
          </div>
        </div>
      )}

      {step === 'review' && (
        <>
          {readStatus === 'unreadable' && <div style={notice('#f59e0b')}>Nothing usable could be read from this card. Enter the details below, or take another photo.</div>}
          {readStatus === 'partial' && <div style={notice('#f59e0b')}>Only some details could be read. Fill in what is missing.</div>}
          <p style={muted}>Check each detail against the card and correct anything that is wrong.</p>
          <CaptureReview
            people={people}
            onChange={(index, next) => setPeople(list => list.map((p, i) => (i === index ? next : p)))}
            T={T}
          />
          {renderActions
            ? renderActions({ people, setPeople, startOver })
            : <p style={muted}>Saving from this screen is not switched on yet.</p>}
          <button type="button" style={{ ...button, alignSelf: 'flex-start' }} onClick={startOver}>
            <RotateCcw size={16} /> Start over with a new photo
          </button>
        </>
      )}
    </div>
  );
}
