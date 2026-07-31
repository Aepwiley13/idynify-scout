/**
 * ShellAnnouncements — narration for meaningful pipeline events.
 *
 * The navigation audit's worst single finding was that "Move to Hunter" wrote
 * the stage change and said nothing: same URL, same header, and a back button
 * still reading "Back to People". The user performed the highest-value action
 * in the product and every affordance on screen still described the world as
 * it was before the click.
 *
 * This is the fix. A module calls shell.announce({...}) when something
 * genuinely changes the user's pipeline, and the shell states it, offers the
 * destination, and offers a way back.
 *
 * It narrates transitions, not clicks. Only explicit announce() calls surface
 * here; navigation never produces one on its own.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, RotateCcw, X, CheckCircle2 } from 'lucide-react';
import { useShell } from '../../context/ShellContext';
import './ShellAnnouncements.css';

/** Long enough to read and act on; short enough not to become furniture. */
const AUTO_DISMISS_MS = 12000;

function Announcement({ item, onDismiss }) {
  const navigate = useNavigate();

  useEffect(() => {
    // An announcement offering an undo must not disappear before the user can
    // take it. Those stay until dismissed.
    if (item.undo) return undefined;
    const t = setTimeout(() => onDismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [item.id, item.undo, onDismiss]);

  return (
    <div className="shell-announcement" role="status" aria-live="polite">
      <CheckCircle2 size={18} className="shell-announcement-icon" aria-hidden="true" />

      <div className="shell-announcement-body">
        <p className="shell-announcement-message">{item.message}</p>
        {item.detail && <p className="shell-announcement-detail">{item.detail}</p>}

        {(item.actionLabel || item.undo) && (
          <div className="shell-announcement-actions">
            {item.actionLabel && item.actionPath && (
              <button
                type="button"
                className="shell-announcement-action primary"
                onClick={() => { navigate(item.actionPath); onDismiss(item.id); }}
              >
                {item.actionLabel}
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            )}
            {item.undo && (
              <button
                type="button"
                className="shell-announcement-action"
                onClick={async () => {
                  try {
                    await item.undo();
                  } catch (err) {
                    console.error('[ShellAnnouncements] undo failed:', err);
                  } finally {
                    onDismiss(item.id);
                  }
                }}
              >
                <RotateCcw size={13} aria-hidden="true" />
                Undo
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="shell-announcement-close"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export default function ShellAnnouncements() {
  const { announcements, dismissAnnouncement } = useShell();

  if (!announcements?.length) return null;

  return (
    <div className="shell-announcements" aria-label="Recent changes">
      {announcements.map(item => (
        <Announcement key={item.id} item={item} onDismiss={dismissAnnouncement} />
      ))}
    </div>
  );
}
