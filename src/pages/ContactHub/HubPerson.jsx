/**
 * HubPerson — one person, in Contact Hub.
 *
 * The existing contact card in its simple form (photo, name, title, company,
 * emails, phones, links, stickers) and their notes. No stages, engagement,
 * outreach or lookups: the full profile at /contact/:id is untouched and is
 * not linked from here.
 *
 * The person comes from the list ContactHubMain already loaded. A link opened
 * cold (a refresh, a bookmark) waits for that load; a person who is not in My
 * People, or does not exist, gets a plain "not here" with a way back.
 */
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { CONTACT_HUB_PATH } from '../../constants/contactHub';
import IdentityCard from '../../components/contacts/IdentityCard';
import StickyNotes from '../../components/contacts/StickyNotes';
import { HUB_STATUS, isListedInMyPeople } from './peopleRules';

function BackLink() {
  const T = useT();
  return (
    <Link className="hub-back" to={CONTACT_HUB_PATH} style={{ color: T.textMuted }}>
      <ArrowLeft size={18} aria-hidden="true" />
      My People
    </Link>
  );
}

export default function HubPerson() {
  const T = useT();
  const { contactId } = useParams();
  const { status, contacts, updateContact, reload } = useOutletContext();
  const contact = contacts.find((c) => c.id === contactId);

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
      {/* Keyed by person: the card and the notes hold edit state of their own. */}
      <IdentityCard key={`card-${contact.id}`} contact={contact} onUpdate={updateContact} variant="simple" />
      <section className="hub-card hub-notes" aria-label="Notes" style={{ background: T.cardBg, borderColor: T.border }}>
        <StickyNotes key={`notes-${contact.id}`} contact={contact} onUpdate={updateContact} />
      </section>
    </div>
  );
}
