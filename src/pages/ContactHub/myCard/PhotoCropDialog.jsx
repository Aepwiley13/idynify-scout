/**
 * PhotoCropDialog — position and zoom a picture, then use it as the photo.
 *
 * Opened with a File the person picked. It does NO image processing of its
 * own: the first thing it does is ask the photo utility (utils/photoPrep.js)
 * to prepare the picture as it is, which is also how an unusable file is found
 * (a damaged one, a kind the browser cannot open, one too small) before any
 * cropping is offered. The crop it shows is drawn from the utility's own
 * cropRect, so what is on screen is what is made. "Use photo" asks the utility
 * for the photo with the chosen crop (or reuses the first result if the
 * picture was not moved).
 *
 * THE CROP is a centre (x, y, as fractions of the picture) and a zoom, as the
 * utility defines them. Dragging, a pinch, the wheel, the arrow keys, + and -,
 * the buttons and the slider all just change those three numbers.
 *
 * KEYBOARD: the picture area is a stop in the Tab order. Arrow keys move the
 * picture (Shift: further), + and - zoom, 0 puts it back. The zoom slider and
 * the buttons are ordinary controls. Escape cancels. Tab stays inside.
 *
 * NEVER the picture as text: nothing here shows, labels, announces or logs the
 * data. Failures are one of the utility's plain messages.
 *
 * The picture shown while cropping is a temporary local address for the file
 * (a blob URL, given back when the dialog closes). Nothing is sent anywhere.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import {
  DEFAULT_CROP, PHOTO, PHOTO_ERRORS, PHOTO_MESSAGES, cropRect, normalizeCrop, prepareProfilePhoto,
} from '../../../utils/photoPrep';

const ZOOM_STEP = 0.25;
const KEY_STEP = 0.05;          // of the square's side
const KEY_STEP_BIG = 0.2;
// A square this size when the layout cannot be measured (the page has not been laid out).
const FALLBACK_SIZE = 300;

const isDefaultCrop = (crop) => crop.x === DEFAULT_CROP.x && crop.y === DEFAULT_CROP.y && crop.zoom === DEFAULT_CROP.zoom;
const messageFor = (error) => PHOTO_MESSAGES[error?.code] ?? PHOTO_MESSAGES[PHOTO_ERRORS.ENCODE_FAILED];
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex="0"]';

/** The crop with its centre taken from where the square really is, so a crop pushed against an edge stays there. */
function settled(width, height, crop) {
  const { sx, sy, side } = cropRect(width, height, crop);
  return normalizeCrop({ x: (sx + side / 2) / width, y: (sy + side / 2) / height, zoom: normalizeCrop(crop).zoom });
}

/**
 * @param {object} props
 * @param {File|Blob} props.file
 * @param {() => void} props.onCancel
 * @param {(dataUrl: string) => void} props.onUse  the finished photo; the dialog does not close itself
 * @param {() => void} [props.onChooseAnother]  offered when the file cannot be used
 * @param {typeof prepareProfilePhoto} [props.preparePhoto]  replaceable for tests
 */
export default function PhotoCropDialog({ file, onCancel, onUse, onChooseAnother, preparePhoto = prepareProfilePhoto }) {
  const titleId = useId();
  const helpId = useId();
  const dialog = useRef(null);
  const viewport = useRef(null);
  const alive = useRef(true);
  // Read when it is needed, so a parent that passes a new function every render cannot restart the dialog.
  const prepare = useRef(preparePhoto);
  useEffect(() => { prepare.current = preparePhoto; });

  const [objectUrl, setObjectUrl] = useState(null);
  const [natural, setNatural] = useState(null);                 // { width, height } of the picture as shown
  const [check, setCheck] = useState({ status: 'checking' });   // checking | ready { result } | failed { error }
  const [crop, setCrop] = useState(DEFAULT_CROP);
  const [busy, setBusy] = useState(false);
  const [useError, setUseError] = useState(null);

  // The picture to show while cropping: a local address, given back on close.
  useEffect(() => {
    const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
    setObjectUrl(url);
    return () => { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url); };
  }, [file]);

  // The first look: is this a picture that can be used at all? Also the answer if it is not moved.
  useEffect(() => {
    alive.current = true;
    setCheck({ status: 'checking' });
    setNatural(null);
    setCrop(DEFAULT_CROP);
    setUseError(null);
    prepare.current(file).then(
      (result) => { if (alive.current) setCheck({ status: 'ready', result }); },
      (error) => { if (alive.current) setCheck({ status: 'failed', error }); },
    );
    return () => { alive.current = false; };
  }, [file]);

  // Keep the page behind from scrolling, and give it back.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = before; };
  }, []);

  // Focus goes into the dialog, onto the picture once there is one to move.
  const ready = check.status === 'ready' && natural !== null;
  useEffect(() => {
    if (ready) viewport.current?.focus();
    else dialog.current?.focus();
  }, [ready, check.status]);

  const change = useCallback((next) => {
    setUseError(null);
    setCrop((current) => {
      const target = typeof next === 'function' ? next(current) : next;
      return natural ? settled(natural.width, natural.height, target) : normalizeCrop(target);
    });
  }, [natural]);

  const zoomBy = useCallback((delta) => change((current) => ({ ...current, zoom: current.zoom + delta })), [change]);
  const zoomByFactor = useCallback((factor) => change((current) => ({ ...current, zoom: current.zoom * factor })), [change]);

  /** Moves the picture by this much of the square's side, in the direction it is dragged (so the centre goes the other way). */
  const nudge = useCallback((dx, dy) => change((current) => {
    if (!natural) return current;
    const { side } = cropRect(natural.width, natural.height, current);
    return { ...current, x: current.x - (dx * side) / natural.width, y: current.y - (dy * side) / natural.height };
  }), [change, natural]);

  // ── Dragging and pinching ────────────────────────────────────────────────
  const pointers = useRef(new Map());
  const drag = useRef(null);
  const pinch = useRef(null);

  const sizeOf = (element) => element.getBoundingClientRect().width || FALLBACK_SIZE;

  function beginDrag(element, point) {
    drag.current = { x: point.x, y: point.y, crop, size: sizeOf(element) };
  }

  function onPointerDown(event) {
    if (!ready || busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      beginDrag(event.currentTarget, { x: event.clientX, y: event.clientY });
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: crop.zoom };
      drag.current = null;
    }
  }

  function onPointerMove(event) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const { zoom } = pinch.current;
      change((current) => ({ ...current, zoom: zoom * (distance / pinch.current.distance) }));
    } else if (drag.current && natural) {
      const start = drag.current;
      const { side } = cropRect(natural.width, natural.height, start.crop);
      // The picture follows the pointer: `size` screen pixels show `side` picture pixels.
      const perPixel = side / start.size;
      change({
        ...start.crop,
        x: start.crop.x - ((event.clientX - start.x) * perPixel) / natural.width,
        y: start.crop.y - ((event.clientY - start.y) * perPixel) / natural.height,
      });
    }
  }

  function onPointerEnd(event) {
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pinch.current = null;
    // One finger left after a pinch carries on as a drag from where it is.
    const [rest] = [...pointers.current.values()];
    drag.current = rest ? { x: rest.x, y: rest.y, crop, size: sizeOf(event.currentTarget) } : null;
  }

  // The wheel zooms. It has to be a listener of its own: React's are passive, and this stops the page scrolling.
  useEffect(() => {
    const element = viewport.current;
    if (!element || !ready) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      zoomByFactor(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ready, zoomByFactor]);

  function onViewportKeyDown(event) {
    const step = event.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) { event.preventDefault(); nudge(...moves[event.key]); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(ZOOM_STEP); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(-ZOOM_STEP); }
    else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); change(DEFAULT_CROP); }
  }

  // ── The dialog's own keys: Escape leaves, Tab stays inside ───────────────
  function onDialogKeyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onCancel(); return; }
    if (event.key !== 'Tab') return;
    // In the order they are on the page, whatever order the browser lists a mixed selector's matches in.
    const stops = [...dialog.current.querySelectorAll(FOCUSABLE)]
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    if (stops.length === 0) { event.preventDefault(); dialog.current.focus(); return; }
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  // ── Use photo ────────────────────────────────────────────────────────────
  async function usePhoto() {
    if (busy || check.status !== 'ready') return;
    setBusy(true);
    setUseError(null);
    try {
      // Not moved: the first result is the photo. Moved: ask for it with the crop.
      const result = isDefaultCrop(crop) ? check.result : await prepare.current(file, { crop });
      if (alive.current) onUse(result.dataUrl);
    } catch (error) {
      if (alive.current) setUseError(messageFor(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const rect = natural ? cropRect(natural.width, natural.height, crop) : null;
  const imageStyle = rect ? {
    width: `${(natural.width / rect.side) * 100}%`,
    height: `${(natural.height / rect.side) * 100}%`,
    left: `${(-rect.sx / rect.side) * 100}%`,
    top: `${(-rect.sy / rect.side) * 100}%`,
  } : { visibility: 'hidden' };
  const zoomText = `${crop.zoom.toFixed(1)}×`;
  const failed = check.status === 'failed';

  return (
    <div className="mycard-crop-backdrop">
      <div
        ref={dialog}
        className="mycard-crop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <h2 id={titleId} className="mycard-crop-title">Crop your photo</h2>
        <p id={helpId} className="mycard-crop-help">
          {failed
            ? 'Choose another photo to carry on, or cancel.'
            : 'Drag the photo to move it. Use the slider or the + and − buttons to zoom. With a keyboard, use the arrow keys and + and −.'}
        </p>

        {failed ? (
          <div className="mycard-crop-failed" role="alert">
            <p className="mycard-message mycard-message--error">{PHOTO_MESSAGES[check.error?.code] ?? PHOTO_MESSAGES[PHOTO_ERRORS.DECODE_FAILED]}</p>
          </div>
        ) : (
          <>
            <div
              ref={viewport}
              className="mycard-crop-viewport"
              role="group"
              tabIndex={ready ? 0 : -1}
              aria-label="Photo position"
              aria-describedby={helpId}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onKeyDown={onViewportKeyDown}
            >
              {objectUrl ? (
                <img
                  className="mycard-crop-img"
                  src={objectUrl}
                  alt=""
                  draggable={false}
                  style={imageStyle}
                  onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                  onError={() => setCheck((current) => (current.status === 'failed' ? current : { status: 'failed', error: { code: PHOTO_ERRORS.DECODE_FAILED } }))}
                />
              ) : null}
              <span className="mycard-crop-guide" aria-hidden="true" />
            </div>

            <div className="mycard-crop-zoom">
              <button type="button" className="mycard-crop-iconbtn" aria-label="Zoom out" disabled={!ready || busy || crop.zoom <= 1} onClick={() => zoomBy(-ZOOM_STEP)}>
                <Minus size={20} aria-hidden="true" />
              </button>
              <input
                className="mycard-crop-slider"
                type="range"
                aria-label="Zoom"
                aria-valuetext={zoomText}
                min={1}
                max={PHOTO.MAX_ZOOM}
                step={0.05}
                value={crop.zoom}
                disabled={!ready || busy}
                onChange={(event) => change((current) => ({ ...current, zoom: Number(event.target.value) }))}
              />
              <button type="button" className="mycard-crop-iconbtn" aria-label="Zoom in" disabled={!ready || busy || crop.zoom >= PHOTO.MAX_ZOOM} onClick={() => zoomBy(ZOOM_STEP)}>
                <Plus size={20} aria-hidden="true" />
              </button>
              <button type="button" className="mycard-crop-iconbtn" aria-label="Put the photo back" disabled={!ready || busy || isDefaultCrop(crop)} onClick={() => change(DEFAULT_CROP)}>
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            </div>

            {check.status === 'checking' || (check.status === 'ready' && !natural) ? (
              <p className="mycard-message" role="status">Getting your photo ready…</p>
            ) : null}
            {useError ? <p className="mycard-message mycard-message--error" role="alert">{useError}</p> : null}
          </>
        )}

        <div className="mycard-crop-actions">
          {failed && onChooseAnother ? (
            <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onChooseAnother}>Choose another photo</button>
          ) : null}
          <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onCancel}>Cancel</button>
          {failed ? null : (
            <button type="button" className="mycard-btn mycard-btn--primary" disabled={!ready || busy} aria-busy={busy ? 'true' : undefined} onClick={usePhoto}>
              {busy ? 'Preparing…' : 'Use photo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
