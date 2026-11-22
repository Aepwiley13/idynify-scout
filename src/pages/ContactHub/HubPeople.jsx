/**
 * HubPeople — Contact Hub's My People.
 *
 * A heading, Add Person, a search box, sticker navigation and the people, as
 * a plain list or (on a desktop, by choice) a compact table. Nothing else: no
 * pipeline stages, no engagement status, no outreach actions. Those stay in
 * People (Command Center), which this does not replace or change.
 *
 * WHERE THE STICKER NAVIGATION IS
 *   In the application sidebar, under Contact Hub (HubSidebarNav), wherever
 *   the sidebar offers a place for it: a desktop with the sidebar expanded.
 *   The people then have the whole content area.
 *   Otherwise (a phone, the compact sidebar, a page with no sidebar) it is
 *   the chip row here. Never both.
 * The List / Table choice follows the room the people actually have beside
 * the sidebar, measured here, not the size of the window: the sidebar can be
 * 64 or 220px, so the same window can be either.
 *
 * Reused as they are: the contacts ContactHubMain loaded, the sticker
 * registry, People's sticker chips (interactive on a wide screen, read-only
 * on a phone), the Stickers wall, and the manual add form.
 *
 * With no one in My People yet there is nothing to search, filter or sort, so
 * none of that is drawn: one friendly message and one action.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { ArrowLeft, List, Mail, Phone, Search, Table2, Upload, UserPlus, Users, X } from 'lucide-react';
import DeleteContactsDialog from './DeleteContactsDialog';
import DuplicateReview from './duplicates/DuplicateReview';
import { useImpersonation } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  contactDeletionEnabled, DELETE_SELECTION_LIMIT, CONTACT_HUB_PATH, CONTACT_HUB_SIDEBAR_SLOT, CONTACT_HUB_STICKERS_PATH, contactHubPersonPath, isContactHubStickersPath,
} from '../../constants/contactHub';
import { resolveContactPhotoSources, getInitials } from '../../utils/contactPhoto';
import { useStickers } from '../../components/stickers/stickersRegistry';
import { resolveStickerFilter } from '../../components/stickers/peopleStickers';
import ContactCardStickersInteractive from '../../components/stickers/ContactCardStickersInteractive';
import ContactCardStickers from '../../components/stickers/ContactCardStickers';
import StickersWall from '../../components/stickers/StickersWall';
import ManualContactForm from '../../components/scout/ManualContactForm';
import ImportPeopleDialog from '../../components/contactImport/ImportPeopleDialog';
import { importSummary } from '../../components/contactImport/importPeople';
import StickerChipRow from './StickerChipRow';
import { AVAILABILITY } from '../../components/stickers/stickersAvailabilityState';
import StickersLoadError from './StickersLoadError';
import { useSidebarSlot } from '../../components/layout/sidebarSlots';
import HubTable from './HubTable';
import { describeAddPersonError } from './addPersonErrors';
import {
  HUB_STATUS, PAGE_SIZE, listMyPeople, visiblePeople, pageOf, stickersFailedToLoad, personName, personSubtitle, emailOf, phoneOf, addedLabel,
} from './peopleRules';

/** How many sticker chips a row shows before "+N". */
export const ROW_STICKER_MAX = 2;

/**
 * The table needs room for its columns. Where Contact Hub's content area is
 * narrower than this (a small window beside the wide sidebar), the list is
 * shown whatever was chosen, and the choice is not offered. Between this and
 * TABLE_FULL_WIDTH the Added column gives way to the other four.
 */
export const TABLE_MIN_WIDTH = 600;
export const TABLE_FULL_WIDTH = 760;

export const VIEW = Object.freeze({ LIST: 'list', TABLE: 'table' });
/** This browser only: a convenience, not an account setting. */
export const VIEW_STORAGE_KEY = 'idynify_hub_view';

function readStoredView() {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === VIEW.TABLE ? VIEW.TABLE : VIEW.LIST;
  } catch {
    return VIEW.LIST; // storage blocked or unavailable: the default
  }
}

/**
 * The width of an element, kept up to date. 0 until it can be measured (and
 * wherever it cannot be, such as a test without layout), which callers treat
 * as "not wide".
 */
function useElementWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Before the first paint, so the table does not appear a frame late.
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[entries.length - 1]?.contentRect?.width;
      if (typeof next === 'number') setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The add form here: no pipeline, no enrichment, no Scout+, and only Name,
 * Email and Phone to begin with. The rest is one tap away under "More
 * details".
 */
const ADD_COPY = Object.freeze({
  hint: 'Only a name is needed. You can add the rest any time.',
  duplicate: (name) => `${name} is already in My People. Any new details you entered were added to them.`,
  submit: 'Add Person',
  showReferral: false,
  moreDetails: true,
  // A person here needs no company. One is only looked up or created when the
  // user types it; an email address alone creates nothing and enriches nothing.
  companyFromEmail: false,
  // The details being typed are someone else's, not the signed-in user's.
  autofill: false,
  describeError: describeAddPersonError,
});

/**
 * The soft fill behind initials and the call and email buttons. The light
 * themes have a surface made for this. The dark themes' surfaces are nearly
 * invisible on a card (4 to 6% white), so those use the next step up.
 */
const softFill = (T) => (T.isDark ? T.border2 ?? T.surface2 ?? T.surface : T.surface);

function Avatar({ contact, name }) {
  const [broken, setBroken] = useState(null);
  const T = useT();
  const thumbnail = contact.contact_hub_photo ? null : resolveContactPhotoSources(contact).thumbnail;
  const src = broken === thumbnail ? null : thumbnail;
  return src ? (
    <img className="hub-avatar" src={src} alt="" loading="lazy" onError={() => setBroken(src)} />
  ) : (
    <span className="hub-avatar hub-avatar--initials" style={{ background: softFill(T), color: T.text }} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

function PersonRow({ contact, onStickerChange, readOnlyStickers, selection }) {
  const T = useT();
  const name = personName(contact);
  const subtitle = personSubtitle(contact);
  const email = emailOf(contact);
  const phone = phoneOf(contact);
  const added = addedLabel(contact);
  return (
    <li className="hub-row" style={{ borderColor: T.border }}>
      {selection}
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
      {/* On a phone the list stays quiet: up to two chips and "+N", nothing to
          tap. Stickers are added and removed on the person's own page. A wide
          screen keeps People's in-place add and remove. */}
      <div className={`hub-row-stickers${readOnlyStickers ? ' hub-row-stickers--readonly' : ''}`}>
        {readOnlyStickers
          ? <ContactCardStickers contact={contact} max={ROW_STICKER_MAX} />
          : <ContactCardStickersInteractive contact={contact} max={ROW_STICKER_MAX} onUpdate={onStickerChange} />}
      </div>
      {added ? <span className="hub-row-added" style={{ color: T.textMuted }}>{added}</span> : null}
      <div className="hub-row-actions">
        {phone ? (
          <a className="hub-icon-btn" href={`tel:${phone}`} aria-label={`Call ${name}`} style={{ color: T.text, background: softFill(T) }}>
            <Phone size={18} aria-hidden="true" />
          </a>
        ) : null}
        {email ? (
          <a className="hub-icon-btn" href={`mailto:${email}`} aria-label={`Email ${name}`} style={{ color: T.text, background: softFill(T) }}>
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
  const { uid, removeContacts } = useOutletContext();
  const { isImpersonating, isReadOnly } = useImpersonation();
  const readOnly = Boolean(isImpersonating || isReadOnly);
  const canDelete = Boolean(contactDeletionEnabled() && uid && removeContacts && !readOnly);
  return <HubPeopleList key={JSON.stringify([uid, readOnly])} canDelete={canDelete} readOnly={readOnly} />;
}

function HubPeopleList({ canDelete, readOnly }) {
  const T = useT();
  const isMobile = useIsMobile();
  const {
    uid, status, contacts, reload, addContacts, removeContacts, applyStickerChange,
    searchTerm, setSearchTerm, stickerId, setStickerId, listPath,
  } = useOutletContext();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [deleting, setDeleting] = useState(null);

  function selectionFor(contact) {
    const checked = selected.includes(contact.id);
    return <label className="hub-select-contact">
      <input type="checkbox" aria-label={`Select ${personName(contact)}`} checked={checked}
        disabled={!checked && selected.length >= DELETE_SELECTION_LIMIT}
        onChange={() => setSelected((ids) => checked ? ids.filter((id) => id !== contact.id) : [...ids, contact.id])} />
    </label>;
  }

  const stickers = useStickers();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState('');
  // The Sticker Wall is this screen at its own address (/contact-hub/stickers).
  const navigate = useNavigate();
  const managing = isContactHubStickersPath(useLocation().pathname);
  const openWall = () => navigate(CONTACT_HUB_STICKERS_PATH);
  // Leaving the wall returns to My People as it was, sticker filter included.
  const closeWall = () => navigate(listPath || CONTACT_HUB_PATH);
  const [justAdded, setJustAdded] = useState(null);
  const [view, setView] = useState(readStoredView);
  const workspaceRef = useRef(null);
  const contentWidth = useElementWidth(workspaceRef);

  function chooseView(next) {
    setView(next);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, next); } catch { /* not remembered; still switches */ }
  }

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

  // The wall's address is always the Sticker Wall screen: its own heading and
  // way back, never My People under another name. The wall itself is drawn
  // once stickers are available and loaded; until then, or if they are not
  // available for this account, the screen says so (wallNotice, below).
  const showWall = managing;
  const wallReady = managing && stickers.ready;

  // Display paging: how many of `shown` are drawn. A new search or filter
  // starts from the first page again. Everyone is loaded and searched either
  // way (peopleRules.js: PAGE_SIZE).
  const pageKey = `${searchTerm}\u0000${activeSticker?.id ?? ''}`;
  const [paging, setPaging] = useState({ key: pageKey, count: PAGE_SIZE });
  // Adjusted while rendering, so the reset is permanent: clearing a search
  // does not bring back every row that had been drawn before it.
  if (paging.key !== pageKey) setPaging({ key: pageKey, count: PAGE_SIZE });
  const drawnCount = paging.key === pageKey ? paging.count : PAGE_SIZE;
  const page = useMemo(() => pageOf(shown, drawnCount), [shown, drawnCount]);

  function handleAdded(added) {
    addContacts(added);
    setAdding(false);
    setImported('');
    setJustAdded(added?.[0] ? personName(added[0]) : null);
  }

  // An import can add people and update people already here: read the list again.
  function handleImported(result) {
    setImporting(false);
    setJustAdded(null);
    setImported(importSummary(result));
    reload();
  }

  // Navigates to My People with that filter (or none), which also leaves the wall.
  function selectSticker(id) {
    setStickerId(id);
  }

  const filtering = Boolean(searchTerm.trim()) || Boolean(activeSticker);
  // No one yet: the page is the invitation, with nothing else competing.
  const firstRun = status === HUB_STATUS.READY && people.length === 0;

  const stickersBroken = stickersFailedToLoad(stickers);
  // What the Sticker Wall screen says while the wall itself cannot be drawn.
  // A failed load has its own message (StickersLoadError), so nothing here.
  const wallNotice = !showWall || wallReady || stickersBroken
    ? null
    : stickers.availability === AVAILABILITY.UNAVAILABLE
      ? 'Stickers are not available for this account yet.'
      : 'Loading your stickers…';
  // Contact Hub's entries are in the application sidebar wherever it offers a
  // place for them (HubSidebarNav). Only where it does not (a phone, the
  // compact sidebar, a page with no sidebar) is the chip row drawn here.
  const sidebarSlot = useSidebarSlot(CONTACT_HUB_SIDEBAR_SLOT);
  const navInSidebar = Boolean(sidebarSlot) && !isMobile;
  // The room the people have: the whole content area.
  // 0 means it could not be measured, which does not rule the table out.
  const peopleWidth = contentWidth;
  const tableFits = !isMobile && (peopleWidth === 0 || peopleWidth >= TABLE_MIN_WIDTH);
  const asTable = view === VIEW.TABLE && tableFits;
  const tightTable = peopleWidth !== 0 && peopleWidth < TABLE_FULL_WIDTH;

  // Heading and Add first, then search across the full width: the same order
  // at every width, so the keyboard and screen readers follow what is seen.
  const searchField = (
    <label key="search" className="hub-search" style={{ background: T.input ?? T.surface, borderColor: isMobile ? T.textMuted : T.border }}>
      <Search size={isMobile ? 20 : 18} aria-hidden="true" style={{ color: T.textMuted, flexShrink: 0 }} />
      <input
        type="search"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search people…"
        aria-label="Search people"
        style={{ color: T.text }}
      />
    </label>
  );
  // A phone has room for one word beside the heading; the name read out stays
  // "Add Person" at every width.
  const addButton = (
    <button key="add" type="button" className="hub-primary-btn hub-add-btn" aria-label="Add Person" style={{ background: T.accent }} onClick={() => setAdding(true)}>
      {isMobile ? 'Add' : 'Add Person'}
    </button>
  );
  const importButton = (
    <button key="import" type="button" className="hub-secondary-btn" aria-label="Import Contacts" style={{ color: T.text, borderColor: T.border }} onClick={() => setImporting(true)}>
      <Upload size={16} aria-hidden="true" />
      Import
    </button>
  );

  // The page title, above the people at every width.
  const pageHeader = (
    <header className="hub-header">
      <div>
        <h1 className="hub-title">Contact Hub</h1>
        <p className="hub-tagline" style={{ color: T.textMuted }}>The people in your world, in one place.</p>
      </div>
    </header>
  );
  // Desktop only: a phone always has the list.
  const viewToggle = (
    <div key="view" className="hub-view" role="group" aria-label="View" style={{ borderColor: T.border, background: T.cardBg }}>
      {[VIEW.LIST, VIEW.TABLE].map((id) => (
        <button
          key={id}
          type="button"
          className="hub-view-btn"
          aria-pressed={view === id ? 'true' : 'false'}
          style={view === id ? { background: T.accentBg, color: T.text } : { background: 'transparent', color: T.textMuted }}
          onClick={() => chooseView(id)}
        >
          {id === VIEW.LIST ? <List size={16} aria-hidden="true" /> : <Table2 size={16} aria-hidden="true" />}
          {id === VIEW.LIST ? 'List' : 'Table'}
        </button>
      ))}
    </div>
  );
  // The Sticker Wall is this screen under its own name, with its own way back.
  const subtitle = showWall
    ? 'Open a sticker to see its people'
    : activeSticker
      ? `People with the ${activeSticker.name} sticker`
      : 'Everyone you know, in one place';
  // On a phone the selected chip can be scrolled out of sight, so the list
  // says which sticker it is filtered by, how many that is, and how to undo it.
  const filteredNote = isMobile && activeSticker && !showWall && status === HUB_STATUS.READY
    ? `${shown.length} ${shown.length === 1 ? 'person' : 'people'} with the ${activeSticker.name} sticker`
    : null;

  return (
    <>
      {pageHeader}

      <div ref={workspaceRef} className="hub-workspace">

      {/* Colours reach the stylesheet as variables: on a phone the card is the list
          alone, and the heading, search and chips sit on the page above it. */}
      <section
        aria-labelledby="hub-people-heading"
        className="hub-card hub-people"
        style={{ '--hub-card': T.cardBg, '--hub-border': T.border, '--hub-muted': T.textMuted }}
      >
        <div className="hub-toolbar">
          <div className="hub-heading">
            {showWall ? (
              <Link className="hub-back hub-back--wall" to={listPath || CONTACT_HUB_PATH} style={{ color: T.text }}>
                <ArrowLeft size={18} aria-hidden="true" />
                My People
              </Link>
            ) : null}
            <h2 id="hub-people-heading" className="hub-section-title">
              {showWall ? 'Sticker Wall' : 'My People'}
              {status === HUB_STATUS.READY && !firstRun && !showWall ? <span className="hub-count" style={{ color: T.textMuted }}> ({people.length})</span> : null}
            </h2>
            {!firstRun && !isMobile ? <p className="hub-subtitle" style={{ color: T.textMuted }}>{subtitle}</p> : null}
          </div>
          {/* Adding and searching people belong to My People, not to the wall. */}
          {!firstRun && !showWall && addButton}
          {!firstRun && !showWall && (
            <div className="hub-tools">
              {searchField}
              {importButton}
              {uid && status === HUB_STATUS.READY && <DuplicateReview contacts={people} stickers={stickers.byId} readOnly={readOnly} />}
              {canDelete && status === HUB_STATUS.READY && (
                <button type="button" className="hub-secondary-btn" onClick={() => {
                  setSelecting(!selecting);
                  setSelected([]);
                }}>{selecting ? 'Cancel selection' : 'Select contacts'}</button>
              )}
              {selecting && <button type="button" className="hub-secondary-btn" disabled={!selected.length}
                onClick={() => setDeleting(selected)}>Delete selected ({selected.length})</button>}
              {tableFits ? viewToggle : null}
            </div>
          )}
        </div>

        {!firstRun && !navInSidebar && (
        <StickerChipRow
          people={people}
          selectedId={activeSticker?.id ?? null}
          onSelect={selectSticker}
          managing={showWall}
          onToggleManage={() => (managing ? closeWall() : openWall())}
          // A phone reaches the wall from the bottom bar; the row is filters only.
          wallChip={!isMobile}
        />
        )}
        {!firstRun && !navInSidebar && stickersBroken ? <StickersLoadError /> : null}
        {filteredNote ? (
          <p className="hub-filter-note" style={{ color: T.textMuted }}>
            <span>{filteredNote}</span>
            <button type="button" className="hub-link-btn" style={{ color: T.text }} onClick={() => setStickerId(null)}>
              Show everyone
            </button>
          </p>
        ) : null}

        <p className="hub-status" role="status" aria-live="polite" style={{ color: T.textMuted }}>
          {justAdded ? `${justAdded} was added to My People.` : imported}
        </p>

        {canDelete && deleting && <DeleteContactsDialog uid={uid} ids={deleting}
          nameFor={(id) => personName(contacts.find((contact) => contact.id === id))} onClose={() => setDeleting(null)}
          onResult={(ids, done) => {
            removeContacts(ids);
            setSelected((previous) => previous.filter((id) => !ids.includes(id)));
            if (done) {
              setDeleting(null);
              setSelecting(false);
            }
          }} />}

        {status === HUB_STATUS.LOADING && (
          <p className="hub-note" style={{ color: T.textMuted }}>Loading your people…</p>
        )}

        {status === HUB_STATUS.ERROR && (
          <div className="hub-empty">
            <p className="hub-empty-title">Your people could not be loaded.</p>
            <button type="button" className="hub-secondary-btn" style={{ color: T.text, borderColor: T.border }} onClick={reload}>Try again</button>
          </div>
        )}

        {status === HUB_STATUS.READY && wallReady && (
          <StickersWall contacts={people} onOpenSticker={(id) => selectSticker(id)} />
        )}
        {wallNotice ? <p className="hub-note" style={{ color: T.textMuted }}>{wallNotice}</p> : null}
        {/* With the navigation in the sidebar the message is there; the wall says it too. */}
        {showWall && stickersBroken && navInSidebar ? <StickersLoadError /> : null}

        {firstRun && !showWall && (
          <div className="hub-empty hub-empty--first">
            <span className="hub-empty-art" style={{ background: T.accentBg, color: T.accent }} aria-hidden="true">
              <Users size={32} />
            </span>
            <p className="hub-empty-title">Start with one person</p>
            <p className="hub-empty-text" style={{ color: T.textMuted }}>
              Add someone you want to stay in touch with. All you need is their name.
            </p>
            <button type="button" className="hub-primary-btn hub-primary-btn--wide" style={{ background: T.accent }} onClick={() => setAdding(true)}>
              <UserPlus size={18} aria-hidden="true" />
              Add Your First Person
            </button>
            {/* Owner decision (billing W2): a new account can bring its existing contacts
                straight away, without adding someone by hand first. */}
            <button type="button" className="hub-secondary-btn" style={{ color: T.text, borderColor: T.border }} onClick={() => setImporting(true)}>
              <Upload size={16} aria-hidden="true" />
              Import Contacts
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

        {status === HUB_STATUS.READY && !showWall && shown.length > 0 && (asTable && !selecting ? (
          <HubTable
            rows={page.drawn}
            tight={tightTable}
            showStickers={stickers.ready}
            stickerMax={ROW_STICKER_MAX}
            onStickerChange={applyStickerChange}
            renderAvatar={(contact, name) => <Avatar contact={contact} name={name} />}
          />
        ) : (
          <ul className="hub-list" aria-label="My People">
            {page.drawn.map((contact) => (
              <PersonRow
                key={contact.id}
                contact={contact}
                onStickerChange={applyStickerChange}
                readOnlyStickers={isMobile}
                selection={selecting ? selectionFor(contact) : null}
              />
            ))}
          </ul>
        ))}

        {status === HUB_STATUS.READY && !showWall && page.remaining > 0 && (
          <div className="hub-more" style={{ borderColor: T.border }}>
            <span role="status" style={{ color: T.textMuted }}>
              Showing {page.drawn.length} of {page.total} people
            </span>
            <button
              type="button"
              className="hub-secondary-btn"
              style={{ color: T.text, borderColor: T.border }}
              onClick={() => setPaging({ key: pageKey, count: drawnCount + PAGE_SIZE })}
            >
              Show {page.next} more
            </button>
          </div>
        )}
      </section>
      </div>

      {adding ? <AddPersonDialog onClose={() => setAdding(false)} onAdded={handleAdded} /> : null}
      {importing ? <ImportPeopleDialog onClose={() => setImporting(false)} onImported={handleImported} /> : null}
    </>
  );
}
