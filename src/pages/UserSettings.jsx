/**
 * UserSettings — User preferences page.
 *
 * Sprint 2: "Mission sounds" toggle.
 * Label is exactly "Mission sounds" per spec — not "Sound effects".
 *
 * Toggle behavior:
 *   ON  (default): engage fires sound + haptic on mobile
 *   OFF:           engage fires haptic only on mobile, archive fires nothing
 *
 * Persisted to Firestore: users/{userId}.preferences.missionSounds
 */

import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react';
import { useMissionSounds } from '../hooks/useMissionSounds';
import './UserSettings.css';

export default function UserSettings() {
  const navigate = useNavigate();
  const { soundEnabled, setSoundEnabled } = useMissionSounds();

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

      </div>
    </div>
  );
}
