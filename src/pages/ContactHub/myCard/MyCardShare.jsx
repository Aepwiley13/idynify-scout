/**
 * MyCardShare — Share, Scan, Save: the action area under the card (MY-CARD-SHARE-001).
 *
 *   Card live      "Your card is live" · Manage, then one big Share My Card button (the device's share sheet;
 *                  Copy Link where there is none), a row of Show QR · Copy Link · Edit Card, and a quiet
 *                  View my card link. Manage sharing holds Turn sharing off and Reset link, and says plainly
 *                  what cannot be recalled.
 *   Card not live  The same place, one primary button: Turn on sharing. It opens a short sheet: what people
 *                  will see, what stays private, any one-tap fixes, and Publish my card. Nothing is
 *                  published until that button is pressed.
 *
 * It holds no card and no rules. The page passes in what the card is and what each button does; the words
 * and the public link are built here from the public ID only. Nothing here reads a private field: the sheet
 * lists what people will see from the same privacy rule as the preview (previewOf), and what is kept
 * private by label.
 *
 * ACCESSIBLE: every control is a real button of at least 44px; dialogs trap Tab, close on Escape, name
 * themselves, and return focus to what opened them; a result is announced (role="status"/"alert").
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Copy, ExternalLink, Pencil, QrCode, RotateCcw, Share2, Power, Download, X,
} from 'lucide-react';
import { previewOf, unsharedFields } from './cardDraft';
import { cardLinkUrl, shareCard, copyText, shareOrigin, SHARE_FEEDBACK } from './shareLink';
import { publishGate } from '../../../utils/myCardRules';
import { QR_SURFACE, qrFileName, qrPngDataUrl } from './cardQr';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]';

/** What the person must be told they cannot take back. Also shown in Manage sharing. */
const CANNOT_RECALL = Object.freeze([
  'A contact someone already saved stays on their phone.',
  'A link preview already shown in a message stays in that conversation. Slack, LinkedIn and Facebook keep their own copies as long as they choose.',
  'Screenshots and downloaded card images can\'t be recalled.',
  'Reset link stops old links and QR codes working. It doesn\'t recall copies that were already saved.',
]);

const FIELD_LABEL = Object.freeze({
  email: 'email', phone: 'phone number', linkedinUrl: 'LinkedIn', instagram: 'Instagram', website: 'website', firstName: 'name',
});

/** A modal: named, Escape closes, Tab stays inside, focus returns to what opened it. */
function Dialog({ title, onClose, children, tone = 'sheet', describedBy }) {
  const titleId = useId();
  const box = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const first = box.current?.querySelector(FOCUSABLE);
    first?.focus?.();
    return () => { if (opener && document.contains(opener)) opener.focus?.(); };
  }, []);
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const items = [...box.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className={`mycard-crop-backdrop mycard-dialog-backdrop--${tone}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={box} className={`mycard-crop mycard-dialog mycard-dialog--${tone}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="mycard-crop-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The full-screen QR code: white, black code, the owner's name above it. */
function QrScreen({ url, name, onClose }) {
  const [png, setPng] = useState(null);
  const [failed, setFailed] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    let alive = true;
    qrPngDataUrl(url, 1024).then((value) => { if (alive) setPng(value); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);
  useEffect(() => {
    const opener = document.activeElement;
    box.current?.querySelector('button')?.focus?.();
    return () => { if (opener && document.contains(opener)) opener.focus?.(); };
  }, []);
  const download = () => {
    if (!png) return;
    const link = document.createElement('a');
    link.href = png;
    link.download = qrFileName(name);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  return (
    <div
      ref={box}
      className="mycard-qr"
      style={QR_SURFACE}
      role="dialog"
      aria-modal="true"
      aria-label={`QR code for ${name || 'my card'}`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}
    >
      <button type="button" className="mycard-qr-close mycard-btn mycard-btn--secondary" onClick={onClose}>
        <X size={18} aria-hidden="true" /><span>Close</span>
      </button>
      <div className="mycard-qr-body">
        {name ? <p className="mycard-qr-name">{name}</p> : null}
        {png ? <img className="mycard-qr-img" src={png} alt={`QR code that opens ${name ? `${name}'s` : 'your'} card`} /> : null}
        {!png && !failed ? <p className="mycard-qr-note" role="status">Making your QR code…</p> : null}
        {failed ? <p className="mycard-qr-note" role="alert">Couldn&apos;t make the QR code. Close this and try again.</p> : null}
        <p className="mycard-qr-note">Point a phone camera at this code.</p>
        <button type="button" className="mycard-btn mycard-btn--secondary" onClick={download} disabled={!png}>
          <Download size={18} aria-hidden="true" /><span>Download QR</span>
        </button>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.card        the draft's card (what the preview shows)
 * @param {{ live: boolean, publicId: string|null }} props.sharing
 * @param {null | 'publish'|'unpublish'|'reset'} props.busy
 * @param {null | { message: string, reload?: boolean }} props.error
 * @param {boolean} props.dirty      the draft has unsaved changes
 * @param {() => Promise<object>} props.onPublish   saves first when there are unsaved changes, then publishes
 * @param {() => Promise<object>} props.onUnpublish
 * @param {() => Promise<object>} props.onReset
 * @param {(field: string) => void} props.onTurnOn  turn a field's switch on (a one-tap fix)
 * @param {() => void} props.onEditCard
 * @param {() => void} [props.onReload]
 * @param {() => void} [props.onDismissError]
 * @param {string} [props.origin]    for tests
 */
export default function MyCardShare({
  card, sharing, busy = null, error = null, dirty = false,
  onPublish, onUnpublish, onReset, onTurnOn, onEditCard, onReload, onDismissError, origin,
}) {
  const [sheet, setSheet] = useState(null); // null | 'publish' | 'reset' | 'off'
  const [qr, setQr] = useState(false);
  const [toast, setToast] = useState(null);
  const view = previewOf(card);
  const name = view?.name ?? '';
  const url = cardLinkUrl(sharing.publicId, origin ?? shareOrigin());
  const live = sharing.live && Boolean(url);
  const working = busy !== null;
  const timer = useRef(null);

  const say = useCallback((message) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const share = async () => {
    const result = await shareCard({ url, name });
    if (result.status === 'copied') say(SHARE_FEEDBACK.copied);
    else if (result.status === 'failed') say(SHARE_FEEDBACK.copyFailed);
  };
  const copy = async () => say((await copyText(url)) ? SHARE_FEEDBACK.copied : SHARE_FEEDBACK.copyFailed);

  const publish = async () => {
    const result = await onPublish();
    if (result?.status === 'saved') { setSheet(null); say('Your card is live'); }
  };
  const turnOff = async () => {
    const result = await onUnpublish();
    if (result?.status === 'saved') { setSheet(null); say('Sharing is off. Your link is kept, so turning it back on restores it.'); }
  };
  const reset = async () => {
    const result = await onReset();
    if (result?.status === 'saved') { setSheet(null); say('New link ready. The old link and QR code no longer work.'); }
  };

  // The publish sheet is about the card as it stands in the editor (what Publish will save and publish).
  const gate = publishGate(card);
  const hidden = unsharedFields(card);
  const visible = view ? ['photoUrl', 'title', 'organization', 'email', 'phone', 'linkedinUrl', 'instagram', 'website']
    .filter((field) => view[field]).map((field) => ({ photoUrl: 'photo', title: 'title', organization: 'organization', email: 'email', phone: 'phone', linkedinUrl: 'LinkedIn', instagram: 'Instagram', website: 'website' }[field])) : [];
  const linkCount = view ? ['link1', 'link2', 'link3', 'link4', 'link5'].filter((slot) => view[slot]).length : 0;

  return (
    <section className="mycard-share-area" aria-labelledby="mycard-share-heading">
      <h2 id="mycard-share-heading" className="mycard-sr">Share your card</h2>

      {live ? (
        <>
          <p className="mycard-live" role="status">
            <span className="mycard-live-dot" aria-hidden="true" />
            <span>Your card is live</span>
            <button type="button" className="mycard-linkbtn" onClick={() => document.getElementById('mycard-manage')?.scrollIntoView?.({ block: 'center' })}>Manage</button>
          </p>
          <button type="button" className="mycard-btn mycard-btn--primary mycard-share-primary" disabled={working} onClick={share}>
            <Share2 size={20} aria-hidden="true" /><span>Share My Card</span>
          </button>
          <div className="mycard-share-row">
            <button type="button" className="mycard-btn mycard-btn--secondary" disabled={working} onClick={() => setQr(true)}>
              <QrCode size={18} aria-hidden="true" /><span>Show QR</span>
            </button>
            <button type="button" className="mycard-btn mycard-btn--secondary" disabled={working} onClick={copy}>
              <Copy size={18} aria-hidden="true" /><span>Copy Link</span>
            </button>
            <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onEditCard}>
              <Pencil size={18} aria-hidden="true" /><span>Edit Card</span>
            </button>
          </div>
          <a className="mycard-viewlink" href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" /><span>View my card</span>
          </a>
        </>
      ) : (
        <>
          <button type="button" className="mycard-btn mycard-btn--primary mycard-share-primary" disabled={working || !view} onClick={() => setSheet('publish')}>
            <Share2 size={20} aria-hidden="true" /><span>Turn on sharing</span>
          </button>
          <p className="mycard-download-note">
            {view ? 'Nobody can see your card until you turn sharing on. Then you can send it by text, show a QR code, or copy a link.' : 'Add your name to share your card.'}
          </p>
        </>
      )}

      {toast ? <p className="mycard-download-feedback" role="status">{toast}</p> : null}
      {error ? (
        <div className="mycard-notice mycard-notice--error" role="alert">
          <p className="mycard-notice-text">{error.message}</p>
          <div className="mycard-notice-actions">
            {error.reload && onReload ? <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onReload}>Reload my card</button> : null}
            {onDismissError ? <button type="button" className="mycard-btn mycard-btn--secondary" onClick={onDismissError}>Dismiss</button> : null}
          </div>
        </div>
      ) : null}

      {live ? (
        <details id="mycard-manage" className="mycard-manage">
          <summary>Manage sharing</summary>
          <div className="mycard-manage-body">
            <div className="mycard-share-row">
              <button type="button" className="mycard-btn mycard-btn--secondary" disabled={working} onClick={() => setSheet('off')}>
                <Power size={18} aria-hidden="true" /><span>Turn sharing off</span>
              </button>
              <button type="button" className="mycard-btn mycard-btn--secondary" disabled={working} onClick={() => setSheet('reset')}>
                <RotateCcw size={18} aria-hidden="true" /><span>Reset link</span>
              </button>
            </div>
            <p className="mycard-download-note">What we can&apos;t recall:</p>
            <ul className="mycard-recall">{CANNOT_RECALL.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        </details>
      ) : null}

      {sheet === 'publish' ? (
        <Dialog title="Turn on sharing" onClose={() => { if (!working) setSheet(null); }}>
          <p className="mycard-crop-help">Anyone with your link or QR code will see this, with no account needed.</p>
          <div className="mycard-sheet-list">
            <p className="mycard-sheet-line"><strong>People will see:</strong> {name}{visible.length ? `, ${visible.join(', ')}` : ''}{linkCount ? `, and ${linkCount} link${linkCount === 1 ? '' : 's'}` : ''}.</p>
            {hidden.length ? <p className="mycard-sheet-line"><strong>Kept private:</strong> {hidden.map((item) => item.label).join(', ')}.</p> : <p className="mycard-sheet-line"><strong>Kept private:</strong> nothing is hidden.</p>}
          </div>
          {!gate.ok ? (
            <div className="mycard-sheet-fixes" role="group" aria-label="To publish, fix this">
              <p className="mycard-sheet-line">Your card needs your name and at least one way to reach you.</p>
              {gate.fixes.map((fix) => (fix.action === 'share' ? (
                <button key={`${fix.action}-${fix.field}`} type="button" className="mycard-btn mycard-btn--secondary" onClick={() => onTurnOn(fix.field)}>
                  Turn on {FIELD_LABEL[fix.field] ?? fix.field}
                </button>
              ) : (
                <button key={`${fix.action}-${fix.field}`} type="button" className="mycard-btn mycard-btn--secondary" onClick={() => { setSheet(null); onEditCard(); }}>
                  Add your {FIELD_LABEL[fix.field] ?? fix.field}
                </button>
              )))}
            </div>
          ) : null}
          {dirty ? <p className="mycard-download-note">Your unsaved changes are saved first.</p> : null}
          {error ? <p className="mycard-message mycard-message--error" role="alert">{error.message}</p> : null}
          <div className="mycard-notice-actions">
            <button type="button" className="mycard-btn mycard-btn--primary" disabled={!gate.ok || working} aria-busy={busy === 'publish' ? 'true' : undefined} onClick={publish}>
              {busy === 'publish' ? 'Publishing…' : 'Publish my card'}
            </button>
            <button type="button" className="mycard-btn mycard-btn--secondary" disabled={working} onClick={() => setSheet(null)}>Cancel</button>
          </div>
        </Dialog>
      ) : null}

      {sheet === 'off' ? (
        <Dialog title="Turn sharing off?" onClose={() => { if (!working) setSheet(null); }}>
          <p className="mycard-crop-help">Your link and QR code stop working right away. Turn sharing back on any time and the same link and QR code work again.</p>
          {error ? <p className="mycard-message mycard-message--error" role="alert">{error.message}</p> : null}
          <div className="mycard-notice-actions">
            <button type="button" className="mycard-btn mycard-btn--primary" disabled={working} aria-busy={busy === 'unpublish' ? 'true' : undefined} onClick={turnOff}>
              {busy === 'unpublish' ? 'Turning off…' : 'Turn sharing off'}
            </button>
            <button type="button" className="mycard-btn mycard-btn--secondary" disabled={working} onClick={() => setSheet(null)}>Keep sharing</button>
          </div>
        </Dialog>
      ) : null}

      {sheet === 'reset' ? (
        <Dialog title="Reset your link?" onClose={() => { if (!working) setSheet(null); }}>
          <p className="mycard-crop-help">You get a new link and QR code. The old link and every QR code you have shared or printed stop working for good, and can&apos;t be brought back.</p>
          <p className="mycard-download-note">{CANNOT_RECALL[3]}</p>
          {error ? <p className="mycard-message mycard-message--error" role="alert">{error.message}</p> : null}
          <div className="mycard-notice-actions">
            <button type="button" className="mycard-btn mycard-btn--danger" disabled={working} aria-busy={busy === 'reset' ? 'true' : undefined} onClick={reset}>
              {busy === 'reset' ? 'Resetting…' : 'Reset link'}
            </button>
            <button type="button" className="mycard-btn mycard-btn--secondary" disabled={working} onClick={() => setSheet(null)}>Cancel</button>
          </div>
        </Dialog>
      ) : null}

      {qr && url ? <QrScreen url={url} name={name} onClose={() => setQr(false)} /> : null}
    </section>
  );
}
