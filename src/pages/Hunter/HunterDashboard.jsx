/**
 * HunterDashboard — Rebuilt as the Hunter card deck entry point.
 *
 * Primary surface: card deck swipe experience (Hunter spec).
 * Secondary surface: Active Missions tab (contacts with hunter_status: 'active_mission')
 * Archived tab: contacts with hunter_status: 'archived' — retrievable.
 *
 * On first load, runs hunterBootstrap to seed relationship_state and hunter_status
 * for existing contacts that predate those fields.
 *
 * Engage flow:
 *   1. Card rocket launches (animation in HunterCardStack)
 *   2. Contact hunter_status → 'engaged_pending' (immediate)
 *   3. Barry processes in background (barryGenerateMissionSequence)
 *   4. Contact hunter_status → 'active_mission' (on Barry completion)
 *
 * Archive flow:
 *   1. Card slides left
 *   2. Contact hunter_status → 'archived'
 *   3. Contact appears in Archived tab, retrievable
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, getDocs, query, where, orderBy,
  doc, updateDoc, onSnapshot
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { ArrowLeft, Target, CheckCircle, Archive as ArchiveIcon } from 'lucide-react';
import HunterCardStack from '../../components/hunter/HunterCardStack';
import { bootstrapContactsForUser } from '../../utils/hunterBootstrap';
import { getDefaultOutcomeGoal } from '../../constants/structuredFields';
import './HunterDashboard.css';

const TABS = ['deck', 'active', 'archived'];

export default function HunterDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('deck');
  const [deckContacts, setDeckContacts] = useState([]);
  const [activeContacts, setActiveContacts] = useState([]);
  const [archivedContacts, setArchivedContacts] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const unsubRef = useRef(null);

  useEffect(() => {
    initHunter();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function initHunter() {
    const user = auth.currentUser;
    if (!user) { navigate('/login'); return; }

    // Bootstrap existing contacts (seeds relationship_state + hunter_status)
    // Only runs if contacts are missing these fields — safe to call every time
    try {
      setBootstrapping(true);
      await bootstrapContactsForUser(user.uid);
    } catch (err) {
      console.warn('[Hunter] Bootstrap warning (non-fatal):', err.message);
    } finally {
      setBootstrapping(false);
    }

    // Real-time listener for deck contacts
    const contactsRef = collection(db, 'users', user.uid, 'contacts');

    const deckQuery = query(
      contactsRef,
      where('hunter_status', '==', 'deck'),
      orderBy('strategic_value', 'desc')
    );

    const activeQuery = query(
      contactsRef,
      where('hunter_status', 'in', ['active_mission', 'engaged_pending']),
      orderBy('updated_at', 'desc')
    );

    const archivedQuery = query(
      contactsRef,
      where('hunter_status', '==', 'archived'),
      orderBy('updated_at', 'desc')
    );

    let deckData = [], activeData = [], archivedData = [];
    let loadedCount = 0;

    function checkAllLoaded() {
      loadedCount++;
      if (loadedCount >= 3) setLoading(false);
    }

    const unsubDeck = onSnapshot(deckQuery, snap => {
      deckData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDeckContacts([...deckData]);
      checkAllLoaded();
    }, err => {
      console.error('[Hunter] Deck listener error:', err);
      checkAllLoaded();
    });

    const unsubActive = onSnapshot(activeQuery, snap => {
      activeData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setActiveContacts([...activeData]);
      checkAllLoaded();
    }, err => {
      console.error('[Hunter] Active listener error:', err);
      checkAllLoaded();
    });

    const unsubArchived = onSnapshot(archivedQuery, snap => {
      archivedData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setArchivedContacts([...archivedData]);
      checkAllLoaded();
    }, err => {
      console.error('[Hunter] Archived listener error:', err);
      checkAllLoaded();
    });

    unsubRef.current = () => { unsubDeck(); unsubActive(); unsubArchived(); };
  }

  // ── Engage handler ──────────────────────────────────────

  const handleEngage = useCallback(async (contact) => {
    const user = auth.currentUser;
    if (!user) return;

    // Advance index immediately (card is already animating off screen)
    setCurrentIndex(prev => prev + 1);

    // Set to engaged_pending immediately — holds the contact in limbo
    // while Barry generates the mission in background
    const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
    try {
      await updateDoc(contactRef, {
        hunter_status: 'engaged_pending',
        hunter_engaged_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Hunter] Failed to set engaged_pending:', err);
    }

    // Background: create the mission
    createMissionInBackground(user, contact, contactRef);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createMissionInBackground(user, contact, contactRef) {
    try {
      const authToken = await user.getIdToken();
      const outcomeGoal = getDefaultOutcomeGoal(contact.relationship_state);

      const res = await fetch('/.netlify/functions/barryGenerateMissionSequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contact,
          missionParams: {
            outcome_goal: outcomeGoal,
            engagement_style: 'moderate',
            timeframe: 'this_month',
            source: 'hunter_deck'
          }
        })
      });

      const data = await res.json();

      if (data.success && data.missionId) {
        // Mission created — move contact to active_mission
        await updateDoc(contactRef, {
          hunter_status: 'active_mission',
          active_mission_id: data.missionId,
          updated_at: new Date().toISOString()
        });
      } else {
        console.warn('[Hunter] Mission generation incomplete, contact stays in engaged_pending');
      }
    } catch (err) {
      console.error('[Hunter] Background mission creation failed:', err);
      // Contact stays in engaged_pending — user will see it in Active tab
      // and Barry will retry on next visit
    }
  }

  // ── Archive handler ─────────────────────────────────────

  const handleArchive = useCallback(async (contact) => {
    const user = auth.currentUser;
    if (!user) return;

    setCurrentIndex(prev => prev + 1);

    const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
    try {
      await updateDoc(contactRef, {
        hunter_status: 'archived',
        hunter_archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Hunter] Failed to archive contact:', err);
    }
  }, []);

  // ── Restore from archive ────────────────────────────────

  const handleRestore = useCallback(async (contact) => {
    const user = auth.currentUser;
    if (!user) return;

    const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
    try {
      await updateDoc(contactRef, {
        hunter_status: 'deck',
        hunter_archived_at: null,
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Hunter] Failed to restore contact:', err);
    }
  }, []);

  // ── Render ──────────────────────────────────────────────

  const deckCount = deckContacts.length;
  const activeCount = activeContacts.length;
  const archivedCount = archivedContacts.length;

  return (
    <div className="hunter-dashboard">
      {/* Header */}
      <div className="hunter-header">
        <div className="hunter-header-inner">
          <div className="hunter-header-left">
            <button
              className="hunter-back-btn"
              onClick={() => navigate('/mission-control-v2')}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="hunter-identity">
              <div className="hunter-icon-wrap">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="hunter-title">Hunter</h1>
                <p className="hunter-subtitle">Engage your contacts</p>
              </div>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="hunter-tabs">
            <button
              className={`hunter-tab ${tab === 'deck' ? 'hunter-tab--active' : ''}`}
              onClick={() => setTab('deck')}
            >
              Deck
              {deckCount > 0 && <span className="hunter-tab-badge">{deckCount}</span>}
            </button>
            <button
              className={`hunter-tab ${tab === 'active' ? 'hunter-tab--active' : ''}`}
              onClick={() => setTab('active')}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Active
              {activeCount > 0 && <span className="hunter-tab-badge">{activeCount}</span>}
            </button>
            <button
              className={`hunter-tab ${tab === 'archived' ? 'hunter-tab--active' : ''}`}
              onClick={() => setTab('archived')}
            >
              <ArchiveIcon className="w-3.5 h-3.5" />
              Archived
              {archivedCount > 0 && <span className="hunter-tab-badge hunter-tab-badge--muted">{archivedCount}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="hunter-content">
        {loading ? (
          <div className="hunter-loading">
            <div className="hunter-loading-spinner" />
            {bootstrapping
              ? 'Barry is orienting your contacts...'
              : 'Loading Hunter...'}
          </div>
        ) : (
          <>
            {/* Deck tab */}
            {tab === 'deck' && (
              <div className="hunter-deck-view">
                <HunterCardStack
                  contacts={deckContacts}
                  currentIndex={currentIndex}
                  onEngage={handleEngage}
                  onArchive={handleArchive}
                  onDeckEmpty={() => setTab('active')}
                />
                {deckContacts.length > 0 && currentIndex < deckContacts.length && (
                  <p className="hunter-deck-count">
                    {deckContacts.length - currentIndex} contact{deckContacts.length - currentIndex !== 1 ? 's' : ''} remaining
                  </p>
                )}
              </div>
            )}

            {/* Active Missions tab */}
            {tab === 'active' && (
              <div className="hunter-active-view">
                {activeContacts.length === 0 ? (
                  <div className="hunter-empty">
                    <div className="hunter-empty-icon">🎯</div>
                    <p className="hunter-empty-title">No active missions yet.</p>
                    <p className="hunter-empty-sub">Engage contacts from the deck to launch missions.</p>
                    <button className="hunter-empty-cta" onClick={() => setTab('deck')}>
                      Go to deck
                    </button>
                  </div>
                ) : (
                  <div className="hunter-contact-list">
                    {activeContacts.map(contact => (
                      <ActiveMissionCard
                        key={contact.id}
                        contact={contact}
                        onClick={() => navigate(`/hunter/mission/${contact.active_mission_id || contact.id}`)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Archived tab */}
            {tab === 'archived' && (
              <div className="hunter-archived-view">
                {archivedContacts.length === 0 ? (
                  <div className="hunter-empty">
                    <div className="hunter-empty-icon">📁</div>
                    <p className="hunter-empty-title">Nothing archived yet.</p>
                    <p className="hunter-empty-sub">Contacts you archive from the deck appear here.</p>
                  </div>
                ) : (
                  <div className="hunter-contact-list">
                    {archivedContacts.map(contact => (
                      <ArchivedCard
                        key={contact.id}
                        contact={contact}
                        onRestore={() => handleRestore(contact)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────

function ActiveMissionCard({ contact, onClick }) {
  const name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
  const isPending = contact.hunter_status === 'engaged_pending';

  return (
    <div className="hunter-list-card hunter-list-card--active" onClick={onClick}>
      <div className="hunter-list-card-avatar">
        {name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
      </div>
      <div className="hunter-list-card-info">
        <div className="hunter-list-card-name">{name}</div>
        <div className="hunter-list-card-sub">
          {[contact.title, contact.company_name].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="hunter-list-card-status">
        {isPending ? (
          <span className="hunter-status-badge hunter-status-badge--pending">Barry working...</span>
        ) : (
          <span className="hunter-status-badge hunter-status-badge--active">Active Mission</span>
        )}
      </div>
    </div>
  );
}

function ArchivedCard({ contact, onRestore }) {
  const name = contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();

  return (
    <div className="hunter-list-card hunter-list-card--archived">
      <div className="hunter-list-card-avatar hunter-list-card-avatar--muted">
        {name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
      </div>
      <div className="hunter-list-card-info">
        <div className="hunter-list-card-name">{name}</div>
        <div className="hunter-list-card-sub">
          {[contact.title, contact.company_name].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button
        className="hunter-restore-btn"
        onClick={(e) => { e.stopPropagation(); onRestore(); }}
      >
        Restore
      </button>
    </div>
  );
}
