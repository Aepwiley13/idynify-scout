/**
 * FirstExperience — the single authoritative Barry First Experience route.
 *
 * Two first-run flows used to exist. Which one a user got depended on how they
 * arrived: checkout sent them to BarryOnboarding, which created an ICP and ran
 * a search, while visiting the site root sent them to OnboardingFlow, which
 * created no ICP and ran no search. Both marked the user onboarded. This route
 * replaces both.
 *
 * It is not a mode the user enters and exits. Existing-user affordances
 * ("Review ICP with Barry") land here too, so it resumes and refines rather
 * than restarting — the same progressive model that governs Barry's ongoing
 * operation, running for the first time.
 *
 * Gate A scope: canonical entry, WHO acquisition, and resumption. Intent
 * routing (Gate B) and the decomposed Prospecting branch (Gate C) land on top
 * of this shell; until then the existing Barry conversation is the single
 * branch, so behaviour is preserved or better for every user at every step.
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { resolveWho, rememberName, WHO_PROMPT } from '../../utils/resolveWho';
import { resolveActiveIcp } from '../../utils/resolveActiveIcp';
import { resolveFirstExperienceMode, shouldIntroduce } from '../../utils/firstExperienceMode';
import BarryOnboarding from './BarryOnboarding';

/**
 * Barry asks for a name at most once per session, and only when none is known.
 *
 * Deliberately sessionStorage rather than a stored flag: a persisted
 * "weAskedAlready" field would be a completion state in disguise, and those
 * are exactly what this phase removes. If the user answers, the name is stored
 * and the question never returns. If they skip, it stays quiet for this
 * session and may come up naturally another day.
 */
const ASKED_KEY = 'idynify_who_asked';

export default function FirstExperience() {
  const T = useT();
  // Why the user arrived on this navigation. Transient by construction — it
  // lives in the history entry and is gone on reload — so an explicit
  // "Review ICP with Barry" click can outrank generic resume state without
  // becoming durable mode state.
  const location = useLocation();
  const arrival = location.state?.arrival || null;
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState(null);
  const [askingName, setAskingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const user = getEffectiveUser() || auth.currentUser;
      if (!user) { setLoading(false); return; }

      let userData = null;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        userData = snap.exists() ? snap.data() : null;
      } catch (err) {
        // WHO is never a gate. A failed read means Barry does not know the
        // name yet, not that the experience stops.
        console.warn('[FirstExperience] user document read failed:', err.message);
      }

      // What this visit is: beginning, resuming an unfinished conversation, or
      // refining an ICP that already exists. Derived from state that already
      // exists — never stored, so it cannot become another completion flag.
      let conversation = null;
      try {
        const convSnap = await getDoc(doc(db, 'users', user.uid, 'barryConversations', 'icp'));
        conversation = convSnap.exists() ? convSnap.data() : null;
      } catch (err) {
        console.warn('[FirstExperience] conversation read failed:', err.message);
      }
      const icpResolution = await resolveActiveIcp(user.uid);

      if (cancelled) return;

      const resolved = resolveWho(user, userData);
      setWho(resolved);

      // Someone resuming or refining has met Barry already. Asking their name
      // mid-conversation is the tell of a flow that does not know you have been
      // here, so the question belongs to a genuine first conversation.
      const { mode } = resolveFirstExperienceMode(conversation, icpResolution, arrival);
      const alreadyAsked = sessionStorage.getItem(ASKED_KEY) === '1';
      setAskingName(resolved.shouldAsk && !alreadyAsked && shouldIntroduce(mode));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [arrival]);

  async function submitName() {
    const user = getEffectiveUser() || auth.currentUser;
    const answered = nameInput.trim();

    sessionStorage.setItem(ASKED_KEY, '1');
    setAskingName(false);

    if (!answered || !user) return;

    // Optimistic: the conversation continues whether or not the write lands.
    setWho(prev => ({ ...prev, name: answered, shouldAsk: false }));
    await rememberName(user.uid, answered);
  }

  function skipName() {
    sessionStorage.setItem(ASKED_KEY, '1');
    setAskingName(false);
  }

  if (loading) {
    return (
      <div className="barry-onboarding-loading">
        <div className="loading-content">
          <p>Loading Barry...</p>
        </div>
      </div>
    );
  }

  // The one WHO question. One turn, skippable, and nothing downstream depends
  // on the answer.
  if (askingName) {
    return (
      <div className="barry-onboarding" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20, padding: 24 }}>
        <p style={{ fontSize: 20, fontWeight: 600, color: T.text, margin: 0, textAlign: 'center' }}>
          {WHO_PROMPT}
        </p>
        <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 420 }}>
          <input
            autoFocus
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitName(); }}
            placeholder="Your name"
            aria-label="Your name"
            style={{ flex: 1, padding: '12px 14px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 15 }}
          />
          <button
            onClick={submitName}
            style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: T.accent, color: '#fff', fontWeight: 700, cursor: 'pointer' }}
          >
            Continue
          </button>
        </div>
        <button
          onClick={skipName}
          style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Skip
        </button>
      </div>
    );
  }

  // Gate A: one branch. Gate B puts intent routing in front of this, and Gate C
  // decomposes what sits behind it.
  // The mode is the shell's own reading of this visit — it decides whether
  // Barry introduces itself and whether the WHO question belongs here. The
  // delegated conversation restores its own state and builds its own returning
  // greeting, so nothing is passed down that it would only ignore.
  return <BarryOnboarding knownName={who?.name || null} />;
}
