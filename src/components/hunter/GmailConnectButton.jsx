import { useState } from 'react';
import { startGmailConnect } from '../../utils/gmailConnect';
import { Mail, Loader } from 'lucide-react';

export default function GmailConnectButton({ onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleConnect() {
    setLoading(true);
    setError(null);

    try {
      // Redirects to Google; comes back to this page with ?gmail=<outcome>.
      await startGmailConnect();
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
    </div>
  );
}
