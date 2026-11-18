/**
 * MyCardPhoto — the photo part of the My Card form.
 *
 *   Upload photo      the first and main action: the device's own file picker
 *                     (a phone offers its camera and library), then the crop
 *                     dialog (PhotoCropDialog), then the photo is the card's
 *                     photo, as an unsaved edit like any other.
 *   Use my LinkedIn   second, when the account has a LinkedIn picture to offer.
 *   Remove photo      asks first: "Remove your photo?" with the way back.
 *   Advanced          the old way, pasting a link, is in here. It opens by itself
 *                     when the link needs attention (a message about it, a value
 *                     the card refuses, a picture that did not load).
 *
 * The Shared / Private switch is the card's, unchanged: a private photo is as
 * absent from what people see whether it was uploaded or linked.
 *
 * A controlled part of a controlled form: it shows the card it is given and
 * reports with onEdit / onShare / onUseSuggestion. It reads and writes nothing
 * and calls no service. A photo made here is only ever handed to onEdit, so it
 * is kept, restored, saved, conflicted and discarded exactly as the draft is.
 *
 * NEVER A PICTURE AS TEXT. An uploaded photo is a very long string; it is shown
 * as the photo, and never in a box, a label, a message or an announcement.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronDown, ChevronUp, Linkedin, Sparkles } from 'lucide-react';
import CardAvatar from './CardAvatar';
import ShareToggle from './ShareToggle';
import PhotoCropDialog from './PhotoCropDialog';
import { FIELD_META } from './cardDraft';
import { cardInitials, isPhotoPicture, normalizeCardField } from '../../../utils/myCardRules';
import { prepareProfilePhoto } from '../../../utils/photoPrep';

/** How long an announcement stays: long enough to be read out, then gone so it cannot go stale. */
const ANNOUNCE_MS = 6000;

/**
 * @param {object} props
 * @param {object} props.card
 * @param {string} [props.message]  the card's message about the photo (a refused link)
 * @param {{ text: string, source: string } | null} [props.suggestion]  a photo on offer (LinkedIn's)
 * @param {(field: string, value: string) => void} props.onEdit
 * @param {(field: string) => void} props.onBlur
 * @param {(field: string, shared: boolean) => void} props.onShare
 * @param {() => void} [props.onUseSuggestion]
 * @param {boolean} [props.disabled]
 * @param {typeof prepareProfilePhoto} [props.preparePhoto]  replaceable for tests
 */
export default function MyCardPhoto({
  card, message, suggestion = null, onEdit, onBlur, onShare, onUseSuggestion, disabled = false, preparePhoto = prepareProfilePhoto,
}) {
  const meta = FIELD_META.photoUrl;
  const base = useId();
  const linkId = `${base}-link`;
  const messageId = `${linkId}-message`;
  const advancedId = `${base}-advanced`;

  const fileInput = useRef(null);
  const uploadButton = useRef(null);
  const removeButton = useRef(null);
  const keepButton = useRef(null);
  const focusLinkWhenShown = useRef(false);
  const focusUploadAfter = useRef(false);

  const [picked, setPicked] = useState(null);          // the File being cropped
  const [confirming, setConfirming] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  const photoText = card.photoUrl ?? '';
  const validPhoto = normalizeCardField('photoUrl', photoText).value;
  const hasPhoto = photoText.trim() !== '';
  const hasGoodPhoto = hasPhoto && validPhoto !== '';
  const isPicture = isPhotoPicture(photoText);
  const photoProblem = failedPhoto !== null && failedPhoto === validPhoto;

  // The link opens by itself when it needs attention, once; after that it is the person's to close.
  const needsAttention = Boolean(message) || photoProblem || (hasPhoto && !hasGoodPhoto && !isPicture);
  const [attentionSeen, setAttentionSeen] = useState(false);
  if (needsAttention !== attentionSeen) {
    // Adjusted while rendering, so the link is never a step behind the thing that needs attention.
    setAttentionSeen(needsAttention);
    if (needsAttention) setAdvanced(true);
  }

  // An announcement for a screen reader, which goes away rather than going stale.
  useEffect(() => {
    if (!announcement) return undefined;
    const timer = setTimeout(() => setAnnouncement(''), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

  // Focus returns to where the person was: the Upload button after the dialog, "Remove photo" after "Keep".
  useEffect(() => {
    if (picked === null && focusUploadAfter.current) {
      focusUploadAfter.current = false;
      uploadButton.current?.focus();
    }
  }, [picked]);
  useEffect(() => { if (confirming) keepButton.current?.focus(); }, [confirming]);

  const chooseFile = () => fileInput.current?.click();

  function onFileChosen(event) {
    const [file] = event.target.files ?? [];
    // Reset, so choosing the same file again still counts.
    event.target.value = '';
    if (file) setPicked(file);
  }

  function closeDialog() {
    focusUploadAfter.current = true;
    setPicked(null);
  }

  function usePicture(dataUrl) {
    onEdit('photoUrl', dataUrl);
    setAnnouncement('Photo added. It is not saved until you press Save.');
    closeDialog();
  }

  function removePhoto() {
    onEdit('photoUrl', '');
    setConfirming(false);
    setAnnouncement('Photo removed. It is not saved until you press Save.');
    // The button that was pressed is gone: put focus somewhere sensible.
    setTimeout(() => uploadButton.current?.focus(), 0);
  }

  function toggleAdvanced() {
    if (!advanced) focusLinkWhenShown.current = true;
    setAdvanced((open) => !open);
  }

  const hint = photoProblem
    ? 'That link didn\'t load a picture, so your initials are used. Check the link, or leave it empty.'
    : (isPicture && hasGoodPhoto ? 'Your uploaded photo is in use. Paste a link to use that instead, or remove the photo.' : meta.hint);

  return (
    <div className="mycard-field mycard-field--photoUrl">
      <div className="mycard-photo-row">
        <CardAvatar photoUrl={validPhoto} initials={cardInitials(card)} size="lg" onPhotoFailed={setFailedPhoto} />
        <div className="mycard-photo-main">
          <div className="mycard-field-head">
            <span className="mycard-label">Photo</span>
            <ShareToggle
              label={meta.shareLabel}
              shared={card.share.photoUrl === true}
              onChange={(value) => onShare('photoUrl', value)}
              disabled={disabled}
            />
          </div>

          {confirming ? (
            <div className="mycard-photo-confirm" role="group" aria-labelledby={`${base}-confirm`}>
              <p id={`${base}-confirm`} className="mycard-photo-confirm-text">
                <strong>Remove your photo?</strong> People will see your initials instead. Nothing changes in your saved card until you press Save.
              </p>
              <div className="mycard-photo-confirm-actions">
                <button type="button" className="mycard-btn mycard-btn--danger" onClick={removePhoto}>Yes, remove it</button>
                <button ref={keepButton} type="button" className="mycard-btn mycard-btn--secondary" onClick={() => { setConfirming(false); setTimeout(() => removeButton.current?.focus(), 0); }}>
                  Keep my photo
                </button>
              </div>
            </div>
          ) : (
            <>
              <button ref={uploadButton} type="button" className="mycard-upload" disabled={disabled} onClick={chooseFile}>
                <Camera size={18} aria-hidden="true" />
                <span>Upload photo</span>
              </button>
              {suggestion && onUseSuggestion ? (
                <button type="button" className="mycard-suggest" disabled={disabled} onClick={onUseSuggestion}>
                  {suggestion.source === 'linkedin' ? <Linkedin size={16} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                  <span>{suggestion.text}</span>
                </button>
              ) : null}
              {hasPhoto ? (
                <div className="mycard-photo-actions">
                  <button ref={removeButton} type="button" className="mycard-linkbtn" disabled={disabled} onClick={() => setConfirming(true)}>
                    Remove photo
                  </button>
                </div>
              ) : (suggestion ? null : <p className="mycard-message">Add a photo so people recognize you.</p>)}
            </>
          )}

          <input
            ref={fileInput}
            className="mycard-sr"
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-label="Choose a photo from your device"
            disabled={disabled}
            onChange={onFileChosen}
          />
          <p className="mycard-sr" role="status" aria-live="polite">{announcement}</p>
        </div>
      </div>

      <div className="mycard-advanced">
        <button
          type="button"
          className="mycard-linkbtn mycard-advanced-toggle"
          aria-expanded={advanced}
          aria-controls={advancedId}
          disabled={disabled}
          onClick={toggleAdvanced}
        >
          <span>Advanced</span>
          {advanced ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
        {advanced ? (
          <div id={advancedId} className="mycard-field">
            <label htmlFor={linkId} className="mycard-label">{meta.linkLabel}</label>
            <input
              id={linkId}
              ref={(element) => {
                if (element && focusLinkWhenShown.current) { focusLinkWhenShown.current = false; element.focus(); }
              }}
              className="mycard-input"
              type={meta.type}
              inputMode={meta.inputMode}
              autoComplete={meta.autoComplete}
              placeholder={meta.placeholder}
              // A picture is never shown as text, or put in a box.
              value={isPicture ? '' : photoText}
              disabled={disabled}
              aria-invalid={message ? 'true' : undefined}
              aria-describedby={message || hint ? messageId : undefined}
              spellCheck={false}
              autoCapitalize="none"
              onChange={(event) => onEdit('photoUrl', event.target.value)}
              onBlur={() => onBlur('photoUrl')}
            />
            {message ? (
              <p id={messageId} className="mycard-message mycard-message--error" role="alert">{message}</p>
            ) : hint ? (
              <p id={messageId} className="mycard-message">{hint}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {picked ? createPortal(
        <PhotoCropDialog
          file={picked}
          onCancel={closeDialog}
          onUse={usePicture}
          onChooseAnother={() => { closeDialog(); chooseFile(); }}
          preparePhoto={preparePhoto}
        />,
        document.body,
      ) : null}
    </div>
  );
}
