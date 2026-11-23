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
import { BrowserRouter, Link, MemoryRouter, Routes } from 'react-router-dom';
import { contactHubRoutes } from '../../../src/pages/ContactHub/contactHubRoutes';
import { ShellProvider } from '../../../src/context/ShellContext';
import { AccountPlanContext } from '../../../src/components/billing/accountPlanContext';
import { PLAN } from '../../../src/utils/accountPlan';
import ContactHubGmailHeader from '../../../src/pages/ContactHub/ContactHubGmailHeader';
import { configureGmailFixture, openFixtureConsent } from './stubs/gmail';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useThemeCtx } from '../../../src/theme/ThemeContext';
import { StickersProvider } from '../../../src/components/stickers/StickersContext';
import ConnectedPersonHeader from '../../../src/components/contacts/personHeader/ConnectedPersonHeader';
import IdentityCard from '../../../src/components/contacts/IdentityCard';
import { withMembershipChange } from '../../../src/services/stickers/stickerCore';
import ContactActionCenter from '../../../src/pages/ContactHub/actionCenter/ContactActionCenter';
import { seedFixtureDoc } from './stubs/firestore';
import { getEffectiveUser } from './stubs/impersonation';
import { fixture, log, wait } from './stubs/fixture.js';
import ContactPhotoEditor from '../../../src/components/contacts/personHeader/ContactPhotoEditor';

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
const isDuplicateDemo = params.get('duplicates') === '1';
const isWorkspace = isDuplicateDemo || params.get('workspace') === '1';
const isAction = isWorkspace || params.get('action') === '1';
const isGmailDemo = isAction && params.get('gmail_demo') === '1';
const isPhotoDemo = isAction && params.get('photo') === '1';
const scout = params.get('scout') === '1' && !fixture.readonly;
const uid = getEffectiveUser().uid;
const dateAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
const BY_ID = Object.fromEntries(CONTACTS.map((c) => [c.id, c]));
if (isDuplicateDemo) {
  BY_ID['jordan-import'] = {
    id: 'jordan-import', name: 'Jordan Lee', title: 'Basketball Coach', company_name: 'Salt Lake Youth League',
    emails: [{ id: '2', value: 'jordan.personal@example.org', label: 'personal', labelSource: 'user' }],
    email: 'jordan.personal@example.org',
    phones: [{ id: '2', value: '801-555-0101', label: 'home', labelSource: 'user', observedLabel: 'Personal' }],
    phone: '801-555-0101', source: 'csv_import', identity_source: 'community_import',
    identity_sources: ['community_import', 'jordan-import-csv'],
    sticker_ids: ['S02'], sticker_assignments: { S02: { assigned_at: '2026-11-20T11:00:00.000Z', assigned_by: 'csv_import' } },
    linkedin_url: 'https://www.linkedin.com/in/jordan-lee-example',
    notes: [{ id: 'introduction', content: 'Introduced by a neighborhood partner', created_at: dateAgo(3), source: 'community_import' }],
    contact_affiliations: [{ id: 'jordan-coach-role', organization_name: 'Salt Lake Youth League', company_id: null, title: 'Basketball Coach', type: 'Volunteer', status: 'current', primary: false, provenance: [{ source: 'community_import', contact_id: 'jordan-import' }] }],
  };
  BY_ID.jordan = { ...BY_ID.jordan, title: 'Director', company_name: 'T-Mobile', company_id: 'tmobile-example',
    phones: BY_ID.jordan.phones.map((phone) => ({ ...phone, labelSource: 'card' })),
    emails: BY_ID.jordan.emails.map((email) => ({ ...email, labelSource: 'card' })),
    contact_affiliations: [{ id: 'jordan-director-role', organization_name: 'T-Mobile', company_id: 'tmobile-example', title: 'Director', type: 'Employment', status: 'current', primary: true, provenance: [{ source: 'business_card', contact_id: 'jordan' }] }],
    sticker_assignments: { S01: { assigned_at: '2026-11-20T10:00:00.000Z', assigned_by: 'user' }, S06: { assigned_at: '2026-11-20T10:05:00.000Z', assigned_by: 'user' }, S07: { assigned_at: '2026-11-20T10:10:00.000Z', assigned_by: 'user' } },
  };
  BY_ID['avery-review'] = {
    id: 'avery-review', name: 'Averi Quinn', company_name: 'Volunteer Network', title: 'Board Member',
  };
  BY_ID.avery = { ...BY_ID.avery, company_name: 'Volunteer Network', source: 'manual' };
}
if (isGmailDemo) {
  BY_ID.jordan = { ...BY_ID.jordan, emails: [
    { value: 'jordan@example.org', label: 'work' },
    { value: 'jordan.personal@example.net', label: 'personal' },
  ], email: 'imported@example.net' };
  configureGmailFixture(BY_ID);
}
if (isAction) {
  BY_ID.jordan = { ...BY_ID.jordan, notes: [
    { id: 'intro', content: 'Met Jordan at the neighborhood partners lunch.', created_at: dateAgo(4) },
  ] };
  BY_ID.morgan = { ...BY_ID.morgan, next_best_step: {
    id: 'barry-sample', action: 'Send Morgan the community calendar', due_at: dateAgo(-5), status: 'pending',
  } };
  for (const contact of Object.values(BY_ID)) seedFixtureDoc(`users/${uid}/contacts/${contact.id}`, contact);
  const historyPath = `users/${uid}/contacts/jordan/timeline/`;
  seedFixtureDoc(historyPath + 'call', { type: 'outreach_logged', preview: 'Jordan offered to introduce the volunteer coordinator.', metadata: { channel: 'call' }, createdAt: dateAgo(2) });
  seedFixtureDoc(historyPath + 'email', { type: 'message_sent', preview: 'Shared the volunteer sign-up link.', metadata: { channel: 'email' }, createdAt: dateAgo(1) });
  if (isDuplicateDemo) seedFixtureDoc(`users/${uid}/contacts/jordan-import/timeline/import-meeting`, { type: 'outreach_logged', preview: 'Discussed coaching and the summer league.', metadata: { channel: 'meeting', source: 'community_import' }, createdAt: dateAgo(6) });
  seedFixtureDoc(`users/${uid}/card/main`, {
    firstName: 'Jordan', lastName: 'Lee', photoUrl: 'https://images.fixture.test/jordan.svg',
    title: 'Community Partnerships Director', organization: 'Community Partners of Salt Lake',
    email: 'jordan.lee@example.org', phone: '+1 (801) 555-0199',
    linkedinUrl: 'https://www.linkedin.com/in/jordan-lee-example', instagram: 'jordan.lee',
    website: 'https://communitypartners.example.org',
    share: { photoUrl: true, title: true, organization: true, email: true, phone: true, linkedinUrl: true, instagram: true, website: true },
    sharingEnabled: false, schemaVersion: 1, revision: 3,
  });
}

const photoEditor = {
  Editor: ContactPhotoEditor,
  async saveOverride(id, { photoOverride }, { expectUid }) {
    const canSave = () => {
      const user = getEffectiveUser();
      return !fixture.readonly && !user?._isImpersonated && user?.uid === uid && expectUid === uid && Object.hasOwn(BY_ID, id);
    };
    if (!canSave()) throw Object.assign(new Error('Fixture access denied'), { code: 'permission-denied' });
    log({ kind: 'photo override', path: `users/${uid}/contacts/${id}/private/photo`, fields: photoOverride?.kind ?? 'restore' });
    await wait();
    if (!canSave()) throw Object.assign(new Error('Fixture account changed'), { code: 'permission-denied' });
    if (fixture.failNext) {
      fixture.failNext = false;
      throw Object.assign(new Error('Fixture save failed'), { code: 'unavailable' });
    }
  },
};

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
      {isGmailDemo && <div className="demo-group"><label>Next simulated send <select aria-label="Next simulated send"
        defaultValue="sent" onChange={(event) => { fixture.gmailOutcome = event.target.value; }}>
        <option value="sent">Success</option><option value="retry">Recoverable failure</option>
        <option value="unknown">Uncertain delivery</option><option value="quota">Contact Hub rate limit</option>
        <option value="gmailQuota">Gmail rate limit</option>
      </select></label></div>}
      {isAction && <div className="demo-group"><span>Access</span>
        <a className="demo-btn" href={link({ scout: null })} aria-current={!scout}>Free</a>
        <a className="demo-btn" href={link({ scout: '1' })} aria-current={scout}>Scout</a>
      </div>}
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
  const [photoOverrides, setPhotoOverrides] = useState({});
  const [currentId, setCurrentId] = useState(params.get('contact') && BY_ID[params.get('contact')] ? params.get('contact') : 'jordan');
  const [barryOpened, setBarryOpened] = useState(false);
  const [, bump] = useReducer((n) => n + 1, 0);
  // What Contact Hub's list will do: merge what it is told into that contact, by id.
  const onPatch = useCallback((id, fields) => {
    if (Object.hasOwn(fields, 'photoOverride')) {
      setPhotoOverrides((previous) => ({ ...previous, [id]: fields.photoOverride }));
    } else {
      setContacts((previous) => ({ ...previous, [id]: { ...previous[id], ...fields } }));
    }
  }, []);
  const onUpdate = useCallback((next, patch = next) => setContacts((prev) => {
    if (!next?.id) return prev;
    const current = prev[next.id];
    return { ...prev, [next.id]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) } };
  }), []);
  const onLateStickerChange = useCallback((id, stickerId, op) => setContacts((prev) => ({ ...prev, [id]: withMembershipChange(prev[id], stickerId, op) })), []);
  const contact = contacts[currentId];
  return (
    <div className="demo">
      {isGmailDemo ? <p className="demo-banner"><strong>Isolated Gmail review.</strong> All connection and send outcomes are simulated.</p> : isAction ? <p className="demo-banner"><strong>Isolated Action Center.</strong> Sample contacts and in-memory saves.</p> : <p className="demo-banner"><strong>Isolated demo of the redesigned Contact Profile.</strong> Real components, made-up contacts, edits kept in this page only (reload resets them). Try: edit the name, title or organization (Enter saves, Esc or Cancel cancels, leaving the box saves); click the photo; Change photo; add and remove stickers and press Undo; edit email, phone and social below the header; use <em>Fail next save</em> to see Try again and Retry.</p>}
      <Controls currentId={currentId} onPick={setCurrentId} bump={bump} />
      <main className={isAction ? "demo-profile hub-person--action" : "demo-profile"}>
        {isGmailDemo ? <ContactHubGmailHeader key={currentId} uid={uid} readOnly={fixture.readonly} contact={contact}
          onPatch={onPatch} onLateStickerChange={onLateStickerChange} openConsent={openFixtureConsent} />
          : <ConnectedPersonHeader compactMobileHeader={isAction} photoEditor={isPhotoDemo ? photoEditor : undefined}
          contact={isPhotoDemo ? { ...contact, photoOverride: photoOverrides[currentId] } : contact} onPatch={onPatch} onLateStickerChange={onLateStickerChange} />}
        {isAction ? (
          <ContactActionCenter key={currentId} uid={uid} contact={contact} readOnly={fixture.readonly}
            scout={scout} openBarry={() => setBarryOpened(true)} onUpdate={onUpdate} onLateStickerChange={onLateStickerChange} />
        ) : <IdentityCard contact={contact} onUpdate={onUpdate} variant="details" />}
        {barryOpened && <section aria-label="Barry fixture" role="status">
          Barry opened for {contact.name || contact.first_name}. <button onClick={() => setBarryOpened(false)}>Close Barry</button>
        </section>}
      </main>
      <WriteLog />
    </div>
  );
}

function WorkspaceDemo() {
  const account = { id: uid, hasCompletedPayment: scout };
  return (
    <div className="demo">
      <p className="demo-banner"><strong>{isDuplicateDemo ? 'Isolated duplicate review.' : 'Isolated Contact Hub workspace.'}</strong> Synthetic data and local-only saves.</p>
      <MemoryRouter initialEntries={['/contact-hub']}>
        <ShellProvider user={account} userData={account}>
          <AccountPlanContext.Provider value={scout ? PLAN.STARTER : PLAN.FREE}>
            <nav className="demo-controls" aria-label="Fixture navigation">
              <Link className="demo-btn" to="/contact-hub/my-card">My Card</Link>
              <Link className="demo-btn" to="/contact-hub">My People</Link>
              <Link className="demo-btn" to="/contact-hub/stickers">Sticker Wall</Link>
            </nav>
            <Routes>{contactHubRoutes()}</Routes>
          </AccountPlanContext.Provider>
        </ShellProvider>
      </MemoryRouter>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    {isWorkspace ? <WorkspaceDemo /> : <StickersProvider uid="u1"><BrowserRouter><Demo /></BrowserRouter></StickersProvider>}
  </ThemeProvider>,
);
document.fonts.ready.then(() => { document.documentElement.dataset.ready = '1'; });
