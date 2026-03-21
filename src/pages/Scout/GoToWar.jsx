/**
 * GoToWar.jsx — Go To War view in Command Center.
 *
 * Dedicated 8-phase wizard for launching bulk missions against a roster of contacts.
 * NOT a modal — this is a full section inside the Command Center shell.
 *
 * Phase 1: Brief    — Define objective (goal type + mission name)
 * Phase 2: Roster   — Select contacts + ICP/company filtering + add decision makers
 * Phase 3: Approach — Engagement style + channel selection
 * Phase 4: Sequence — Barry generates multi-step sequence plan
 * Phase 5: Approve  — Per-step review with StepApprovalCard (edit/skip/approve)
 * Phase 6: Launch   — Launch mission + manual send feed
 * Phase 7: Monitor  — Track replies and engagement in real time
 * Phase 8: Debrief  — Record outcomes, train Barry for next wave
 *
 * Sprint A: Email only. Existing saved contacts/companies. Manual-approved sends.
 */

import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, where, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import {
  Swords, Target, MessageSquare, RefreshCw,
  ChevronRight, ChevronLeft, Check, Search,
  AlertCircle, Loader, Users, Building2, Globe,
  Linkedin, ThumbsUp, ThumbsDown, UserPlus,
  ChevronDown, Crosshair, Clock, Zap, ArrowRight,
  Sparkles, Loader2, Rocket, Send, Eye,
  MailCheck, Clock3, CheckCircle, XCircle,
} from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import BarryHUD, { PHASE_LABELS } from '../../components/BarryHUD';
import {
  OUTCOME_GOALS,
  ENGAGEMENT_STYLES,
  MISSION_TIMEFRAMES,
  NEXT_STEP_TYPES,
  getLabelById,
} from '../../constants/structuredFields';
import StepApprovalCard from '../../components/hunter/StepApprovalCard';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS } from '../../utils/contactStateMachine';

const WAR_ACCENT = '#f97316'; // orange — distinct from CC cyan so Go To War feels like action
const TOTAL_PHASES = 8;

// ─── Goal options (reuse missionTemplates goal IDs) ───────────────────────────
const GOAL_OPTIONS = [
  {
    id: 'book_meetings',
    label: 'Book Meetings',
    icon: Target,
    desc: 'Multi-touch sequence designed to get time on the calendar.',
    color: '#6366f1',
  },
  {
    id: 'warm_conversations',
    label: 'Warm Conversations',
    icon: MessageSquare,
    desc: 'Build relationship before pitching. Low pressure, high value.',
    color: '#10b981',
  },
  {
    id: 'reengage_stalled',
    label: 'Reengage Stalled',
    icon: RefreshCw,
    desc: 'Wake up contacts who went quiet. Different angle, fresh energy.',
    color: '#f59e0b',
  },
];

// ─── ContactRosterRow ─────────────────────────────────────────────────────────
// Replaces CompanyCard swipe UI. Built specifically for bulk list+checkbox selection.
// CompanyCard audit result: swipe-only, not extensible for multi-select — new component needed.
function ContactRosterRow({ contact, selected, onToggle, T }) {
  const initials = (contact.name || contact.email || 'XX')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      onClick={() => onToggle(contact.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        borderRadius: 10,
        marginBottom: 2,
        cursor: 'pointer',
        background: selected ? `${WAR_ACCENT}10` : T.cardBg,
        border: `1.5px solid ${selected ? `${WAR_ACCENT}40` : T.border2}`,
        transition: 'all 0.12s',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = T.surface;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = selected ? `${WAR_ACCENT}10` : T.cardBg;
      }}
    >
      {/* Checkbox */}
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `2px solid ${selected ? WAR_ACCENT : T.border2}`,
          background: selected ? WAR_ACCENT : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.12s',
        }}
      >
        {selected && <Check size={11} color="#fff" strokeWidth={3} />}
      </div>

      {/* Avatar */}
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: `${BRAND.cyan}20`,
          border: `1.5px solid ${BRAND.cyan}40`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: BRAND.cyan,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: T.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 2,
          }}
        >
          {contact.name || 'Unknown'}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.textFaint,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {[contact.title, contact.company].filter(Boolean).join(' · ') || contact.email || '—'}
        </div>
      </div>

      {/* Status badge (if contact is already on an active mission) */}
      {contact.hunter_status === 'active_mission' && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: '#f59e0b',
            background: '#f59e0b15',
            border: '1px solid #f59e0b30',
            padding: '2px 7px',
            borderRadius: 20,
            flexShrink: 0,
          }}
        >
          ACTIVE
        </span>
      )}
    </div>
  );
}


// ─── GoToWar ──────────────────────────────────────────────────────────────────
export default function GoToWar() {
  const T = useT();

  // Phase state (0-indexed)
  const [phase, setPhase] = useState(0);

  // Phase 1: Brief
  const [goalId, setGoalId]       = useState('');
  const [missionName, setMissionName] = useState('');

  // Phase 2: Roster
  const [contacts, setContacts]       = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError]     = useState(null);
  const [selected, setSelected]       = useState(new Set());
  const [search, setSearch]           = useState('');

  // Phase 3: ICP & Companies
  const [objectiveSentence, setObjectiveSentence] = useState('');
  const [icpGeo, setIcpGeo]               = useState('');
  const [icpIndustry, setIcpIndustry]     = useState('');
  const [icpTitle, setIcpTitle]           = useState('');
  const [icpRevenue, setIcpRevenue]       = useState('');
  const [companies, setCompanies]         = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [approvedCompanies, setApprovedCompanies] = useState(new Set());
  const [companySearch, setCompanySearch] = useState('');

  // Phase 4: Contacts — inline company expansion + mission contacts
  const [expandedCompanyId, setExpandedCompanyId] = useState(null);
  const [companyContacts, setCompanyContacts]     = useState({});  // companyId → contacts[]
  const [loadingCompanyContacts, setLoadingCompanyContacts] = useState(null);
  const [missionContacts, setMissionContacts]     = useState([]); // contacts added to mission

  // Phase 2: Roster sub-tab (contacts / companies / decision makers)
  const [rosterTab, setRosterTab] = useState('contacts'); // 'contacts' | 'companies' | 'decision_makers'

  // Phase 3: Approach (strategy config)
  const [outcomeGoal, setOutcomeGoal]         = useState(null);
  const [engagementStyle, setEngagementStyle] = useState(null);
  const [timeframe, setTimeframe]             = useState(null);
  const [nextStepType, setNextStepType]       = useState(null);

  // Phase 4: Sequence generation
  const [microSequence, setMicroSequence]     = useState(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [sequenceError, setSequenceError]     = useState(null);

  // Phase 5: Approve — per-step review
  const [approvedSteps, setApprovedSteps]     = useState(new Set()); // set of step indices
  const [skippedSteps, setSkippedSteps]       = useState(new Set());

  // Phase 6: Launch + Send
  const [missionLaunched, setMissionLaunched] = useState(false);
  const [launchingMission, setLaunchingMission] = useState(false);
  const [activeMissionId, setActiveMissionId] = useState(null);
  const [sendingStep, setSendingStep]         = useState(null); // contactId being sent
  const [sentSteps, setSentSteps]             = useState({});   // contactId → Set of step indices sent

  // Phase 7: Monitor — outcomes
  const [contactOutcomes, setContactOutcomes] = useState({}); // contactId → outcome string

  // Phase 8: Debrief
  const [debriefNotes, setDebriefNotes] = useState('');
  const [debriefSaving, setDebriefSaving] = useState(false);
  const [debriefSaved, setDebriefSaved] = useState(false);

  // Persist debrief outcomes + notes to Firestore
  async function saveDebrief() {
    if (!activeMissionId) return;
    setDebriefSaving(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const missionRef = doc(db, 'users', user.uid, 'missions', activeMissionId);
      const updatedContacts = missionContacts.map((mc) => ({
        ...mc,
        manualOutcome: contactOutcomes[mc.contactId] || null,
        status: contactOutcomes[mc.contactId] ? 'completed' : mc.status,
      }));
      await updateDoc(missionRef, {
        contacts: updatedContacts,
        debriefNotes: debriefNotes || null,
        status: 'completed',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setMissionContacts(updatedContacts);
      setDebriefSaved(true);

      // Log debrief to timeline for each contact with an outcome
      Object.entries(contactOutcomes).forEach(([contactId, outcome]) => {
        logTimelineEvent({
          userId: user.uid,
          contactId,
          type: 'mission_debrief',
          actor: ACTORS.USER,
          preview: `Outcome: ${outcome}`,
          metadata: { missionId: activeMissionId, outcome },
        });
      });
    } catch (err) {
      console.error('[GoToWar] debrief save error:', err);
      alert('Failed to save debrief. Please try again.');
    } finally {
      setDebriefSaving(false);
    }
  }

  // ── Resume banner: check for active missions on mount ───────────────────────
  const [activeMissions, setActiveMissions] = useState([]);
  const [resumeBannerVisible, setResumeBannerVisible] = useState(false);

  useEffect(() => {
    loadActiveMissions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadActiveMissions() {
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const snap = await getDocs(
        query(
          collection(db, 'users', user.uid, 'missions'),
          where('status', '==', 'active')
        )
      );
      const missions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (missions.length > 0) {
        setActiveMissions(missions);
        setResumeBannerVisible(true);
      }
    } catch (err) {
      console.error('[GoToWar] active missions check error:', err);
    }
  }

  function resumeMission(mission) {
    setActiveMissionId(mission.id);
    setMissionName(mission.name || '');
    setGoalId(mission.outcome_goal || '');
    setMissionContacts(mission.contacts || []);
    setMicroSequence(mission.microSequence || null);
    setOutcomeGoal(mission.outcome_goal || null);
    setEngagementStyle(mission.engagement_style || null);
    setTimeframe(mission.timeframe || null);
    setNextStepType(mission.next_step_type || null);
    setMissionLaunched(true);
    setObjectiveSentence(mission.objective_sentence || '');

    // Rebuild sentSteps from contact stepHistory
    const rebuilt = {};
    (mission.contacts || []).forEach((c) => {
      if (c.stepHistory?.length > 0) {
        rebuilt[c.contactId] = new Set(c.stepHistory.map((h) => h.stepIndex));
      }
    });
    setSentSteps(rebuilt);

    // Rebuild outcomes
    const outcomes = {};
    (mission.contacts || []).forEach((c) => {
      if (c.manualOutcome) outcomes[c.contactId] = c.manualOutcome;
    });
    setContactOutcomes(outcomes);

    setResumeBannerVisible(false);
    setPhase(5); // Jump to Launch phase (already launched)
  }

  // Load contacts when entering Phase 2 (Roster)
  useEffect(() => {
    if (phase !== 1) return;
    if (contacts.length === 0) loadContacts();
    if (companies.length === 0) loadCompanies();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadContacts() {
    setContactsLoading(true);
    setContactsError(null);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'contacts'), orderBy('name'))
      );
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('[GoToWar] contacts load error:', err);
      setContactsError('Failed to load contacts. Try refreshing.');
    } finally {
      setContactsLoading(false);
    }
  }

  async function loadCompanies() {
    setCompaniesLoading(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'companies'), where('status', '==', 'accepted'))
      );
      const companyList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCompanies(companyList);
    } catch (err) {
      console.error('[GoToWar] companies load error:', err);
    } finally {
      setCompaniesLoading(false);
    }
  }

  // Load contacts for a specific company (Phase 4 inline expansion)
  async function loadCompanyContacts(companyId) {
    if (companyContacts[companyId]) return; // already loaded
    setLoadingCompanyContacts(companyId);
    try {
      const user = getEffectiveUser();
      if (!user) return;
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'contacts'), where('company_id', '==', companyId))
      );
      const contactList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCompanyContacts((prev) => ({ ...prev, [companyId]: contactList }));
    } catch (err) {
      console.error('[GoToWar] company contacts load error:', err);
    } finally {
      setLoadingCompanyContacts(null);
    }
  }

  // Add contact to mission (Phase 4)
  function addToMission(contact, company) {
    if (missionContacts.find((c) => c.contactId === contact.id)) return; // already added
    setMissionContacts((prev) => [
      ...prev,
      {
        contactId: contact.id,
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || 'Unknown',
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        email: contact.email || null,
        phone: contact.phone || null,
        title: contact.title || contact.current_position_title || null,
        companyId: company?.id || contact.company_id || null,
        companyName: company?.name || contact.company_name || null,
        addedFrom: 'saved',
        currentStepIndex: 0,
        lastTouchDate: null,
        status: 'active',
        sequenceStatus: 'pending',
        stepHistory: [],
        lastOutcome: null,
        replyStatus: 'no-reply',
        lastContactedAt: null,
        manualOutcome: null,
      },
    ]);
  }

  function removeFromMission(contactId) {
    setMissionContacts((prev) => prev.filter((c) => c.contactId !== contactId));
  }

  // Phase 5: Generate sequence from Barry
  async function generateMissionSequence() {
    setSequenceLoading(true);
    setSequenceError(null);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');
      const token = await user.getIdToken();
      const response = await fetch('/.netlify/functions/barryGenerateMissionSequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken: token,
          missionFields: {
            outcome_goal: outcomeGoal,
            engagement_style: engagementStyle,
            timeframe: timeframe,
            next_step_type: nextStepType,
            objective_sentence: objectiveSentence || null,
          },
          contacts: missionContacts.slice(0, 5),
        }),
      });
      if (!response.ok) throw new Error('Failed to generate sequence');
      const data = await response.json();
      if (data.success && data.microSequence) {
        setMicroSequence(data.microSequence);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error('[GoToWar] sequence generation error:', err);
      setSequenceError('Barry could not generate a sequence. You can still launch manually.');
    } finally {
      setSequenceLoading(false);
    }
  }

  // Phase 6: Launch mission to Firestore
  async function handleLaunchMission() {
    setLaunchingMission(true);
    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');
      const warId = `war_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const missionDoc = {
        name: missionName || GOAL_OPTIONS.find((g) => g.id === goalId)?.label + ' — ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        userId: user.uid,
        warId,
        channel: 'email',
        objective_sentence: objectiveSentence || null,
        outcome_goal: outcomeGoal,
        engagement_style: engagementStyle,
        timeframe: timeframe,
        next_step_type: nextStepType,
        microSequence: microSequence || null,
        sequence: microSequence ? {
          steps: microSequence.steps,
          sequenceRationale: microSequence.sequenceRationale,
          expectedOutcome: microSequence.expectedOutcome,
          totalSteps: microSequence.steps?.length || 0,
          generatedAt: microSequence.generatedAt || new Date().toISOString(),
        } : null,
        contacts: missionContacts.map((c) => ({
          ...c,
          sequenceStatus: microSequence ? 'active' : 'pending',
        })),
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const docRef = await addDoc(collection(db, 'users', user.uid, 'missions'), missionDoc);
      setActiveMissionId(docRef.id);
      setMissionLaunched(true);

      // Log timeline events for each contact
      missionContacts.forEach((c) => {
        logTimelineEvent({
          userId: user.uid,
          contactId: c.contactId,
          type: 'mission_assigned',
          actor: ACTORS.USER,
          preview: missionDoc.name,
          metadata: { missionId: docRef.id, missionName: missionDoc.name, goalName: goalId },
        });
        updateContactStatus({ userId: user.uid, contactId: c.contactId, trigger: STATUS_TRIGGERS.MISSION_ASSIGNED });
      });
    } catch (err) {
      console.error('[GoToWar] launch error:', err);
      alert('Failed to launch mission. Please try again.');
    } finally {
      setLaunchingMission(false);
    }
  }

  // ── Send throttle (90s global per-sender) ──────────────────────────────────
  const [lastSendTime, setLastSendTime] = useState(0);
  const [throttleRemaining, setThrottleRemaining] = useState(0);

  useEffect(() => {
    if (throttleRemaining <= 0) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((lastSendTime + 90000 - Date.now()) / 1000));
      setThrottleRemaining(remaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [lastSendTime, throttleRemaining]);

  // Phase 6: Manual send for a specific contact + step
  async function handleManualSend(contact, stepIndex) {
    // Enforce 90s global throttle
    const now = Date.now();
    const elapsed = now - lastSendTime;
    if (lastSendTime > 0 && elapsed < 90000) {
      const wait = Math.ceil((90000 - elapsed) / 1000);
      setThrottleRemaining(wait);
      alert(`Send throttle: please wait ${wait}s before sending again. This prevents rate-limiting.`);
      return;
    }

    const key = `${contact.contactId}_${stepIndex}`;
    setSendingStep(key);
    try {
      const user = getEffectiveUser();
      if (!user || !activeMissionId) return;
      const token = await user.getIdToken();
      // Call existing Gmail send function
      await fetch('/.netlify/functions/gmail-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken: token,
          contactEmail: contact.email,
          contactName: contact.name,
          subject: `Step ${stepIndex + 1} — ${missionName || 'Go To War Mission'}`,
          body: microSequence?.steps?.[stepIndex]?.action || 'Follow up message',
        }),
      });

      // Update throttle timestamp
      const sendTime = Date.now();
      setLastSendTime(sendTime);
      setThrottleRemaining(90);

      // Log to timeline
      logTimelineEvent({
        userId: user.uid,
        contactId: contact.contactId,
        type: 'sequence_step_sent',
        actor: ACTORS.USER,
        preview: `Step ${stepIndex + 1} sent`,
        metadata: { missionId: activeMissionId, stepIndex },
      });

      // Persist send state to Firestore — update mission contact
      const missionRef = doc(db, 'users', user.uid, 'missions', activeMissionId);
      const updatedContacts = missionContacts.map((mc) => {
        if (mc.contactId !== contact.contactId) return mc;
        const newHistory = [...(mc.stepHistory || []), {
          stepIndex,
          sentAt: new Date().toISOString(),
          actor: 'user',
        }];
        return {
          ...mc,
          currentStepIndex: stepIndex + 1,
          lastContactedAt: new Date().toISOString(),
          replyStatus: 'no-reply',
          stepHistory: newHistory,
          status: (stepIndex + 1 >= (microSequence?.steps?.length || 1)) ? 'awaiting_outcome' : 'active',
        };
      });
      await updateDoc(missionRef, {
        contacts: updatedContacts,
        updatedAt: new Date().toISOString(),
      });
      setMissionContacts(updatedContacts);

      setSentSteps((prev) => {
        const next = { ...prev };
        if (!next[contact.contactId]) next[contact.contactId] = new Set();
        next[contact.contactId] = new Set([...next[contact.contactId], stepIndex]);
        return next;
      });
    } catch (err) {
      console.error('[GoToWar] send error:', err);
    } finally {
      setSendingStep(null);
    }
  }

  const toggleContact = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const visible = filteredContacts.map((c) => c.id);
    const allSelected = visible.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visible.forEach((id) => next.delete(id));
      else visible.forEach((id) => next.add(id));
      return next;
    });
  };

  const filteredContacts = contacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q) ||
      c.title?.toLowerCase().includes(q)
    );
  });

  // Filtered companies for Phase 3
  const filteredCompanies = companies.filter((c) => {
    if (!companySearch) return true;
    const q = companySearch.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.industry?.toLowerCase().includes(q)
    );
  });

  // Helpers
  const allStrategyFieldsSet = outcomeGoal && engagementStyle && timeframe && nextStepType;

  // Phase gate: can the user advance?
  const canAdvance = () => {
    if (phase === 0) return goalId !== '';                           // Brief: goal selected
    if (phase === 1) return selected.size > 0 || missionContacts.length > 0; // Roster: contacts selected or added
    if (phase === 2) return allStrategyFieldsSet;                   // Approach: all strategy fields set
    if (phase === 3) return !!microSequence;                        // Sequence: generated
    if (phase === 4) return approvedSteps.size + skippedSteps.size === (microSequence?.steps?.length || 0); // Approve: all steps reviewed
    if (phase === 5) return missionLaunched;                        // Launch: mission launched
    return true;
  };

  // ── Phase 1: Brief ──────────────────────────────────────────────────────────
  const renderPhase1 = () => (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            margin: 0,
            fontSize: '1.25rem',
            fontWeight: 700,
            color: T.text,
            letterSpacing: '-0.02em',
            marginBottom: 6,
          }}
        >
          What are you going after?
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
          Choose the goal that drives this mission. Barry builds the plan around it.
        </p>
      </div>

      {/* Goal cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {GOAL_OPTIONS.map((g) => {
          const active = goalId === g.id;
          const Icon = g.icon;
          return (
            <div
              key={g.id}
              onClick={() => setGoalId(g.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 16px',
                borderRadius: 12,
                border: `2px solid ${active ? g.color : T.border2}`,
                background: active ? `${g.color}10` : T.cardBg,
                cursor: 'pointer',
                transition: 'all 0.12s',
                userSelect: 'none',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = T.surface;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = active ? `${g.color}10` : T.cardBg;
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: `${g.color}18`,
                  border: `1.5px solid ${g.color}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon size={19} color={g.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: active ? g.color : T.text,
                    marginBottom: 3,
                  }}
                >
                  {g.label}
                </div>
                <div style={{ fontSize: 12, color: T.textFaint, lineHeight: 1.45 }}>
                  {g.desc}
                </div>
              </div>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: `2px solid ${active ? g.color : T.border2}`,
                  background: active ? g.color : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {active && <Check size={11} color="#fff" strokeWidth={3} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mission name */}
      {goalId && (
        <div style={{ animation: 'fadeUp 0.18s ease' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: T.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Name this mission (optional)
          </div>
          <input
            type="text"
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            placeholder={
              GOAL_OPTIONS.find((g) => g.id === goalId)?.label + ' — ' +
              new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            }
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 10,
              border: `1.5px solid ${T.border2}`,
              background: T.cardBg,
              color: T.text,
              fontSize: 13,
              outline: 'none',
              fontFamily: 'Inter, system-ui, sans-serif',
              boxSizing: 'border-box',
              transition: 'border-color 0.12s',
            }}
            onFocus={(e) => { e.target.style.borderColor = WAR_ACCENT; }}
            onBlur={(e) => { e.target.style.borderColor = T.border2; }}
          />
        </div>
      )}
    </div>
  );

  // ── Phase 2: Roster (tabbed — contacts, companies, decision makers) ─────────
  const renderPhaseRoster = () => {
    const ROSTER_TABS = [
      { id: 'contacts', label: 'Contacts', icon: Users },
      { id: 'companies', label: 'Companies', icon: Building2 },
      { id: 'decision_makers', label: 'Decision Makers', icon: Crosshair },
    ];
    const approvedList = companies.filter((c) => approvedCompanies.has(c.id));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 12px', flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: T.text, letterSpacing: '-0.02em', marginBottom: 4 }}>
            Build your roster
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: T.textFaint }}>
            {missionContacts.length > 0
              ? `${selected.size} contacts selected · ${missionContacts.length} decision maker${missionContacts.length !== 1 ? 's' : ''} added`
              : selected.size > 0
                ? `${selected.size} contact${selected.size !== 1 ? 's' : ''} selected`
                : 'Select contacts, approve companies, and add decision makers.'}
          </p>
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 24px 10px', flexShrink: 0 }}>
          {ROSTER_TABS.map((tab) => {
            const active = rosterTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setRosterTab(tab.id)}
                style={{
                  padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: active ? 600 : 400,
                  border: `1.5px solid ${active ? WAR_ACCENT : T.border2}`,
                  background: active ? `${WAR_ACCENT}12` : 'transparent',
                  color: active ? WAR_ACCENT : T.textMuted,
                  cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <Icon size={12} /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── Tab: Contacts ────────────────────────────────────────────── */}
        {rosterTab === 'contacts' && (
          <>
            <div style={{ padding: '0 24px 10px', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} color={T.textFaint} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                  type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by name, company, title…"
                  style={{
                    width: '100%', padding: '8px 12px 8px 32px', borderRadius: 9,
                    border: `1.5px solid ${T.border2}`, background: T.surface,
                    color: T.text, fontSize: 12, outline: 'none',
                    fontFamily: 'Inter, system-ui, sans-serif', boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = WAR_ACCENT; }}
                  onBlur={(e) => { e.target.style.borderColor = T.border2; }}
                />
              </div>
            </div>
            {filteredContacts.length > 0 && (
              <div style={{ padding: '4px 24px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: T.textFaint }}>
                  {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''}{search ? ' matching' : ''}
                </span>
                <button onClick={toggleAll} style={{ fontSize: 11, fontWeight: 600, color: WAR_ACCENT, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {filteredContacts.every((c) => selected.has(c.id)) ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
              {contactsLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 40, color: T.textFaint, fontSize: 13 }}>
                  <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading contacts…
                </div>
              ) : contactsError ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', color: '#ef4444', fontSize: 13 }}>
                  <AlertCircle size={15} /> {contactsError}
                </div>
              ) : filteredContacts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
                  {search ? 'No contacts match that filter.' : 'No contacts found. Add contacts in Scout first.'}
                </div>
              ) : (
                filteredContacts.map((c) => (
                  <ContactRosterRow key={c.id} contact={c} selected={selected.has(c.id)} onToggle={toggleContact} T={T} />
                ))
              )}
            </div>
          </>
        )}

        {/* ── Tab: Companies ───────────────────────────────────────────── */}
        {rosterTab === 'companies' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
            <textarea
              value={objectiveSentence} onChange={(e) => setObjectiveSentence(e.target.value)}
              placeholder="e.g. Utah-based commercial construction GCs, CFO or COO, over $20M revenue"
              rows={3}
              style={{
                width: '100%', padding: 12, borderRadius: 10, border: `1.5px solid ${T.border2}`,
                background: T.cardBg, color: T.text, fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif',
                resize: 'vertical', marginBottom: 14, boxSizing: 'border-box',
              }}
            />
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: 11, color: T.textFaint }} />
              <input
                type="text" value={companySearch} onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Filter companies…"
                style={{
                  width: '100%', padding: '9px 12px 9px 34px', borderRadius: 9,
                  border: `1.5px solid ${T.border2}`, background: T.cardBg,
                  color: T.text, fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {companiesLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: T.textFaint }}><Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /></div>
              ) : filteredCompanies.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
                  {companySearch ? 'No companies match that filter.' : 'No accepted companies found.'}
                </div>
              ) : (
                filteredCompanies.map((c) => {
                  const approved = approvedCompanies.has(c.id);
                  return (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10,
                      border: `1.5px solid ${approved ? '#22c55e40' : T.border2}`, background: approved ? '#22c55e08' : T.cardBg,
                    }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: `${WAR_ACCENT}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Building2 size={16} color={WAR_ACCENT} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name || 'Unnamed Company'}</div>
                        <div style={{ fontSize: 11, color: T.textFaint }}>{[c.industry, c.geo || c.state].filter(Boolean).join(' · ') || 'No details'}</div>
                      </div>
                      <button
                        onClick={() => { setApprovedCompanies((prev) => { const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; }); }}
                        style={{
                          padding: '6px 12px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                          background: approved ? '#22c55e' : T.border2, color: approved ? '#fff' : T.textMuted,
                        }}
                      >
                        {approved ? <><ThumbsUp size={12} /> Approved</> : <><ThumbsDown size={12} /> Approve</>}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Decision Makers ─────────────────────────────────────── */}
        {rosterTab === 'decision_makers' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
            {missionContacts.length > 0 && (
              <div style={{
                padding: '10px 14px', borderRadius: 9, background: `${WAR_ACCENT}10`,
                border: `1.5px solid ${WAR_ACCENT}30`, marginBottom: 16, fontSize: 13, color: WAR_ACCENT, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Users size={14} />
                {missionContacts.length} contact{missionContacts.length !== 1 ? 's' : ''} in mission
              </div>
            )}
            {approvedList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
                Approve companies in the Companies tab first, then add decision makers here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {approvedList.map((company) => {
                  const expanded = expandedCompanyId === company.id;
                  const cContacts = companyContacts[company.id] || [];
                  const loading = loadingCompanyContacts === company.id;
                  return (
                    <div key={company.id} style={{ borderRadius: 10, border: `1.5px solid ${T.border2}`, overflow: 'hidden' }}>
                      <div
                        onClick={() => { if (expanded) { setExpandedCompanyId(null); return; } setExpandedCompanyId(company.id); loadCompanyContacts(company.id); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', background: expanded ? `${WAR_ACCENT}08` : T.cardBg }}
                      >
                        <Building2 size={15} color={T.textMuted} />
                        <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.text }}>{company.name}</div>
                        <ChevronDown size={14} color={T.textFaint} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                      </div>
                      {expanded && (
                        <div style={{ borderTop: `1px solid ${T.border}`, padding: '8px 0' }}>
                          {loading ? (
                            <div style={{ textAlign: 'center', padding: 20, color: T.textFaint }}><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /></div>
                          ) : cContacts.length === 0 ? (
                            <div style={{ padding: '12px 14px', fontSize: 12, color: T.textFaint }}>No contacts saved for this company.</div>
                          ) : (
                            cContacts.map((contact) => {
                              const inMission = missionContacts.some((mc) => mc.contactId === contact.id);
                              return (
                                <div key={contact.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px' }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>
                                      {`${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || 'Unknown'}
                                    </div>
                                    <div style={{ fontSize: 11, color: T.textFaint }}>
                                      {contact.title || contact.current_position_title || 'No title'} {contact.email ? `· ${contact.email}` : ''}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => inMission ? removeFromMission(contact.id) : addToMission(contact, company)}
                                    style={{
                                      padding: '5px 10px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600,
                                      cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                                      background: inMission ? '#ef4444' : WAR_ACCENT, color: '#fff',
                                    }}
                                  >
                                    {inMission ? 'Remove' : <><UserPlus size={11} /> Add</>}
                                  </button>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Shared OptionGrid component ──────────────────────────────────────────────
  const OptionGrid = ({ items, selected, onSelect, accent }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
      {items.map((item) => {
        const active = selected === item.id;
        return (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            style={{
              padding: '10px 12px', borderRadius: 9, cursor: 'pointer',
              border: `1.5px solid ${active ? (accent || WAR_ACCENT) : T.border2}`,
              background: active ? `${accent || WAR_ACCENT}10` : T.cardBg,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: active ? (accent || WAR_ACCENT) : T.text, marginBottom: 2 }}>{item.label}</div>
            <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.4 }}>{item.description}</div>
          </div>
        );
      })}
    </div>
  );

  // ── Phase 3: Approach (strategy config) ────────────────────────────────────
  const renderPhaseApproach = () => (
    <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: T.text, letterSpacing: '-0.02em', marginBottom: 6 }}>
          Set your approach
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
          Choose your engagement style and channel. This shapes the sequence Barry builds.
        </p>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Outcome Goal</div>
      <OptionGrid items={OUTCOME_GOALS.slice(0, 6)} selected={outcomeGoal} onSelect={setOutcomeGoal} />

      <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Engagement Style</div>
      <OptionGrid items={ENGAGEMENT_STYLES} selected={engagementStyle} onSelect={setEngagementStyle} />

      <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Timeframe</div>
      <OptionGrid items={MISSION_TIMEFRAMES} selected={timeframe} onSelect={setTimeframe} />

      <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Next Step Type</div>
      <OptionGrid items={NEXT_STEP_TYPES} selected={nextStepType} onSelect={setNextStepType} />
    </div>
  );

  // ── Phase 4: Sequence (Barry generates plan) ──────────────────────────────
  const renderPhaseSequence = () => (
    <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: T.text, letterSpacing: '-0.02em', marginBottom: 6 }}>
          Generate your sequence
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
          Barry will build a multi-step sequence based on your approach. Review the plan before approving.
        </p>
      </div>

      {/* Generate button */}
      {!microSequence && (
        <button
          onClick={generateMissionSequence}
          disabled={sequenceLoading}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
            background: WAR_ACCENT, color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: sequenceLoading ? 'wait' : 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: sequenceLoading ? 0.7 : 1,
          }}
        >
          {sequenceLoading ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Barry is building…</> : <><Sparkles size={14} /> Generate Sequence</>}
        </button>
      )}
      {sequenceError && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={13} /> {sequenceError}
        </div>
      )}

      {/* Sequence preview */}
      {microSequence && (
        <div style={{ marginTop: 4 }}>
          <div style={{ padding: 16, borderRadius: 10, border: `1.5px solid ${WAR_ACCENT}30`, background: `${WAR_ACCENT}06` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: WAR_ACCENT, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={14} /> Sequence — {microSequence.steps?.length || 0} steps
            </div>
            {microSequence.steps?.map((step, i) => (
              <div key={i} style={{ padding: '8px 0', borderTop: i > 0 ? `1px solid ${T.border}` : 'none' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Step {i + 1}: {step.label || step.stepType || 'Action'}</div>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{step.action || step.description || ''}</div>
                {step.channel && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>Channel: {step.channel} {step.suggestedTiming ? `· ${step.suggestedTiming}` : ''}</div>}
              </div>
            ))}
            {microSequence.sequenceRationale && (
              <div style={{ marginTop: 10, fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>
                {microSequence.sequenceRationale}
              </div>
            )}
          </div>

          {/* Regenerate */}
          <button
            onClick={generateMissionSequence}
            disabled={sequenceLoading}
            style={{
              marginTop: 12, padding: '8px 16px', borderRadius: 8,
              border: `1.5px solid ${T.border2}`, background: 'transparent',
              color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {sequenceLoading ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Regenerating…</> : <><RefreshCw size={12} /> Regenerate</>}
          </button>
        </div>
      )}
    </div>
  );

  // ── Phase 5: Approve (per-step review) ─────────────────────────────────────
  const renderPhaseApprove = () => {
    const steps = microSequence?.steps || [];
    const allReviewed = approvedSteps.size + skippedSteps.size === steps.length;
    return (
      <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: T.text, letterSpacing: '-0.02em', marginBottom: 6 }}>
            Review each step
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
            Approve or skip each step before launch. {approvedSteps.size} approved, {skippedSteps.size} skipped of {steps.length}.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {steps.map((step, i) => {
            const isApproved = approvedSteps.has(i);
            const isSkipped = skippedSteps.has(i);
            return (
              <div key={i} style={{
                padding: 16, borderRadius: 10,
                border: `1.5px solid ${isApproved ? '#22c55e40' : isSkipped ? '#f59e0b40' : T.border2}`,
                background: isApproved ? '#22c55e06' : isSkipped ? '#f59e0b06' : T.cardBg,
              }}>
                {/* Step header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: isApproved ? '#22c55e' : isSkipped ? '#f59e0b' : `${WAR_ACCENT}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: isApproved || isSkipped ? '#fff' : WAR_ACCENT,
                  }}>
                    {isApproved ? <Check size={12} /> : isSkipped ? '—' : i + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                      Step {i + 1}: {step.stepType || step.label || 'Action'}
                    </div>
                    <div style={{ fontSize: 11, color: T.textFaint }}>
                      {step.channel || 'email'} {step.suggestedTiming ? `· ${step.suggestedTiming}` : ''}
                    </div>
                  </div>
                  {(isApproved || isSkipped) && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                      padding: '2px 7px', borderRadius: 20,
                      color: isApproved ? '#22c55e' : '#f59e0b',
                      background: isApproved ? '#22c55e12' : '#f59e0b12',
                      border: `1px solid ${isApproved ? '#22c55e30' : '#f59e0b30'}`,
                    }}>
                      {isApproved ? 'APPROVED' : 'SKIPPED'}
                    </span>
                  )}
                </div>

                {/* Step content */}
                <div style={{ fontSize: 12, color: T.text, marginBottom: 4, lineHeight: 1.5 }}>
                  {step.action || step.description || 'No action defined.'}
                </div>
                {step.purpose && (
                  <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 4 }}>
                    Purpose: {step.purpose}
                  </div>
                )}
                {step.reasoning && (
                  <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', marginBottom: 8, display: 'flex', alignItems: 'start', gap: 4 }}>
                    <Sparkles size={11} style={{ flexShrink: 0, marginTop: 2 }} /> {step.reasoning}
                  </div>
                )}

                {/* Actions — only show if not yet reviewed */}
                {!isApproved && !isSkipped && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => setSkippedSteps((prev) => new Set([...prev, i]))}
                      style={{
                        padding: '6px 14px', borderRadius: 7, border: `1.5px solid ${T.border2}`,
                        background: 'transparent', color: T.textMuted, fontSize: 11, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      Skip
                    </button>
                    <button
                      onClick={() => setApprovedSteps((prev) => new Set([...prev, i]))}
                      style={{
                        padding: '6px 14px', borderRadius: 7, border: 'none',
                        background: '#22c55e', color: '#fff', fontSize: 11, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Check size={11} /> Approve
                    </button>
                  </div>
                )}

                {/* Undo */}
                {(isApproved || isSkipped) && (
                  <button
                    onClick={() => {
                      setApprovedSteps((prev) => { const n = new Set(prev); n.delete(i); return n; });
                      setSkippedSteps((prev) => { const n = new Set(prev); n.delete(i); return n; });
                    }}
                    style={{
                      marginTop: 6, padding: '4px 10px', borderRadius: 5, border: `1px solid ${T.border2}`,
                      background: 'transparent', color: T.textFaint, fontSize: 10, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                    }}
                  >
                    Undo
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {allReviewed && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 9,
            background: '#22c55e10', border: `1.5px solid #22c55e30`,
            fontSize: 13, color: '#22c55e', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <CheckCircle size={14} /> All steps reviewed. Ready to launch.
          </div>
        )}
      </div>
    );
  };

  // ── Phase 6: Launch ─────────────────────────────────────────────────────────
  const renderPhase6 = () => (
    <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: T.text, letterSpacing: '-0.02em', marginBottom: 6 }}>
          {missionLaunched ? 'Mission is live' : 'Ready to launch'}
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
          {missionLaunched
            ? 'Send each step manually. Click Send next to a contact to fire the email.'
            : `${missionContacts.length} contact${missionContacts.length !== 1 ? 's' : ''} queued. Launch the mission to begin sending.`}
        </p>
      </div>

      {/* Launch button */}
      {!missionLaunched && (
        <button
          onClick={handleLaunchMission}
          disabled={launchingMission}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 10, border: 'none',
            background: WAR_ACCENT, color: '#fff', fontSize: 15, fontWeight: 700,
            cursor: launchingMission ? 'wait' : 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: `0 4px 16px ${WAR_ACCENT}40`, marginBottom: 24,
          }}
        >
          {launchingMission ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Launching…</> : <><Rocket size={16} /> Launch Mission</>}
        </button>
      )}

      {/* Throttle indicator */}
      {missionLaunched && throttleRemaining > 0 && (
        <div style={{
          padding: '8px 14px', borderRadius: 8, background: `${WAR_ACCENT}08`,
          border: `1.5px solid ${WAR_ACCENT}25`, marginBottom: 10,
          fontSize: 12, color: WAR_ACCENT, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Clock3 size={13} /> Send throttle: {throttleRemaining}s remaining
        </div>
      )}

      {/* Send feed */}
      {missionLaunched && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {missionContacts.map((mc) => {
            const steps = microSequence?.steps || [{ label: 'Initial outreach' }];
            const contactSent = sentSteps[mc.contactId] || new Set();
            const nextStepIdx = [...Array(steps.length).keys()].find((i) => !contactSent.has(i)) ?? null;
            return (
              <div key={mc.contactId} style={{ padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${T.border2}`, background: T.cardBg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{mc.name}</div>
                    <div style={{ fontSize: 11, color: T.textFaint }}>{mc.companyName || ''} {mc.email ? `· ${mc.email}` : ''}</div>
                  </div>
                  <div style={{ fontSize: 11, color: contactSent.size === steps.length ? '#22c55e' : WAR_ACCENT, fontWeight: 600 }}>
                    {contactSent.size}/{steps.length} sent
                  </div>
                </div>
                {nextStepIdx !== null && (
                  <button
                    onClick={() => handleManualSend(mc, nextStepIdx)}
                    disabled={sendingStep === `${mc.contactId}_${nextStepIdx}` || throttleRemaining > 0}
                    style={{
                      width: '100%', padding: '8px 0', borderRadius: 7, border: 'none',
                      background: throttleRemaining > 0 ? `${T.border2}` : `${WAR_ACCENT}15`,
                      color: throttleRemaining > 0 ? T.textFaint : WAR_ACCENT, fontSize: 12, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {sendingStep === `${mc.contactId}_${nextStepIdx}`
                      ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
                      : <><Send size={12} /> Send Step {nextStepIdx + 1}</>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Phase 7: Monitor ────────────────────────────────────────────────────────
  const renderPhase7 = () => {
    const outcomeOptions = [
      { id: 'no_reply', label: 'No Reply', icon: Clock3, color: T.textFaint },
      { id: 'replied', label: 'Replied', icon: MailCheck, color: '#3b82f6' },
      { id: 'meeting_booked', label: 'Meeting Booked', icon: CheckCircle, color: '#22c55e' },
      { id: 'not_interested', label: 'Not Interested', icon: XCircle, color: '#ef4444' },
    ];
    return (
      <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: T.text, letterSpacing: '-0.02em', marginBottom: 6 }}>
            Track responses
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
            Mark how each contact responded. This helps Barry learn your patterns.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {missionContacts.map((mc) => {
            const outcome = contactOutcomes[mc.contactId] || null;
            return (
              <div key={mc.contactId} style={{ padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${T.border2}`, background: T.cardBg }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>{mc.name}</div>
                <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 10 }}>{mc.companyName || ''}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {outcomeOptions.map((o) => {
                    const active = outcome === o.id;
                    const Icon = o.icon;
                    return (
                      <button
                        key={o.id}
                        onClick={() => setContactOutcomes((prev) => ({ ...prev, [mc.contactId]: o.id }))}
                        style={{
                          padding: '5px 10px', borderRadius: 6,
                          border: `1.5px solid ${active ? o.color : T.border2}`,
                          background: active ? `${o.color}15` : 'transparent',
                          color: active ? o.color : T.textMuted,
                          fontSize: 11, fontWeight: 600, cursor: 'pointer',
                          fontFamily: 'Inter, system-ui, sans-serif',
                          display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        <Icon size={11} /> {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Phase 8: Debrief ────────────────────────────────────────────────────────
  const renderPhase8 = () => {
    const replied = Object.values(contactOutcomes).filter((o) => o === 'replied' || o === 'meeting_booked').length;
    const noReply = Object.values(contactOutcomes).filter((o) => o === 'no_reply').length;
    const notInterested = Object.values(contactOutcomes).filter((o) => o === 'not_interested').length;
    return (
      <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: T.text, letterSpacing: '-0.02em', marginBottom: 6 }}>
            Mission debrief
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: T.textFaint, lineHeight: 1.5 }}>
            Review the results and capture lessons for the next wave.
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 24 }}>
          {[
            { label: 'Replied / Booked', value: replied, color: '#22c55e' },
            { label: 'No Reply', value: noReply, color: T.textFaint },
            { label: 'Not Interested', value: notInterested, color: '#ef4444' },
          ].map((s) => (
            <div key={s.label} style={{
              padding: '14px 12px', borderRadius: 10, border: `1.5px solid ${T.border2}`, background: T.cardBg, textAlign: 'center',
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Debrief Notes</div>
        <textarea
          value={debriefNotes}
          onChange={(e) => setDebriefNotes(e.target.value)}
          placeholder="What worked? What would you change next time?"
          rows={4}
          style={{
            width: '100%', padding: 12, borderRadius: 10,
            border: `1.5px solid ${T.border2}`, background: T.cardBg,
            color: T.text, fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif',
            resize: 'vertical', boxSizing: 'border-box', marginBottom: 16,
          }}
        />

        {/* Save debrief button */}
        <button
          onClick={saveDebrief}
          disabled={debriefSaving || debriefSaved}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
            background: debriefSaved ? '#22c55e' : WAR_ACCENT,
            color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: debriefSaving || debriefSaved ? 'default' : 'pointer',
            fontFamily: 'Inter, system-ui, sans-serif',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: debriefSaving ? 0.7 : 1,
          }}
        >
          {debriefSaving
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
            : debriefSaved
              ? <><CheckCircle size={14} /> Debrief Saved</>
              : <><Swords size={14} /> Complete Mission</>}
        </button>
      </div>
    );
  };

  // ── Render active phase ─────────────────────────────────────────────────────
  const renderPhase = () => {
    if (phase === 0) return renderPhase1();       // Brief
    if (phase === 1) return renderPhaseRoster();   // Roster (tabbed: contacts / companies / decision makers)
    if (phase === 2) return renderPhaseApproach(); // Approach (strategy config)
    if (phase === 3) return renderPhaseSequence(); // Sequence (Barry generates plan)
    if (phase === 4) return renderPhaseApprove();  // Approve (per-step review)
    if (phase === 5) return renderPhase6();        // Launch
    if (phase === 6) return renderPhase7();        // Monitor
    if (phase === 7) return renderPhase8();        // Debrief
    return null;
  };

  // ─── Layout ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: T.text,
      }}
    >
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* Barry HUD — persistent top strip */}
      <BarryHUD phase={phase} totalPhases={TOTAL_PHASES} />

      {/* Resume banner — shown if active missions exist */}
      {resumeBannerVisible && activeMissions.length > 0 && (
        <div style={{
          padding: '10px 16px', background: `${WAR_ACCENT}08`,
          borderBottom: `1px solid ${WAR_ACCENT}30`,
          display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: WAR_ACCENT, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={13} /> You have {activeMissions.length} active mission{activeMissions.length !== 1 ? 's' : ''}
          </div>
          {activeMissions.map((m) => (
            <div key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              borderRadius: 8, background: T.cardBg, border: `1.5px solid ${T.border2}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{m.name || 'Unnamed Mission'}</div>
                <div style={{ fontSize: 11, color: T.textFaint }}>
                  {m.contacts?.length || 0} contact{(m.contacts?.length || 0) !== 1 ? 's' : ''} · {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}
                </div>
              </div>
              <button
                onClick={() => resumeMission(m)}
                style={{
                  padding: '5px 12px', borderRadius: 6, border: 'none',
                  background: WAR_ACCENT, color: '#fff', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                Resume
              </button>
            </div>
          ))}
          <button
            onClick={() => setResumeBannerVisible(false)}
            style={{
              fontSize: 11, color: T.textFaint, background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, alignSelf: 'flex-end',
            }}
          >
            Start new mission instead
          </button>
        </div>
      )}

      {/* Phase pills */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '10px 16px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
          overflowX: 'auto',
        }}
      >
        {PHASE_LABELS.map((label, i) => {
          const done    = i < phase;
          const active  = i === phase;
          const locked  = i > phase;
          return (
            <button
              key={i}
              onClick={() => { if (!locked) setPhase(i); }}
              disabled={locked}
              style={{
                flexShrink: 0,
                padding: '5px 11px',
                borderRadius: 20,
                border: `1.5px solid ${
                  active  ? WAR_ACCENT :
                  done    ? `${WAR_ACCENT}50` :
                  T.border2
                }`,
                background: active ? `${WAR_ACCENT}18` : 'transparent',
                color: active ? WAR_ACCENT : done ? T.textMuted : T.textFaint,
                fontSize: 11,
                fontWeight: active || done ? 600 : 400,
                cursor: locked ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: 'Inter, system-ui, sans-serif',
                transition: 'all 0.12s',
                opacity: locked ? 0.45 : 1,
              }}
            >
              {done && <Check size={10} strokeWidth={3} />}
              {!done && <span style={{ fontSize: 9, fontWeight: 700 }}>{i + 1}</span>}
              {label}
            </button>
          );
        })}
      </div>

      {/* Phase content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderPhase()}
      </div>

      {/* Navigation footer */}
      <div
        style={{
          flexShrink: 0,
          padding: '12px 24px',
          borderTop: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: T.cardBg,
        }}
      >
        {/* Back */}
        <button
          onClick={() => setPhase((p) => Math.max(0, p - 1))}
          disabled={phase === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderRadius: 9,
            border: `1.5px solid ${T.border2}`,
            background: 'transparent',
            color: phase === 0 ? T.textFaint : T.textMuted,
            fontSize: 13,
            fontWeight: 600,
            cursor: phase === 0 ? 'default' : 'pointer',
            opacity: phase === 0 ? 0.35 : 1,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          <ChevronLeft size={14} />
          Back
        </button>

        {/* Context label */}
        <div style={{ fontSize: 12, color: T.textFaint }}>
          Phase {phase + 1} of {TOTAL_PHASES} — {PHASE_LABELS[phase]}
        </div>

        {/* Next / Launch */}
        <button
          onClick={() => {
            if (phase < TOTAL_PHASES - 1) setPhase((p) => p + 1);
          }}
          disabled={!canAdvance()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 20px',
            borderRadius: 9,
            border: 'none',
            background: canAdvance() ? WAR_ACCENT : T.border2,
            color: canAdvance() ? '#fff' : T.textFaint,
            fontSize: 13,
            fontWeight: 700,
            cursor: canAdvance() ? 'pointer' : 'default',
            fontFamily: 'Inter, system-ui, sans-serif',
            boxShadow: canAdvance() ? `0 4px 14px ${WAR_ACCENT}40` : 'none',
            transition: 'all 0.15s',
          }}
        >
          {phase === TOTAL_PHASES - 1 ? (
            <>
              <Swords size={14} />
              Finish
            </>
          ) : (
            <>
              Next
              <ChevronRight size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
