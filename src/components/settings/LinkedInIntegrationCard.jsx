/**
 * LinkedInIntegrationCard — Connect LinkedIn on Settings → Integrations.
 *
 * Same card as Gmail and Google Calendar (UserSettings.css `us-card`).
 * Connect goes through linkedin-oauth-init → LinkedIn → linkedin-oauth-callback,
 * which returns here with `?tab=integrations&linkedin=<outcome>`; this card
 * shows that outcome once and removes it from the URL.
 *
 * Reads users/{uid}/integrations/linkedin, which only the server writes
 * (firestore.rules). Shows only identity LinkedIn returned for the user
 * themselves: name, email, connected date.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { Linkedin, CheckCircle, AlertTriangle, Loader, LogOut } from 'lucide-react';
import { db } from '../../firebase/config';
import { LINKEDIN_OUTCOME_MESSAGES } from './linkedinOutcomeMessages';

function formatConnectedDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function LinkedInIntegrationCard({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(null);       // 'connecting' | 'disconnecting' | null
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'integrations', 'linkedin'));
      const data = snap.exists() ? snap.data() : null;
      setIntegration(data?.status === 'connected' ? data : null);
    } catch (err) {
      console.error('[LinkedInIntegrationCard] load error:', err);
      setIntegration(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // The callback's outcome, shown once.
  const outcome = searchParams.get('linkedin');
  useEffect(() => {
    if (!outcome) return;
    const message = LINKEDIN_OUTCOME_MESSAGES[outcome] || LINKEDIN_OUTCOME_MESSAGES.error;
    if (outcome === 'connected') { setNotice(message); setError(null); }
    else { setError(message); setNotice(null); }
    const next = new URLSearchParams(searchParams);
    next.delete('linkedin');
    setSearchParams(next, { replace: true });
  }, [outcome, searchParams, setSearchParams]);

  async function callFunction(name) {
    const token = await user.getIdToken();
    return fetch(`/.netlify/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
  }

  async function handleConnect() {
    setAction('connecting');
    setError(null);
    setNotice(null);
    try {
      const res = await callFunction('linkedin-oauth-init');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authUrl) throw new Error(data.error || 'Could not start the LinkedIn connection. Please try again.');
      window.location.assign(data.authUrl);
    } catch (err) {
      setError(err.message);
      setAction(null);
    }
  }

  async function handleDisconnect() {
    setAction('disconnecting');
    setError(null);
    setNotice(null);
    try {
      const res = await callFunction('linkedin-disconnect');
      if (!res.ok) throw new Error('Could not disconnect LinkedIn. Please try again.');
      setIntegration(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setAction(null);
    }
  }

  const connected = !!integration;
  const connectedOn = formatConnectedDate(integration?.connectedAt);

  return (
    <div className={`us-card ${connected ? '' : 'us-card--action'}`} style={{ marginTop: '12px' }} data-testid="linkedin-integration-card">
      <div className="us-card-icon" style={{ background: 'rgba(10,102,194,0.12)', borderColor: 'rgba(10,102,194,0.28)', color: '#7cb8f0' }}>
        <Linkedin className="w-4 h-4" />
      </div>
      <div className="us-card-body">
        <div className="us-card-label-row">
          <span className="us-card-label">LinkedIn</span>
          {!loading && connected && (
            <span className="us-status-chip us-status-chip--green"><CheckCircle className="w-3 h-3" /> Connected</span>
          )}
          {!loading && !connected && (
            <span className="us-status-chip us-status-chip--gray">Not connected</span>
          )}
        </div>
        {loading ? (
          <span className="us-card-value us-card-value--muted">Loading…</span>
        ) : connected ? (
          <>
            {integration.name && <span className="us-card-value">{integration.name}</span>}
            {integration.email && <span className="us-card-value us-card-value--muted">{integration.email}</span>}
            {connectedOn && <span className="us-card-value us-card-value--muted">Connected {connectedOn}</span>}
          </>
        ) : (
          <span className="us-card-value us-card-value--muted">Connect your LinkedIn account.</span>
        )}
        {notice && (
          <span className="us-inline-success" role="status"><CheckCircle className="w-3 h-3" />{notice}</span>
        )}
        {error && (
          <span className="us-inline-error" role="alert"><AlertTriangle className="w-3 h-3" />{error}</span>
        )}
      </div>
      <div className="us-gmail-actions">
        {loading ? (
          <Loader className="w-4 h-4 animate-spin" style={{ color: '#6b7280' }} />
        ) : connected ? (
          <>
            <button className="us-action-btn" onClick={handleConnect} disabled={action !== null} title="Re-authorize LinkedIn">
              {action === 'connecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
              Reconnect
            </button>
            <button
              className="us-action-btn us-action-btn--danger-icon"
              onClick={handleDisconnect}
              disabled={action !== null}
              title="Disconnect LinkedIn"
              aria-label="Disconnect LinkedIn"
            >
              {action === 'disconnecting' ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
            </button>
          </>
        ) : (
          <button className="us-action-btn us-action-btn--primary" onClick={handleConnect} disabled={action !== null}>
            {action === 'connecting' ? <><Loader className="w-3.5 h-3.5 animate-spin" /> Connecting…</> : 'Connect LinkedIn'}
          </button>
        )}
      </div>
    </div>
  );
}
