import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isPlaceholderPhoto } from '../../../utils/contactPhoto';
import { isHttpsPhotoUrl } from '../../../utils/photoUrl';
import { Camera, ImagePlus, Link2, RotateCcw, Trash2, X } from 'lucide-react';
import PhotoCropDialog from '../../../pages/ContactHub/myCard/PhotoCropDialog';
import { photoFailureMessage, photoRefusalMessage } from './profileMessages';
import '../../../pages/ContactHub/myCard/MyCard.css';
import './photo-editor.css';

export default function ContactPhotoEditor({ currentPhoto, originalPhoto, overrideKind, saving, failure, onSave, onClose, clearError }) {
  const dialog = useRef(null);
  const camera = useRef(null);
  const library = useRef(null);
  const busy = useRef(false);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState(null);
  const [url, setUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [jpeg, setJpeg] = useState('');
  const [refusal, setRefusal] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    if (file) return undefined;
    const element = dialog.current;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, [file]);

  function choose(next) {
    clearError();
    setRefusal('');
    setPreviewFailed(false);
    setPreviewUrl('');
    setMode(next);
  }

  function picked(event) {
    const [chosen] = event.target.files ?? [];
    event.target.value = '';
    if (chosen) setFile(chosen);
  }

  function previewLink() {
    const address = url.trim();
    const reason = !isHttpsPhotoUrl(address) ? 'not_https' : isPlaceholderPhoto(address) ? 'not_a_photo' : null;
    setRefusal(reason ? photoRefusalMessage(reason) : '');
    setPreviewFailed(false);
    setPreviewUrl(reason ? '' : address);
    return !reason;
  }

  async function save(event) {
    event.preventDefault();
    if (!mode || busy.current) return;
    if (mode === 'url' && (!previewUrl || previewUrl !== url.trim())) { previewLink(); return; }
    busy.current = true;
    try {
      const value = mode === 'restore' ? null : mode === 'url' ? { kind: 'url', url: url.trim() }
        : mode === 'upload' ? { kind: 'upload', jpeg } : { kind: 'hidden' };
      const result = await onSave(value);
      if (result.status === 'saved' || result.status === 'unchanged') onClose(true);
      if (result.status === 'refused') setRefusal(photoRefusalMessage(result.reason));
    } finally {
      busy.current = false;
    }
  }

  if (file) return createPortal(<PhotoCropDialog file={file} onCancel={() => setFile(null)} onUse={(data) => {
    setJpeg(data);
    choose('upload');
    setFile(null);
  }} />, document.body);

  const canRestore = Boolean(originalPhoto && overrideKind);
  const preview = mode === 'upload' ? jpeg : mode === 'url' ? previewUrl
    : mode === 'restore' ? originalPhoto : !mode && currentPhoto;
  const photoStatus = overrideKind === 'hidden' ? 'Photo hidden' : overrideKind ? 'Custom photo' : currentPhoto ? 'Original photo' : 'No photo';
  const caption = mode === 'upload' || mode === 'url' ? 'Preview' : mode === 'restore' ? 'Original photo' : photoStatus;
  return createPortal(
    <dialog ref={dialog} className="cp-photo-editor" aria-label="Contact photo" onCancel={(event) => {
      event.preventDefault();
      if (!busy.current) onClose(true);
    }}>
      <form onSubmit={save}>
        <header><h2>Contact photo</h2><button type="button" aria-label="Close photo editor" disabled={saving} onClick={() => onClose(true)}><X size={19} /></button></header>
        {preview && !previewFailed && <figure className="cp-photo-preview">
          <img src={preview} alt="Contact photo preview" onError={() => setPreviewFailed(true)} /><figcaption>{caption}</figcaption>
        </figure>}
        {!mode && !currentPhoto && <p>{photoStatus}</p>}
        {previewFailed && <p>Preview unavailable. Check the photo or choose another.</p>}
        <div className="cp-photo-choices">
          <button type="button" disabled={saving} onClick={() => camera.current.click()}><Camera size={19} /> Take a photo</button>
          <button type="button" disabled={saving} onClick={() => library.current.click()}><ImagePlus size={19} /> Choose a photo</button>
          <button type="button" disabled={saving} onClick={() => choose('url')}><Link2 size={19} /> Use a photo URL</button>
          {(currentPhoto || mode === 'hidden') && <button type="button" disabled={saving} onClick={() => choose('hidden')}><Trash2 size={19} /> Remove photo</button>}
          {(canRestore || mode === 'restore') && <button type="button" disabled={saving} onClick={() => choose('restore')}><RotateCcw size={19} /> Restore original photo</button>}
        </div>
        <input hidden type="file" accept="image/*" capture="environment" aria-label="Camera photo" ref={camera} onChange={picked} />
        <input hidden type="file" accept="image/*" aria-label="Device photo" ref={library} onChange={picked} />
        {mode === 'url' && <label>Photo URL <input type="text" inputMode="url" value={url} disabled={saving} placeholder="https://" maxLength={2000}
          onChange={(event) => { setUrl(event.target.value); setPreviewUrl(''); setPreviewFailed(false); setRefusal(''); clearError(); }} />
          <button type="button" disabled={saving} onClick={previewLink}>Preview link</button></label>}
        {mode === 'hidden' && <p>Save to remove the photo.{originalPhoto && ' The original stays available to restore.'}</p>}
        {mode === 'restore' && <p>Save to show the original photo.</p>}
        {(refusal || failure) && <p role="alert">{refusal || photoFailureMessage(failure)}</p>}
        <footer><button type="button" disabled={saving} onClick={() => onClose(true)}>Cancel</button>
          <button className="cp-photo-save" type="submit" disabled={!mode || saving}>{saving ? 'Saving…' : 'Save photo'}</button></footer>
      </form>
    </dialog>, document.body,
  );
}
