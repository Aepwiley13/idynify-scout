/**
 * The sticker surfaces' one toast: a message, an optional action (Undo,
 * Retry), dismissed after `duration`. The live region is always in the DOM
 * so screen readers announce each message (aria-live="polite").
 */
import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import './stickers.css';

export default function StickerToast({ toast, onDismiss }) {
  const T = useT();
  const descriptionId = useId();

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(onDismiss, toast.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div className="stk-toast-region" role="status" aria-live="polite" aria-atomic="true">
      {toast ? (
        <div
          className={`stk-toast${toast.tone === 'error' ? ' stk-toast--error' : ''}`}
          style={{ background: T.cardBg, color: T.text, border: `1px solid ${T.border}` }}
        >
          <span className="stk-toast-message">{toast.message}</span>
          {toast.description ? <span id={descriptionId} className="stk-sr-only">{toast.description}</span> : null}
          {toast.action ? (
            <button
              type="button"
              className="stk-toast-action"
              aria-describedby={toast.description ? descriptionId : undefined}
              onClick={() => { const { run } = toast.action; onDismiss(); run(); }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" className="stk-toast-close" aria-label="Dismiss" onClick={onDismiss}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
