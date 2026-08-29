import { useState } from 'react';
import { auth } from '../../firebase/config';
import { Mail, Loader, AlertTriangle } from 'lucide-react';
import { useGmailSyncHealth, SYNC_HEALTH } from '../../hooks/useGmailSyncHealth';

/**
 * Whether a health verdict is worth interrupting someone over.
 *
 * `disconnected` is excluded deliberately — the Connect button beside this is
 * already saying that, and repeating it as a warning reads as an error rather
 * than an invitation.
 */
const WARNING_STATUSES = [
  SYNC_HEALTH.NEEDS_RECONNECT,
  SYNC_HEALTH.STALE,
  SYNC_HEALTH.ERROR,
  SYNC_HEALTH.DEGRADED,
];

export default function GmailConnectButton({ onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { health } = useGmailSyncHealth();

  async function handleConnect() {
    setLoading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Not authenticated');
      }

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/gmail-oauth-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken
        })
      });

      if (!response.ok) {
        throw new Error('Failed to initialize Gmail OAuth');
      }

      const data = await response.json();

      // Redirect to Google OAuth
      window.location.href = data.authUrl;

    } catch (err) {
      console.error('Error connecting Gmail:', err);
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleConnect}
        disabled={loading}
        className="px-6 py-3 bg-blue-500 hover:bg-blue-600 rounded-lg font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader className="w-5 h-5 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Mail className="w-5 h-5" />
            Connect Gmail
          </>
        )}
      </button>
      {error && (
        <div className="mt-2 text-sm text-red-400">{error}</div>
      )}

      {/* Barry's reading state, surfaced. Until now this was written every ten
          minutes and read by nothing, so a mailbox could stop syncing without
          anything on screen changing. */}
      {health && WARNING_STATUSES.includes(health.status) && (
        <div
          role="status"
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{health.message}</span>
        </div>
      )}
    </div>
  );
}
