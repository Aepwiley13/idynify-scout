/**
 * MyCardDownload — "Download contact", under the card it downloads.
 *
 * A contact file for the card as the preview shows it, to put in a phone or an
 * address book. It sits with the preview, not the Save bar, because that is
 * what it is: a copy of the preview, and it says so, and says that it does not
 * save anything to IDYNIFY. Whether it can be done and what to tell the
 * person afterwards come from the page; the words are in downloadContact.js.
 */
import { useCallback } from 'react';
import { Download } from 'lucide-react';
import { DOWNLOAD_CONTACT } from './downloadContact';

/**
 * @param {object} props
 * @param {boolean} props.available  there is a name to give a contact
 * @param {() => void} props.onDownload
 * @param {null | { status: 'downloaded'|'failed'|'unavailable', message: string|null }} [props.feedback]
 *   the answer to the last click, while the card is still as it was then
 */
export default function MyCardDownload({ available, onDownload, feedback = null }) {
  // The answer can land below the Save bar's edge on a phone: bring it into view as it appears.
  const bringIntoView = useCallback((element) => { element?.scrollIntoView?.({ block: 'nearest' }); }, []);
  return (
    <section className="mycard-download" aria-labelledby="mycard-download-heading">
      <h2 id="mycard-download-heading" className="mycard-sr">Download your contact</h2>
      <button
        type="button"
        className="mycard-btn mycard-btn--secondary"
        disabled={!available}
        aria-describedby="mycard-download-note mycard-download-hint"
        onClick={onDownload}
      >
        <Download size={18} aria-hidden="true" />
        <span>{DOWNLOAD_CONTACT.label}</span>
      </button>
      <p id="mycard-download-note" className="mycard-download-note">{DOWNLOAD_CONTACT.note}</p>
      <p id="mycard-download-hint" className="mycard-download-note" hidden={available}>{available ? '' : DOWNLOAD_CONTACT.noName}</p>
      {feedback && feedback.status === 'downloaded' ? (
        <p ref={bringIntoView} className="mycard-download-feedback" role="status">
          Contact file downloaded.{feedback.message ? ` ${feedback.message}` : ''}
        </p>
      ) : null}
      {feedback && feedback.status === 'failed' ? (
        <p ref={bringIntoView} className="mycard-download-feedback mycard-download-feedback--error" role="alert">{feedback.message}</p>
      ) : null}
    </section>
  );
}
