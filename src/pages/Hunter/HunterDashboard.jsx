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
 * Sprint 4 additions:
 *   - Loads RECON data from dashboards/{userId} on init
 *   - Computes reconConfidencePct (0-100) and passes to HunterCardStack + ActiveMissionsView
 *   - Stuck engaged_pending recovery: if a contact is engaged_pending > 30s, auto-recover
 *   - Improved empty states on all 3 tabs (Deck: "browse archived" + "go to Scout" CTAs)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection, query, where, orderBy,
  doc, getDoc, updateDoc, onSnapshot
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { ArrowLeft, Target, CheckCircle, Archive as ArchiveIcon, Zap } from 'lucide-react';
import HunterCardStack from '../../components/hunter/HunterCardStack';
import ActiveMissionsView from '../../components/hunter/ActiveMissionsView';
import QuickMissionAssignModal from '../../components/hunter/QuickMissionAssignModal';
import { bootstrapContactsForUser } from '../../utils/hunterBootstrap';
import { calculateReconConfidence } from '../../utils/reconConfidence';
import './HunterDashboard.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

// Contacts stuck in engaged_pending for more than 30s get auto-recovered
const STUCK_TIMEOUT_MS = 30_000;

export default function HunterDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('deck');
  const [deckContacts, setDeckContacts] = useState([]);
  const [activeContacts, setActiveContacts] = useState([]);
  const [archivedContacts, setArchivedContacts] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [reconConfidencePct, setReconConfidencePct] = useState(null);

  // Sprint 1.2: Quick mission assign
  const [quickAssignContact, setQuickAssignContact] = useState(null);

  // Intake badge: active contacts with no intake yet
  const intakeQueue = activeContacts.filter(
    c => c.hunter_status === 'active_mission' &&
         !c.hunter_intake?.completed_at &&
         !c.hunter_intake?.skipped
  );

  const unsubRef = useRef(null);
  // Track which stuck contacts have already been recovered (avoid repeated writes)
  const recoveredRef = useRef(new Set());

  useEffect(() => {
    initHunter();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stuck contact recovery ────────────────────────────────────────────────
  useEffect(() => {
    const user = getEffectiveUser();
    if (!user) return;

    const now = Date.now();
    activeContacts.forEach(c => {
      if (c.hunter_status !== 'engaged_pending') return;
      if (recoveredRef.current.has(c.id)) return;

      const engagedAt = c.hunter_engaged_at ? new Date(c.hunter_engaged_at).getTime() : 0;
      if (now - engagedAt > STUCK_TIMEOUT_MS) {
        recoveredRef.current.add(c.id);
        recoverStuckContact(user, c);
      }
    });
  }, [activeContacts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function recoverStuckContact(user, contact) {
    try {
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        hunter_status: 'active_mission',
        processing_error: 'Barry took too long. Tap Retry to try again.',
        processing_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      console.log(`[Hunter] Recovered stuck contact: ${contact.id}`);
    } catch (err) {
      console.error('[Hunter] Stuck contact recovery failed:', err);
    }
  }

  async function initHunter() {
    const user = getEffectiveUser();
    if (!user) { navigate('/login'); return; }

    // Load RECON confidence score (non-fatal)
    try {
      const dashboardDoc = await getDoc(doc(db, 'dashboards', user.uid));
      if (dashboardDoc.exists()) {
        setReconConfidencePct(calculateReconConfidence(dashboardDoc.data()));
      }
    } catch (err) {
      console.warn('[Hunter] RECON confidence load failed (non-fatal):', err.message);
    }

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

  // ── Engage handler ────────────────────────────────────────────────────────
  const handleEngage = useCallback(async (contact) => {
    const user = getEffectiveUser();
    if (!user) return;

    setCurrentIndex(prev => prev + 1);

    try {
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        hunter_status: 'engaged_pending',
        hunter_engaged_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[Hunter] Failed to set engaged_pending:', err);
      return;
    }

    setTab('active');
    processEngageBackground(user, contact);
  }, []);

  async function processEngageBackground(user, contact) {
    try {
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/barryHunterProcessEngage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, authToken, contactId: contact.id })
      });
      const data = await res.json();
      if (!data.success) console.warn('[Hunter] Process engage error:', data.error);
    } catch (err) {
      console.error('[Hunter] processEngageBackground network error:', err);
      try {
        const u = auth.currentUser;
        if (u) {
          await updateDoc(doc(db, 'users', u.uid, 'contacts', contact.id), {
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
    const user = getEffectiveUser();
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

  // ── Sprint 1.2: Quick mission assign ────────────────────────────────────
  const handleQuickMissionAssign = useCallback((contact) => {
    setQuickAssignContact(contact);
  }, []);

  // ── Restore from archive ─────────────────────────────────────────────────
  const handleRestore = useCallback(async (contact) => {
    const user = getEffectiveUser();
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
  const visibleDeckCount = Math.max(0, deckContacts.length - currentIndex);
  const activeCount = activeContacts.length;
  const archivedCount = archivedContacts.length;
  const intakeCount = intakeQueue.length;

  return (
    <div className="hunter-dashboard">
      {/* Sprint 1.2: Quick Mission Assign Modal */}
      {quickAssignContact && (
        <QuickMissionAssignModal
          contact={quickAssignContact}
          onClose={() => setQuickAssignContact(null)}
          onNavigateCreate={(contactId) => {
            setQuickAssignContact(null);
            navigate(`/hunter/create-mission?contactId=${contactId}`);
          }}
        />
      )}
      {/* Header */}
      <div className="hunter-header">
        <div className="hunter-header-inner">
          <div className="hunter-header-left">
            <button className="hunter-back-btn" onClick={() => navigate('/mission-control-v2')}>
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

          <div className="hunter-tabs">
            <button
              className={`hunter-tab ${tab === 'deck' ? 'hunter-tab--active' : ''}`}
              onClick={() => setTab('deck')}
            >
              Deck
              {visibleDeckCount > 0 && (
                <span className="hunter-tab-badge">{visibleDeckCount}</span>
              )}
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
            {bootstrapping ? 'Barry is orienting your contacts...' : 'Loading Hunter...'}
          </div>
        ) : (
          <>
            {/* Deck tab */}
            {tab === 'deck' && (
              <div className="hunter-deck-view">
                {/* HunterCardStack handles its own empty state (no contacts left in deck) */}
                <HunterCardStack
                  contacts={deckContacts}
                  currentIndex={currentIndex}
                  reconConfidencePct={reconConfidencePct}
                  onEngage={handleEngage}
                  onArchive={handleArchive}
                  onQuickMissionAssign={handleQuickMissionAssign}
                  onDeckEmpty={() => setTab('active')}
                />
                {visibleDeckCount > 0 && (
                  <p className="hunter-deck-count">
                    {visibleDeckCount} contact{visibleDeckCount !== 1 ? 's' : ''} remaining
                  </p>
                )}
              </div>
            )}

            {/* Active Missions tab */}
            {tab === 'active' && (
              <ActiveMissionsView
                contacts={activeContacts}
                reconConfidencePct={reconConfidencePct}
                onGoToDeck={() => setTab('deck')}
                onMissionComplete={(contact, outcome) => {
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
                    <p className="hunter-empty-sub">
                      Contacts you skip in the deck will appear here.
                    </p>
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

// ── Archived card ─────────────────────────────────────────────────────────────

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
        onClick={e => { e.stopPropagation(); onRestore(); }}
      >
        Restore
      </button>
    </div>
  );
}
