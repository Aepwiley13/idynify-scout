/**
 * UserSettings — User preferences page.
 *
 * Sprint 2: "Mission sounds" toggle.
 * Gmail Settings: Connect, reconnect, or disconnect Gmail integration.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Volume2, VolumeX, Mail, CheckCircle, AlertTriangle, Loader, LogOut } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { useMissionSounds } from '../hooks/useMissionSounds';
import './UserSettings.css';

export default function UserSettings() {
  const navigate = useNavigate();
  const { soundEnabled, setSoundEnabled } = useMissionSounds();

  const [gmailStatus, setGmailStatus] = useState(null); // null | 'connected' | 'disconnected'
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailLoading, setGmailLoading] = useState(true);
  const [gmailAction, setGmailAction] = useState(null); // null | 'connecting' | 'disconnecting'
  const [gmailError, setGmailError] = useState(null);

  useEffect(() => {
    loadGmailStatus();
  }, []);

  async function loadGmailStatus() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const gmailDoc = await getDoc(doc(db, 'users', user.uid, 'integrations', 'gmail'));
      if (gmailDoc.exists()) {
        const data = gmailDoc.data();
        setGmailStatus(data.status === 'connected' ? 'connected' : 'disconnected');
        setGmailEmail(data.email || '');
      } else {
        setGmailStatus('disconnected');
      }
    } catch (err) {
      console.error('[UserSettings] loadGmailStatus error:', err);
      setGmailStatus('disconnected');
    } finally {
      setGmailLoading(false);
    }
  }

  async function handleConnectGmail() {
    setGmailAction('connecting');
    setGmailError(null);
    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/gmail-oauth-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken })
      });
      if (!response.ok) throw new Error('Failed to initialize Gmail OAuth');
      const data = await response.json();
      window.location.href = data.authUrl;
    } catch (err) {
      setGmailError(err.message);
      setGmailAction(null);
    }
  }

  async function handleDisconnectGmail() {
    setGmailAction('disconnecting');
    setGmailError(null);
    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/gmail-disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken })
      });
      if (!response.ok) throw new Error('Failed to disconnect Gmail');
      setGmailStatus('disconnected');
      setGmailEmail('');
    } catch (err) {
      setGmailError(err.message);
    } finally {
      setGmailAction(null);
    }
  }

  return (
    <div className="user-settings">
      <div className="us-header">
        <button className="us-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="us-title">Settings</h1>
      </div>

      <div className="us-content">

        {/* Hunter section */}
        <section className="us-section">
          <h2 className="us-section-title">Hunter</h2>

          <div className="us-row">
            <div className="us-row-info">
              <div className="us-row-icon">
                {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </div>
              <div className="us-row-text">
                <span className="us-row-label">Mission sounds</span>
                <span className="us-row-desc">
                  Engage and archive sounds in the Hunter deck
                </span>
              </div>
            </div>
            <button
              role="switch"
              aria-checked={soundEnabled}
              aria-label="Mission sounds"
              className={`us-toggle ${soundEnabled ? 'us-toggle--on' : 'us-toggle--off'}`}
              onClick={() => setSoundEnabled(!soundEnabled)}
            >
              <span className="us-toggle-thumb" />
            </button>
          </div>
        </section>

        {/* Integrations section */}
        <section className="us-section">
          <h2 className="us-section-title">Integrations</h2>

          <div className="us-row us-row--gmail">
            <div className="us-row-info">
              <div className="us-row-icon us-row-icon--gmail">
                <Mail className="w-5 h-5" />
              </div>
              <div className="us-row-text">
                <div className="us-gmail-label-row">
                  <span className="us-row-label">Gmail</span>
                  {!gmailLoading && gmailStatus === 'connected' && (
                    <span className="us-gmail-badge us-gmail-badge--connected">
                      <CheckCircle className="w-3 h-3" />
                      Connected
                    </span>
                  )}
                  {!gmailLoading && gmailStatus === 'disconnected' && (
                    <span className="us-gmail-badge us-gmail-badge--disconnected">
                      Not connected
                    </span>
                  )}
                </div>
                <span className="us-row-desc">
                  {gmailLoading
                    ? 'Loading...'
                    : gmailStatus === 'connected' && gmailEmail
                    ? gmailEmail
                    : 'Send emails directly from your Gmail account'}
                </span>
                {gmailError && (
                  <span className="us-gmail-error">
                    <AlertTriangle className="w-3 h-3" />
                    {gmailError}
                  </span>
                )}
              </div>
            </div>

            <div className="us-gmail-actions">
              {gmailLoading ? (
                <Loader className="w-4 h-4 animate-spin us-gmail-spinner" />
              ) : gmailStatus === 'connected' ? (
                <>
                  <button
                    className="us-gmail-btn us-gmail-btn--reconnect"
                    onClick={handleConnectGmail}
                    disabled={gmailAction !== null}
                    title="Re-authorize Gmail to fix sync issues"
                  >
                    {gmailAction === 'connecting' ? (
                      <Loader className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    Reconnect
                  </button>
                  <button
                    className="us-gmail-btn us-gmail-btn--disconnect"
                    onClick={handleDisconnectGmail}
                    disabled={gmailAction !== null}
                    title="Remove Gmail connection"
                  >
                    {gmailAction === 'disconnecting' ? (
                      <Loader className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogOut className="w-3.5 h-3.5" />
                    )}
                  </button>
                </>
              ) : (
                <button
                  className="us-gmail-btn us-gmail-btn--connect"
                  onClick={handleConnectGmail}
                  disabled={gmailAction !== null}
                >
                  {gmailAction === 'connecting' ? (
                    <>
                      <Loader className="w-3.5 h-3.5 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </button>
              )}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
