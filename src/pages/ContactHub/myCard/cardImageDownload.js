/**
 * My Card — "Download card image": what to say, and getting the picture to the person.
 *
 * The picture is made by renderCardImage (cardImage.js): the card as the preview
 * shows it right now, an unsaved draft included, with only what is Shared. This
 * module makes no picture of its own. It decides how the finished PNG reaches the
 * device, and what to tell the person.
 *
 *   a phone or tablet that can share a file   the native share sheet (Save Image, Add to
 *                                             Photos, Messages, Mail, Files…)
 *   anything else                             a plain download of "Name_card.png"
 *   a browser that will not start the         the picture itself, on the page, with the
 *   download                                  words for saving it by hand (press and hold)
 *
 * A person who closes the share sheet without choosing anything has not failed:
 * nothing is said. A share that is refused for any other reason falls back to the
 * download, so the picture is never lost to a browser quirk.
 *
 * Like Download contact, it is a file on the person's own device and nothing
 * else: no database is read or written, no network call is made, the card is not
 * saved, and sharing is not touched. Nothing is logged. The share sheet is given
 * the file and nothing else (no title, no text), so no name or detail is in what
 * is shared except the picture and its safe file name. This module imports
 * nothing that could do any of that, and a test holds it to that.
 */
import { renderCardImage } from './cardImage';
import { previewOf } from './cardDraft';
import { THEMES } from '../../../theme/tokens';

/** The words, in one place so the button, its note and its messages cannot drift. */
export const DOWNLOAD_IMAGE = Object.freeze({
  label: 'Download card image',
  note: 'Saves a picture of the card shown in the preview. This does not save your changes to IDYNIFY.',
  noName: 'Add your name to make a card image.',
  preparing: 'Preparing your card image…',
  downloaded: 'Card image downloaded.',
  shared: 'Card image shared.',
  failed: 'We couldn\'t make the card image. Try again.',
  fallback: 'Your browser wouldn\'t start the download. Press and hold the picture, then choose Save Image or Add to Photos.',
});

const PNG = 'image/png';

/** The theme the page is showing, as the renderer knows it: the app's dark themes are dark, the rest light. */
export function currentCardTheme(doc = typeof document === 'undefined' ? null : document) {
  const id = doc?.documentElement?.getAttribute?.('data-theme');
  return THEMES[id]?.isDark === true ? 'dark' : 'light';
}

/** What the real browser can do. Replaceable, so every branch can be tested. */
export const browserDelivery = Object.freeze({
  makeFile: (blob, name) => new File([blob], name, { type: PNG }),
  /** A phone or tablet (a coarse pointer). A desktop browser that can also share files still just downloads. */
  prefersShareSheet: () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
  canShareFile: (file) => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] }) === true,
  share: (file) => navigator.share({ files: [file] }),
  /** Hands a blob to the browser as a download. Throws when it cannot. The temporary address is let go after the click. */
  saveBlob(blob, fileName, { revokeAfterMs = 1000 } = {}) {
    const url = window.URL.createObjectURL(blob);
    let link = null;
    try {
      link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
    } finally {
      if (link?.parentNode) link.parentNode.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), revokeAfterMs);
    }
  },
});

/**
 * Whether there is anything to make a picture of: the card needs a name, as for the contact file.
 * @returns {{ available: boolean }}
 */
export const imageDownloadState = (card) => ({ available: previewOf(card) !== null });

/**
 * Makes the picture of the card as it is NOW and delivers it.
 *
 * @param {object} card  the draft's card; only its Shared fields are ever drawn (cardImage.js)
 * @returns {Promise<
 *   { status: 'downloaded', fileName: string, message: string }
 * | { status: 'shared', fileName: string, message: string }
 * | { status: 'canceled', message: null }
 * | { status: 'fallback', fileName: string, blob: Blob, message: string }
 * | { status: 'unavailable', message: string }
 * | { status: 'failed', message: string }>}
 *   never rejects; `message` is words for the person
 */
export async function downloadCardImage(card, { theme = currentCardTheme(), render = renderCardImage, delivery = browserDelivery } = {}) {
  if (!imageDownloadState(card).available) return { status: 'unavailable', message: DOWNLOAD_IMAGE.noName };

  let made;
  try {
    made = await render(card, { theme });
  } catch {
    return { status: 'failed', message: DOWNLOAD_IMAGE.failed };
  }
  if (!made?.ok) return { status: 'failed', message: DOWNLOAD_IMAGE.failed };

  const { blob, fileName } = made;
  try {
    const file = delivery.makeFile(blob, fileName);
    if (delivery.prefersShareSheet() && delivery.canShareFile(file)) {
      try {
        await delivery.share(file);
        return { status: 'shared', fileName, message: DOWNLOAD_IMAGE.shared };
      } catch (error) {
        // Closing the sheet is a choice, not a failure. Anything else (a browser that wants a fresher tap, say) is the download's turn.
        if (error?.name === 'AbortError') return { status: 'canceled', message: null };
      }
    }
  } catch {
    // The share check itself failed: download instead.
  }

  try {
    delivery.saveBlob(blob, fileName);
    return { status: 'downloaded', fileName, message: DOWNLOAD_IMAGE.downloaded };
  } catch {
    return { status: 'fallback', fileName, blob, message: DOWNLOAD_IMAGE.fallback };
  }
}
