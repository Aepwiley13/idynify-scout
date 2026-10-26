/**
 * ContactIdentityViewer — the doorway into a person's identity.
 *
 * Opens from a contact's avatar: their photo at its own framing (never the
 * circular crop), then name, title, company, and one next action. It reads
 * everything from the `contact` it is given, so any surface that has a contact
 * (profile, Hunter, Scout, Command Center, search, Barry) can open it.
 *
 *   <ContactIdentityViewer
 *     contact={contact}
 *     open={viewerOpen}
 *     onClose={() => setViewerOpen(false)}
 *     returnFocusRef={avatarButtonRef}
 *   />
 *
 * Callers open it only when `hasRealContactPhoto(contact)` is true; it renders
 * nothing for a contact without a real photo.
 *
 * Accessibility: a modal dialog labelled by the contact's name. Focus moves
 * to the close button, Tab stays inside, Esc / backdrop / X close it, and
 * focus returns to `returnFocusRef` (or whatever was focused before).
 * Page scroll is locked while it is open.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Building2, Linkedin, ArrowUpRight } from 'lucide-react';
import { resolveContactPhotoSources, contactDisplayName, getInitials } from '../../utils/contactPhoto';
import './ContactIdentityViewer.css';

// The viewer's size is set by the screen (ContactIdentityViewer.css); the
// photo fills it unless that would enlarge the source past this factor. A
// small source is then shown sharp at its capped size over a blurred fill of
// itself, instead of being stretched soft across the frame.
const MAX_UPSCALE = 1.5;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function ContactIdentityViewer({ contact, open, onClose, returnFocusRef }) {
  const { thumbnail, full } = resolveContactPhotoSources(contact);
  if (!open || !full) return null;
  // Keyed on the photo so image state starts fresh for each photo.
  return (
    <IdentityDialog
      key={full}
      contact={contact}
      full={full}
      thumbnail={thumbnail}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    />
  );
}

function IdentityDialog({ contact, full, thumbnail, onClose, returnFocusRef }) {
  const titleId = useId();
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const pressedBackdropRef = useRef(false);
  // Esc reads the latest onClose without re-running the open/close effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const [src, setSrc] = useState(full);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState(null);

  // Focus, scroll lock, Esc, focus trap, focus return.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const returnTarget = returnFocusRef;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      const target = returnTarget?.current || previouslyFocused;
      if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
    };
  }, [returnFocusRef]);

  const name = contactDisplayName(contact) || 'Unnamed contact';
  const company = contact.company_name || contact.company || null;
  const linkedinUrl = contact.linkedin_url || null;

  const known = !!(natural?.w && natural?.h);
  const photoCap = known
    ? { maxWidth: `${Math.round(natural.w * MAX_UPSCALE)}px`, maxHeight: `${Math.round(natural.h * MAX_UPSCALE)}px` }
    : undefined;

  function handleImgError() {
    if (src !== thumbnail && thumbnail) setSrc(thumbnail);
    else setFailed(true);
  }

  return createPortal(
    <div
      className="civ-backdrop"
      data-testid="contact-identity-backdrop"
      // Close on a click that both starts and ends on the backdrop, so a drag
      // out of the panel does not close it. Closing on click (not mousedown)
      // lets focus return to the opener after the browser's own focus change.
      onMouseDown={(e) => { pressedBackdropRef.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // A portal still bubbles React events to the opener's tree; keep clicks here.
        e.stopPropagation();
        if (pressedBackdropRef.current && e.target === e.currentTarget) onClose?.();
        pressedBackdropRef.current = false;
      }}
    >
      <div
        ref={panelRef}
        className="civ-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className={`civ-photo${natural ? ' civ-photo--ready' : ''}`}
          style={known ? { aspectRatio: `${natural.w} / ${natural.h}` } : undefined}
        >
          {failed ? (
            <div className="civ-initials" aria-hidden="true">{getInitials(name)}</div>
          ) : (
            <>
              {natural && <img src={src} alt="" aria-hidden="true" className="civ-photo-fill" />}
              <img
                src={src}
                alt={`Profile photo of ${name}`}
                className="civ-photo-img"
                style={photoCap}
                onLoad={(e) => {
                  // 0×0 when the browser can't tell (e.g. some SVGs): shown, uncapped.
                  const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                  setNatural({ w, h });
                }}
                onError={handleImgError}
              />
            </>
          )}
          <button
            ref={closeRef}
            type="button"
            className="civ-close"
            onClick={() => onClose?.()}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="civ-body">
          <h2 id={titleId} className="civ-name">{name}</h2>
          {contact.title && <p className="civ-title">{contact.title}</p>}
          {company && (
            <p className="civ-company">
              <Building2 size={13} aria-hidden="true" />
              <span>{company}</span>
            </p>
          )}

          {linkedinUrl && (
            <a
              className="civ-action"
              href={linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Linkedin size={15} aria-hidden="true" />
              <span>View LinkedIn</span>
              <ArrowUpRight size={14} className="civ-action-arrow" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
