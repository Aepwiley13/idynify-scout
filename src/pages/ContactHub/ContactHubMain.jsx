/**
 * ContactHubMain — the Contact Hub section (Phase 1A: My People only).
 *
 * A simple home for the people a user knows. It renders inside the global
 * shell like every other module and owns only its own content:
 *
 *   /contact-hub                      My People  (HubPeople)
 *   /contact-hub/person/:contactId    one person (HubPerson)
 *
 * THE PEOPLE ARE THE USER'S EXISTING CONTACTS. This reads the same
 * users/{uid}/contacts collection People reads, once, and holds it for both
 * views, so opening a person and coming back does not reload or lose the
 * search. There is no Contact Hub collection and no Contact Hub field.
 *
 * Writes happen only through code that already existed: the manual add form,
 * the sticker components and the contact card's inline edits. This file
 * writes nothing.
 *
 * Mounted only when the Contact Hub switch is on (constants/contactHub.js).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useActiveUserId } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { StickersProvider } from '../../components/stickers/StickersContext';
import { withMembershipChange } from '../../services/stickers/stickerCore';
import { HUB_STATUS } from './hubPeople';
import './ContactHub.css';

export default function ContactHubMain() {
  const T = useT();
  const uid = useActiveUserId();
  const [contacts, setContacts] = useState([]);
  const [attempt, setAttempt] = useState(0);
  // The outcome of one load, tagged with what it was a load OF. A different
  // user, or a retry, is "loading" until its own outcome arrives — derived,
  // so there is no moment where the old answer is shown for the new request.
  const loadKey = `${uid ?? ''}:${attempt}`;
  const [outcome, setOutcome] = useState({ key: null, status: HUB_STATUS.LOADING });
  const status = outcome.key === loadKey ? outcome.status : HUB_STATUS.LOADING;

  // What the list was showing, kept here so it survives opening a person.
  const [searchTerm, setSearchTerm] = useState('');
  const [stickerId, setStickerId] = useState(null);

  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    getDocs(collection(db, 'users', uid, 'contacts'))
      .then((snapshot) => {
        if (!live) return;
        setContacts(snapshot.docs.map((d) => ({ ...d.data(), id: d.id })));
        setOutcome({ key: loadKey, status: HUB_STATUS.READY });
      })
      .catch((err) => {
        // Code only: no contact data in logs.
        console.error('[contact-hub] could not load people', { code: err?.code ?? 'unknown' });
        if (live) setOutcome({ key: loadKey, status: HUB_STATUS.ERROR });
      });
    return () => { live = false; };
  }, [uid, loadKey]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /** A person changed on their card (name, phone, notes, stickers…). */
  const updateContact = useCallback((next) => {
    if (!next?.id) return;
    setContacts((prev) => prev.map((c) => (c.id === next.id ? { ...c, ...next } : c)));
  }, []);

  /** People the add form just saved. */
  const addContacts = useCallback((added) => {
    const fresh = (added ?? []).filter((c) => c?.id);
    if (!fresh.length) return;
    setContacts((prev) => {
      const known = new Set(prev.map((c) => c.id));
      return [...fresh.filter((c) => !known.has(c.id)), ...prev];
    });
  }, []);

  /** A sticker was added to or removed from someone, from a list row. */
  const applyStickerChange = useCallback((contactId, changedStickerId, op) => {
    setContacts((prev) => prev.map((c) => (c.id === contactId ? withMembershipChange(c, changedStickerId, op) : c)));
  }, []);

  const context = useMemo(() => ({
    uid, status, contacts, reload, updateContact, addContacts, applyStickerChange,
    searchTerm, setSearchTerm, stickerId, setStickerId,
  }), [uid, status, contacts, reload, updateContact, addContacts, applyStickerChange, searchTerm, stickerId]);

  return (
    <StickersProvider uid={uid}>
      <div className="hub" style={{ color: T.text }}>
        <div className="hub-inner">
          <Outlet context={context} />
        </div>
      </div>
    </StickersProvider>
  );
}
