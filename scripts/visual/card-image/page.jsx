/**
 * The card image beside the live preview, for looking at. Synthetic data and
 * synthetic pictures only; nothing here reads or writes anything.
 *
 *   ?theme=workspace|mission      light or dark (the app's own themes)
 *
 * For each scene: the real MyCardPreview at 400px (left), and the PNG the
 * renderer made from the same card, shown at the same width (right). The PNGs
 * themselves are read by capture.mjs from window.__images.
 */
import '../../../src/index.css';
import '../../../src/pages/ContactHub/myCard/MyCard.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MyCardPreview from '../../../src/pages/ContactHub/myCard/MyCardPreview';
import { renderCardImage } from '../../../src/pages/ContactHub/myCard/cardImage';
import { DEFAULT_SHARE, SHAREABLE_FIELDS, newCard } from '../../../src/utils/myCardRules';
import { prepareProfilePhoto } from '../../../src/utils/photoPrep';

const params = new URLSearchParams(window.location.search);
const dark = params.get('theme') === 'mission';
document.documentElement.dataset.theme = dark ? 'mission' : 'workspace';

/** A made-up head and shoulders on a gradient. Nobody's photograph. */
async function syntheticPhoto() {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 900;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 900, 900);
  g.addColorStop(0, '#2f7f86'); g.addColorStop(1, '#e8a33d');
  x.fillStyle = g; x.fillRect(0, 0, 900, 900);
  x.fillStyle = '#2b2146'; x.beginPath(); x.ellipse(450, 900, 340, 300, 0, 0, 7); x.fill();
  x.fillStyle = '#f0cdb4'; x.beginPath(); x.ellipse(450, 380, 150, 190, 0, 0, 7); x.fill();
  x.fillStyle = '#3a2a24'; x.beginPath(); x.ellipse(450, 260, 165, 120, 0, Math.PI, 0); x.fill();
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
  return (await prepareProfilePhoto(new File([blob], 'synthetic.jpg', { type: 'image/jpeg' }))).dataUrl;
}

const ALL = Object.fromEntries(SHAREABLE_FIELDS.map((f) => [f, true]));
const NONE = Object.fromEntries(SHAREABLE_FIELDS.map((f) => [f, false]));
const base = {
  ...newCard(), firstName: 'Ada', lastName: 'Lovelace', title: 'Founder & CEO', organization: 'Analytical Engines',
  email: 'ada@analyticalengines.example', phone: '+1 (555) 010-2000', linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
  instagram: 'ada.lovelace', website: 'https://analyticalengines.example', photoUrl: '', share: { ...DEFAULT_SHARE },
};

function scenes(photo) {
  return [
    { id: 'full-photo', label: 'Everything shared, with an uploaded photo', card: { ...base, photoUrl: photo, share: ALL } },
    { id: 'full-initials', label: 'Everything shared, initials', card: { ...base, share: ALL } },
    { id: 'default-shares', label: 'Default switches (email, phone, Instagram, website private)', card: { ...base, photoUrl: photo } },
    { id: 'private-all', label: 'Everything private but the name and the title: the other fields are filled in and unsaved', card: { ...base, photoUrl: photo, share: { ...NONE, title: true } } },
    { id: 'name-only', label: 'Name only', card: { ...newCard(), firstName: 'Ada', share: { ...NONE } } },
    { id: 'no-org', label: 'No organization: neutral header', card: { ...base, organization: '', share: ALL } },
    { id: 'link-photo', label: 'A linked photo: never fetched, initials drawn', card: { ...base, photoUrl: 'https://images.invalid/ada.jpg', share: ALL } },
    {
      id: 'long', label: 'Very long text',
      card: {
        ...base, photoUrl: photo, share: ALL, firstName: 'Bartholomew-Alexandrovich', lastName: 'Featherstonehaugh-Cholmondeley',
        title: 'Senior Vice President of Global Strategic Partnerships and Ecosystem Development',
        organization: 'The International Association of Analytical Engine Manufacturers and Allied Trades',
        email: 'bartholomew.featherstonehaugh-cholmondeley@internationalassociation-analyticalengines.example',
        website: 'https://www.internationalassociation-analyticalengines.example/members/leadership/bartholomew',
      },
    },
    {
      id: 'cjk', label: 'Accents and CJK',
      card: { ...base, photoUrl: photo, share: ALL, firstName: 'José', lastName: '李小龍', title: '創辦人兼執行長', organization: 'Café Ünïcode 株式会社', instagram: 'jose.li' },
    },
  ];
}

// eslint-disable-next-line react-refresh/only-export-components
function Review() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      const photo = await syntheticPhoto();
      await document.fonts.ready;
      const out = [];
      for (const scene of scenes(photo)) {
        const result = await renderCardImage(scene.card, { theme: dark ? 'dark' : 'light' });
        if (!result.ok) { out.push({ ...scene, error: result.reason }); continue; }
        const dataUrl = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(result.blob); });
        out.push({ ...scene, dataUrl, fileName: result.fileName, width: result.width, height: result.height, photo: result.photo });
      }
      window.__images = out.map(({ id, label, dataUrl, fileName, width, height, photo: usedPhoto, error }) => ({ id, label, dataUrl, fileName, width, height, usedPhoto, error }));
      setRows(out);
      document.documentElement.dataset.ready = '1';
    })();
  }, []);
  if (!rows) return <p>Rendering…</p>;
  return (
    <div>
      {rows.map((row) => (
        <section key={row.id} data-scene={row.id} style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{row.label}{row.fileName ? ` — ${row.fileName}, ${row.width}×${row.height}${row.photo ? ', photo' : ''}` : ` — ${row.error}`}</h2>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <div style={{ width: 400 }}><MyCardPreview card={row.card} /></div>
            {row.dataUrl ? <img alt="" src={row.dataUrl} style={{ width: 400, border: '1px solid #8884' }} /> : null}
          </div>
        </section>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Review />);
