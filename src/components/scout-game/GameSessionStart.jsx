import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Target, Users, RefreshCw, UserPlus, Loader, ArrowRight } from 'lucide-react';
import { GAME_BUCKET_LIST } from '../../utils/buildAutoIntent';

const ICONS = {
  Target,
  Users,
  RefreshCw,
  UserPlus
};

/**
 * GameSessionStart — Live bucket cards replacing abstract mode selector.
 *
 * Shows actual buckets with real contact counts. A contact is "ready"
 * if it's assigned to the bucket AND has no message_sent event in its
 * activity_log / timeline.
 *
 * Empty buckets are shown dimmed. Zero-bucket state shows onboarding prompt.
 */
export default function GameSessionStart({ onSelectBucket }) {
  const navigate = useNavigate();
  const [bucketCounts, setBucketCounts] = useState({});
  const [totalContacts, setTotalContacts] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBucketCounts();
  }, []);

  async function loadBucketCounts() {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const contactsRef = collection(db, 'users', user.uid, 'contacts');
      const snapshot = await getDocs(contactsRef);
      const contacts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      setTotalContacts(contacts.length);

      // Count ready contacts per bucket
      // "Ready" = assigned to bucket + no message_sent event in activity_log
      const counts = {};
      for (const bucket of GAME_BUCKET_LIST) {
        const bucketContacts = contacts.filter(c => c.game_bucket === bucket.id);
        const readyContacts = bucketContacts.filter(c => {
          if (!c.activity_log || c.activity_log.length === 0) return true;
          return !c.activity_log.some(e =>
            e.type === 'message_sent' || e.type === 'email_sent'
          );
        });
        counts[bucket.id] = { total: bucketContacts.length, ready: readyContacts.length };
      }

      setBucketCounts(counts);
    } catch (err) {
      console.error('Error loading bucket counts:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="game-session-start">
        <div className="game-start-header">
          <h2>Scout Game</h2>
          <p>Loading your buckets...</p>
        </div>
        <div className="game-start-loading">
          <Loader className="w-6 h-6 spin" />
        </div>
      </div>
    );
  }

  const totalBucketed = Object.values(bucketCounts).reduce((sum, b) => sum + b.total, 0);
  const totalReady = Object.values(bucketCounts).reduce((sum, b) => sum + b.ready, 0);

  // Zero-bucket state: user has All Leads contacts but none bucketed
  if (totalBucketed === 0 && totalContacts > 0) {
    return (
      <div className="game-session-start">
        <div className="game-start-header">
          <h2>Scout Game</h2>
          <p>Your game queue is empty</p>
        </div>
        <div className="game-empty-state">
          <p className="game-empty-text">
            Assign contacts to a bucket in All Leads to start a session.
          </p>
          <button
            className="game-empty-cta"
            onClick={() => navigate('/scout', { state: { activeTab: 'all-leads' } })}
          >
            Go to All Leads
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // No contacts at all: new user onboarding
  if (totalContacts === 0) {
    return (
      <div className="game-session-start">
        <div className="game-start-header">
          <h2>Scout Game</h2>
          <p>Start by approving your Daily Leads</p>
        </div>
        <div className="game-empty-state">
          <p className="game-empty-text">
            Process your Daily Leads first, then assign contacts to buckets to start game sessions.
          </p>
          <button
            className="game-empty-cta"
            onClick={() => navigate('/scout', { state: { activeTab: 'daily-leads' } })}
          >
            Go to Daily Leads
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-session-start">
      <div className="game-start-header">
        <h2>Scout Game</h2>
        <p>Pick a bucket. {totalReady} contacts ready to engage.</p>
      </div>

      <div className="game-mode-grid">
        {GAME_BUCKET_LIST.map((bucket) => {
          const Icon = ICONS[bucket.icon] || Target;
          const counts = bucketCounts[bucket.id] || { total: 0, ready: 0 };
          const isEmpty = counts.ready === 0;

          return (
            <button
              key={bucket.id}
              className={`game-mode-card ${isEmpty ? 'game-mode-card-empty' : ''}`}
              onClick={() => isEmpty
                ? navigate('/scout', { state: { activeTab: 'all-leads' } })
                : onSelectBucket(bucket.id)
              }
              style={!isEmpty ? { borderColor: bucket.color } : {}}
            >
              <Icon className="game-mode-icon" style={!isEmpty ? { color: bucket.color } : {}} />
              <span className="game-mode-label">{bucket.label}</span>
              {isEmpty ? (
                <span className="game-mode-desc game-mode-empty-cta">
                  Add contacts to get started
                </span>
              ) : (
                <span className="game-mode-count" style={{ color: bucket.color }}>
                  {counts.ready} contact{counts.ready !== 1 ? 's' : ''} ready
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
