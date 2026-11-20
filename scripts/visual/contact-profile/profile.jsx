/* eslint-disable react-refresh/only-export-components */
/**
 * The redesigned Contact Profile, working. Synthetic contacts only, in this page's memory.
 *
 * What is real: ConnectedPersonHeader and everything under it (the identity, photo and sticker controllers, the
 * photo viewer, the sticker picker), IdentityCard variant="details" (its email, phone and social editors), the sticker
 * and theme providers. What is a stand-in: persistence (stubs/). The page plays the part Contact Hub's list will play:
 * it keeps every contact in one state and merges what it is told, by id.
 */
import '../../../src/index.css';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useThemeCtx } from '../../../src/theme/ThemeContext';
import { StickersProvider } from '../../../src/components/stickers/StickersContext';
import ConnectedPersonHeader from '../../../src/components/contacts/personHeader/ConnectedPersonHeader';
import IdentityCard from '../../../src/components/contacts/IdentityCard';
import { withMembershipChange } from '../../../src/services/stickers/stickerCore';
import { fixture } from './stubs/fixture.js';

const params = new URLSearchParams(window.location.search);
if (params.get('theme')) { try { window.localStorage.setItem('idynify_theme', params.get('theme') === 'dark' ? 'mission' : 'workspace'); } catch { /* storage blocked */ } }
// Served by this page's own dev server over http (Vite would inline a small file as a data: address, which the app does not treat as a photo).
const portrait = (name) => `${window.location.origin}/scripts/visual/contact-profile/portraits/${name}.svg`;

const CONTACTS = [
  { id: 'jordan', name: 'Jordan Lee', title: 'Community Partner', company_name: 'Community Partners of Salt Lake', city: 'Salt Lake City', state: 'UT', photo_url: portrait('jordan'), photo_source: 'apollo', phones: [{ id: '1', value: '(801) 555-0199', label: 'mobile' }], emails: [{ id: '0', value: 'jordan@communityslc.org', label: 'work' }], linkedin_url: 'https://www.linkedin.com/in/jordan-lee-example', social_profiles: [{ platform: 'instagram', handle: 'jordan.lee', url: 'https://www.instagram.com/jordan.lee' }], sticker_ids: ['S01', 'S06', 'S07'], last_message_at: new Date(Date.now() - 5 * 86400000).toISOString() },
  { id: 'avery', name: 'Avery Quinn', title: 'Program Director', city: 'Denver', state: 'CO', emails: [{ id: '0', value: 'avery@example.org', label: 'work' }], sticker_ids: [] },
  { id: 'morgan', first_name: 'Morgan', last_name: 'Ellis', email: 'morgan.ellis@example.org', phone: '555-0142', source: 'csv_import', sticker_ids: ['S02'] },
  { id: 'lee', name: 'Lee Park', title: 'CTO', company_name: 'Initech', company_id: 'co-9', city: 'Austin', state: 'TX', photo_url: portrait('avery'), phones: [{ id: '1', value: '(512) 555-0110', label: 'work' }], emails: [{ id: '0', value: 'lee@initech.example', label: 'work' }], linkedin_url: 'https://www.linkedin.com/in/lee-park-example', sticker_ids: ['S03', 'S04'] },
  { id: 'long', name: 'Bartholomew-Alexandrovich Featherstonehaugh-Cholmondeley-Wolfeschlegelsteinhausenbergerdorff', title: 'Senior Vice President of Global Strategic Partnerships, Ecosystem Development and Public Sector Alliances', company_name: 'The International Association of Analytical Engine Manufacturers and Allied Trades of the Northern Hemisphere', location: 'Wales, United Kingdom', photo_url: portrait('morgan'), phones: [{ id: '1', value: '+44 20 7946 0958', label: 'work' }], emails: [{ id: '0', value: 'bartholomew@internationalassociation.example', label: 'work' }], sticker_ids: ['S00', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'] },
];
const BY_ID = Object.fromEntries(CONTACTS.map((c) => [c.id, c]));

function Controls({ currentId, onPick, bump }) {
  const { themeId, setThemeId } = useThemeCtx();
  const link = (extra) => { const next = new URLSearchParams(window.location.search); for (const [k, v] of Object.entries(extra)) { if (v === null) next.delete(k); else next.set(k, v); } return `?${next.toString()}`; };
  const toggle = (key) => { fixture[key] = !fixture[key]; bump(); };
  return (
    <div className="demo-controls" role="group" aria-label="Review controls (not part of the profile)">
      <div className="demo-group" role="group" aria-label="Contact"><span>Contact</span>
        {CONTACTS.map((c) => <button key={c.id} type="button" className="demo-btn" aria-pressed={c.id === currentId} onClick={() => onPick(c.id)}>{c.id}</button>)}
      </div>
      <div className="demo-group" role="group" aria-label="Theme"><span>Theme</span>
        <button type="button" className="demo-btn" aria-pressed={themeId === 'workspace'} onClick={() => setThemeId('workspace')}>Light</button>
        <button type="button" className="demo-btn" aria-pressed={themeId === 'mission'} onClick={() => setThemeId('mission')}>Dark</button>
      </div>
      <div className="demo-group" role="group" aria-label="Make something fail"><span>Fail</span>
        <button type="button" className="demo-btn" aria-pressed={fixture.failNext} onClick={() => toggle('failNext')}>next save</button>
        <button type="button" className="demo-btn" aria-pressed={fixture.failNextSticker} onClick={() => toggle('failNextSticker')}>next sticker change</button>
      </div>
      <div className="demo-group"><span>Save takes</span>
        <select aria-label="How long a save takes" value={String(fixture.latency)} onChange={(e) => { fixture.latency = Number(e.target.value); bump(); }}>
          <option value="0">instant</option><option value="700">0.7 s</option><option value="2500">2.5 s</option><option value="6000">6 s</option>
        </select>
      </div>
      <div className="demo-group"><span>Session</span>
        <a className="demo-btn" href={link({ readonly: null })} aria-current={!fixture.readonly}>owner</a>
        <a className="demo-btn" href={link({ readonly: '1' })} aria-current={fixture.readonly}>admin viewing (read-only)</a>
      </div>
      <div className="demo-group"><span>Stickers</span>
        {[['on', 'on'], ['off', 'not available'], ['readonly', 'read-only']].map(([value, label]) => (
          <a key={value} className="demo-btn" href={link({ stickers: value === 'on' ? null : value })} aria-current={fixture.stickers === value}>{label}</a>
        ))}
      </div>
    </div>
  );
}

function WriteLog() {
  const [rows, setRows] = useState([]);
  useEffect(() => { const id = setInterval(() => setRows([...window.__writes]), 250); return () => clearInterval(id); }, []);
  return (
    <section className="demo-log" aria-label="Writes made (stand-ins; nothing leaves this page)">
      <h2>Writes asked for (nothing leaves this page)</h2>
      {rows.length === 0 ? <p>None yet. Edit something above.</p> : (
        <table><tbody>
          {rows.slice(-12).reverse().map((row) => (
            <tr key={row.at + row.path + row.fields}><td>{new Date(row.at).toLocaleTimeString()}</td><td>{row.kind}</td><td>{row.path}</td><td>{row.fields}</td></tr>
          ))}
        </tbody></table>
      )}
    </section>
  );
}

function Demo() {
  const [contacts, setContacts] = useState(BY_ID);
  const [currentId, setCurrentId] = useState(params.get('contact') && BY_ID[params.get('contact')] ? params.get('contact') : 'jordan');
  const [, bump] = useReducer((n) => n + 1, 0);
  // What Contact Hub's list will do: merge what it is told into that contact, by id.
  const onPatch = useCallback((id, fields) => setContacts((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } })), []);
  const onUpdate = useCallback((next) => setContacts((prev) => (next?.id ? { ...prev, [next.id]: { ...prev[next.id], ...next } } : prev)), []);
  const onLateStickerChange = useCallback((id, stickerId, op) => setContacts((prev) => ({ ...prev, [id]: withMembershipChange(prev[id], stickerId, op) })), []);
  const contact = contacts[currentId];
  return (
    <div className="demo">
      <p className="demo-banner"><strong>Isolated demo of the redesigned Contact Profile.</strong> Real components, made-up contacts, edits kept in this page only (reload resets them). Try: edit the name, title or organization (Enter saves, Esc or Cancel cancels, leaving the box saves); click the photo; Change photo; add and remove stickers and press Undo; edit email, phone and social below the header; use <em>Fail next save</em> to see Try again and Retry.</p>
      <Controls currentId={currentId} onPick={setCurrentId} bump={bump} />
      <main className="demo-profile">
        <ConnectedPersonHeader contact={contact} onPatch={onPatch} onLateStickerChange={onLateStickerChange} />
        <IdentityCard contact={contact} onUpdate={onUpdate} variant="details" />
      </main>
      <WriteLog />
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <StickersProvider uid="u1"><Demo /></StickersProvider>
  </ThemeProvider>,
);
document.fonts.ready.then(() => { document.documentElement.dataset.ready = '1'; });
