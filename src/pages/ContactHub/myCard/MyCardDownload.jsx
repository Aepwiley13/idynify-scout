/**
 * MyCardDownload — "Download contact" and "Download card image", under the card they download.
 *
 * Two copies of the card as the preview shows it: a contact file, to put in a phone
 * or an address book, and a picture, to keep or send. They sit with the preview, not
 * the Save bar, because that is what they are, and each says that it does not save
 * anything to IDYNIFY. They are independent: either works without the other, and a
 * picture being made does not hold up the contact file. Whether each can be done and
 * what to tell the person afterwards come from the page; the words are in
 * downloadContact.js and cardImageDownload.js.
 */
import { useCallback } from 'react';
import { Download, Image as ImageIcon } from 'lucide-react';
import { DOWNLOAD_CONTACT } from './downloadContact';
import { DOWNLOAD_IMAGE } from './cardImageDownload';

/**
 * @param {object} props
 * @param {boolean} props.available  there is a name to give a contact
 * @param {() => void} props.onDownload
 * @param {null | { status: 'downloaded'|'failed'|'unavailable', message: string|null }} [props.feedback]
 *   the answer to the last click, while the card is still as it was then
 * @param {object} [props.image]  the card image: { available, busy, onDownload, feedback, pictureUrl, onClosePicture }
 * @param {boolean} [props.merged]  one line of help for both buttons (with sharing, where the card on screen is the one downloaded)
 */
export default function MyCardDownload({ available, onDownload, feedback = null, image = null, merged = false }) {
  // The answer can land below the Save bar's edge on a phone: bring it into view as it appears.
  const bringIntoView = useCallback((element) => { element?.scrollIntoView?.({ block: 'nearest' }); }, []);
  return (
    <section className="mycard-download" aria-labelledby="mycard-download-heading">
      <h2 id="mycard-download-heading" className="mycard-sr">{image ? 'Download your card' : 'Download your contact'}</h2>
      <div className="mycard-download-actions">
        <button
          type="button"
          className="mycard-btn mycard-btn--secondary"
          disabled={!available}
          aria-describedby={merged ? 'mycard-download-merged mycard-download-hint' : 'mycard-download-note mycard-download-hint'}
          onClick={onDownload}
        >
          <Download size={18} aria-hidden="true" />
          <span>{DOWNLOAD_CONTACT.label}</span>
        </button>
        {image ? (
          <button
            type="button"
            className="mycard-btn mycard-btn--secondary"
            disabled={!image.available || image.busy}
            aria-busy={image.busy ? 'true' : undefined}
            aria-describedby={merged ? 'mycard-download-merged mycard-download-hint' : 'mycard-download-image-note mycard-download-hint'}
            onClick={image.onDownload}
          >
            <ImageIcon size={18} aria-hidden="true" />
            <span>{DOWNLOAD_IMAGE.label}</span>
          </button>
        ) : null}
      </div>
      {merged ? (
        <p id="mycard-download-merged" className="mycard-download-note">Downloads use the card shown above. They don&apos;t save your edits.</p>
      ) : (
        <>
          <p id="mycard-download-note" className="mycard-download-note">{DOWNLOAD_CONTACT.note}</p>
          {image ? <p id="mycard-download-image-note" className="mycard-download-note">{DOWNLOAD_IMAGE.note}</p> : null}
        </>
      )}
      <p id="mycard-download-hint" className="mycard-download-note" hidden={available}>{available ? '' : DOWNLOAD_CONTACT.noName}</p>
      {feedback && feedback.status === 'downloaded' ? (
        <p ref={bringIntoView} className="mycard-download-feedback" role="status">
          Contact file downloaded.{feedback.message ? ` ${feedback.message}` : ''}
        </p>
      ) : null}
      {feedback && feedback.status === 'failed' ? (
        <p ref={bringIntoView} className="mycard-download-feedback mycard-download-feedback--error" role="alert">{feedback.message}</p>
      ) : null}
      {image && image.busy ? (
        <p className="mycard-download-feedback" role="status">{DOWNLOAD_IMAGE.preparing}</p>
      ) : null}
      {image && !image.busy && image.feedback && (image.feedback.status === 'downloaded' || image.feedback.status === 'shared') ? (
        <p ref={bringIntoView} className="mycard-download-feedback" role="status">{image.feedback.message}</p>
      ) : null}
      {image && !image.busy && image.feedback && (image.feedback.status === 'failed' || image.feedback.status === 'unavailable') ? (
        <p ref={bringIntoView} className="mycard-download-feedback mycard-download-feedback--error" role="alert">{image.feedback.message}</p>
      ) : null}
      {image && !image.busy && image.feedback && image.feedback.status === 'fallback' && image.pictureUrl ? (
        <div ref={bringIntoView} className="mycard-download-picture">
          <p className="mycard-download-feedback" role="status">{image.feedback.message}</p>
          <img className="mycard-download-picture-img" src={image.pictureUrl} alt="Your card image" />
          <button type="button" className="mycard-linkbtn" onClick={image.onClosePicture}>Close picture</button>
        </div>
      ) : null}
    </section>
  );
}
