/**
 * CardAvatar — a person's photo on their card, or their initials.
 *
 * The photo is a link the person pasted or LinkedIn suggested, so it can be
 * wrong, gone or slow. When it cannot be shown (no link, or the image fails to
 * load) the initials are shown instead; a failed link is remembered for that
 * link only, so editing it to a new one tries again.
 *
 * Decorative: the name is always next to it, so it is hidden from screen readers.
 */
import { useState } from 'react';
import { User } from 'lucide-react';

/**
 * @param {string} [photoUrl]   an https link, already checked by the card's rules
 * @param {string} [initials]   up to two letters; a person icon when there are none
 * @param {'sm'|'md'|'lg'|'xl'} [size]
 * @param {'neutral'|'brand'} [tone]  the initials' background: quiet (the editor) or the brand gradient (the card)
 * @param {(url: string) => void} [onPhotoFailed]  told once per link that did not load
 */
export default function CardAvatar({ photoUrl = '', initials = '', size = 'md', tone = 'neutral', onPhotoFailed }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const showPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;

  return (
    <span className={`mycard-avatar mycard-avatar--${size}${tone === 'brand' ? ' mycard-avatar--brand' : ''}`} aria-hidden="true">
      {showPhoto ? (
        <img
          className="mycard-avatar-img"
          src={photoUrl}
          alt=""
          // LinkedIn's picture links do not load when the page names itself as the referrer.
          referrerPolicy="no-referrer"
          onError={() => { setFailedUrl(photoUrl); onPhotoFailed?.(photoUrl); }}
        />
      ) : (
        <span className="mycard-avatar-initials">{initials || <User size={size === 'xl' ? 44 : size === 'lg' ? 32 : 20} />}</span>
      )}
    </span>
  );
}
