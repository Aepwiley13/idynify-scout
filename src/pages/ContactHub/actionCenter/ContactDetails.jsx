import { useEffect, useState } from 'react';
import IdentityCard from '../../../components/contacts/IdentityCard';
import { locationText } from '../../../components/contacts/personHeader/personHeaderModel';
import { saveContactFields } from '../../../services/contactFields';
import { canWriteRelationship } from './relationship';
import { AFFILIATION_LIMITS, affiliationsForContact, MAX_CONTACT_AFFILIATIONS, saveContactAffiliations } from '../../../utils/contactAffiliations';

const emptyAffiliation = () => ({ id: crypto.randomUUID(), organization_name: null, company_id: null, title: null, type: null, status: 'current', primary: false, provenance: [] });

export default function ContactDetails({ contact, uid, canWrite, onUpdate }) {
  const [location, setLocation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [affiliations, setAffiliations] = useState(() => affiliationsForContact(contact));
  const [editingAffiliation, setEditingAffiliation] = useState(null);
  const [affiliationSaving, setAffiliationSaving] = useState(false);
  const [affiliationError, setAffiliationError] = useState('');
  useEffect(() => setAffiliations(affiliationsForContact(contact)), [contact]);

  function updateAffiliation(patch) {
    setEditingAffiliation((current) => ({ ...current, ...patch }));
  }

  async function saveAffiliation(event) {
    event.preventDefault();
    if (!canWrite || !canWriteRelationship(uid) || affiliationSaving) return;
    const row = { ...editingAffiliation,
      organization_name: editingAffiliation.organization_name?.trim() || null,
      title: editingAffiliation.title?.trim() || null,
      type: editingAffiliation.type?.trim() || null };
    let next = affiliations.some((item) => item.id === row.id)
      ? affiliations.map((item) => item.id === row.id ? row : item) : [...affiliations, row];
    if (row.primary) next = next.map((item) => ({ ...item, primary: item.id === row.id }));
    else if (!next.some((item) => item.primary)) next = next.map((item, index) => ({ ...item, primary: index === 0 }));
    setAffiliationSaving(true);
    setAffiliationError('');
    try {
      const result = await saveContactAffiliations(uid, contact.id, contact._contactHubVersion ?? null, next);
      setAffiliations(result.affiliations);
      onUpdate?.({ id: contact.id }, { contact_affiliations: result.affiliations, _contactHubVersion: result.contactVersion,
        title: result.affiliations.find((item) => item.primary)?.title ?? null,
        company_name: result.affiliations.find((item) => item.primary)?.organization_name ?? null,
        company_id: result.affiliations.find((item) => item.primary)?.company_id ?? null });
      setEditingAffiliation(null);
    } catch (error) {
      setAffiliationError(error.message === 'contact_changed' ? 'This contact changed elsewhere. Refresh the page before saving.' : 'The affiliation could not be saved. Your edits are still here; try again.');
    } finally { setAffiliationSaving(false); }
  }
  return <section className="ac-card ac-details">
    <h2>Contact information</h2>
    <dl>
      <div><dt>Organization</dt><dd>{contact.company_name || '—'}</dd></div>
      <div><dt>Job title</dt><dd>{contact.title || '—'}</dd></div>
      <div><dt>Location</dt><dd>{locationText(contact) || '—'}
        {canWrite && location === null && <button type="button" onClick={() => setLocation(locationText(contact) || '')}>Edit location</button>}
      </dd></div>
    </dl>
    <section className="ac-affiliations" aria-labelledby="ac-affiliations-heading">
      <div className="ac-affiliations__heading"><h3 id="ac-affiliations-heading">Roles &amp; organizations</h3>
        {canWrite && affiliations.length < MAX_CONTACT_AFFILIATIONS && <button type="button" disabled={affiliationSaving} onClick={() => { setAffiliationError(''); setEditingAffiliation(emptyAffiliation()); }}>Add affiliation</button>}
      </div>
      {affiliations.length === 0 ? <p>No affiliations saved.</p> : <ul>{affiliations.map((item) => <li key={item.id}>
        <div><strong>{item.title || 'Role not specified'}</strong><span>{item.organization_name || 'Organization not specified'}{item.status === 'former' ? ' · Former' : ''}</span>{item.primary && <small>Primary</small>}</div>
        {canWrite && <button type="button" disabled={affiliationSaving} aria-label={`Edit ${item.title || item.organization_name || 'affiliation'}`} onClick={() => { setAffiliationError(''); setEditingAffiliation({ ...item }); }}>Edit</button>}
      </li>)}</ul>}
      {editingAffiliation && <form className="ac-form ac-affiliations__form" onSubmit={saveAffiliation}>
        <label>Organization <input autoFocus maxLength={AFFILIATION_LIMITS.organization} value={editingAffiliation.organization_name ?? ''} onChange={(event) => updateAffiliation({ organization_name: event.target.value })} disabled={affiliationSaving} /></label>
        <label>Job title or role <input maxLength={AFFILIATION_LIMITS.title} value={editingAffiliation.title ?? ''} onChange={(event) => updateAffiliation({ title: event.target.value })} disabled={affiliationSaving} /></label>
        <label>Affiliation type (optional) <input maxLength={AFFILIATION_LIMITS.type} value={editingAffiliation.type ?? ''} onChange={(event) => updateAffiliation({ type: event.target.value })} disabled={affiliationSaving} /></label>
        <label>Status <select value={editingAffiliation.status} onChange={(event) => updateAffiliation({ status: event.target.value })} disabled={affiliationSaving}><option value="current">Current</option><option value="former">Former</option></select></label>
        <label className="ac-affiliations__primary"><input type="checkbox" checked={editingAffiliation.primary} onChange={(event) => updateAffiliation({ primary: event.target.checked })} disabled={affiliationSaving} /> Use as primary affiliation</label>
        <div><button disabled={affiliationSaving}>{affiliationSaving ? 'Saving…' : 'Save affiliation'}</button><button type="button" disabled={affiliationSaving} onClick={() => setEditingAffiliation(null)}>Cancel</button></div>
        {affiliationError && <p role="alert">{affiliationError}</p>}
      </form>}
      {affiliationError && !editingAffiliation && <p role="alert">{affiliationError}</p>}
    </section>
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
