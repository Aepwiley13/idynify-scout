/**
 * BarryWorkspace — full-page Barry conversation surface.
 *
 * This is the primary place a user intentionally works with Barry:
 *   - First Experience (onboarding) renders here, inside the app shell
 *   - Post-onboarding, this is the persistent Barry conversation page
 *   - Same canonical conversation as the Sidecar panel
 *
 * The page reads and writes the same canonical subcollection that every
 * other renderer uses (barryConversations/canonical/turns), so moving
 * between Workspace and Sidecar never loses turns.
 *
 * During First Experience, the shell shows simplified navigation — just
 * Barry and a wordmark. After onboarding completes, the full nav appears.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { auth, db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useShell } from '../../context/ShellContext';
import { useT } from '../../theme/ThemeContext';
import { BRAND, ASSETS } from '../../theme/tokens';
import { appendTurn, loadOrSeedRecentTurns } from '../../utils/barryCanonical';
import { resolveActiveIcp, isResolved } from '../../utils/resolveActiveIcp';
import { resolveWho } from '../../utils/resolveWho';
import { resolveFirstExperienceMode, MODE_BEGIN, MODE_RESUME } from '../../utils/firstExperienceMode';
import FirstExperience from '../Onboarding/FirstExperience';
import './BarryWorkspace.css';

const SOFT_PROGRESS_STATES = {
  prospecting: ['Understanding', 'Refining', 'Searching', 'First results'],
  engagement: ['Understanding', 'Finding context', 'Helping you act'],
  general: ['Getting started', 'Building context', 'Ready'],
};

function deriveSoftProgress(onboardingData, icpResolution, conversationData) {
  const hasIcp = icpResolution && isResolved(icpResolution);
  const hasConversation = conversationData?.status === 'confirming' || conversationData?.status === 'saving';
  const isAsking = conversationData?.status === 'asking' || conversationData?.status === 'clarifying';

  const states = SOFT_PROGRESS_STATES.prospecting;

  if (hasIcp) return { states, current: 3, label: states[3] };
  if (hasConversation) return { states, current: 2, label: states[2] };
  if (isAsking) return { states, current: 1, label: states[1] };
  return { states, current: 0, label: states[0] };
}

export default function BarryWorkspace() {
  const T = useT();
  const navigate = useNavigate();
  const { closeBarry, setFirstExperience } = useShell();
  const [loading, setLoading] = useState(true);
  const [isFirstExperience, setIsFirstExperienceLocal] = useState(false);
  const [softProgress, setSoftProgress] = useState(null);
  const [conversationTurns, setConversationTurns] = useState([]);
  const [who, setWho] = useState(null);

  const threadRef = useRef(null);

  useEffect(() => {
    closeBarry();
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const user = getEffectiveUser() || auth.currentUser;
    if (!user) { setLoading(false); return; }

    try {
      const [userSnap, convSnap, icpResolution, turns] = await Promise.all([
        getDoc(doc(db, 'users', user.uid)).catch(() => null),
        getDoc(doc(db, 'users', user.uid, 'barryConversations', 'icp')).catch(() => null),
        resolveActiveIcp(user.uid),
        loadOrSeedRecentTurns(db, user.uid, 30),
      ]);

      const userData = userSnap?.exists() ? userSnap.data() : null;
      const convData = convSnap?.exists() ? convSnap.data() : null;
      const onboardingComplete = userData?.onboardingComplete || userData?.onboarding?.completed;

      const firstExp = !onboardingComplete;
      setIsFirstExperienceLocal(firstExp);
      setFirstExperience?.(firstExp);

      if (firstExp) {
        const progress = deriveSoftProgress(userData?.onboarding, icpResolution, convData);
        setSoftProgress(progress);
      }

      setConversationTurns(turns);
      setWho(resolveWho(user, userData));
    } catch (err) {
      console.warn('[BarryWorkspace] init failed:', err.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [conversationTurns]);

  useEffect(() => {
    return () => { setFirstExperience?.(false); };
  }, [setFirstExperience]);

  if (loading) {
    return (
      <div className="barry-workspace">
        <div className="barry-workspace-loading">
          <div className="barry-workspace-loading-avatar">
            <img src={ASSETS.barryAvatar} alt="" width={64} height={64} />
          </div>
          <p style={{ color: T.textMuted }}>Loading Barry...</p>
        </div>
      </div>
    );
  }

  if (isFirstExperience) {
    return (
      <div className="barry-workspace barry-workspace--first-experience">
        {softProgress && (
          <div className="barry-workspace-progress" style={{ borderColor: T.border }}>
            <div className="barry-workspace-progress-track">
              {softProgress.states.map((label, i) => {
                const isActive = i === softProgress.current;
                const isDone = i < softProgress.current;
                return (
                  <div
                    key={label}
                    className={`barry-progress-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
                  >
                    <div
                      className="barry-progress-dot"
                      style={{
                        background: isDone ? BRAND.cyan : isActive ? BRAND.pink : T.surface2,
                        borderColor: isActive ? BRAND.pink : 'transparent',
                      }}
                    />
                    <span
                      className="barry-progress-label"
                      style={{ color: isActive ? T.text : T.textMuted }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="barry-workspace-content">
          <FirstExperience />
        </div>
      </div>
    );
  }

  return (
    <div className="barry-workspace">
      <div className="barry-workspace-header" style={{ borderColor: T.border }}>
        <div className="barry-workspace-header-left">
          <img
            src={ASSETS.barryAvatar}
            alt="Barry"
            className="barry-workspace-avatar"
            width={40}
            height={40}
          />
          <div>
            <h1 className="barry-workspace-title" style={{ color: T.text }}>Barry</h1>
            <span className="barry-workspace-subtitle" style={{ color: T.textMuted }}>
              Your sales intelligence co-pilot
            </span>
          </div>
        </div>
      </div>

      <div className="barry-workspace-thread" ref={threadRef}>
        {conversationTurns.length === 0 ? (
          <div className="barry-workspace-empty">
            <img
              src={ASSETS.barryAvatar}
              alt=""
              className="barry-workspace-empty-avatar"
              width={80}
              height={80}
            />
            <p style={{ color: T.text, fontWeight: 600, fontSize: 18 }}>
              {who?.name ? `Hey ${who.name}!` : 'Hey there!'}
            </p>
            <p style={{ color: T.textMuted, maxWidth: 440, textAlign: 'center', lineHeight: 1.6 }}>
              This is your workspace with Barry. Your entire conversation history
              lives here — pick up where you left off, or start something new.
            </p>
          </div>
        ) : (
          conversationTurns.map((turn, i) => (
            <div
              key={turn.id || i}
              className={`barry-workspace-message ${turn.role === 'user' ? 'user' : 'assistant'}`}
            >
              {turn.role === 'assistant' && (
                <img
                  src={ASSETS.barryAvatar}
                  alt=""
                  className="barry-workspace-msg-avatar"
                  width={28}
                  height={28}
                />
              )}
              <div
                className="barry-workspace-msg-bubble"
                style={{
                  background: turn.role === 'user' ? `${BRAND.pink}18` : T.surface,
                  borderColor: turn.role === 'user' ? `${BRAND.pink}30` : T.border,
                  color: T.text,
                }}
              >
                {turn.role === 'assistant' ? (
                  <ReactMarkdown className="barry-workspace-prose">
                    {turn.content}
                  </ReactMarkdown>
                ) : (
                  <p>{turn.content}</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="barry-workspace-composer" style={{ borderColor: T.border }}>
        <p className="barry-workspace-composer-hint" style={{ color: T.textMuted }}>
          Use the Barry panel for live conversation — this workspace shows your full history.
        </p>
      </div>
    </div>
  );
}
