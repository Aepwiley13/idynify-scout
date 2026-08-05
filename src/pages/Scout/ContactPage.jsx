/**
 * ContactPage — the canonical contact destination at /contact/:contactId.
 *
 * TWO DISPLAY MODES, ONE IMPLEMENTATION
 * ─────────────────────────────────────
 * This is the PAGE mode. ContactProfilePanel is the PANEL mode. Both render
 * the same ContactProfile with the same data loader, the same actions, the
 * same Barry context and the same timeline — the only difference is what
 * surrounds it and what closing means:
 *
 *   page   (/contact/:id)         full width, Back goes to `returnTo`
 *   panel  (/scout/contact/:id)   over Scout's list, Escape closes to the list
 *
 * Scout keeps the panel because Scout has something worth preserving behind
 * it: a filtered, sorted, scrolled list the user built. Mission Control, the
 * Command Bar and every other module have no such list, and overlaying a panel
 * on an unrelated screen was exactly the bug — a user clicking a priority in
 * Mission Control ended up looking at Scout's Daily Leads through a gap.
 *
 * WHAT THIS COMPONENT OWNS
 * ────────────────────────
 * Arrival. It reads the ephemeral navigation intent, tells the shell where the
 * user came from (so the breadcrumb says Mission Control, not Scout), loads
 * Barry's persistent memory for the contact, and renders the arrival banner.
 * The contact record itself is ContactProfile's job and stays there.
 *
 * It deliberately does NOT mount ScoutMain, and nothing in its tree imports it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useArrival, useShellEntity } from '../../context/ShellContext';
import { readNavigationIntent, originModuleId, barrySessionKey } from '../../utils/navigation';
import { resolveDestination, resolveModule, MISSION_CONTROL } from '../../constants/navigationModel';
import { loadContactMemory } from '../../services/barryMemoryService';
import ArrivalBanner from '../../components/contacts/ArrivalBanner';
import ContactProfile from './ContactProfile';

function displayName(contact) {
  if (!contact) return null;
  const composed = [contact.firstName ?? contact.first_name, contact.lastName ?? contact.last_name]
    .filter(Boolean).join(' ').trim();
  return composed || contact.name || contact.email || 'Contact';
}

export default function ContactPage() {
  const { contactId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [summary, setSummary] = useState(null);
  // Which contact Barry's memory has been warmed for, rather than a boolean.
  // Storing the id makes "loaded" derivable during render, so switching
  // contacts is stale-by-construction instead of needing a reset write inside
  // the effect that starts the next load.
  const [memoryLoadedFor, setMemoryLoadedFor] = useState(null);
  const memoryLoaded = memoryLoadedFor === contactId;
  const headingRef = useRef(null);

  // Intent is matched against THIS contact — see readNavigationIntent for why.
  const intent = useMemo(
    () => readNavigationIntent(location, { entityType: 'contact', entityId: contactId }),
    [location, contactId],
  );

  const origin = originModuleId(intent, resolveModule);
  const originDestination = resolveDestination(origin);
  const sessionKey = useMemo(() => barrySessionKey(intent, contactId), [intent, contactId]);

  // Tell the shell where the user came from and why. Drives the breadcrumb,
  // and rides along on every Barry message via navigationContext.
  useArrival({ intent, originModuleId: origin, sessionKey, memoryLoaded });

  // A light read for the breadcrumb's entity segment. ContactProfile loads the
  // full record itself; this needs a name and a stage before that resolves.
  useEffect(() => {
    let cancelled = false;
    const user = getEffectiveUser();
    if (!user || !contactId) return undefined;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'contacts', contactId));
        if (!cancelled && snap.exists()) setSummary({ id: snap.id, ...snap.data() });
      } catch (err) {
        console.warn('[ContactPage] summary load failed:', err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [contactId]);

  useShellEntity({
    type: 'contact',
    id: contactId,
    stage: summary?.stage ?? null,
    label: displayName(summary),
  });

  /**
   * Barry reads persistent memory from the contact record on arrival.
   *
   * Fired here rather than inside Barry so the memory is warm before the user
   * opens the panel — Barry's first message should already know this person,
   * not spend a round trip discovering them. The result is not held in state:
   * barryMemoryService owns the record read, and duplicating its payload into
   * the page would give two sources for the same thing. What this tracks is
   * whether the read has HAPPENED, which is what the contract reports.
   */
  useEffect(() => {
    let cancelled = false;
    const user = getEffectiveUser();
    if (!user || !contactId) return undefined;

    loadContactMemory(user.uid, contactId)
      .then(() => { if (!cancelled) setMemoryLoadedFor(contactId); })
      .catch((err) => {
        console.warn('[ContactPage] Barry memory preload failed:', err?.message);
      });

    return () => { cancelled = true; };
  }, [contactId]);

  /**
   * Focus management on open.
   *
   * A full-page navigation leaves focus on whatever the user clicked, which no
   * longer exists — so keyboard and screen-reader users land at the top of the
   * document with no announcement. Moving focus to the page container makes
   * the landmark the starting point for Tab, and the aria-label names where
   * they have arrived. Re-runs on contactId so clicking through to a second
   * contact re-announces.
   */
  useEffect(() => {
    headingRef.current?.focus();
  }, [contactId]);

  const returnTo = intent?.returnTo ?? null;
  const backLabel = originDestination
    ? `Back to ${originDestination.label}`
    : 'Back to People';

  const goBack = () => {
    if (returnTo) navigate(returnTo);
    else navigate(MISSION_CONTROL.path);
  };

  return (
    <div
      ref={headingRef}
      tabIndex={-1}
      className="canonical-contact-page"
      aria-label={summary ? `Contact — ${displayName(summary)}` : 'Contact'}
      style={{ outline: 'none' }}
    >
      <ContactProfile
        contactId={contactId}
        returnTo={returnTo}
        returnLabel={backLabel}
        banner={({ triggerEngage }) => (
          <ArrivalBanner
            intent={intent}
            entryLabel={originDestination?.label ?? null}
            onAction={triggerEngage}
            onBack={goBack}
          />
        )}
      />
    </div>
  );
}
