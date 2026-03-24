/**
 * ReinforcementsEngagementPanel — Sprint 4 rebuild.
 *
 * For Reinforcements-stage contacts (terminal stage — they're already advocates).
 * Replaces the old chip-only panel with:
 *   • Referral metrics (Refs In / Converted / Value)
 *   • RelationshipArc
 *   • 4 playbook action buttons that pre-fill InlineEngagementSection
 *
 * Props:
 *   contact         — contact object
 *   onPrefillCompose(text) — callback to pre-fill InlineEngagementSection compose box
 */

import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { BRAND } from '../../theme/tokens';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { getContactReferralAnalytics } from '../../services/referralIntelligenceService';
import { logTimelineEvent, ACTORS } from '../../utils/timelineLogger';
import RelationshipArc from './RelationshipArc';

const STAGE_COLOR = '#6366f1';

const RECOGNIZE_OPTIONS = [
  { id: 'linkedin_rec', label: 'Write a LinkedIn recommendation' },
  { id: 'testimonial',  label: 'Request a testimonial'             },
  { id: 'nomination',   label: 'Nominate for recognition / award'  },
];

export default function ReinforcementsEngagementPanel({ contact, onPrefillCompose }) {
  const T = useT();
  const [referralData, setReferralData]       = useState(null);
  const [recognizeOption, setRecognizeOption] = useState('linkedin_rec');
  const [introTarget, setIntroTarget]         = useState('');
  const [showIntroInput, setShowIntroInput]   = useState(false);

  const firstName = contact?.first_name
    || contact?.name?.split(' ')[0]
    || 'them';
  const fullName = contact?.name
    || `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim()
    || firstName;

  useEffect(() => {
    const user = getEffectiveUser();
    if (!user || !contact?.id) return;
    getContactReferralAnalytics(user.uid, contact.id)
      .then(setReferralData)
      .catch(() => null);
  }, [contact?.id]);

  // Most recent received referral (for Thank playbook)
  const latestReceived = referralData?.referred_to_me_records?.[0] ?? null;

  function prefill(text, eventType) {
    onPrefillCompose?.(text);
    const user = getEffectiveUser();
    if (user && contact?.id) {
      logTimelineEvent({
        userId:    user.uid,
        contactId: contact.id,
        type:      eventType,
        actor:     ACTORS.USER,
        preview:   text.slice(0, 80),
      }).catch(() => null);
    }
  }

  // ── Playbook handlers ────────────────────────────────────────────

  function handleThank() {
    const referredName = latestReceived?.to_contact_name || '[referred person]';
    prefill(
      `Thank ${firstName} for referring ${referredName} — let them know how it went and reinforce the behavior.`,
      'referral_thank_you_sent',
    );
  }

  function handleAskIntro() {
    const target = introTarget.trim() || '[Target Name]';
    prefill(
      `Ask ${firstName} if they can introduce me to ${target} — explain why I want the intro and how to frame it for ${firstName}.`,
      'referral_ask_sent',
    );
    setShowIntroInput(false);
    setIntroTarget('');
  }

  function handleKeepWarm() {
    prefill(
      `Send ${firstName} a value-add touchpoint — something relevant to what they care about. No ask. Just a reason to stay connected.`,
      'keep_warm_sent',
    );
  }

  function handleRecognize() {
    const prompts = {
      linkedin_rec: `Write a LinkedIn recommendation for ${fullName} highlighting their role and key strengths.`,
      testimonial:  `Ask ${fullName} if they would be willing to share a testimonial about working with me.`,
      nomination:   `Draft a nomination message recognizing ${fullName} for an award or recognition.`,
    };
    prefill(prompts[recognizeOption] ?? prompts.linkedin_rec, 'recognition_sent');
  }

  // ── Stat values ──────────────────────────────────────────────────

  const refsIn    = referralData?.intros_given ?? referralData?.referred_to_me_records?.length ?? '—';
  const converted = referralData?.converted    ?? referralData?.referred_to_me_records?.filter(r => r.status === 'converted').length ?? '—';
  const latestVal = referralData?.referred_to_me_records?.map(r => r.referral_value).find(Boolean) ?? null;

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Referral metrics row */}
      {referralData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { label: 'Refs In',   value: refsIn    },
            { label: 'Converted', value: converted  },
            { label: 'Value',     value: latestVal ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{
              padding: '10px 12px', borderRadius: 10,
              background: T.surface, border: `1px solid ${T.border}`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.text, lineHeight: 1.1 }}>
                {value}
              </div>
              <div style={{
                fontSize: 10, color: T.textFaint, marginTop: 3,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Relationship arc */}
      <RelationshipArc contact={contact} />

      {/* Playbook action panel */}
      <div style={{
        borderRadius: 12,
        border: `1px solid ${STAGE_COLOR}30`,
        background: `${STAGE_COLOR}06`,
        overflow: 'hidden',
        paddingBottom: 12,
      }}>

        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: STAGE_COLOR,
            textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
          }}>
            What do you want to do?
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

            {/* ★ Thank for a referral */}
            <button onClick={handleThank} style={btnStyle(T)}>
              <span style={{ fontSize: 14 }}>★</span>
              <span style={{ flex: 1 }}>Thank {firstName} for a referral</span>
              {latestReceived?.to_contact_name && (
                <span style={{ fontSize: 10, color: T.textFaint }}>
                  Re: {latestReceived.to_contact_name}
                </span>
              )}
            </button>

            {/* ↗ Ask for intro */}
            <div>
              <button
                onClick={() => setShowIntroInput(v => !v)}
                style={btnStyle(T)}
              >
                <span style={{ fontSize: 14 }}>↗</span>
                <span style={{ flex: 1 }}>
                  {introTarget.trim()
                    ? `Ask for intro to ${introTarget.trim()}`
                    : 'Ask for intro'}
                </span>
                <ChevronRight
                  size={12}
                  color={T.textFaint}
                  style={{
                    transform: showIntroInput ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                  }}
                />
              </button>
              {showIntroInput && (
                <div style={{ padding: '6px 0 4px', display: 'flex', gap: 6 }}>
                  <input
                    autoFocus
                    placeholder="Who do you want to meet?"
                    value={introTarget}
                    onChange={e => setIntroTarget(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAskIntro(); }}
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: 7,
                      border: `1px solid ${T.border}`, background: T.appBg,
                      color: T.text, fontSize: 12, outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  <button
                    onClick={handleAskIntro}
                    style={{
                      padding: '6px 12px', borderRadius: 7, border: 'none',
                      background: STAGE_COLOR, color: '#fff',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Pre-fill →
                  </button>
                </div>
              )}
            </div>

            {/* 💬 Keep warm */}
            <button onClick={handleKeepWarm} style={btnStyle(T)}>
              <span style={{ fontSize: 14 }}>💬</span>
              <span>Keep warm</span>
            </button>

            {/* 🏆 Recognize publicly */}
            <div style={{
              borderRadius: 8, border: `1px solid ${T.border}`,
              background: T.surface, overflow: 'hidden',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
              }}>
                <span style={{ fontSize: 14 }}>🏆</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.text, flex: 1 }}>
                  Recognize {firstName} publicly
                </span>
              </div>
              <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {RECOGNIZE_OPTIONS.map(opt => (
                  <label
                    key={opt.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
                  >
                    <input
                      type="radio"
                      name={`recognize_${contact?.id}`}
                      value={opt.id}
                      checked={recognizeOption === opt.id}
                      onChange={() => setRecognizeOption(opt.id)}
                      style={{ accentColor: STAGE_COLOR, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 11, color: T.textMuted }}>{opt.label}</span>
                  </label>
                ))}
                <button
                  onClick={handleRecognize}
                  style={{
                    marginTop: 4, padding: '5px 12px', borderRadius: 7, border: 'none',
                    background: `${STAGE_COLOR}18`, color: STAGE_COLOR,
                    fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    alignSelf: 'flex-start',
                  }}
                >
                  Pre-fill compose →
                </button>
              </div>
            </div>

          </div>
        </div>

        <div style={{ height: 1, background: `${STAGE_COLOR}15`, margin: '0 16px 10px' }} />
        <p style={{
          margin: 0, padding: '0 16px',
          fontSize: 11, color: T.textFaint, fontStyle: 'italic',
        }}>
          Or write your own message below ↓
        </p>
      </div>
    </div>
  );
}

function btnStyle(T) {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', borderRadius: 8,
    background: T.surface, border: `1px solid ${T.border}`,
    color: T.text, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', textAlign: 'left',
  };
}
