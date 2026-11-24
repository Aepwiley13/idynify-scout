/**
 * PersonHeader, for looking at. Synthetic contacts only: nobody's record.
 *
 *   ?theme=workspace|mission      light or dark (the app's own themes)
 *
 * Each scene is a made-up contact turned into a display model by the real
 * buildPersonHeaderModel and drawn by the real PersonHeader, in a column the
 * width of Contact Hub's person page (960px at most). The sticker registry is a
 * Map, as the adapter takes it; the header itself is only handed display-ready
 * stickers. Nothing here reads or writes anything.
 */
import '../../../src/index.css';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import PersonHeader from '../../../src/components/contacts/personHeader/PersonHeader';
import { buildPersonHeaderModel } from '../../../src/components/contacts/personHeader/personHeaderModel';
import { addInertAddStickerMock } from './addStickerMock';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get('theme') === 'mission' ? 'mission' : 'workspace';
// ?mock=add-sticker adds an inert, clearly marked illustration of the proposed Add sticker chip (addStickerMock.js).
const MOCK_ADD_STICKER = params.get('mock') === 'add-sticker';

// The capture script answers this address with a drawn stand-in portrait, so no real image host is contacted.
const PHOTO = 'https://images.fixture.test/jordan.svg';
const PHOTO_2 = 'https://images.fixture.test/avery.svg';
const NOW = Date.parse('2026-11-18T12:00:00Z');

const sticker = (id, name, color, emoji = null) => [id, { id, name, color, emoji, status: 'active' }];
const REGISTRY = new Map([
  sticker('partner', 'Partner', 'purple', '🤝'),
  sticker('community', 'Community', 'green', '🌱'),
  sticker('priority', 'Priority', 'amber', '⭐'),
  sticker('education', 'Education', 'blue'),
  sticker('supporter', 'Supporter', 'pink', '💜'),
  sticker('long', 'Community partner, school fundraiser and annual gala volunteer committee', 'teal'),
  sticker('cjk', '友達 · Amigos', 'coral', '🌎'),
  sticker('volunteer', 'Volunteer', 'teal', '🙌'),
  sticker('board', 'Board member', 'blue'),
  sticker('mentor', 'Mentor', 'amber', '🧭'),
  sticker('donor', 'Donor', 'green'),
]);

const JORDAN = {
  id: 'fx-1', name: 'Jordan Lee', title: 'Community Partner', company_name: 'Community Partners of Salt Lake', city: 'Salt Lake City', state: 'UT',
  photo_url: PHOTO, phones: [{ id: '1', value: '(801) 555-0199', label: 'mobile' }], emails: [{ id: '0', value: 'jordan@communityslc.org', label: 'work' }],
  linkedin_url: 'https://www.linkedin.com/in/jordan-lee-example', social_profiles: [{ platform: 'instagram', handle: 'jordan.lee', url: 'https://www.instagram.com/jordan.lee' }],
  sticker_ids: ['partner', 'community', 'priority', 'education', 'supporter'], last_message_at: '2026-11-10T09:00:00Z',
};

const LONG = {
  id: 'fx-5', name: 'Bartholomew-Alexandrovich Featherstonehaugh-Cholmondeley-Wolfeschlegelsteinhausenbergerdorff',
  title: 'Senior Vice President of Global Strategic Partnerships, Ecosystem Development and Public Sector Alliances',
  company_name: 'The International Association of Analytical Engine Manufacturers and Allied Trades of the Northern Hemisphere',
  location: 'A very long place name, Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch, Wales, United Kingdom, Europe',
  phones: [{ id: '1', value: '+44 20 7946 0958 x204', label: 'work' }],
  emails: [{ id: '0', value: 'bartholomew.featherstonehaugh-cholmondeley@internationalassociation-analyticalengines.example', label: 'work' }],
  linkedin_url: 'https://www.linkedin.com/in/bartholomew-featherstonehaugh', facebook_url: 'https://www.facebook.com/bartholomew.f',
  sticker_ids: ['long', 'partner', 'community', 'long', 'priority', 'education', 'supporter'], last_contacted_at: '2026-06-01T00:00:00Z',
};

const withStickers = (contact, ids) => ({ ...contact, sticker_ids: ids });

const SCENES = [
  { id: 'full', label: 'Full contact: photo, contact methods, social, stickers', contact: JORDAN, stickers: true },
  { id: 'no-photo', label: 'Missing photo: initials', contact: { ...JORDAN, id: 'fx-2', name: 'Avery Quinn', photo_url: '', title: 'Program Director', company_name: 'Utah Arts Council', last_message_at: '2025-01-01T00:00:00Z', sticker_ids: ['education', 'supporter'] }, stickers: true },
  { id: 'photo-2', label: 'Photo, no organization and no location', contact: { ...JORDAN, id: 'fx-2b', name: 'Priya Raman', photo_url: PHOTO_2, company_name: '', city: '', state: '', title: 'Independent consultant', sticker_ids: ['partner'] }, stickers: true },
  { id: 'org-only', label: 'Organization and location only, no title', contact: { ...JORDAN, id: 'fx-3', name: 'Sam Okafor', photo_url: '', title: '', social_profiles: [], linkedin_url: '', sticker_ids: [] }, stickers: true },
  { id: 'name-only', label: 'Name only', contact: { id: 'fx-4', first_name: 'Morgan', last_name: 'Ellis' }, stickers: true },
  { id: 'long', label: 'Very long name, title, company, location, email and stickers', contact: { ...LONG, photo_url: PHOTO }, stickers: true },
  { id: 'cjk', label: 'International: CJK', contact: { id: 'fx-6', name: '李小龍', title: '創辦人兼執行長', company_name: 'Café Ünïcode 株式会社', city: '東京', country: '日本', phones: [{ id: '1', value: '+81 3 1234 5678', label: 'mobile' }], emails: [{ id: '0', value: 'li@example.jp' }], sticker_ids: ['cjk', 'partner'] }, stickers: true },
  { id: 'accents-rtl', label: 'International: accents, and right-to-left', contact: { id: 'fx-7', name: 'José Ünal Ñandú', title: 'Directora de Alianzas', company_name: 'Fundación Ñuble', city: 'Santiago', country: 'Chile', phones: [{ id: '1', value: '+56 2 2345 6789', label: 'work' }], emails: [{ id: '0', value: 'jose@example.cl' }], sticker_ids: ['community'] }, stickers: true },
  { id: 'rtl', label: 'International: Arabic name and title', contact: { id: 'fx-8', name: 'محمد علي الحسن', title: 'مدير الشراكات', company_name: 'مؤسسة النور', city: 'دبي', country: 'الإمارات', phones: [{ id: '1', value: '+971 4 123 4567', label: 'work' }], emails: [{ id: '0', value: 'mohammed@example.ae' }], sticker_ids: ['partner'] }, stickers: true },
  { id: 'phone-only', label: 'Phone only: no email', contact: { ...JORDAN, id: 'fx-13', name: 'Dana Whitfield', photo_url: '', emails: [], email: '', sticker_ids: ['partner', 'community'] }, stickers: true },
  { id: 'email-only', label: 'Email only: no phone', contact: { ...JORDAN, id: 'fx-14', name: 'Evan Castillo', photo_url: '', phones: [], phone: '', sticker_ids: ['education'] }, stickers: true },
  { id: 'bad-links', label: 'An email and a phone that cannot be made into safe links: no pills (the values stay on the contact)', contact: { ...JORDAN, id: 'fx-9', name: 'Casey Brooks', photo_url: '', phones: [{ id: '1', value: 'call the front desk', label: 'work' }], emails: [{ id: '0', value: 'casey@@broken' }], email: 'also not an email', linkedin_url: 'javascript:alert(1)', social_profiles: [], sticker_ids: ['priority'] }, stickers: true },
  { id: 'stickers-unavailable', label: 'Stickers unavailable (no registry): no sticker area at all', contact: withStickers(JORDAN, ['partner', 'community']), stickers: false },
  { id: 'stickers-empty', label: 'Stickers available, none assigned (no add control yet): no sticker area', contact: withStickers({ ...JORDAN, id: 'fx-10' }, []), stickers: true },
  { id: 'stickers-many', label: 'Stickers populated: enough to wrap on every size', contact: withStickers({ ...JORDAN, id: 'fx-12', name: 'Taylor Brooks', photo_url: '', title: 'Board Chair', company_name: 'Wasatch Youth Alliance' }, ['partner', 'community', 'priority', 'education', 'supporter', 'volunteer', 'board', 'mentor', 'donor']), stickers: true },
  { id: 'stickers-populated', label: 'Stickers populated', contact: withStickers({ ...JORDAN, id: 'fx-11', name: 'Riley Chen', photo_url: '' }, ['partner', 'community', 'priority', 'education', 'supporter', 'cjk']), stickers: true },
];

// eslint-disable-next-line react-refresh/only-export-components
function Review() {
  useEffect(() => { if (MOCK_ADD_STICKER) addInertAddStickerMock(); }, []);
  return (
    <div className="fx-page">
      {SCENES.map((scene) => (
        <section key={scene.id} className="fx-scene" data-scene={scene.id} data-stickers={scene.stickers ? 'available' : 'unavailable'}>
          <h2 className="fx-label">{scene.label}{MOCK_ADD_STICKER && scene.stickers ? ' — with an INERT mock of Add sticker (not a control)' : ''}</h2>
          <PersonHeader person={buildPersonHeaderModel(scene.contact, { stickersById: scene.stickers ? REGISTRY : null, now: NOW })} />
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Review />);
document.fonts.ready.then(() => { document.documentElement.dataset.ready = '1'; });
