import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Target, Users, RefreshCw, UserPlus, Zap } from 'lucide-react';
import { GAME_BUCKET_LIST } from '../../utils/buildAutoIntent';
import './GameBucketSelector.css';

const BUCKET_ICONS = {
  Target,
  Users,
  RefreshCw,
  UserPlus
};

/**
 * GameBucketSelector — Assign a contact to a game session bucket.
 * One bucket per contact. Tap current bucket to remove (set to null).
 * Placed below StructuredFields on Contact Profile.
 */
export default function GameBucketSelector({ contact, onUpdate }) {
  const [saving, setSaving] = useState(false);

  async function handleBucketSelect(bucketId) {
    const user = auth.currentUser;
    if (!user || !contact?.id) return;

    // Toggle: if already selected, unassign
    const newValue = contact.game_bucket === bucketId ? null : bucketId;

    // Optimistic update
    const updatedContact = { ...contact, game_bucket: newValue };
    onUpdate(updatedContact);

    try {
      setSaving(true);
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        game_bucket: newValue,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[GameBucketSelector] Error saving bucket:', error);
      // Revert on failure
      onUpdate(contact);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="game-bucket-selector">
      <div className="gbs-header">
        <Zap className="w-4 h-4" />
        <span>Game Bucket</span>
        {saving && <span className="gbs-saving">Saving...</span>}
      </div>
      <div className="gbs-options">
        {GAME_BUCKET_LIST.map((bucket) => {
          const Icon = BUCKET_ICONS[bucket.icon] || Target;
          const isActive = contact.game_bucket === bucket.id;
          return (
            <button
              key={bucket.id}
              className={`gbs-option ${isActive ? 'gbs-option-active' : ''}`}
              onClick={() => handleBucketSelect(bucket.id)}
              style={isActive ? { borderColor: bucket.color, color: bucket.color } : {}}
              title={isActive ? 'Click to remove from bucket' : `Assign to ${bucket.label}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{bucket.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
