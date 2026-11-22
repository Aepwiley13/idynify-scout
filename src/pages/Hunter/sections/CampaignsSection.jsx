/**
 * Hunter → Campaigns: the one place to find existing campaigns and start a
 * new one. Opened at /hunter?tab=campaigns, from Hunter and from Command Center.
 *
 * Read-only. One query: the effective user's campaigns, newest first, the
 * same path CampaignDetail reads. Missions are not loaded, so cards show the
 * campaign's own status rather than mission health (see CampaignCards).
 *
 * Creation and detail stay on their existing routes:
 *   New Campaign → /hunter/campaign/new    card → /hunter/campaign/:id
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { AlertCircle, Loader, Mail, Plus, RefreshCw } from 'lucide-react';
import { db } from '../../../firebase/config';
import { getEffectiveUser } from '../../../context/ImpersonationContext';
import { buildCampaignSummaries } from '../../../utils/dashboardEngine';
import CampaignCards from './CampaignCards';
import './DashboardSection.css';
import './CampaignsSection.css';

export default function CampaignsSection() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error

  const load = useCallback(async (isCancelled = () => false) => {
    setState('loading');
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('not signed in');
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'campaigns'), orderBy('createdAt', 'desc'))
      );
      if (isCancelled()) return;
      setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setState('ready');
    } catch (err) {
      if (isCancelled()) return;
      console.error('[CampaignsSection] Failed to load campaigns:', err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  const summaries = useMemo(() => {
    const statusById = Object.fromEntries(campaigns.map(c => [c.id, c.status]));
    return buildCampaignSummaries(campaigns, []).map(s => ({ ...s, status: statusById[s.id] }));
  }, [campaigns]);

  const newCampaign = () => navigate('/hunter/campaign/new');

  return (
    <div className="campaigns-section">
      <div className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div className="dashboard-panel-title">
            <Mail className="w-5 h-5" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <h2>Campaigns</h2>
            {state === 'ready' && campaigns.length > 0 && (
              <span className="campaigns-count">{campaigns.length}</span>
            )}
          </div>
          <button type="button" className="campaigns-new-btn" onClick={newCampaign}>
            <Plus className="w-4 h-4" aria-hidden="true" />
            New Campaign
          </button>
        </div>

        {state === 'loading' && (
          <div className="dashboard-empty" role="status">
            <Loader className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <p className="campaigns-note">Loading campaigns…</p>
          </div>
        )}

        {state === 'error' && (
          <div className="dashboard-empty" role="alert">
            <AlertCircle className="w-8 h-8 text-red-500" aria-hidden="true" />
            <p className="campaigns-note">Campaigns couldn't be loaded.</p>
            <button type="button" className="campaigns-retry-btn" onClick={() => load()}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        )}

        {state === 'ready' && campaigns.length === 0 && (
          <div className="dashboard-empty">
            <Mail className="w-8 h-8" style={{ color: 'var(--text-faint)' }} aria-hidden="true" />
            <p className="campaigns-note">No campaigns yet. Send personalized emails to several contacts at once.</p>
            <button type="button" className="campaigns-new-btn" onClick={newCampaign}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              New Campaign
            </button>
          </div>
        )}

        {state === 'ready' && campaigns.length > 0 && (
          <CampaignCards summaries={summaries} showStatus />
        )}
      </div>
    </div>
  );
}
