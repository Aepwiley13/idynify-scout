/**
 * StickersLoadError — said wherever Contact Hub's sticker controls would have
 * been, when stickers are on for this user but their list could not be read.
 *
 * A failed load is not the same as having no stickers, and must not look like
 * it: nothing has been changed, and reloading is the way to try again.
 *
 * Used by the entries in the application sidebar (HubSidebarNav) and by My
 * People where the sticker chips would be (HubPeople).
 */
import { useT } from '../../theme/ThemeContext';

export default function StickersLoadError({ className = '' }) {
  const T = useT();
  return (
    <div className={`hub-stickers-error ${className}`} role="status" style={{ color: T.textMuted, borderColor: T.border }}>
      <span>Your stickers could not be loaded. They have not been changed.</span>
      <button
        type="button"
        className="hub-link-btn"
        style={{ color: T.text }}
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}
