/**
 * HubPeople — Contact Hub's My People.
 *
 * A heading, Add Person, a search box, sticker navigation and the people, as
 * a plain list or (on a desktop, by choice) a compact table. Nothing else: no
 * pipeline stages, no engagement status, no outreach actions. Those stay in
 * People (Command Center), which this does not replace or change.
 *
 * THREE LAYOUTS, ONE PAGE
 *   phone            heading and Add, search, sticker chips, the list.
 *   desktop, narrow  the same, plus the List / Table choice.
 *   desktop, wide    Contact Hub's own panel (HubSidePanel) beside the people,
 *                    in place of the chip row.
 * "Wide" is the room Contact Hub actually has beside the application's
 * sidebar, measured here, not the size of the window: the sidebar can be 64
 * or 220px, so the same window can be either.
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
import { List, Mail, Phone, Search, Table2, UserPlus, Users, X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  CONTACT_HUB_PATH, CONTACT_HUB_STICKERS_PATH, contactHubPersonPath, isContactHubStickersPath,
} from '../../constants/contactHub';
import { hasRealContactPhoto, resolveContactPhotoSources, getInitials } from '../../utils/contactPhoto';
import { useStickers } from '../../components/stickers/stickersRegistry';
import { resolveStickerFilter } from '../../components/stickers/peopleStickers';
import ContactCardStickersInteractive from '../../components/stickers/ContactCardStickersInteractive';
import ContactCardStickers from '../../components/stickers/ContactCardStickers';
import StickersWall from '../../components/stickers/StickersWall';
import ManualContactForm from '../../components/scout/ManualContactForm';
import { AVAILABILITY } from '../../components/stickers/stickersAvailabilityState';
import StickerChipRow from './StickerChipRow';
import HubSidePanel, { StickersLoadError } from './HubSidePanel';
import HubTable from './HubTable';
import { describeAddPersonError } from './addPersonErrors';
import {
  HUB_STATUS, PAGE_SIZE, listMyPeople, visiblePeople, pageOf, stickersFailedToLoad, personName, personSubtitle, emailOf, phoneOf, addedLabel,
} from './peopleRules';

/** How many sticker chips a row shows before "+N". */
export const ROW_STICKER_MAX = 2;

/**
 * The narrowest Contact Hub content area that gets the inner panel. Below it
 * the panel's choices are the chip row. 232px of panel and a 24px gap leave
 * the table about 720px, the least at which five columns stay readable.
 */
export const PANEL_MIN_WIDTH = 980;

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
    // Before the first paint, so the panel does not appear a frame late.
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
  const [broken, setBroken] = useState(false);
  const T = useT();
  const src = hasRealContactPhoto(contact) && !broken ? resolveContactPhotoSources(contact).thumbnail : null;
  return src ? (
    <img className="hub-avatar" src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
  ) : (
    <span className="hub-avatar hub-avatar--initials" style={{ background: softFill(T), color: T.text }} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

function PersonRow({ contact, onStickerChange, readOnlyStickers }) {
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
  const T = useT();
  const isMobile = useIsMobile();
  const {
    status, contacts, reload, addContacts, applyStickerChange,
    searchTerm, setSearchTerm, stickerId, setStickerId, listPath,
  } = useOutletContext();
  const stickers = useStickers();
  const [adding, setAdding] = useState(false);
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

  // The Stickers view exists only while stickers are available.
  const showWall = managing && stickers.ready;

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
    setJustAdded(added?.[0] ? personName(added[0]) : null);
  }

  // Navigates to My People with that filter (or none), which also leaves the wall.
  function selectSticker(id) {
    setStickerId(id);
  }

  const filtering = Boolean(searchTerm.trim()) || Boolean(activeSticker);
  // No one yet: the page is the invitation, with nothing else competing.
  const firstRun = status === HUB_STATUS.READY && people.length === 0;

  // Stickers switched off for this user (or an admin viewing as them) means
  // no sticker navigation at all, so no panel: the page is a people directory.
  // While that is still being checked the panel holds its place with My People
  // alone, so the layout does not jump when the answer arrives.
  const stickersBroken = stickersFailedToLoad(stickers);
  const showPanel = !isMobile && !firstRun
    && contentWidth >= PANEL_MIN_WIDTH
    && stickers.availability !== AVAILABILITY.UNAVAILABLE;
  // The room the people have: the content area, less the panel when it is open.
  // 0 means it could not be measured, which does not rule the table out.
  const peopleWidth = contentWidth ? contentWidth - (showPanel ? 256 : 0) : 0;
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

  // With the panel open the page title sits at the top of it; otherwise it is
  // above the people, as before. One element either way.
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
  const subtitle = activeSticker
    ? `People with the ${activeSticker.name} sticker`
    : 'Everyone you know, in one place';

  return (
    <>
      {showPanel ? null : pageHeader}

      <div ref={workspaceRef} className={`hub-workspace${showPanel ? ' hub-workspace--panel' : ''}`}>
      {showPanel ? (
        <HubSidePanel
          header={pageHeader}
          people={people}
          selectedId={activeSticker?.id ?? null}
          onSelect={selectSticker}
          wallOpen={showWall}
          onOpenWall={openWall}
        />
      ) : null}

      {/* Colours reach the stylesheet as variables: on a phone the card is the list
          alone, and the heading, search and chips sit on the page above it. */}
      <section
        aria-labelledby="hub-people-heading"
        className="hub-card hub-people"
        style={{ '--hub-card': T.cardBg, '--hub-border': T.border, '--hub-muted': T.textMuted }}
      >
        <div className="hub-toolbar">
          <div className="hub-heading">
            <h2 id="hub-people-heading" className="hub-section-title">
              My People
              {status === HUB_STATUS.READY && !firstRun ? <span className="hub-count" style={{ color: T.textMuted }}> ({people.length})</span> : null}
            </h2>
            {!firstRun && !isMobile ? <p className="hub-subtitle" style={{ color: T.textMuted }}>{subtitle}</p> : null}
          </div>
          {!firstRun && addButton}
          {!firstRun && (
            <div className="hub-tools">
              {searchField}
              {tableFits && !showWall ? viewToggle : null}
            </div>
          )}
        </div>

        {!firstRun && !showPanel && (
        <StickerChipRow
          people={people}
          selectedId={activeSticker?.id ?? null}
          onSelect={selectSticker}
          managing={showWall}
          onToggleManage={() => (managing ? closeWall() : openWall())}
        />
        )}
        {!firstRun && !showPanel && stickersBroken ? <StickersLoadError /> : null}

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

        {status === HUB_STATUS.READY && !firstRun && showWall && (
          <StickersWall contacts={people} onOpenSticker={(id) => selectSticker(id)} />
        )}

        {firstRun && (
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

        {status === HUB_STATUS.READY && !showWall && shown.length > 0 && (asTable ? (
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
    </>
  );
}
