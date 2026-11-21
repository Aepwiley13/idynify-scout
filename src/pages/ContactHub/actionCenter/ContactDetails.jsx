import { useState } from 'react';
import IdentityCard from '../../../components/contacts/IdentityCard';
import { locationText } from '../../../components/contacts/personHeader/personHeaderModel';
import { saveContactFields } from '../../../services/contactFields';
import { canWriteRelationship } from './relationship';

export default function ContactDetails({ contact, uid, canWrite, onUpdate }) {
  const [location, setLocation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  return <section className="ac-card ac-details">
    <h2>Contact information</h2>
    <dl>
      <div><dt>Organization</dt><dd>{contact.company_name || '—'}</dd></div>
      <div><dt>Job title</dt><dd>{contact.title || '—'}</dd></div>
      <div><dt>Location</dt><dd>{locationText(contact) || '—'}
        {canWrite && location === null && <button type="button" onClick={() => setLocation(locationText(contact) || '')}>Edit location</button>}
      </dd></div>
    </dl>
    {location !== null && <form className="ac-form" onSubmit={async (event) => {
      event.preventDefault();
      if (!canWrite || saving) return;
      setSaving(true);
      setError(false);
      const patch = { location: location.trim() };
      try {
        await saveContactFields(contact.id, patch, { expectUid: uid });
        if (canWriteRelationship(uid)) onUpdate({ id: contact.id }, patch);
        setLocation(null);
      } catch {
        setError(true);
      } finally {
        setSaving(false);
      }
    }}>
      <label>Location <input value={location} maxLength={200} disabled={saving} onChange={(event) => setLocation(event.target.value)} /></label>
      <button disabled={saving}>Save location</button>
      <button type="button" disabled={saving} onClick={() => { setLocation(null); setError(false); }}>Cancel</button>
      {error && <p role="alert">Location couldn’t be saved. Try again.</p>}
    </form>}
    <IdentityCard contact={contact} variant="details" readOnly={!canWrite} onUpdate={onUpdate} />
  </section>;
}
