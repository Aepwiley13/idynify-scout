/**
 * HubPeople — Contact Hub's My People.
 *
 * A heading, a search box, Add Person, the sticker chips and a plain list.
 * Nothing else: no pipeline stages, no engagement status, no outreach
 * actions. Those stay in People (Command Center), which this does not replace
 * or change.
 *
 * Reused as they are: the contacts ContactHubMain loaded, the sticker
 * registry, the interactive sticker chips People's rows use, the Stickers
 * wall, and the manual add form.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Mail, Phone, Search, UserPlus, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { contactHubPersonPath } from '../../constants/contactHub';
import { hasRealContactPhoto, resolveContactPhotoSources, getInitials } from '../../utils/contactPhoto';
import { useStickers } from '../../components/stickers/stickersRegistry';
import { resolveStickerFilter } from '../../components/stickers/peopleStickers';
import ContactCardStickersInteractive from '../../components/stickers/ContactCardStickersInteractive';
import StickersWall from '../../components/stickers/StickersWall';
import ManualContactForm from '../../components/scout/ManualContactForm';
import StickerChipRow from './StickerChipRow';
import {
  HUB_STATUS, listMyPeople, visiblePeople, personName, personSubtitle, emailOf, phoneOf, addedLabel,
} from './hubPeople';

/** The add form's wording here: no pipeline, no enrichment, no Scout+. */
const ADD_COPY = Object.freeze({
  hint: 'Only a name is needed. You can add the rest any time.',
  duplicate: (name) => `${name} is already in My People. Any new details you entered were added to them.`,
  submit: 'Add Person',
  showReferral: false,
});

function Avatar({ contact, name }) {
  const [broken, setBroken] = useState(false);
  const T = useT();
  const src = hasRealContactPhoto(contact) && !broken ? resolveContactPhotoSources(contact).thumbnail : null;
  return src ? (
    <img className="hub-avatar" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
  ) : (
    <span className="hub-avatar hub-avatar--initials" style={{ background: T.surface2 ?? T.surface, color: T.textMuted }} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

function PersonRow({ contact, onStickerChange, stickerMax }) {
  const T = useT();
  const name = personName(contact);
  const subtitle = personSubtitle(contact);
  const email = emailOf(contact);
  const phone = phoneOf(contact);
  const added = addedLabel(contact);
  return (
    <li className="hub-row" style={{ borderColor: T.border }}>
      <Avatar contact={contact} name={name} />
      <div className="hub-row-main">
        {/* The name is the link; its hit area is stretched over the whole row
            (ContactHub.css), so the row opens the person while the buttons on
            it stay separate, reachable targets. */}
        <Link className="hub-row-link" to={contactHubPersonPath(contact.id)} style={{ color: T.text }}>
          {name}
        </Link>
        {subtitle ? <span className="hub-row-sub" style={{ color: T.textMuted }}>{subtitle}</span> : null}
      </div>
      <div className="hub-row-stickers">
        <ContactCardStickersInteractive contact={contact} max={stickerMax} onUpdate={onStickerChange} />
      </div>
      {added ? <span className="hub-row-added" style={{ color: T.textFaint }}>{added}</span> : null}
      <div className="hub-row-actions">
        {phone ? (
          <a className="hub-icon-btn" href={`tel:${phone}`} aria-label={`Call ${name}`} style={{ color: T.textMuted, borderColor: T.border }}>
            <Phone size={18} aria-hidden="true" />
          </a>
        ) : null}
        {email ? (
          <a className="hub-icon-btn" href={`mailto:${email}`} aria-label={`Email ${name}`} style={{ color: T.textMuted, borderColor: T.border }}>
            <Mail size={18} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

function AddPersonDialog({ onClose, onAdded }) {
  const T = useT();
  const titleId = useId();
  const boxRef = useRef(null);
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement);

  useEffect(() => {
    boxRef.current?.querySelector('input')?.focus();
    const previous = opener.current;
    return () => { previous?.focus?.(); };
  }, []);

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }

  return (
    <>
      <div className="hub-dialog-backdrop" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hub-dialog"
        style={{ background: T.cardBg, color: T.text, borderColor: T.border }}
        onKeyDown={onKeyDown}
      >
        <div className="hub-dialog-head">
          <h2 id={titleId} className="hub-dialog-title">Add Person</h2>
          <button type="button" className="hub-icon-btn hub-icon-btn--plain" aria-label="Close" onClick={onClose} style={{ color: T.textMuted }}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <ManualContactForm onContactAdded={onAdded} onCancel={onClose} copy={ADD_COPY} />
      </div>
    </>
  );
}

export default function HubPeople() {
  const T = useT();
  const isMobile = useIsMobile();
  const {
    status, contacts, reload, addContacts, applyStickerChange,
    searchTerm, setSearchTerm, stickerId, setStickerId,
  } = useOutletContext();
  const stickers = useStickers();
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [justAdded, setJustAdded] = useState(null);

  const people = useMemo(() => listMyPeople(contacts), [contacts]);

  // A sticker that was archived or deleted while selected stops filtering.
  const { sticker: activeSticker } = stickers.ready
    ? resolveStickerFilter(stickerId, stickers.byId)
    : { sticker: null };

  const shown = useMemo(
    () => visiblePeople(contacts, {
      term: searchTerm,
      stickerId: activeSticker?.id ?? null,
      stickersById: stickers.ready ? stickers.byId : null,
    }),
    [contacts, searchTerm, activeSticker, stickers.ready, stickers.byId],
  );

  // The Stickers view exists only while stickers are available.
  const showWall = managing && stickers.ready;

  function handleAdded(added) {
    addContacts(added);
    setAdding(false);
    setJustAdded(added?.[0] ? personName(added[0]) : null);
  }

  function selectSticker(id) {
    setManaging(false);
    setStickerId(id);
  }

  const filtering = Boolean(searchTerm.trim()) || Boolean(activeSticker);

  return (
    <>
      <header className="hub-header">
        <div>
          <h1 className="hub-title">Contact Hub</h1>
          <p className="hub-tagline" style={{ color: T.textMuted }}>The people in your world, in one place.</p>
        </div>
      </header>

      <section aria-labelledby="hub-people-heading" className="hub-card" style={{ background: T.cardBg, borderColor: T.border }}>
        <div className="hub-toolbar">
          <h2 id="hub-people-heading" className="hub-section-title">
            My People
            {status === HUB_STATUS.READY ? <span className="hub-count" style={{ color: T.textFaint }}> ({people.length})</span> : null}
          </h2>
          <label className="hub-search" style={{ background: T.input ?? T.surface, borderColor: T.border }}>
            <Search size={18} aria-hidden="true" style={{ color: T.textFaint, flexShrink: 0 }} />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search people…"
              aria-label="Search people"
              style={{ color: T.text }}
            />
          </label>
          <button type="button" className="hub-primary-btn" style={{ background: T.accent }} onClick={() => setAdding(true)}>
            <UserPlus size={18} aria-hidden="true" />
            Add Person
          </button>
        </div>

        <StickerChipRow
          people={people}
          selectedId={activeSticker?.id ?? null}
          onSelect={selectSticker}
          managing={showWall}
          onToggleManage={() => setManaging((on) => !on)}
        />

        <p className="hub-status" role="status" aria-live="polite" style={{ color: T.textMuted }}>
          {justAdded ? `${justAdded} was added to My People.` : ''}
        </p>

        {status === HUB_STATUS.LOADING && (
          <p className="hub-note" style={{ color: T.textMuted }}>Loading your people…</p>
        )}

        {status === HUB_STATUS.ERROR && (
          <div className="hub-empty">
            <p className="hub-empty-title">Your people could not be loaded.</p>
            <button type="button" className="hub-secondary-btn" style={{ color: T.text, borderColor: T.border }} onClick={reload}>Try again</button>
          </div>
        )}

        {status === HUB_STATUS.READY && showWall && (
          <StickersWall contacts={people} onOpenSticker={(id) => selectSticker(id)} />
        )}

        {status === HUB_STATUS.READY && !showWall && people.length === 0 && (
          <div className="hub-empty">
            <p className="hub-empty-title">No one here yet.</p>
            <p className="hub-empty-text" style={{ color: T.textMuted }}>Add the first person you want to keep in touch with.</p>
            <button type="button" className="hub-primary-btn" style={{ background: T.accent }} onClick={() => setAdding(true)}>
              <UserPlus size={18} aria-hidden="true" />
              Add Person
            </button>
          </div>
        )}

        {status === HUB_STATUS.READY && !showWall && people.length > 0 && shown.length === 0 && (
          <div className="hub-empty">
            <p className="hub-empty-title">No one matches.</p>
            {filtering ? (
              <button
                type="button"
                className="hub-secondary-btn"
                style={{ color: T.text, borderColor: T.border }}
                onClick={() => { setSearchTerm(''); setStickerId(null); }}
              >
                Show everyone
              </button>
            ) : null}
          </div>
        )}

        {status === HUB_STATUS.READY && !showWall && shown.length > 0 && (
          <ul className="hub-list" aria-label="My People">
            {shown.map((contact) => (
              <PersonRow
                key={contact.id}
                contact={contact}
                onStickerChange={applyStickerChange}
                stickerMax={isMobile ? 1 : 2}
              />
            ))}
          </ul>
        )}
      </section>

      {adding ? <AddPersonDialog onClose={() => setAdding(false)} onAdded={handleAdded} /> : null}
    </>
  );
}
