/**
 * HunterDashboard — Hunter card deck entry point.
 *
 * Tabs:
 *   Deck        — swipeable card stack (hunter_status: 'deck')
 *   Active      — full mission view with Barry drafts (active_mission + engaged_pending)
 *   Archived    — retrievable archive
 *
 * Sprint 3 engage flow:
 *   1. Card rocket launches → hunter_status: 'engaged_pending' (immediate Firestore write)
 *   2. barryHunterProcessEngage fires (background):
 *      - loads context + RECON → generates 4-angle Step 1 draft → creates mission doc
 *      - updates contact: hunter_status → 'active_mission', active_mission_id set
 *   3. ActiveMissionsView renders MissionCard which listens to the mission doc
 *   4. Draft appears in real-time when Barry writes it (onSnapshot)
 *
 * First-contact path:
 *   If the contact has no last_outcome/last_interaction_at (new relationship):
 *   - barryHunterProcessEngage sets isFirstContact: true
 *   - Barry generates draft with limited_context: true flag
 *   - MissionCard shows intake prompt to sharpen the draft
 *
 * Micro Intake:
 *   HunterMicroIntake renders when there are contacts with no intake completed.
 *   Queue badge on the Active tab shows the count.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, query, where, orderBy,
  doc, updateDoc, onSnapshot
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { ArrowLeft, Target, CheckCircle, Archive as ArchiveIcon, Zap } from 'lucide-react';
import HunterCardStack from '../../components/hunter/HunterCardStack';
import ActiveMissionsView from '../../components/hunter/ActiveMissionsView';
import HunterMicroIntake from '../../components/hunter/HunterMicroIntake';
import { bootstrapContactsForUser } from '../../utils/hunterBootstrap';
import './HunterDashboard.css';

export default function HunterDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('deck');
  const [deckContacts, setDeckContacts] = useState([]);
  const [activeContacts, setActiveContacts] = useState([]);
  const [archivedContacts, setArchivedContacts] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);

  // Micro Intake queue — contacts in active with no intake
  const [showIntakeQueue, setShowIntakeQueue] = useState(false);
  const intakeQueue = activeContacts.filter(
    c => c.hunter_status === 'active_mission' &&
         !c.hunter_intake?.completed_at &&
         !c.hunter_intake?.skipped
  );

  const unsubRef = useRef(null);

  useEffect(() => {
    initHunter();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function initHunter() {
    const user = auth.currentUser;
    if (!user) { navigate('/login'); return; }

    // Bootstrap existing contacts (seeds relationship_state + hunter_status)
    try {
      setBootstrapping(true);
      await bootstrapContactsForUser(user.uid);
    } catch (err) {
      console.warn('[Hunter] Bootstrap warning (non-fatal):', err.message);
    } finally {
      setBootstrapping(false);
    }

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

    let loadedCount = 0;
    function checkAllLoaded() {
      loadedCount++;
      if (loadedCount >= 3) setLoading(false);
    }

    const unsubDeck = onSnapshot(deckQuery, snap => {
      setDeckContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      checkAllLoaded();
    }, err => { console.error('[Hunter] Deck listener error:', err); checkAllLoaded(); });

    const unsubActive = onSnapshot(activeQuery, snap => {
      setActiveContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      checkAllLoaded();
    }, err => { console.error('[Hunter] Active listener error:', err); checkAllLoaded(); });

    const unsubArchived = onSnapshot(archivedQuery, snap => {
      setArchivedContacts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      checkAllLoaded();
    }, err => { console.error('[Hunter] Archived listener error:', err); checkAllLoaded(); });

    unsubRef.current = () => { unsubDeck(); unsubActive(); unsubArchived(); };
  }

  // ── Engage handler — Sprint 3 ────────────────────────────────────────────
  const handleEngage = useCallback(async (contact) => {
    const user = auth.currentUser;
    if (!user) return;

    // Advance deck index immediately (card is animating off screen)
    setCurrentIndex(prev => prev + 1);

    const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);

    // Step 1: set engaged_pending immediately
    try {
      await updateDoc(contactRef, {
        hunter_status: 'engaged_pending',
        hunter_engaged_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Hunter] Failed to set engaged_pending:', err);
      return;
    }

    // Step 2: auto-switch to active tab so user sees the loading state
    setTab('active');

    // Step 3: call barryHunterProcessEngage in background
    // This creates the mission, generates the draft, moves contact to active_mission
    processEngageBackground(user, contact);
  }, []);

  async function processEngageBackground(user, contact) {
    try {
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryHunterProcessEngage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactId: contact.id
        })
      });

      const data = await res.json();

      if (!data.success) {
        // barryHunterProcessEngage already writes the error state to Firestore.
        // The contact will appear in the Active tab with an error card.
        console.warn('[Hunter] Process engage returned error:', data.error);
      }
      // If success: the function already updated hunter_status + created mission.
      // The onSnapshot in ActiveMissionsView will pick up the changes automatically.

    } catch (err) {
      console.error('[Hunter] processEngageBackground network error:', err);
      // Write error state manually if the function didn't complete
      try {
        const user2 = auth.currentUser;
        if (user2) {
          await updateDoc(doc(db, 'users', user2.uid, 'contacts', contact.id), {
            hunter_status: 'active_mission',
            processing_error: 'Network error — could not reach Barry.',
            processing_error_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }
      } catch (_) {}
    }
  }

  // ── Archive handler ──────────────────────────────────────────────────────
  const handleArchive = useCallback(async (contact) => {
    const user = auth.currentUser;
    if (!user) return;

    setCurrentIndex(prev => prev + 1);

    try {
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        hunter_status: 'archived',
        hunter_archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Hunter] Failed to archive contact:', err);
    }
  }, []);

  // ── Restore from archive ─────────────────────────────────────────────────
  const handleRestore = useCallback(async (contact) => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        hunter_status: 'deck',
        hunter_archived_at: null,
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Hunter] Failed to restore contact:', err);
    }
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  const deckCount = deckContacts.length;
  const activeCount = activeContacts.length;
  const archivedCount = archivedContacts.length;
  const intakeCount = intakeQueue.length;

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
              {intakeCount > 0 && (
                <span className="hunter-tab-badge hunter-tab-badge--intake" title="Intake pending">
                  <Zap className="w-2.5 h-2.5" />{intakeCount}
                </span>
              )}
            </button>
            <button
              className={`hunter-tab ${tab === 'archived' ? 'hunter-tab--active' : ''}`}
              onClick={() => setTab('archived')}
            >
              <ArchiveIcon className="w-3.5 h-3.5" />
              Archived
              {archivedCount > 0 && (
                <span className="hunter-tab-badge hunter-tab-badge--muted">{archivedCount}</span>
              )}
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
              <ActiveMissionsView
                contacts={activeContacts}
                onGoToDeck={() => setTab('deck')}
                onMissionComplete={(contact, outcome) => {
                  // Mission complete (scheduled / not_interested / all steps done)
                  // Contact stays in active_mission status for now
                  // (future: move to a 'completed' status)
                  console.log(`[Hunter] Mission complete for ${contact.name}: ${outcome}`);
                }}
              />
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

// ── Archived card (unchanged from Sprint 1) ──────────────────────────────────

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
