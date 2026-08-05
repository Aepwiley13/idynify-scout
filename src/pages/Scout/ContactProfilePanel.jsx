/**
 * ContactProfilePanel — Contact Profile as a contextual panel inside Scout.
 *
 * THE PATTERN (Phase 5 decision, documented per the brief)
 * ────────────────────────────────────────────────────────
 * /scout/contact/:contactId is a CHILD route of /scout. That single fact
 * gives us everything the phase asks for:
 *
 *   · Opening a contact does not unmount Scout. The list, its filters, its
 *     sort and its scroll position are still there — closing is a genuine
 *     return, not a re-navigation that rebuilds the screen.
 *   · The URL is real. Direct links work, refresh works, and browser Back
 *     closes the panel because closing IS a navigation.
 *   · There is exactly one URL for "this contact". The previous design had
 *     a full-page route AND an embedded panel in three other components,
 *     with different back semantics depending on which one you hit.
 *
 * DEVIATION FROM THE BRIEF, stated plainly: the brief suggested a full
 * content route on direct URL and refresh. Here a direct link renders Scout
 * WITH the panel open rather than a standalone page. That is deliberate — a
 * standalone page is where the old hardcoded "Back to People" came from,
 * because a page reached cold has no origin to return to. Rendering the list
 * alongside means there is always somewhere to go back to. Below 1100px the
 * list is hidden and the panel occupies the full workspace, which is the
 * full-content-route behavior the brief describes.
 *
 * What replaced "Back to People": the panel closes to the Scout view the user
 * was actually in, and the shell breadcrumb shows Mission Control ▸ Scout ▸
 * <name> so the trail is visible rather than assumed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useOutletContext, useNavigate, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { X, Zap, ArrowLeft } from 'lucide-react';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useArrival, useShell, useShellEntity } from '../../context/ShellContext';
import { readNavigationIntent, originModuleId, barrySessionKey } from '../../utils/navigation';
import { resolveDestination, resolveModule } from '../../constants/navigationModel';
import ArrivalBanner from '../../components/contacts/ArrivalBanner';
import ContactProfile from './ContactProfile';

function displayName(contact) {
  if (!contact) return '';
  const composed = [contact.firstName ?? contact.first_name, contact.lastName ?? contact.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return composed || contact.name || contact.email || 'Contact';
}

export default function ContactProfilePanel() {
  const { contactId } = useParams();
  const outlet = useOutletContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { openQuickEngage } = useShell();

  const panelRef = useRef(null);
  // What had focus when the panel opened. Restored on close, so a keyboard
  // user who opened a contact from row 40 of the list lands back on row 40
  // rather than at the top of the document.
  const returnFocusRef = useRef(null);
  const [summary, setSummary] = useState(null);

  // The panel is a display mode of the same canonical experience, so it reads
  // the same intent. A contact opened in panel mode from another module keeps
  // that module's breadcrumb — the panel does not assume Scout either.
  const intent = useMemo(
    () => readNavigationIntent(location, { entityType: 'contact', entityId: contactId }),
    [location, contactId],
  );
  const origin = originModuleId(intent, resolveModule);
  const originDestination = resolveDestination(origin);
  const sessionKey = useMemo(() => barrySessionKey(intent, contactId), [intent, contactId]);

  useArrival({ intent, originModuleId: origin, sessionKey, memoryLoaded: false });

  // Stable identity: this is an effect dependency and a prop that decides
  // ContactProfile's panel mode, so it must not be a new function each render.
  const outletClose = outlet?.onClose;
  const onClose = useCallback(() => {
    if (outletClose) outletClose();
    else navigate('/scout');
  }, [outletClose, navigate]);

  // A light read purely for the breadcrumb, the panel header and the shell
  // context contract. ContactProfile loads the full record itself; this does
  // not duplicate that work, it just needs a name and a stage early.
  useEffect(() => {
    let cancelled = false;
    const user = getEffectiveUser();
    if (!user || !contactId) return undefined;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'contacts', contactId));
        if (!cancelled && snap.exists()) setSummary({ id: snap.id, ...snap.data() });
      } catch (err) {
        console.warn('[ContactProfilePanel] summary load failed:', err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [contactId]);

  // Tell the shell which entity is on screen. This is what puts the contact's
  // name in the breadcrumb and what lets Barry answer about the right person
  // without Scout having to know anything about Barry.
  useShellEntity({
    type: 'contact',
    id: contactId,
    stage: summary?.stage ?? null,
    label: summary ? displayName(summary) : null,
  });

  // Focus moves into the panel when it opens, Escape closes it, and focus goes
  // back to whatever opened it. The list is never unmounted, so the triggering
  // element is still in the document and still focusable — which is precisely
  // why this can be a real focus RESTORE rather than a best-effort jump to the
  // top of the list.
  useEffect(() => {
    const opener = document.activeElement;
    if (opener && opener !== document.body) returnFocusRef.current = opener;

    panelRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const previous = returnFocusRef.current;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [onClose]);

  const name = summary ? displayName(summary) : 'Contact';

  return (
    <aside
      ref={panelRef}
      className="scout-contact-panel"
      tabIndex={-1}
      aria-label={`Contact profile — ${name}`}
    >
      <div className="scout-contact-panel-header">
        <button
          type="button"
          className="scout-contact-panel-btn"
          onClick={onClose}
          aria-label="Close contact profile"
        >
          <ArrowLeft size={13} aria-hidden="true" />
          Back
        </button>

        <span className="scout-contact-panel-title">Contact</span>

        {summary && (
          <button
            type="button"
            className="scout-contact-panel-btn primary"
            onClick={() => openQuickEngage(summary, { origin: 'scout_contact_panel' })}
          >
            <Zap size={13} aria-hidden="true" />
            Quick Engage
          </button>
        )}

        <button
          type="button"
          className="scout-contact-panel-btn"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="scout-contact-panel-body">
        {/* onClose is what puts ContactProfile into panel mode
            (isPanelMode = !!onClose), which suppresses its own page header
            and the hardcoded "Back to People" button. */}
        <ContactProfile
          contactId={contactId}
          onClose={onClose}
          banner={({ triggerEngage }) => (
            <ArrivalBanner
              intent={intent}
              entryLabel={originDestination?.label ?? null}
              onAction={triggerEngage}
              onBack={onClose}
            />
          )}
        />
      </div>
    </aside>
  );
}
