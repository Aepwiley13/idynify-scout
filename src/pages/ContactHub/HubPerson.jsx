/**
 * HubPerson — one person, in Contact Hub.
 *
 * The approved profile header stays above the relationship workspace.
 * Edits and late sticker completions are merged by contact ID.
 *
 * The person comes from the list ContactHubMain already loaded. A link opened
 * cold (a refresh, a bookmark) waits for that load; a person who is not in My
 * People, or does not exist, gets a plain "not here" with a way back.
 */
import { useCallback } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { canUseContactHubScout, CONTACT_HUB_PATH } from '../../constants/contactHub';
import ConnectedPersonHeader from '../../components/contacts/personHeader/ConnectedPersonHeader';
import ContactActionCenter from './actionCenter/ContactActionCenter';
import { useImpersonation } from '../../context/ImpersonationContext';
import { useShell, useShellEntity } from '../../context/ShellContext';
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
  const { uid, status, contacts, updateContact, applyStickerChange, reload } = useOutletContext();
  const { isImpersonating, isReadOnly } = useImpersonation();
  const { shellUser, openBarry } = useShell();
  const readOnly = Boolean(isImpersonating || isReadOnly);
  const scout = !readOnly && canUseContactHubScout(uid, shellUser);
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
      {/* Keep transient editing state scoped to this person and session. */}
      <ConnectedPersonHeader key={`header-${contact.id}`} contact={contact} onPatch={patchContact} onLateStickerChange={applyStickerChange} />
      <ContactActionCenter key={JSON.stringify([uid, contact.id, readOnly])} uid={uid} contact={contact}
        readOnly={readOnly} scout={scout} openBarry={openBarry} onUpdate={updateContact} onLateStickerChange={applyStickerChange} />
    </div>
  );
}
