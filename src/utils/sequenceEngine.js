/**
 * SEQUENCE ENGINE (Step 5)
 *
 * Core logic for approval-based engagement sequencing.
 * Manages sequence progression, outcome tracking, and state transitions
 * for contacts within missions.
 *
 * Architecture:
 *   - One sequence plan per mission (structure comes from mission fields)
 *   - Per-contact progression (each contact moves independently)
 *   - Content generated just-in-time when user approves a step
 *   - Barry adapts each step based on previous step outcome
 *   - Nothing advances without explicit user approval
 *
 * Storage:
 *   Mission document: mission.sequence (the plan)
 *   Contact within mission: mission.contacts[].sequenceState (per-contact progress)
 *
 * Sequence Plan Structure (stored on mission):
 *   {
 *     steps: [{ stepNumber, stepType, suggestedTiming, reasoning, channel }],
 *     rationale: string,
 *     generatedAt: string,
 *     totalSteps: number
 *   }
 *
 * Per-Contact Sequence State (stored on mission.contacts[]):
 *   {
 *     currentStepIndex: number,       // Which step we're on (0-based)
 *     status: 'pending' | 'active' | 'awaiting_outcome' | 'completed',
 *     stepHistory: [{
 *       stepIndex: number,
 *       action: 'approved' | 'sent' | 'skipped',
 *       outcome: 'no_reply' | 'replied_positive' | 'replied_negative' | 'not_sure' | null,
 *       generatedContent: { subject, body, channel } | null,
 *       approvedAt: string | null,
 *       sentAt: string | null,
 *       outcomeRecordedAt: string | null
 *     }]
 *   }
 */

import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { logTimelineEvent, ACTORS } from './timelineLogger';
import { updateContactStatus, STATUS_TRIGGERS } from './contactStateMachine';

// ── Step Types ──────────────────────────────────────────

export const SEQUENCE_STEP_TYPES = {
  MESSAGE: 'message',
  FOLLOW_UP: 'follow_up',
  CALL: 'call',
  RESOURCE: 'resource',
  INTRODUCTION: 'introduction'
};

// ── Outcome Options ─────────────────────────────────────

export const STEP_OUTCOMES = {
  NO_REPLY: 'no_reply',
  REPLIED_POSITIVE: 'replied_positive',
  REPLIED_NEGATIVE: 'replied_negative',
  NOT_SURE: 'not_sure'
};

export const STEP_OUTCOME_LABELS = {
  [STEP_OUTCOMES.NO_REPLY]: 'No reply yet',
  [STEP_OUTCOMES.REPLIED_POSITIVE]: 'Replied positively',
  [STEP_OUTCOMES.REPLIED_NEGATIVE]: 'Replied negatively',
  [STEP_OUTCOMES.NOT_SURE]: 'Not sure yet'
};

// ── Contact Sequence Status ─────────────────────────────

export const SEQUENCE_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  AWAITING_OUTCOME: 'awaiting_outcome',
  COMPLETED: 'completed'
};

// ── Read Helpers ────────────────────────────────────────

/**
 * Get the sequence plan from a mission document.
 */
export function getSequencePlan(mission) {
  return mission?.sequence || null;
}

/**
 * Get a contact's sequence state within a mission.
 */
export function getContactSequenceState(mission, contactId) {
  const contact = mission?.contacts?.find(c => c.contactId === contactId);
  if (!contact) return null;

  return {
    currentStepIndex: contact.currentStepIndex ?? 0,
    status: contact.sequenceStatus ?? SEQUENCE_STATUS.PENDING,
    stepHistory: contact.stepHistory ?? [],
    lastOutcome: contact.lastOutcome ?? null
  };
}

/**
 * Determine what action is needed for a contact in a sequence.
 * Returns the "next move" Barry should present.
 */
export function resolveNextAction(mission, contactId) {
  const plan = getSequencePlan(mission);
  if (!plan || !plan.steps || plan.steps.length === 0) {
    return { action: 'no_sequence', reason: 'No sequence plan exists for this mission' };
  }

  const state = getContactSequenceState(mission, contactId);
  if (!state) {
    return { action: 'not_in_mission', reason: 'Contact is not in this mission' };
  }

  const { currentStepIndex, status, stepHistory } = state;

  // Sequence already completed
  if (status === SEQUENCE_STATUS.COMPLETED) {
    return { action: 'completed', reason: 'Sequence is complete' };
  }

  // All steps done
  if (currentStepIndex >= plan.steps.length) {
    return { action: 'completed', reason: 'All steps executed' };
  }

  const currentStep = plan.steps[currentStepIndex];
  const lastHistoryEntry = stepHistory.length > 0 ? stepHistory[stepHistory.length - 1] : null;

  // If the previous step was sent but no outcome recorded yet → ask for outcome
  if (lastHistoryEntry && lastHistoryEntry.action === 'sent' && !lastHistoryEntry.outcome) {
    return {
      action: 'needs_outcome',
      reason: 'Previous step was sent — Barry needs to know what happened',
      previousStep: plan.steps[lastHistoryEntry.stepIndex],
      previousStepIndex: lastHistoryEntry.stepIndex,
      stepHistory
    };
  }

  // Ready to propose the next step
  return {
    action: 'propose_step',
    reason: 'Ready to propose next step',
    step: currentStep,
    stepIndex: currentStepIndex,
    totalSteps: plan.steps.length,
    previousOutcome: lastHistoryEntry?.outcome ?? null,
    stepHistory
  };
}

// ── Write Operations ────────────────────────────────────

/**
 * Record that a step was proposed to the user.
 * Logs timeline event. Does not modify mission document.
 */
export async function recordStepProposed({ userId, contactId, missionId, stepIndex, step }) {
  logTimelineEvent({
    userId,
    contactId,
    type: 'sequence_step_proposed',
    actor: ACTORS.BARRY,
    preview: `Step ${stepIndex + 1}: ${step.stepType || step.action || 'Next step'}`,
    metadata: {
      missionId,
      stepIndex,
      stepType: step.stepType,
      channel: step.channel,
      suggestedTiming: step.suggestedTiming
    }
  });
}

/**
 * Record that a user approved a step (with generated content).
 * Updates mission document and logs timeline event.
 */
export async function recordStepApproved({ userId, contactId, missionId, stepIndex, generatedContent }) {
  try {
    const missionRef = doc(db, 'users', userId, 'missions', missionId);
    const missionSnap = await getDoc(missionRef);
    if (!missionSnap.exists()) return null;

    const mission = missionSnap.data();
    const contacts = [...(mission.contacts || [])];
    const contactIdx = contacts.findIndex(c => c.contactId === contactId);
    if (contactIdx === -1) return null;

    const contact = { ...contacts[contactIdx] };
    const history = [...(contact.stepHistory || [])];

    history.push({
      stepIndex,
      action: 'approved',
      outcome: null,
      generatedContent: generatedContent || null,
      approvedAt: new Date().toISOString(),
      sentAt: null,
      outcomeRecordedAt: null
    });

    contact.stepHistory = history;
    contact.sequenceStatus = SEQUENCE_STATUS.ACTIVE;
    contacts[contactIdx] = contact;

    await updateDoc(missionRef, {
      contacts,
      updatedAt: new Date().toISOString()
    });

    logTimelineEvent({
      userId,
      contactId,
      type: 'sequence_step_approved',
      actor: ACTORS.USER,
      preview: `Approved Step ${stepIndex + 1}`,
      metadata: {
        missionId,
        stepIndex,
        channel: generatedContent?.channel || null
      }
    });

    return contact;
  } catch (error) {
    console.error('[SequenceEngine] Failed to record step approved:', error);
    return null;
  }
}

/**
 * Record that an approved step was sent/executed.
 * Updates mission document, logs timeline event, triggers state machine.
 */
export async function recordStepSent({ userId, contactId, missionId, stepIndex }) {
  try {
    const missionRef = doc(db, 'users', userId, 'missions', missionId);
    const missionSnap = await getDoc(missionRef);
    if (!missionSnap.exists()) return null;

    const mission = missionSnap.data();
    const contacts = [...(mission.contacts || [])];
    const contactIdx = contacts.findIndex(c => c.contactId === contactId);
    if (contactIdx === -1) return null;

    const contact = { ...contacts[contactIdx] };
    const history = [...(contact.stepHistory || [])];

    // Find the approved entry for this step and mark it as sent
    const entryIdx = history.findIndex(h => h.stepIndex === stepIndex && h.action === 'approved');
    if (entryIdx !== -1) {
      history[entryIdx] = {
        ...history[entryIdx],
        action: 'sent',
        sentAt: new Date().toISOString()
      };
    }

    contact.stepHistory = history;
    contact.sequenceStatus = SEQUENCE_STATUS.AWAITING_OUTCOME;
    contact.lastTouchDate = new Date().toISOString();
    contacts[contactIdx] = contact;

    await updateDoc(missionRef, {
      contacts,
      updatedAt: new Date().toISOString()
    });

    // Timeline event
    logTimelineEvent({
      userId,
      contactId,
      type: 'sequence_step_sent',
      actor: ACTORS.USER,
      preview: `Sent Step ${stepIndex + 1}`,
      metadata: {
        missionId,
        stepIndex
      }
    });

    // State machine: Message sent → Awaiting Reply
    updateContactStatus({
      userId,
      contactId,
      trigger: STATUS_TRIGGERS.MESSAGE_SENT
    });

    return contact;
  } catch (error) {
    console.error('[SequenceEngine] Failed to record step sent:', error);
    return null;
  }
}

/**
 * Record that a user skipped a step.
 * Advances to next step without sending.
 */
export async function recordStepSkipped({ userId, contactId, missionId, stepIndex }) {
  try {
    const missionRef = doc(db, 'users', userId, 'missions', missionId);
    const missionSnap = await getDoc(missionRef);
    if (!missionSnap.exists()) return null;

    const mission = missionSnap.data();
    const plan = getSequencePlan(mission);
    const contacts = [...(mission.contacts || [])];
    const contactIdx = contacts.findIndex(c => c.contactId === contactId);
    if (contactIdx === -1) return null;

    const contact = { ...contacts[contactIdx] };
    const history = [...(contact.stepHistory || [])];

    history.push({
      stepIndex,
      action: 'skipped',
      outcome: null,
      generatedContent: null,
      approvedAt: null,
      sentAt: null,
      outcomeRecordedAt: null
    });

    const nextIndex = stepIndex + 1;
    const isComplete = nextIndex >= (plan?.steps?.length || 0);

    contact.stepHistory = history;
    contact.currentStepIndex = nextIndex;
    contact.sequenceStatus = isComplete ? SEQUENCE_STATUS.COMPLETED : SEQUENCE_STATUS.ACTIVE;
    contacts[contactIdx] = contact;

    await updateDoc(missionRef, {
      contacts,
      updatedAt: new Date().toISOString()
    });

    logTimelineEvent({
      userId,
      contactId,
      type: 'sequence_step_skipped',
      actor: ACTORS.USER,
      preview: `Skipped Step ${stepIndex + 1}`,
      metadata: {
        missionId,
        stepIndex
      }
    });

    if (isComplete) {
      await completeSequence({ userId, contactId, missionId });
    }

    return contact;
  } catch (error) {
    console.error('[SequenceEngine] Failed to record step skipped:', error);
    return null;
  }
}

/**
 * Record an outcome for the most recent sent step.
 * Advances currentStepIndex so the next step can be proposed.
 * Triggers state machine updates based on outcome.
 */
export async function recordStepOutcome({ userId, contactId, missionId, stepIndex, outcome }) {
  try {
    const missionRef = doc(db, 'users', userId, 'missions', missionId);
    const missionSnap = await getDoc(missionRef);
    if (!missionSnap.exists()) return null;

    const mission = missionSnap.data();
    const plan = getSequencePlan(mission);
    const contacts = [...(mission.contacts || [])];
    const contactIdx = contacts.findIndex(c => c.contactId === contactId);
    if (contactIdx === -1) return null;

    const contact = { ...contacts[contactIdx] };
    const history = [...(contact.stepHistory || [])];

    // Find the sent entry for this step and record outcome
    const entryIdx = history.findIndex(h => h.stepIndex === stepIndex && h.action === 'sent');
    if (entryIdx !== -1) {
      history[entryIdx] = {
        ...history[entryIdx],
        outcome,
        outcomeRecordedAt: new Date().toISOString()
      };
    }

    const nextIndex = stepIndex + 1;
    const isComplete = nextIndex >= (plan?.steps?.length || 0);

    contact.stepHistory = history;
    contact.lastOutcome = outcome;
    contact.currentStepIndex = nextIndex;
    contact.sequenceStatus = isComplete ? SEQUENCE_STATUS.COMPLETED : SEQUENCE_STATUS.ACTIVE;
    contacts[contactIdx] = contact;

    await updateDoc(missionRef, {
      contacts,
      updatedAt: new Date().toISOString()
    });

    // State machine transitions based on outcome
    if (outcome === STEP_OUTCOMES.REPLIED_POSITIVE) {
      updateContactStatus({
        userId,
        contactId,
        trigger: STATUS_TRIGGERS.POSITIVE_REPLY
      });
    }

    if (isComplete) {
      await completeSequence({ userId, contactId, missionId });
    }

    return contact;
  } catch (error) {
    console.error('[SequenceEngine] Failed to record step outcome:', error);
    return null;
  }
}

/**
 * Mark the sequence as completed for a contact.
 * Logs timeline event and triggers state machine.
 */
async function completeSequence({ userId, contactId, missionId }) {
  logTimelineEvent({
    userId,
    contactId,
    type: 'sequence_completed',
    actor: ACTORS.SYSTEM,
    preview: 'Engagement sequence completed',
    metadata: { missionId }
  });

  updateContactStatus({
    userId,
    contactId,
    trigger: STATUS_TRIGGERS.SEQUENCE_COMPLETE
  });
}

/**
 * Build the full context stack that Barry needs to generate or adapt a sequence step.
 * This is the "Barry's Full Input Stack for Sequencing" from the spec.
 */
export function buildBarryContextStack({ contact, mission, stepHistory, previousOutcome }) {
  return {
    // Contact layer
    relationship_type: contact.relationship_type || null,
    engagementIntent: contact.engagementIntent || null,
    warmth_level: contact.warmth_level || null,
    strategic_value: contact.strategic_value || null,
    contact_name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
    contact_title: contact.title || contact.current_position_title || null,
    contact_company: contact.company_name || contact.current_company_name || null,

    // Mission layer
    outcome_goal: mission.outcome_goal || null,
    engagement_style: mission.engagement_style || null,
    timeframe: mission.timeframe || null,
    next_step_type: mission.next_step_type || null,

    // Campaign layer (if mission has campaign context)
    objective_type: mission.objective_type || null,
    time_horizon: mission.time_horizon || null,
    strategic_priority: mission.strategic_priority || null,

    // History layer
    stepHistory: stepHistory || [],
    previousOutcome: previousOutcome || null,

    // Barry context (pre-generated intelligence)
    barryContext: contact.barryContext || null
  };
}
