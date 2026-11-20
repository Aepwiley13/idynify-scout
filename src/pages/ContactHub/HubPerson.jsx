/**
 * HubPerson — one person, in Contact Hub.
 *
 * The redesigned profile header (photo, name, title, organization, ways to
 * reach them, stickers: all editable here, through ConnectedPersonHeader), the
 * existing card's contact details (email, phones, social profiles: the same
 * editors as before, IdentityCard variant="details") and their notes. No
 * stages, engagement, outreach or lookups: the full profile at /contact/:id is
 * untouched and is not linked from here.
 *
 * The header reports every change as an id-addressed patch, which this page's
 * list merges by id (updateContact); a sticker change that finishes after the
 * person moved on is applied by id (applyStickerChange).
 *
 * The person comes from the list ContactHubMain already loaded. A link opened
 * cold (a refresh, a bookmark) waits for that load; a person who is not in My
 * People, or does not exist, gets a plain "not here" with a way back.
 */
import { useCallback } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { CONTACT_HUB_PATH } from '../../constants/contactHub';
import IdentityCard from '../../components/contacts/IdentityCard';
import ConnectedPersonHeader from '../../components/contacts/personHeader/ConnectedPersonHeader';
import StickyNotes from '../../components/contacts/StickyNotes';
import { useShellEntity } from '../../context/ShellContext';
import { HUB_STATUS, isListedInMyPeople, personName } from './peopleRules';

function BackLink() {
  const T = useT();
  // Back to My People as it was left, sticker filter included.
  const { listPath } = useOutletContext();
  return (
    <Link className="hub-back" to={listPath || CONTACT_HUB_PATH} style={{ color: T.text }}>
      <ArrowLeft size={18} aria-hidden="true" />
      My People
    </Link>
  );
}

export default function HubPerson() {
  const T = useT();
  const { contactId } = useParams();
  const { status, contacts, updateContact, applyStickerChange, reload } = useOutletContext();
  const contact = contacts.find((c) => c.id === contactId);
  // updateContact merges what it is given into the contact with that id, so a patch changes only its fields, on that contact.
  const patchContact = useCallback((id, fields) => updateContact({ id, ...fields }), [updateContact]);

  // Tell the shell who is open, as every other profile does: the top bar then
  // names the person, and Barry (if opened) knows who is on screen. Only for a
  // person actually shown here, and with no pipeline stage: Contact Hub has none.
  const shown = status === HUB_STATUS.READY && contact && isListedInMyPeople(contact) ? contact : null;
  useShellEntity({
    type: 'contact',
    id: shown?.id,
    stage: null,
    label: shown ? personName(shown) : null,
  });

  if (status === HUB_STATUS.LOADING) {
    return (
      <>
        <BackLink />
        <p className="hub-note" style={{ color: T.textMuted }}>Loading…</p>
      </>
    );
  }

  if (status === HUB_STATUS.ERROR) {
    return (
      <>
        <BackLink />
        <div className="hub-empty">
          <p className="hub-empty-title">This person could not be loaded.</p>
          <button type="button" className="hub-secondary-btn" style={{ color: T.text, borderColor: T.border }} onClick={reload}>Try again</button>
        </div>
      </>
    );
  }

  if (!contact || !isListedInMyPeople(contact)) {
    return (
      <>
        <BackLink />
        <div className="hub-empty">
          <p className="hub-empty-title">This person is not in My People.</p>
        </div>
      </>
    );
  }

  return (
    <div className="hub-person">
      <BackLink />
      {/* Keyed by person: the header, the card and the notes hold edit state of their own. */}
      <ConnectedPersonHeader key={`header-${contact.id}`} contact={contact} onPatch={patchContact} onLateStickerChange={applyStickerChange} />
      <IdentityCard key={`card-${contact.id}`} contact={contact} onUpdate={updateContact} variant="details" />
      <section className="hub-card hub-notes" aria-label="Notes" style={{ background: T.cardBg, borderColor: T.border }}>
        <StickyNotes key={`notes-${contact.id}`} contact={contact} onUpdate={updateContact} />
      </section>
    </div>
  );
}
