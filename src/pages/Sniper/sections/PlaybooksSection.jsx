/**
 * PlaybooksSection.jsx — Conversion playbooks for SNIPER.
 *
 * Pre-built nurture sequences for different post-demo scenarios.
 * Each playbook defines a cadence, channels, and message guidance
 * to help reps know exactly how to convert a warm prospect.
 */
import { useState } from 'react';
import {
  BookOpen, Zap, Calendar, Clock, ChevronRight,
  CheckCircle, Mail, Phone, MessageSquare, Link,
  ArrowRight, Target, Trophy, RefreshCw
} from 'lucide-react';
import { useT } from '../../../theme/ThemeContext';
import { BRAND } from '../../../theme/tokens';

const SNIPER_TEAL = '#14b8a6';

const PLAYBOOKS = [
  {
    id: 'hot_close',
    name: 'Hot Close',
    emoji: '🔥',
    color: '#ef4444',
    description: 'They said yes — just need to sign. Move fast with urgency and clear next steps.',
    cadence: 'Every 2–3 days',
    timeline: '1–2 weeks',
    bestFor: 'Contacts who expressed strong intent or said they\'re ready to move forward',
    steps: [
      { day: 1,   channel: 'email',    title: 'Send the proposal / agreement',           desc: 'Clear pricing, scope, next step. Make it easy to say yes.' },
      { day: 2,   channel: 'linkedin', title: 'Congratulatory message',                  desc: 'Reinforce excitement. "Excited to get this started with you."' },
      { day: 4,   channel: 'call',     title: 'Check-in call',                           desc: 'Any questions on the proposal? Remove objections now.' },
      { day: 6,   channel: 'email',    title: 'Follow up with social proof',             desc: 'Share a relevant customer story or quick win.' },
      { day: 9,   channel: 'email',    title: 'Gentle urgency — soft deadline',          desc: '"We\'re booking clients for next month — want to lock in your spot?"' },
      { day: 12,  channel: 'call',     title: 'Final close call',                        desc: 'Address any remaining blockers. Offer to simplify terms if needed.' },
    ]
  },
  {
    id: 'long_nurture',
    name: 'Long Nurture',
    emoji: '⏳',
    color: '#3b82f6',
    description: 'Great fit but not ready yet. Stay top of mind every 2 weeks — forever if needed.',
    cadence: 'Every 2 weeks',
    timeline: 'Ongoing (3–12 months)',
    bestFor: 'Contacts who are interested but have timing, budget, or priority blockers',
    steps: [
      { day: 1,   channel: 'email',    title: 'Value drop #1 — a relevant insight',      desc: 'Send something genuinely useful related to their pain point.' },
      { day: 14,  channel: 'linkedin', title: 'Engage with their content',               desc: 'Like or comment on a recent post. Stay on their radar.' },
      { day: 28,  channel: 'email',    title: 'Check-in — any shifts in priority?',      desc: '"Thinking of you — any updates on the timing side?"' },
      { day: 42,  channel: 'email',    title: 'Value drop #2 — case study or result',    desc: 'Share a result from a similar company. Make it feel relevant.' },
      { day: 56,  channel: 'call',     title: 'Casual check-in call',                    desc: 'No pitch. Just relationship building. Ask what\'s changed.' },
      { day: 70,  channel: 'email',    title: 'Value drop #3 — industry insight',        desc: 'Position yourself as a trusted resource, not just a vendor.' },
      { day: 84,  channel: 'linkedin', title: 'Re-share relevant content or milestone',  desc: 'Tag them or mention something that connects to their world.' },
    ]
  },
  {
    id: 're_engagement',
    name: 'Re-Engagement',
    emoji: '🔄',
    color: '#8b5cf6',
    description: 'They went cold after the demo. Bring them back to the conversation with fresh angles.',
    cadence: 'Every 5–7 days (burst)',
    timeline: '3–4 weeks',
    bestFor: 'Contacts who stopped responding after a strong initial demo',
    steps: [
      { day: 1,   channel: 'email',    title: 'The "just checking in" re-open',          desc: '"I know timing wasn\'t perfect — has anything changed on your end?"' },
      { day: 5,   channel: 'linkedin', title: 'Engage on their recent activity',         desc: 'Comment genuinely on something they shared. Warm the channel.' },
      { day: 8,   channel: 'email',    title: 'New angle — different pain point',        desc: 'Approach from a new angle. Maybe address a secondary problem.' },
      { day: 13,  channel: 'call',     title: 'Short voicemail or call attempt',         desc: '"I\'ll keep this brief — I have an idea that might be relevant."' },
      { day: 18,  channel: 'email',    title: 'Social proof + outcome',                  desc: 'Share a result from a customer they might know or relate to.' },
      { day: 24,  channel: 'email',    title: 'The breakup email',                       desc: '"I don\'t want to keep reaching out if the timing isn\'t right — should I close your file?"' },
    ]
  },
  {
    id: 'proposal_follow',
    name: 'Proposal Follow-Through',
    emoji: '📋',
    color: SNIPER_TEAL,
    description: 'Proposal is out — keep momentum while they\'re reviewing. Address concerns proactively.',
    cadence: 'Every 3–5 days',
    timeline: '2–3 weeks',
    bestFor: 'Contacts who have received a proposal and are in internal review / decision phase',
    steps: [
      { day: 1,   channel: 'email',    title: 'Proposal sent confirmation',              desc: 'Summarize key value props. Offer to walk through it together.' },
      { day: 3,   channel: 'email',    title: 'Quick explainer on ROI',                  desc: 'Make the numbers easy to justify internally.' },
      { day: 5,   channel: 'call',     title: 'Any questions call',                      desc: '"Just making sure everything is clear before you present it internally."' },
      { day: 8,   channel: 'email',    title: 'Address the most common objection',       desc: 'Price, timeline, risk — pick the most likely one and address it.' },
      { day: 12,  channel: 'linkedin', title: 'Share relevant success story',            desc: 'Reinforce credibility while they\'re still deciding.' },
      { day: 16,  channel: 'call',     title: 'Decision timeline check',                 desc: '"When do you expect to have a decision? How can I help move things forward?"' },
    ]
  },
];

const CHANNEL_CONFIG = {
  email:    { label: 'Email',    color: '#3b82f6', Icon: Mail },
  call:     { label: 'Call',     color: '#10b981', Icon: Phone },
  linkedin: { label: 'LinkedIn', color: '#0077b5', Icon: MessageSquare },
  other:    { label: 'Other',    color: SNIPER_TEAL, Icon: Link },
};

function PlaybookCard({ playbook, isOpen, onToggle }) {
  const T = useT();

  return (
    <div style={{
      background: T.cardBg,
      border: `1px solid ${isOpen ? playbook.color + '40' : T.border2}`,
      borderRadius: 12, marginBottom: 10,
      transition: 'all 0.15s',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', cursor: 'pointer',
        }}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: `${playbook.color}15`, border: `1px solid ${playbook.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>
          {playbook.emoji}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
            {playbook.name}
          </div>
          <div style={{ fontSize: 10, color: T.textFaint, marginTop: 1 }}>
            {playbook.cadence} · {playbook.timeline}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            padding: '3px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
            background: `${playbook.color}15`, color: playbook.color,
          }}>
            {playbook.steps.length} steps
          </span>
          <ChevronRight
            size={14} color={T.textFaint}
            style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
          />
        </div>
      </div>

      {/* Expanded content */}
      {isOpen && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
          <div style={{
            padding: '9px 12px', borderRadius: 8, marginBottom: 14,
            background: `${playbook.color}0d`, border: `1px solid ${playbook.color}20`,
            fontSize: 12, color: T.textMuted, lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: playbook.color, marginBottom: 4, letterSpacing: 0.5 }}>
              BEST FOR
            </div>
            {playbook.bestFor}
          </div>

          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: 1, marginBottom: 10 }}>
            SEQUENCE STEPS
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {playbook.steps.map((step, i) => {
              const ch = CHANNEL_CONFIG[step.channel] || CHANNEL_CONFIG.other;
              const ChIcon = ch.Icon;
              return (
                <div key={i} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '10px 12px', borderRadius: 8,
                  background: T.surface, border: `1px solid ${T.border2}`,
                }}>
                  {/* Step number */}
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: `${playbook.color}18`, border: `1.5px solid ${playbook.color}40`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700, color: playbook.color, marginTop: 1,
                  }}>
                    {i + 1}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>
                        {step.title}
                      </span>
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: 3,
                        padding: '1px 7px', borderRadius: 10, fontSize: 9, fontWeight: 600,
                        background: `${ch.color}15`, color: ch.color,
                      }}>
                        <ChIcon size={8} />
                        {ch.label}
                      </span>
                      <span style={{ fontSize: 9, color: T.textFaint, marginLeft: 'auto' }}>
                        Day {step.day}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.4 }}>
                      {step.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlaybooksSection() {
  const T = useT();
  const [openId, setOpenId] = useState(null);

  return (
    <div style={{ padding: '20px 22px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Playbooks</div>
      <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 20 }}>
        Proven conversion sequences for every post-demo scenario
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {PLAYBOOKS.map(pb => (
          <PlaybookCard
            key={pb.id}
            playbook={pb}
            isOpen={openId === pb.id}
            onToggle={() => setOpenId(openId === pb.id ? null : pb.id)}
          />
        ))}

        <div style={{
          marginTop: 16, padding: '14px 16px', borderRadius: 10,
          background: `${SNIPER_TEAL}0a`, border: `1px dashed ${SNIPER_TEAL}30`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <BookOpen size={16} color={SNIPER_TEAL} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.5 }}>
            Custom playbooks coming soon — create sequences tailored to your specific sales process and ICP.
          </div>
        </div>
      </div>
    </div>
  );
}
