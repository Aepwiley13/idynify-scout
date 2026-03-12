/**
 * ImpersonationReadOnlyGuard
 *
 * Wraps submit buttons, forms, and destructive actions.
 * When IMPERSONATION_MODE === 'readonly' and an impersonation session is active,
 * the wrapped content is replaced with a read-only notice.
 *
 * Usage:
 *   <ImpersonationReadOnlyGuard>
 *     <button onClick={sendEmail}>Send Email</button>
 *   </ImpersonationReadOnlyGuard>
 */
import { useImpersonation } from '../context/ImpersonationContext';

export default function ImpersonationReadOnlyGuard({ children, message }) {
  const { isImpersonating, isReadOnly, targetUserEmail } = useImpersonation();

  if (!isReadOnly) return children;

  return (
    <div
      title={message || `Read-only mode — cannot perform write actions while viewing ${targetUserEmail || 'user'}'s account`}
      style={{ opacity: 0.5, cursor: 'not-allowed', display: 'inline-block' }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ pointerEvents: 'none' }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Hook version — returns true if the action should be blocked.
 * Use in event handlers to prevent writes during impersonation.
 *
 * Example:
 *   const blockWrite = useReadOnlyGuard();
 *   const handleSave = () => {
 *     if (blockWrite('save contact')) return;
 *     // ...do the save
 *   };
 */
export function useReadOnlyGuard() {
  const { isReadOnly, targetUserEmail } = useImpersonation();

  return (actionName = 'this action') => {
    if (isReadOnly) {
      alert(`Read-only mode: Cannot perform "${actionName}" while viewing ${targetUserEmail || 'a user'}'s account.\n\nEnd the impersonation session to make changes.`);
      return true; // blocked
    }
    return false; // allowed
  };
}
