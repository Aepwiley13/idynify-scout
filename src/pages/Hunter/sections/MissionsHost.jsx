/**
 * Hunter → Missions (#003.3): the canonical mission list, at /hunter?tab=missions.
 * Command Center's Missions entry links here.
 *
 * Loads the effective user's missions with the same single, read-only query
 * Command Center uses, and hands them to the existing MissionsSection, which
 * owns the loading, empty and list views. Every mission is passed, completed
 * ones included: Command Center hid the list when nothing was active, so an
 * account whose missions had all finished could not see any of them.
 *
 * Mission routes are unchanged: /hunter/create-mission, /hunter/mission/:id.
 */
import { useCallback, useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { db } from '../../../firebase/config';
import { getEffectiveUser } from '../../../context/ImpersonationContext';
import MissionsSection from './MissionsSection';
import './DashboardSection.css';
import './CampaignsSection.css';

export default function MissionsHost() {
  const [missions, setMissions] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error

  const load = useCallback(async (isCancelled = () => false) => {
    setState('loading');
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('not signed in');
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'missions'), orderBy('createdAt', 'desc'))
      );
      if (isCancelled()) return;
      setMissions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setState('ready');
    } catch (err) {
      if (isCancelled()) return;
      console.error('[MissionsHost] Failed to load missions:', err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

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
            <p className="campaigns-note">Missions couldn't be loaded.</p>
            <button type="button" className="campaigns-retry-btn" onClick={() => load()}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <MissionsSection missions={missions} loading={state === 'loading'} />;
}
