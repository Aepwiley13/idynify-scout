/**
 * PersonHeader — a person's identity, drawn as a relationship card.
 *
 *   <PersonHeader person={model} />
 *
 * PRESENTATION ONLY. It draws a PersonHeaderModel (personHeaderModel.js) and nothing
 * else: it is handed no contact, no sticker registry, no service and no plan, imports
 * none of them, reads nothing and writes nothing. The same header can therefore be
 * drawn from Contact Hub today and from Scout later.
 *
 * WHAT IS ON IT, top to bottom and left to right:
 *   the photo (or the initials), with a quiet activity dot
 *   the name, then "Title · Organization", then the location, as text
 *   the primary phone and email as pills, and a button-sized link for each social profile
 *   the person's stickers, as soft pills (where stickers are available)
 * A part the model has nothing for is left out, and the layout closes up around it.
 *
 * NO DEAD CONTROLS. Everything here that can be pressed is a link that really goes
 * somewhere (tel:, mailto:, the profile). There is no edit, photo, add-sticker or
 * remove-sticker control in this milestone, so none is drawn; the contract's callbacks
 * (personHeaderContract.js) arrive with the behaviour they belong to. The one callback
 * honoured now is onContactAction, which is only told that a link was used.
 *
 * LONG AND UNUSUAL TEXT. The model keeps every value complete; the stylesheet does the
 * fitting: words wrap anywhere they must, a name is clamped to three lines and the
 * subtitle to two, a pill ends in an ellipsis. Whatever is cut by the eye is whole for
 * a screen reader and for a hover: the full text is the element's own text, its title,
 * and (for a pill) its accessible name. Text direction follows the text (dir="auto").
 *
 * COLOUR. The card follows the app theme through its variables (src/index.css). The
 * purple accent comes from the design tokens (BRAND) and is mixed toward the theme's
 * own text colour, so it is deep on a light theme and light on a dark one; a sticker
 * keeps its own colour, in the same tint the existing sticker chips use.
 */
import { useState } from 'react';
import { Facebook, Instagram, Linkedin, Mail, MapPin, Phone } from 'lucide-react';
import { BRAND } from '../../../theme/tokens';
import { hexOf, TINT_ALPHA, BORDER_ALPHA } from '../../stickers/stickerPalette';
import { headerParts } from './personHeaderContract';
import './PersonHeader.css';

const SOCIAL_ICONS = Object.freeze({ linkedin: Linkedin, instagram: Instagram, facebook: Facebook });

// The identity accent, from the design tokens: this file holds the one place the header's brand colours are named.
const ACCENT = Object.freeze({
  '--ph-purple': BRAND.purple,
  '--ph-indigo': BRAND.indigo,
  '--ph-pink': BRAND.pink,
});

// A link is drawn only to an address of the kind it is for, whatever the model holds: a phone is tel:, an email is
// mailto:, a profile is https:. The model already makes only these; this is the component not trusting that alone.
const SAFE_HREF = Object.freeze({
  phone: /^tel:\+?\d{7,15}$/,
  email: /^mailto:[^\s,;?&#"'<>]+$/,
  social: /^https:\/\/[^\s"'<>]+$/,
});
const safe = (kind, href) => typeof href === 'string' && SAFE_HREF[kind].test(href);

const clampLevel = (level) => Math.min(6, Math.max(1, Number.isInteger(level) ? level : 2));

function Avatar({ person }) {
  const { initials, photoUrl } = person.avatar;
  // A photo that does not load falls back to the initials, for that address only.
  const [failedUrl, setFailedUrl] = useState(null);
  const showPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;
  const { active } = person.activity;
  return (
    <div className="ph-avatar-wrap">
      <span className="ph-avatar" aria-hidden="true">
        {showPhoto ? (
          <img
            className="ph-avatar-img"
            src={photoUrl}
            alt=""
            // A signed profile-picture address does not load when the page names itself as the referrer.
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(photoUrl)}
          />
        ) : (
          <span className="ph-avatar-initials" dir="auto">{initials}</span>
        )}
      </span>
      <span
        className={`ph-activity ph-activity--${active ? 'on' : 'off'}`}
        role="img"
        aria-label={active ? 'Active in the last 30 days' : 'No recent activity'}
        title={active ? 'Active in the last 30 days' : 'No recent activity'}
      />
    </div>
  );
}

function StickerPill({ sticker }) {
  const hex = hexOf(sticker.color);
  return (
    <li className="ph-sticker" style={{ '--ph-sticker-tint': `${hex}${TINT_ALPHA}`, '--ph-sticker-border': `${hex}${BORDER_ALPHA}`, '--ph-sticker-dot': hex }} title={sticker.name}>
      {sticker.emoji
        ? <span className="ph-sticker-emoji" aria-hidden="true">{sticker.emoji}</span>
        : <span className="ph-sticker-dot" aria-hidden="true" />}
      <span className="ph-sticker-name" dir="auto">{sticker.name}</span>
    </li>
  );
}

/**
 * @param {object} props
 * @param {import('./personHeaderModel.js').PersonHeaderModel} props.person
 * @param {number} [props.headingLevel]  the name's heading level, 1 to 6 (default 2)
 * @param {import('./personHeaderContract.js').PersonHeaderActions} [props.actions]  only onContactAction is used in this milestone
 */
export default function PersonHeader({ person, headingLevel = 2, actions = undefined }) {
  if (!person) return null;
  const parts = headerParts(person, actions);
  const Heading = `h${clampLevel(headingLevel)}`;
  const notify = typeof actions?.onContactAction === 'function' ? actions.onContactAction : null;
  const subtitle = [person.title, person.organization].filter(Boolean);
  const phone = parts.phone && safe('phone', person.phone.href) ? person.phone : null;
  const email = parts.email && safe('email', person.email.href) ? person.email : null;
  const social = parts.social ? person.social.filter((link) => SOCIAL_ICONS[link.platform] && safe('social', link.url)) : [];
  const hasContacts = Boolean(phone || email || social.length > 0);
  const stickers = parts.stickers ? person.stickers : null;

  return (
    <article className="ph" aria-label={`Contact: ${person.name}`} style={ACCENT}>
      {/* data-layout says which of the two optional rows exist (c: ways to reach them, s: stickers), so the layout closes up around a missing one. */}
      <div className="ph-card" data-layout={`${hasContacts ? 'c1' : 'c0'}${stickers ? 's1' : 's0'}`}>
        <Avatar person={person} />

        <div className="ph-identity">
          <Heading className="ph-name" dir="auto" title={person.name}>{person.name}</Heading>
          {parts.subtitle ? (
            <p className="ph-subtitle" dir="auto" title={subtitle.join(' · ')}>
              {subtitle.map((part, index) => (
                <span key={index} className="ph-subtitle-part">
                  {index > 0 ? <span className="ph-sep" aria-hidden="true"> · </span> : null}
                  {index > 0 ? <span className="ph-sr">, </span> : null}
                  {part}
                </span>
              ))}
            </p>
          ) : null}
          {parts.location ? (
            <p className="ph-location" dir="auto" title={person.location}>
              <MapPin size={15} aria-hidden="true" className="ph-location-icon" />
              <span className="ph-sr">Location: </span>
              <span className="ph-location-text">{person.location}</span>
            </p>
          ) : null}
        </div>

        {hasContacts ? (
          <ul className="ph-contacts" aria-label="Ways to reach them">
            {phone ? (
              <li className="ph-contact">
                <a
                  className="ph-pill"
                  href={phone.href}
                  title={phone.text}
                  aria-label={`Call ${phone.text}`}
                  onClick={notify ? () => notify('phone', {}) : undefined}
                >
                  <Phone size={16} aria-hidden="true" className="ph-pill-icon" />
                  <span className="ph-pill-text">{phone.text}</span>
                </a>
              </li>
            ) : null}
            {email ? (
              <li className="ph-contact">
                <a
                  className="ph-pill"
                  href={email.href}
                  title={email.address}
                  aria-label={`Email ${email.address}`}
                  onClick={notify ? () => notify('email', {}) : undefined}
                >
                  <Mail size={16} aria-hidden="true" className="ph-pill-icon" />
                  <span className="ph-pill-text">{email.address}</span>
                </a>
              </li>
            ) : null}
            {social.map((link) => {
              const Icon = SOCIAL_ICONS[link.platform];
              return (
                <li key={`${link.platform}:${link.handle}`} className="ph-contact ph-contact--social">
                  <a
                    className="ph-social"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${link.label}: ${link.handle}`}
                    aria-label={`${link.label} profile of ${person.name} (opens in a new tab)`}
                    onClick={notify ? () => notify('social', { platform: link.platform }) : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        ) : null}

        {stickers ? (
          <ul className="ph-stickers" aria-label="Stickers">
            {stickers.map((sticker) => <StickerPill key={sticker.id} sticker={sticker} />)}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
