/**
 * Hunter → Mission Outcomes (#003.4), at /hunter?tab=outcomes.
 * Command Center's Mission Outcomes entry and /hunter/outcomes link here.
 *
 * Outreach performance (reply rate by engagement style, campaign send stats)
 * belongs with Hunter's outreach, not with Sniper's sales results — which now
 * reads "Sales Outcomes". This host runs the same two read-only queries
 * Command Center uses for this view (missions, campaigns; newest first) for the
 * effective user, and renders the existing OutcomesSection unchanged, so every
 * calculation is the one users already see.
 */
import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { db } from '../../../firebase/config';
import { getEffectiveUser } from '../../../context/ImpersonationContext';
import OutcomesSection from './OutcomesSection';
import './MissionsSection.css';
import './DashboardSection.css';
import './CampaignsSection.css';

export default function OutcomesHost() {
  const [data, setData] = useState({ missions: [], campaigns: [] });
  const [state, setState] = useState('loading'); // loading | ready | error

  const load = useCallback(async (isCancelled = () => false) => {
    setState('loading');
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('not signed in');
      const read = (name) => getDocs(
        query(collection(db, 'users', user.uid, name), orderBy('createdAt', 'desc'))
      ).then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
      const [missions, campaigns] = await Promise.all([read('missions'), read('campaigns')]);
      if (isCancelled()) return;
      setData({ missions, campaigns });
      setState('ready');
    } catch (err) {
      if (isCancelled()) return;
      console.error('[OutcomesHost] Failed to load outcomes:', err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="hunter-loading" role="status">
        <div className="hunter-loading-spinner"></div>
        <p className="hunter-loading-text">Loading mission outcomes...</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="campaigns-section">
        <div className="dashboard-panel">
          <div className="dashboard-empty" role="alert">
            <AlertCircle
              className="w-8 h-8"
              style={{ color: 'color-mix(in srgb, #ef4444 70%, var(--text-primary))' }}
              aria-hidden="true"
            />
            <p className="campaigns-note">Mission outcomes couldn't be loaded.</p>
            <button type="button" className="campaigns-retry-btn" onClick={() => load()}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <OutcomesSection missions={data.missions} campaigns={data.campaigns} />;
}
