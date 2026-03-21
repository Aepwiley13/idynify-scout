/**
 * InterventionPlaybook.jsx — CSM intervention playbooks with phase state management.
 *
 * Spec ref: v1.2 Section 9 — Intervention Playbooks
 *
 * Pre-built playbooks for at-risk and neutral customers. Each playbook
 * defines a multi-phase intervention cadence with channel guidance.
 *
 * Features:
 *   - Playbook selection based on health bucket + churn signal
 *   - Phase tracking (current step, completed steps)
 *   - Channel guidance per step (email, call, LinkedIn)
 *   - Barry draft generation trigger (draft-only per v1 decision)
 *   - Timeline visualization
 *
 * Props:
 *   contact       — Firestore contact document
 *   healthResult  — { score, bucket, label, color } from computeHealthScore
 *   userId        — current user ID
 *   onClose       — close handler
 *   onDraftMessage — (contact, step) → open draft composer
 */

import { useState, useMemo } from 'react';
import {
  BookOpen, ChevronRight, Check, Clock, Mail,
  Phone, Linkedin, MessageSquare, AlertTriangle,
  ArrowRight, Play, Pause, RotateCcw, X,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useT } from '../../theme/ThemeContext';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';

const GREEN = '#22c55e';
const TEAL  = '#14b8a6';

// ─── Playbook Definitions ─────────────────────────────────────────────────────
const PLAYBOOKS = [
  {
    id: 'rescue',
    name: 'Rescue Play',
    emoji: '🚨',
    color: '#dc2626',
    trigger: 'at_risk',
    description: 'Customer has gone dark or shown negative signals. Immediate, high-touch intervention to save the relationship.',
    cadence: 'Days 1, 3, 5, 10, 15',
    timeline: '2–3 weeks',
    bestFor: 'At-risk customers with no recent contact or negative sentiment',
    steps: [
      { day: 1,  channel: 'call',     title: 'Direct call — acknowledge the gap',     desc: 'No pitch. Acknowledge you\'ve been out of touch. Ask what\'s changed.' },
      { day: 1,  channel: 'email',    title: 'Follow-up email with value',            desc: 'If call didn\'t connect, send a short email with something genuinely useful.' },
      { day: 3,  channel: 'linkedin', title: 'Low-pressure LinkedIn touch',           desc: 'Engage with their content or send a brief DM. Stay visible.' },
      { day: 5,  channel: 'email',    title: 'Share a relevant insight or case study', desc: 'Position around their industry or role. Make it about them, not you.' },
      { day: 10, channel: 'call',     title: 'Second call attempt',                   desc: 'Try a different time. Leave a voicemail if needed — keep it warm.' },
      { day: 15, channel: 'email',    title: 'Decision point email',                  desc: '"I want to make sure we\'re still a fit. Would love 15 minutes to reconnect."' },
    ],
  },
  {
    id: 'reactivate',
    name: 'Reactivation',
    emoji: '🔄',
    color: '#f59e0b',
    trigger: 'neutral',
    description: 'Customer is drifting — not at risk yet, but engagement is fading. Gentle nudges to rebuild momentum.',
    cadence: 'Every 5–7 days',
    timeline: '3–4 weeks',
    bestFor: 'Neutral customers with declining engagement or missed milestones',
    steps: [
      { day: 1,  channel: 'email',    title: 'Genuine check-in',                      desc: 'Ask how things are going. No agenda. Show you care about their success.' },
      { day: 5,  channel: 'email',    title: 'Share a quick win or tip',              desc: 'Something they can use immediately. Position as "thought of you when I saw this."' },
      { day: 10, channel: 'linkedin', title: 'Engage with their activity',            desc: 'Like or comment on their posts. Build social presence.' },
      { day: 15, channel: 'call',     title: 'Casual call — ask about priorities',     desc: 'Understand what\'s taking their attention. Find alignment.' },
      { day: 20, channel: 'email',    title: 'Milestone check-in',                    desc: 'Reference their milestones. "I noticed X hasn\'t been completed — anything I can help with?"' },
      { day: 25, channel: 'email',    title: 'Success story or referral offer',       desc: 'Share how a similar customer succeeded. Offer to connect them.' },
    ],
  },
  {
    id: 'expansion',
    name: 'Expansion Play',
    emoji: '📈',
    color: '#22c55e',
    trigger: 'healthy',
    description: 'Customer is thriving — time to explore expansion, upsell, or referral opportunities.',
    cadence: 'Every 7–10 days',
    timeline: '3–4 weeks',
    bestFor: 'Healthy customers with completed milestones and strong engagement',
    steps: [
      { day: 1,  channel: 'email',    title: 'Celebrate their success',               desc: 'Acknowledge milestones hit. Make them feel valued and seen.' },
      { day: 7,  channel: 'call',     title: 'Strategic review call',                 desc: 'Discuss what\'s working and explore where else you can add value.' },
      { day: 10, channel: 'email',    title: 'Introduce expansion opportunity',       desc: 'Position naturally: "Based on what we discussed, X might be a great fit."' },
      { day: 15, channel: 'email',    title: 'Case study or ROI data',                desc: 'Show concrete results from similar expansions. Make the business case easy.' },
      { day: 20, channel: 'call',     title: 'Referral ask',                          desc: '"Is there anyone in your network who might benefit from what we do?"' },
      { day: 25, channel: 'linkedin', title: 'Public endorsement opportunity',        desc: 'Offer to feature them in a case study or testimonial.' },
    ],
  },
];

const CHANNEL_ICONS = {
  email: Mail,
  call: Phone,
  linkedin: Linkedin,
  sms: MessageSquare,
};

const CHANNEL_COLORS = {
  email: '#0ea5e9',
  call: '#22c55e',
  linkedin: '#0077b5',
  sms: '#8b5cf6',
};

// ─── InterventionPlaybook ─────────────────────────────────────────────────────
export default function InterventionPlaybook({
  contact,
  healthResult,
  userId,
  onClose,
  onDraftMessage,
}) {
  const T = useT();
  const bucket = healthResult?.bucket || 'neutral';

  // Find the best playbook for this contact's health bucket
  const suggestedPlaybook = PLAYBOOKS.find(p => p.trigger === bucket) || PLAYBOOKS[1];
  const [selectedPlaybook, setSelectedPlaybook] = useState(suggestedPlaybook.id);
  const playbook = PLAYBOOKS.find(p => p.id === selectedPlaybook) || suggestedPlaybook;

  // Phase tracking — read from contact doc, fallback to empty
  const phaseState = contact.intervention_phases?.[playbook.id] || {};
  const completedSteps = new Set(phaseState.completed_steps || []);
  const [localCompleted, setLocalCompleted] = useState(completedSteps);
  const [saving, setSaving] = useState(false);

  async function toggleStep(stepIndex) {
    const next = new Set(localCompleted);
    if (next.has(stepIndex)) next.delete(stepIndex);
    else next.add(stepIndex);
    setLocalCompleted(next);

    // Persist to Firestore
    setSaving(true);
    try {
      const ref = doc(db, 'users', userId, 'contacts', contact.id);
      await updateDoc(ref, {
        [`intervention_phases.${playbook.id}.completed_steps`]: [...next],
        [`intervention_phases.${playbook.id}.updated_at`]: new Date().toISOString(),
        [`intervention_phases.${playbook.id}.playbook_name`]: playbook.name,
      });

      // Log if step just completed
      if (next.has(stepIndex) && !completedSteps.has(stepIndex)) {
        await logTimelineEvent({
          userId,
          contactId: contact.id,
          type: 'next_step_completed',
          actor: ACTORS.user,
          preview: `Playbook step: ${playbook.steps[stepIndex].title}`,
          metadata: {
            playbook_id: playbook.id,
            step_index: stepIndex,
            step_title: playbook.steps[stepIndex].title,
            channel: playbook.steps[stepIndex].channel,
          },
        });
      }
    } catch (err) {
      console.error('[InterventionPlaybook] save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  const progress = playbook.steps.length > 0
    ? Math.round((localCompleted.size / playbook.steps.length) * 100)
    : 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 560,
        background: T.cardBg, borderRadius: 16,
        border: `1px solid ${T.border}`,
        boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BookOpen size={18} color={playbook.color} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>
                Intervention Playbook
              </div>
              <div style={{ fontSize: 11, color: T.textFaint }}>
                {contact.name} — {healthResult?.label || 'Unknown'} ({healthResult?.score || 0}/100)
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={18} color={T.textFaint} />
          </button>
        </div>

        {/* Playbook selector */}
        <div style={{ padding: '12px 20px 0', display: 'flex', gap: 6 }}>
          {PLAYBOOKS.map(p => {
            const active = selectedPlaybook === p.id;
            return (
              <button
                key={p.id}
                onClick={() => { setSelectedPlaybook(p.id); setLocalCompleted(new Set(contact.intervention_phases?.[p.id]?.completed_steps || [])); }}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: active ? 600 : 400,
                  background: active ? `${p.color}15` : 'transparent',
                  border: `1px solid ${active ? p.color : T.border}`,
                  color: active ? p.color : T.textMuted,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <span>{p.emoji}</span>
                {p.name}
              </button>
            );
          })}
        </div>

        {/* Playbook info */}
        <div style={{ padding: '12px 20px' }}>
          <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5, marginBottom: 8 }}>
            {playbook.description}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: T.textFaint }}>
            <span><Clock size={10} style={{ marginRight: 3 }} />{playbook.cadence}</span>
            <span>{playbook.timeline}</span>
          </div>
          {/* Progress bar */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 10, color: T.textFaint }}>Progress</span>
              <span style={{ fontSize: 10, color: T.textFaint }}>{localCompleted.size}/{playbook.steps.length}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: T.border }}>
              <div style={{ height: '100%', borderRadius: 2, width: `${progress}%`, background: playbook.color, transition: 'width 0.3s' }} />
            </div>
          </div>
        </div>

        {/* Steps timeline */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
          {playbook.steps.map((step, i) => {
            const done = localCompleted.has(i);
            const ChannelIcon = CHANNEL_ICONS[step.channel] || Mail;
            const channelColor = CHANNEL_COLORS[step.channel] || T.textFaint;

            return (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 2 }}>
                {/* Timeline line */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 24, flexShrink: 0 }}>
                  <div
                    onClick={() => toggleStep(i)}
                    style={{
                      width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
                      background: done ? playbook.color : 'transparent',
                      border: `2px solid ${done ? playbook.color : T.border2}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, transition: 'all 0.15s',
                    }}
                  >
                    {done && <Check size={10} color="#fff" strokeWidth={3} />}
                  </div>
                  {i < playbook.steps.length - 1 && (
                    <div style={{ width: 1, flex: 1, minHeight: 20, background: done ? playbook.color : T.border }} />
                  )}
                </div>

                {/* Step content */}
                <div style={{
                  flex: 1, padding: '0 0 14px',
                  opacity: done ? 0.6 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: T.textFaint }}>DAY {step.day}</span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
                      background: `${channelColor}15`, color: channelColor,
                      border: `1px solid ${channelColor}25`,
                    }}>
                      <ChannelIcon size={8} />
                      {step.channel}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>
                    {step.title}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.4 }}>
                    {step.desc}
                  </div>
                  {!done && onDraftMessage && (
                    <button
                      onClick={e => { e.stopPropagation(); onDraftMessage(contact, step); }}
                      style={{
                        marginTop: 6, padding: '3px 10px', borderRadius: 6,
                        fontSize: 10, fontWeight: 600,
                        background: `${playbook.color}12`, border: `1px solid ${playbook.color}30`,
                        color: playbook.color, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <ArrowRight size={9} />
                      Draft with Barry
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 20px', borderTop: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: T.textFaint }}>
            {saving ? 'Saving...' : `Best for: ${playbook.bestFor}`}
          </span>
          <button
            onClick={() => { setLocalCompleted(new Set()); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '5px 10px', borderRadius: 6, fontSize: 11,
              background: 'none', border: `1px solid ${T.border}`,
              color: T.textFaint, cursor: 'pointer',
            }}
          >
            <RotateCcw size={10} />
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export { PLAYBOOKS };
