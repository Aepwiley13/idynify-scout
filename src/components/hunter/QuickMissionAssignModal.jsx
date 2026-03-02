/**
 * QuickMissionAssignModal — Sprint 1.2
 *
 * Lightweight mission picker shown when user taps the Mission icon on a contact
 * card in the Hunter deck. Deliberately minimal — no Barry context load, no
 * intent input, no weapon selection. Just pick a mission and assign.
 *
 * On assign:
 *   1. Writes contact entry to mission document immediately
 *   2. Fires Barry step personalization in background (non-blocking)
 *   3. Closes modal — user approves personalized steps in mission/:id
 *
 * For batch-assigning 20+ contacts in one session without losing deck flow.
 */

import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore';
import { X, Plus, Crosshair, CheckCircle, Loader2 } from 'lucide-react';
import { db, auth } from '../../firebase/config';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS, getContactStatus } from '../../utils/contactStateMachine';
import './QuickMissionAssignModal.css';

export default function QuickMissionAssignModal({ contact, onClose, onNavigateCreate }) {
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(null); // missionId being assigned
  const [assigned, setAssigned] = useState(null);   // missionId just assigned

  const firstName = contact?.firstName || contact?.first_name || 'this contact';

  useEffect(() => {
    loadMissions();
  }, []);

  async function loadMissions() {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const snap = await getDocs(collection(db, 'users', user.uid, 'missions'));
      const list = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m.status === 'autopilot' || m.status === 'draft');
      setMissions(list);
    } catch (err) {
      console.error('[QuickMissionAssignModal] load missions error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAssign(mission) {
    if (assigning) return;
    setAssigning(mission.id);

    try {
      const user = auth.currentUser;
      if (!user) return;

      const newEntry = {
        contactId: contact.id,
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || '',
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        email: contact.email || null,
        phone: contact.phone || null,
        currentStepIndex: 0,
        lastTouchDate: null,
        status: 'active',
        outcomes: [],
        sequenceStatus: 'pending',
        stepHistory: [],
        lastOutcome: null,
        personalizationStatus: 'generating',
        personalizedSteps: null,
      };

      const missionRef = doc(db, 'users', user.uid, 'missions', mission.id);
      const missionSnap = await getDoc(missionRef);
      const current = missionSnap.exists() ? missionSnap.data() : {};
      const updatedContacts = [...(current.contacts || []), newEntry];

      await updateDoc(missionRef, {
        contacts: updatedContacts,
        updatedAt: new Date().toISOString(),
      });

      logTimelineEvent({
        userId: user.uid,
        contactId: contact.id,
        type: 'mission_assigned',
        actor: ACTORS.USER,
        preview: mission.name || 'Mission',
        metadata: { missionId: mission.id, missionName: mission.name || null, source: 'quick_assign' },
      });

      updateContactStatus({
        userId: user.uid,
        contactId: contact.id,
        trigger: STATUS_TRIGGERS.MISSION_ASSIGNED,
        currentStatus: getContactStatus(contact),
      });

      // Fire Barry personalization in background (non-blocking)
      _triggerPersonalizationBackground(user, mission, updatedContacts);

      setAssigned(mission.id);

      // Auto-close after brief success flash
      setTimeout(() => onClose(mission.id), 1400);
    } catch (err) {
      console.error('[QuickMissionAssignModal] assign error:', err);
      setAssigning(null);
    }
  }

  async function _triggerPersonalizationBackground(user, mission, updatedContacts) {
    try {
      const stepsToGenerate = _getSteps(mission);
      if (!stepsToGenerate.length) return;

      const token = await user.getIdToken();
      const missionFields = {
        outcome_goal: mission.outcome_goal || null,
        engagement_style: mission.engagement_style || null,
        timeframe: mission.timeframe || null,
        next_step_type: mission.next_step_type || null,
      };
      const contactData = {
        name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.name || '',
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        title: contact.title || contact.current_position_title || null,
        company_name: contact.company_name || contact.current_company_name || null,
        engagementIntent: contact.engagementIntent || 'prospect',
        relationship_type: contact.relationship_type || null,
        warmth_level: contact.warmth_level || null,
        strategic_value: contact.strategic_value || null,
      };

      const generatedSteps = [];
      for (let i = 0; i < stepsToGenerate.length; i++) {
        try {
          const res = await fetch('/.netlify/functions/barryGenerateSequenceStep', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.uid,
              authToken: token,
              contact: contactData,
              missionFields,
              stepPlan: stepsToGenerate[i],
              stepIndex: i,
              stepHistory: [],
              previousOutcome: null,
            }),
          });
          const data = await res.json();
          if (data.success && data.generatedContent) {
            generatedSteps.push({
              stepIndex: i,
              stepNumber: stepsToGenerate[i].stepNumber,
              channel: data.generatedContent.channel || stepsToGenerate[i].channel,
              subject: data.generatedContent.subject || null,
              body: data.generatedContent.body,
              toneNote: data.generatedContent.toneNote || null,
              status: 'pending_approval',
              generatedAt: data.generatedContent.generatedAt || new Date().toISOString(),
            });
          }
        } catch (_) { /* non-fatal */ }
      }

      // Write personalized steps back
      const missionRef = doc(db, 'users', user.uid, 'missions', mission.id);
      const missionSnap = await getDoc(missionRef);
      if (!missionSnap.exists()) return;
      const mData = missionSnap.data();
      const refreshed = (mData.contacts || []).map(c =>
        c.contactId === contact.id
          ? {
              ...c,
              personalizationStatus: generatedSteps.length > 0 ? 'pending_approval' : 'failed',
              personalizedSteps: generatedSteps.length > 0 ? generatedSteps : null,
            }
          : c
      );
      await updateDoc(missionRef, { contacts: refreshed, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.warn('[QuickMissionAssignModal] background personalization error:', err);
    }
  }

  function _getSteps(mission) {
    if (mission.sequence?.steps?.length) {
      return mission.sequence.steps.map((s, i) => ({
        stepNumber: s.stepNumber || i + 1,
        channel: s.channel,
        stepType: s.stepType || 'message',
        action: s.action,
        purpose: s.purpose,
      }));
    }
    return (mission.steps || [])
      .filter(s => s.enabled !== false)
      .map((s, i) => ({
        stepNumber: i + 1,
        channel: s.weapon,
        stepType: s.type || 'message',
        action: s.label,
        purpose: s.description,
      }));
  }

  function stepCount(mission) {
    return mission.sequence?.steps?.length ||
      mission.microSequence?.steps?.length ||
      mission.steps?.filter(s => s.enabled !== false).length || 0;
  }

  return (
    <div className="qma-overlay" onClick={onClose}>
      <div className="qma-sheet" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="qma-header">
          <div className="qma-header-left">
            <Crosshair className="w-4 h-4 text-purple-400" />
            <span className="qma-title">Add to Mission</span>
          </div>
          <button className="qma-close" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="qma-contact-label">{firstName}</p>

        {/* Mission list */}
        <div className="qma-list">
          {loading ? (
            <div className="qma-loading">
              <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            </div>
          ) : missions.length === 0 ? (
            <p className="qma-empty">No active missions. Create one first.</p>
          ) : (
            missions.map(mission => {
              const isAssigning = assigning === mission.id;
              const isAssigned  = assigned  === mission.id;
              return (
                <button
                  key={mission.id}
                  className={`qma-mission-row ${isAssigning || isAssigned ? 'qma-mission-row--active' : ''}`}
                  onClick={() => handleAssign(mission)}
                  disabled={!!assigning || !!assigned}
                >
                  <div className="qma-mission-info">
                    <span className="qma-mission-name">{mission.name}</span>
                    <span className="qma-mission-meta">
                      {mission.contacts?.length || 0} contacts · {stepCount(mission)} steps
                    </span>
                  </div>
                  {isAssigning && <Loader2 className="w-4 h-4 animate-spin text-purple-400" />}
                  {isAssigned  && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                </button>
              );
            })
          )}
        </div>

        {/* Create new */}
        <button
          className="qma-create-new"
          onClick={() => onNavigateCreate(contact.id)}
        >
          <Plus className="w-4 h-4" />
          Create new mission with {firstName}
        </button>

        {assigned && (
          <p className="qma-success-hint">
            Added! Barry is personalizing steps in the background. Review them in the mission.
          </p>
        )}
      </div>
    </div>
  );
}
