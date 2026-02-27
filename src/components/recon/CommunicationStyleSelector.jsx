/**
 * CommunicationStyleSelector — RECON preference panel.
 *
 * Lets the user set their outreach communication style once.
 * Barry reads this on every message draft and matches the feel.
 *
 * Reads/writes: dashboards/{userId}.communicationStyle
 * Auto-saves on selection change (no separate save button needed).
 */

import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import './CommunicationStyleSelector.css';

const STYLES = [
  {
    id: 'direct_concise',
    label: 'Direct & concise',
    description: 'Short, punchy, no fluff'
  },
  {
    id: 'warm_conversational',
    label: 'Warm & conversational',
    description: 'Friendly, human, approachable'
  },
  {
    id: 'professional_formal',
    label: 'Professional & formal',
    description: 'Polished, structured, corporate-safe'
  },
  {
    id: 'casual_relaxed',
    label: 'Casual & relaxed',
    description: 'Like texting a colleague'
  }
];

export default function CommunicationStyleSelector({ userId }) {
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    loadStyle();
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStyle = async () => {
    try {
      const snap = await getDoc(doc(db, 'dashboards', userId));
      if (snap.exists()) {
        setSelected(snap.data().communicationStyle || null);
      }
    } catch (err) {
      console.warn('[CommunicationStyleSelector] Load failed:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (styleId) => {
    if (styleId === selected || saving) return;
    setSelected(styleId);
    setSaving(true);
    setSaved(false);

    try {
      await updateDoc(doc(db, 'dashboards', userId), {
        communicationStyle: styleId,
        lastUpdatedAt: new Date().toISOString()
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('[CommunicationStyleSelector] Save failed:', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="css-panel">
      <div className="css-header">
        <div className="css-title-row">
          <h2 className="css-title">Communication Style</h2>
          {saved && <span className="css-saved-badge">✓ Saved</span>}
        </div>
        <p className="css-subtitle">
          Barry uses this to match the feel of every message he drafts for you. Change it anytime.
        </p>
      </div>

      {loading ? (
        <div className="css-loading">
          {STYLES.map((_, i) => (
            <div key={i} className="css-option-skeleton" />
          ))}
        </div>
      ) : (
        <div className="css-options">
          {STYLES.map((style) => (
            <label
              key={style.id}
              className={`css-option ${selected === style.id ? 'css-option--selected' : ''}`}
            >
              <input
                type="radio"
                name="communicationStyle"
                value={style.id}
                checked={selected === style.id}
                onChange={() => handleSelect(style.id)}
                className="css-radio"
              />
              <span className="css-option-dot" />
              <span className="css-option-text">
                <span className="css-option-label">{style.label}</span>
                <span className="css-option-desc">{style.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
