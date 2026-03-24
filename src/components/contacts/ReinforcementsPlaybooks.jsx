/**
 * REINFORCEMENTS PLAYBOOKS
 *
 * Four-playbook action center for Reinforcements-stage contacts.
 * Each playbook calls Barry to generate the appropriate message.
 *
 *   ★  Thank         — Personalized thank-you for a referral
 *   ↗  Ask for Intro — Referral ask for a specific ICP target
 *   💬 Keep Warm     — Value-add touchpoint, no ask
 *   🏆 Recognize     — Public recognition or testimonial request
 *
 * Replaces the old ReinforcementsEngagementPanel chip buttons.
 * Each playbook: Barry drafts → user reviews → user sends.
 */

import { useState } from 'react';
import { Star, ArrowUpRight, MessageSquare, Trophy, Loader, Copy, CheckCircle, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';

const STAGE_COLOR = '#6366f1';

const PLAYBOOKS = [
  {
    id: 'thank',
    icon: Star,
    label: '★ Thank for a referral',
    description: 'Barry drafts a personalized thank-you referencing the specific person they introduced.',
    promptKey: 'thank_referral',
    goalHint: 'Who did they refer? How did it go?',
  },
  {
    id: 'ask_intro',
    icon: ArrowUpRight,
    label: '↗ Ask for intro',
    description: 'Barry drafts a warm referral ask for a specific ICP target in their network.',
    promptKey: 'ask_intro',
    goalHint: 'Who do you want to meet? Why?',
  },
  {
    id: 'keep_warm',
    icon: MessageSquare,
    label: '💬 Keep warm',
    description: 'Barry writes a value-add touchpoint — relevant to what they care about. No ask.',
    promptKey: 'keep_warm',
    goalHint: 'Anything specific that happened recently?',
  },
  {
    id: 'recognize',
    icon: Trophy,
    label: '🏆 Recognize publicly',
    description: 'Barry drafts a public recognition post, testimonial request, or award nomination.',
    promptKey: 'recognize',
    goalHint: 'What do you want to recognize them for?',
  },
];

function PlaybookCard({ playbook, contact, T }) {
  const [expanded, setExpanded] = useState(false);
  const [goal, setGoal] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  const Icon = playbook.icon;

  async function handleGenerate() {
    if (!goal.trim() && playbook.id !== 'keep_warm') return;
    setGenerating(true);
    setError(null);
    setGenerated(null);

    try {
      const user = getEffectiveUser();
      if (!user) throw new Error('Not authenticated');
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/barryOutreachMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contact,
          intent: playbook.promptKey,
          goal: goal.trim() || `Keep warm with ${contact.name || 'this contact'}`,
          channel: 'email',
        }),
      });

      if (!response.ok) throw new Error('Generation failed');
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Generation failed');

      setGenerated(result.message || result.generatedMessage || '');
    } catch (err) {
      setError(err.message || 'Barry hit a snag. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    if (!generated) return;
    navigator.clipboard.writeText(generated).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div style={{
      borderRadius: 11,
      border: `1px solid ${expanded ? `${STAGE_COLOR}50` : T.border}`,
      background: expanded ? `${STAGE_COLOR}06` : T.surface,
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      {/* Card header — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', padding: '12px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: `${STAGE_COLOR}15`, border: `1px solid ${STAGE_COLOR}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={14} color={STAGE_COLOR} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{playbook.label}</div>
          {!expanded && (
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>{playbook.description}</div>
          )}
        </div>
        {expanded ? <ChevronUp size={14} color={T.textFaint} /> : <ChevronDown size={14} color={T.textFaint} />}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ height: 1, background: `${STAGE_COLOR}18` }} />
          <p style={{ fontSize: 12, color: T.textMuted, margin: 0 }}>{playbook.description}</p>

          {/* Goal input */}
          <textarea
            placeholder={playbook.goalHint}
            value={goal}
            onChange={e => setGoal(e.target.value)}
            rows={2}
            style={{
              width: '100%', padding: '9px 11px', borderRadius: 8, resize: 'vertical',
              background: T.appBg, border: `1px solid ${T.border2}`,
              color: T.text, fontSize: 12, fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />

          {/* Generate CTA */}
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: '9px 16px', borderRadius: 9, border: 'none',
              background: generating ? T.border : `linear-gradient(135deg,${STAGE_COLOR},#4f46e5)`,
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: generating ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
            }}
          >
            {generating ? (
              <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />Barry is writing...</>
            ) : (
              <>✦ Generate with Barry</>
            )}
          </button>

          {/* Error */}
          {error && (
            <p style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>{error}</p>
          )}

          {/* Generated message */}
          {generated && (
            <div style={{
              borderRadius: 9, border: `1px solid ${STAGE_COLOR}30`,
              background: `${STAGE_COLOR}08`, overflow: 'hidden',
            }}>
              <pre style={{
                margin: 0, padding: '12px 14px',
                fontSize: 12, color: T.text, whiteSpace: 'pre-wrap', lineHeight: 1.6,
                fontFamily: 'inherit',
              }}>
                {generated}
              </pre>
              <div style={{
                borderTop: `1px solid ${STAGE_COLOR}20`,
                padding: '8px 14px',
                display: 'flex', gap: 8,
              }}>
                <button
                  onClick={handleCopy}
                  style={{
                    padding: '5px 12px', borderRadius: 7, border: 'none', fontSize: 11, fontWeight: 600,
                    background: copied ? '#22c55e18' : `${STAGE_COLOR}18`,
                    color: copied ? '#22c55e' : STAGE_COLOR,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {copied ? <><CheckCircle size={11} />Copied!</> : <><Copy size={11} />Copy</>}
                </button>
                <button
                  onClick={handleGenerate}
                  style={{
                    padding: '5px 12px', borderRadius: 7, border: 'none', fontSize: 11, fontWeight: 600,
                    background: T.surface, color: T.textMuted, cursor: 'pointer',
                  }}
                >
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReinforcementsPlaybooks({ contact }) {
  const T = useT();

  if (!contact || contact.stage !== 'reinforcements') return null;

  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${STAGE_COLOR}35`,
      background: `${STAGE_COLOR}06`,
      overflow: 'hidden',
    }}>
      {/* Section header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${STAGE_COLOR}20`,
        display: 'flex', alignItems: 'center', gap: 9,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: `${STAGE_COLOR}18`, border: `1px solid ${STAGE_COLOR}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Users size={14} color={STAGE_COLOR} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Reinforcements</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
            {contact.first_name || contact.name?.split(' ')[0] || 'This contact'} is your most valuable referral source
          </div>
        </div>
      </div>

      {/* Playbooks */}
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PLAYBOOKS.map(pb => (
          <PlaybookCard key={pb.id} playbook={pb} contact={contact} T={T} />
        ))}
      </div>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}
