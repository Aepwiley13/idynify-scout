/* eslint-disable react-refresh/only-export-components */
/**
 * PersonHeader with inline editing, for looking at. Synthetic contacts only. Each scene is a real PersonHeader driven
 * by the real useContactIdentityEdit hook; the wording for a refused name and a failed save is supplied here, as the
 * connected wrapper (H2-3) will. Nothing is read or written outside the page (see vite.edit.config.mjs).
 */
import '../../../src/index.css';
import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PersonHeader from '../../../src/components/contacts/personHeader/PersonHeader';
import { buildPersonHeaderModel } from '../../../src/components/contacts/personHeader/personHeaderModel';
import { EDIT_FIELDS } from '../../../src/components/contacts/personHeader/personHeaderContract';
import { useContactIdentityEdit } from '../../../src/components/contacts/personHeader/useContactIdentityEdit';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get('theme') === 'mission' ? 'mission' : 'workspace';
const NOW = Date.parse('2026-11-18T12:00:00Z');

const SCENES = [
  { id: 'full', label: 'A full contact', contact: { id: 'fx-1', name: 'Jordan Lee', title: 'Community Partner', company_name: 'Community Partners of Salt Lake', city: 'Salt Lake City', state: 'UT', phones: [{ id: '1', value: '(801) 555-0199', label: 'mobile' }], emails: [{ id: '0', value: 'jordan@communityslc.org' }], linkedin_url: 'https://www.linkedin.com/in/jordan-lee-example' } },
  { id: 'long', label: 'Very long name, title and organization', contact: { id: 'fx-5', name: 'Bartholomew-Alexandrovich Featherstonehaugh-Cholmondeley-Wolfeschlegelsteinhausenbergerdorff', title: 'Senior Vice President of Global Strategic Partnerships, Ecosystem Development and Public Sector Alliances', company_name: 'The International Association of Analytical Engine Manufacturers and Allied Trades of the Northern Hemisphere', location: 'Wales, United Kingdom', phones: [{ id: '1', value: '+44 20 7946 0958', label: 'work' }], emails: [{ id: '0', value: 'bartholomew@internationalassociation.example' }] } },
  { id: 'csv', label: 'A CSV import: first and last name only', contact: { id: 'fx-7', first_name: 'Morgan', last_name: 'Ellis', title: 'Analyst', company_name: 'Acme', emails: [{ id: '0', value: 'morgan@acme.example' }] } },
  { id: 'sparse', label: 'Name only: no title or organization yet', contact: { id: 'fx-8', name: 'Sam Okafor' } },
  { id: 'linked', label: 'Linked to a company: the organization is not editable', contact: { id: 'fx-9', name: 'Lee Park', title: 'CTO', company_name: 'Initech', company_id: 'co-9' } },
];
const REASON = { blank_name: "Name can't be empty." };

function Scene({ scene }) {
  const [contact, setContact] = useState(scene.contact);
  const onPatch = useCallback((id, fields) => setContact((c) => (c.id === id ? { ...c, ...fields } : c)), []);
  const edit = useContactIdentityEdit({ contact, onPatch });
  const editing = {
    editable: Object.fromEntries(EDIT_FIELDS.map((f) => [f, edit.editable(f)])),
    active: edit.editing,
    saving: Object.fromEntries(EDIT_FIELDS.map((f) => [f, edit.isSaving(f)])),
    problem: edit.problem ? { field: edit.problem.field, message: REASON[edit.problem.reason] ?? 'Check this and try again.' } : null,
    failure: edit.error ? { field: edit.error.field, message: `Couldn't save ${edit.error.field}. Try again.` } : null,
    onChange: edit.setValue, onSubmit: edit.commit, onCancel: edit.cancel,
  };
  return (
    <section className="fx-scene" data-scene={scene.id}>
      <h2 className="fx-label">{scene.label}</h2>
      <PersonHeader person={buildPersonHeaderModel(contact, { stickersById: null, now: NOW })} actions={{ onEdit: edit.start }} editing={editing} />
    </section>
  );
}

createRoot(document.getElementById('root')).render(<div className="fx-page">{SCENES.map((scene) => <Scene key={scene.id} scene={scene} />)}<button type="button" id="elsewhere">Elsewhere</button></div>);
document.fonts.ready.then(() => { document.documentElement.dataset.ready = '1'; });
