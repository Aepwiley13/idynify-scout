/**
 * MyCardPreview — what other people would see of a card.
 *
 * Built from previewOf(card), which is the card's own privacy rule
 * (publicCardView) applied to the draft as it stands, unsaved changes
 * included. A field whose switch is off, a field left empty and a value the
 * rules refuse never appear here, so the preview cannot show more than a
 * shared card would.
 *
 * THE CARD IS JUST THE CARD. The organization (when shared) is the header, in
 * the place the IDYNIFY wordmark used to take; photo, name and title lead; the
 * contact details follow; a small "Made with IDYNIFY" closes it. Nothing about privacy is written on it. What is kept
 * private, and the fact that sharing is not on yet, are said in a note beside
 * it, so the card looks the way it will look when it is shared.
 *
 * Display only: no links, no actions, nothing written.
 */
import { Fragment } from 'react';
import { Globe, Info, Instagram, Linkedin, Link2, Lock, Mail, Phone } from 'lucide-react';
import { LINK_SLOTS } from '../../../utils/myCardRules';
import CardAvatar from './CardAvatar';
import { previewOf, readableLink, unsharedFields } from './cardDraft';
import { BRAND, THEMES } from '../../../theme/tokens';

// The card is IDYNIFY-branded in every theme, like the sign-in screens: the brand's
// navy, indigo, purple and pink, and white on them. Set here from the app's own
// design tokens, so the stylesheet holds no colour of its own.
/** The header when there is no organization to show: neutral, and says nothing about anyone. */
export const HEADER_FALLBACK = 'Contact card';

const BRAND_SURFACE = Object.freeze({
  '--mycard-brand-1': BRAND.navy,
  '--mycard-brand-2': BRAND.indigo,
  '--mycard-brand-3': BRAND.purple,
  '--mycard-brand-4': BRAND.pink,
  '--mycard-on-brand': THEMES.workspace.cardBg,
});

/** Text with places a long address may break after, so it wraps at a / or @ and not mid-word. */
function softBreaks(text) {
  return String(text).split(/([/@.\-_])/).map((part, index) => (
    /^[/@.\-_]$/.test(part) ? <Fragment key={index}>{part}<wbr /></Fragment> : part
  ));
}

/** The place a link goes, so a label cannot disguise it: "calendly.com". */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function Row({ icon, label, children }) {
  return (
    <li className="mycard-row">
      <span className="mycard-row-icon" aria-hidden="true">{icon}</span>
      <span className="mycard-sr">{label}: </span>
      <span className="mycard-row-value">{children}</span>
    </li>
  );
}

/**
 * @param {object} props
 * @param {object} props.card  the draft's card
 * @param {boolean} [props.sharing]  whether the card can be seen by anyone yet. It cannot, for now.
 */
export default function MyCardPreview({ card, sharing = false, hasUnsavedChanges = false }) {
  const view = previewOf(card);
  const hidden = unsharedFields(card);
  const links = view ? LINK_SLOTS.filter((slot) => view[slot]).map((slot) => view[slot]) : [];
  const hasDetails = view && (view.email || view.phone || view.linkedinUrl || view.instagram || view.website || links.length);

  return (
    <section className="mycard-preview" aria-labelledby="mycard-preview-title">
      <h2 id="mycard-preview-title" className="mycard-preview-title">What people will see</h2>
      {hasUnsavedChanges ? <p className="mycard-preview-unsaved" role="status">Preview includes unsaved changes</p> : null}

      {view ? (
        <article className="mycard-card" aria-label={`Card for ${view.name}`} style={BRAND_SURFACE}>
          <div className="mycard-card-banner" aria-hidden={view.organization ? undefined : 'true'}>
            {view.organization
              ? <span className="mycard-card-brand mycard-card-brand--org">{view.organization}</span>
              : <span className="mycard-card-brand">{HEADER_FALLBACK}</span>}
          </div>
          <div className="mycard-card-body">
            <CardAvatar photoUrl={view.photoUrl} initials={view.initials} size="xl" tone="brand" />
            <h3 className="mycard-card-name">{view.name}</h3>
            {view.title ? <p className="mycard-card-title">{view.title}</p> : null}
            {hasDetails ? (
              <ul className="mycard-rows">
                {view.email ? <Row icon={<Mail size={16} />} label="Email">{softBreaks(view.email)}</Row> : null}
                {view.phone ? <Row icon={<Phone size={16} />} label="Phone">{view.phone}</Row> : null}
                {view.linkedinUrl ? <Row icon={<Linkedin size={16} />} label="LinkedIn">{softBreaks(readableLink(view.linkedinUrl))}</Row> : null}
                {view.instagram ? <Row icon={<Instagram size={16} />} label="Instagram">@{view.instagram}</Row> : null}
                {view.website ? <Row icon={<Globe size={16} />} label="Website">{softBreaks(readableLink(view.website))}</Row> : null}
                {links.map((link) => <Row key={link.url + link.label} icon={<Link2 size={16} />} label={link.label}>{link.label}<span className="mycard-row-host"> {hostOf(link.url)}</span></Row>)}
              </ul>
            ) : null}
            <p className="mycard-card-made">Made with IDYNIFY</p>
          </div>
        </article>
      ) : (
        <div className="mycard-card mycard-card--empty">
          <p className="mycard-empty">Add your name to see your card.</p>
        </div>
      )}

      {hidden.length > 0 || !sharing ? (
        <div className="mycard-aside">
          {hidden.length > 0 ? (
            <p className="mycard-aside-row">
              <Lock size={14} aria-hidden="true" />
              <span>Kept private: {hidden.map((item) => item.label).join(', ')}</span>
            </p>
          ) : null}
          {!sharing ? (
            <p className="mycard-aside-row">
              <Info size={14} aria-hidden="true" />
              <span>Sharing isn&apos;t turned on yet, so nobody can see your card. This is how it will look.</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
