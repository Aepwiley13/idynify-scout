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
 * The shape of a first conversation:
 *
 *   WHO ─► INTENT ─► FIRST VALUE
 *
 * WHO is one skippable question and never a gate. INTENT is one open question,
 * classified invisibly. FIRST VALUE is either this conversation continuing
 * (defining who to reach), a handoff to the surface that actually delivers the
 * outcome, or an honest account of why it cannot happen yet.
 *
 * Nothing on this path is simulated. Where a capability is missing, Barry says
 * so and offers something real instead.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, getDocs, collection, query, limit } from 'firebase/firestore';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useT } from '../../theme/ThemeContext';
import { resolveWho, rememberName, WHO_PROMPT } from '../../utils/resolveWho';
import { resolveActiveIcp } from '../../utils/resolveActiveIcp';
import { resolveFirstExperienceMode, shouldIntroduce, MODE_BEGIN } from '../../utils/firstExperienceMode';
import {
  OPENING_QUESTION,
  normalizeClassification,
  unclearClassification,
  orderCompound,
  INTENT_PROSPECTING,
} from '../../utils/firstExperienceIntent';
import {
  routeIntent,
  intentLabel,
  ROUTE_IN_PLACE,
  ROUTE_NAVIGATE,
  ROUTE_CONFIRM,
  ROUTE_CLARIFY,
  ROUTE_BLOCKED,
  ROUTE_RELATIONSHIP,
} from '../../utils/firstValueRouting';
import { logEvent, EVENTS } from '../../services/analytics';
import BarryOnboarding from './BarryOnboarding';
import RelationshipFirstValue from '../../components/onboarding/RelationshipFirstValue';

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

/**
 * The handful of facts routing needs, read once.
 *
 * A failed read reports the pessimistic answer. Barry then says what is missing
 * and offers a real alternative, which is a recoverable turn — whereas routing
 * someone to an empty replies view on an optimistic guess is a dead end.
 */
async function readReadiness(userId) {
  const [contacts, gmail] = await Promise.all([
    getDocs(query(collection(db, 'users', userId, 'contacts'), limit(1))).catch(() => null),
    getDoc(doc(db, 'users', userId, 'integrations', 'gmail')).catch(() => null),
  ]);
  return {
    hasContacts: Boolean(contacts) && !contacts.empty,
    gmailConnected: Boolean(gmail?.exists()) && gmail.data()?.status === 'connected',
  };
}

export default function FirstExperience() {
  const T = useT();
  const navigate = useNavigate();
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

  // Everything below is session state and dies with the tab. Intent is
  // transient routing context: no field, no collection, no history.
  const [askingIntent, setAskingIntent] = useState(false);
  const [readiness, setReadiness] = useState({ hasContacts: false, gmailConnected: false });
  const [turn, setTurn] = useState('');
  const [classifying, setClassifying] = useState(false);
  const [pending, setPending] = useState(null);   // classification awaiting confirmation
  const [decision, setDecision] = useState(null);
  const [held, setHeld] = useState(null);         // the second half of a compound intent

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
      const facts = await readReadiness(user.uid);

      if (cancelled) return;

      const resolved = resolveWho(user, userData);
      setWho(resolved);
      setReadiness(facts);

      // Someone resuming or refining has met Barry already. Asking their name
      // mid-conversation is the tell of a flow that does not know you have been
      // here, so the question belongs to a genuine first conversation.
      const { mode } = resolveFirstExperienceMode(conversation, icpResolution, arrival);

      logEvent(EVENTS.FIRST_EXPERIENCE_STARTED, { mode: mode === MODE_BEGIN ? 'begin' : 'resume' });
      logEvent(EVENTS.WHO_RESOLVED, { source: resolved.source });

      const alreadyAsked = sessionStorage.getItem(ASKED_KEY) === '1';
      const wantsName = resolved.shouldAsk && !alreadyAsked && shouldIntroduce(mode);
      setAskingName(wantsName);
      if (wantsName) logEvent(EVENTS.WHO_ASKED);

      // The intent question belongs to a genuine first conversation only.
      // Someone resuming an unfinished targeting conversation, or arriving to
      // refine an ICP that exists, has already told Barry what they came for —
      // asking again would throw away the thing this route was built to keep.
      const beginning = mode === MODE_BEGIN;
      setAskingIntent(beginning && !wantsName);
      if (!beginning) {
        setDecision(routeIntent({ intent: INTENT_PROSPECTING, confidence: 1 }, facts));
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [arrival]);

  async function submitName() {
    const user = getEffectiveUser() || auth.currentUser;
    const answered = nameInput.trim();

    sessionStorage.setItem(ASKED_KEY, '1');
    setAskingName(false);
    setAskingIntent(true);

    if (!answered || !user) return;

    logEvent(EVENTS.WHO_PROVIDED, { source: 'conversational' });
    // Optimistic: the conversation continues whether or not the write lands.
    setWho(prev => ({ ...prev, name: answered, shouldAsk: false }));
    await rememberName(user.uid, answered);
  }

  function skipName() {
    sessionStorage.setItem(ASKED_KEY, '1');
    setAskingName(false);
    setAskingIntent(true);
  }

  /** Classify one turn and act on it. One round trip, nothing written. */
  async function submitIntent() {
    const said = turn.trim();
    if (!said || classifying) return;

    setClassifying(true);
    setTurn('');
    logEvent(EVENTS.INTENT_CLASSIFICATION_ATTEMPTED);

    let classification;
    try {
      const user = getEffectiveUser() || auth.currentUser;
      const authToken = await user.getIdToken();
      const res = await fetch('/.netlify/functions/barryMissionChat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          firstExperience: true,
          message: said,
          knownName: who?.name || null,
        }),
      });
      const data = res.ok ? await res.json() : null;
      classification = data?.classification
        ? normalizeClassification(data.classification)
        : unclearClassification('unclassified');
    } catch (err) {
      console.warn('[FirstExperience] classification failed:', err.message);
      classification = unclearClassification('request-failed');
    }

    logEvent(EVENTS.INTENT_CLASSIFIED, {
      intent: classification.intent,
      confidence_band: classification.confidence >= 0.6 ? 'high' : 'low',
      has_secondary: Boolean(classification.secondaryIntent),
    });

    applyClassification(classification);
    setClassifying(false);
  }

  function applyClassification(classification) {
    // Compound intent is served one at a time, most actionable first. The
    // second is held in this component for the session and nowhere else.
    const [first, second] = orderCompound(classification.intent, classification.secondaryIntent);
    setHeld(second);
    setPending({ ...classification, intent: first });
    const routed = routeIntent({ ...classification, intent: first }, readiness);
    setDecision(routed);

    if (routed.kind === ROUTE_CLARIFY) {
      logEvent(EVENTS.INTENT_CLARIFICATION_REQUESTED, { intent: first });
    } else {
      logEvent(EVENTS.FIRST_VALUE_BRANCH_SELECTED, { intent: first, branch: routed.kind });
      if (routed.kind === ROUTE_BLOCKED) {
        logEvent(EVENTS.FIRST_VALUE_BLOCKED, { intent: first, reason: routed.reason });
      }
    }
  }

  /** The user said yes to Barry's restatement. */
  function confirmIntent() {
    const settled = { ...pending, needsConfirmation: false };
    setPending(settled);
    setDecision(routeIntent(settled, readiness));
  }

  /** The user said no. Back to the question, without re-asking it colder. */
  function rejectIntent() {
    setPending(null);
    setDecision(null);
    setHeld(null);
    setAskingIntent(true);
  }

  /** An offered alternative — always a real capability, never a placeholder. */
  function chooseIntent(intent) {
    setHeld(prev => (prev === intent ? null : prev));
    setPending({ intent, confidence: 1 });
    setDecision(routeIntent({ intent, confidence: 1 }, readiness));
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
      <Ask
        T={T}
        prompt={WHO_PROMPT}
        value={nameInput}
        onChange={setNameInput}
        onSubmit={submitName}
        placeholder="Your name"
        label="Your name"
        cta="Continue"
        onSkip={skipName}
      />
    );
  }

  // The one INTENT question. Open text — the categories behind it are internal
  // and are never rendered as choices.
  if (askingIntent && !decision) {
    return (
      <Ask
        T={T}
        prompt={who?.name ? `${who.name} — ${lower(OPENING_QUESTION)}` : OPENING_QUESTION}
        value={turn}
        onChange={setTurn}
        onSubmit={submitIntent}
        placeholder="e.g. I need to follow up with a few people this week"
        label="What you want to get done"
        cta={classifying ? 'One moment…' : 'Continue'}
        busy={classifying}
      />
    );
  }

  // Prospecting is served by this conversation. Everything that made the old
  // ICP flow work is intact behind it — extraction, the clarify loop, the
  // confirmation card, and the confirmation event that creates the ICP.
  if (decision?.kind === ROUTE_IN_PLACE) {
    // The goal is Barry's own restatement of the intent turn, passed down so
    // the proposal can open with what he thinks the user is trying to do
    // rather than with a field list. Transient by construction: it is derived
    // from this session's classification and is never written anywhere.
    return <BarryOnboarding knownName={who?.name || null} goal={pending?.restatement || null} />;
  }

  // Engagement and Preparation are served here, about one named person, from
  // what IDYNIFY already holds. Deliberately a different kind from in-place:
  // in-place means the targeting conversation, and relationship work must
  // never widen the set of things that can reach an ICP.
  if (decision?.kind === ROUTE_RELATIONSHIP) {
    return <RelationshipFirstValue decision={decision} knownName={who?.name || null} />;
  }

  // Barry read the intent back and is waiting to be told it is right.
  if (decision?.kind === ROUTE_CONFIRM) {
    return (
      <Panel T={T} headline={decision.headline} detail={decision.detail}>
        <button style={primaryBtn(T)} onClick={confirmIntent}>Yes, that's it</button>
        <button style={quietBtn(T)} onClick={rejectIntent}>Not quite</button>
      </Panel>
    );
  }

  // Barry could not tell, and asks once rather than guessing.
  if (decision?.kind === ROUTE_CLARIFY) {
    return (
      <Ask
        T={T}
        prompt={decision.headline}
        value={turn}
        onChange={setTurn}
        onSubmit={submitIntent}
        placeholder="In your own words"
        label="What you want to get done"
        cta={classifying ? 'One moment…' : 'Continue'}
        busy={classifying}
        options={decision.options}
        onChoose={chooseIntent}
      />
    );
  }

  // A handoff, a missing precondition, or a branch that is not built yet. All
  // three render the same way, because all three are Barry telling the user
  // exactly what is about to happen or exactly why it is not.
  if (decision) {
    const handleNavigate = () => {
      logEvent(EVENTS.FIRST_VALUE_DELIVERED, { intent: decision.intent, branch: decision.kind });
      navigate(decision.destination.path);
    };
    const offers = held
      ? [...decision.options, { id: 'held', label: `Then ${intentLabel(held)}`, intent: held }]
      : decision.options;

    return (
      <Panel T={T} headline={decision.headline} detail={decision.detail}>
        {decision.destination && (
          <button style={primaryBtn(T)} onClick={handleNavigate}>
            {decision.kind === ROUTE_NAVIGATE ? 'Take me there' : 'Set that up'}
          </button>
        )}
        {offers.map(o => (
          <button key={o.id} style={quietBtn(T)} onClick={() => chooseIntent(o.intent)}>
            {o.label}
          </button>
        ))}
      </Panel>
    );
  }

  return <BarryOnboarding knownName={who?.name || null} />;
}

/** Lowercase a sentence's first letter so it can follow a name. */
function lower(sentence) {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}

const shell = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '60vh',
  gap: 20,
  padding: 24,
};

function primaryBtn(T) {
  return {
    padding: '12px 20px', borderRadius: 10, border: 'none',
    background: T.accent, color: '#fff', fontWeight: 700, cursor: 'pointer',
  };
}

function quietBtn(T) {
  return {
    padding: '10px 18px', borderRadius: 10, border: `1px solid ${T.border}`,
    background: 'transparent', color: T.text, fontSize: 14, cursor: 'pointer',
  };
}

/** One question, free text, with optional real alternatives beneath it. */
function Ask({ T, prompt, value, onChange, onSubmit, placeholder, label, cta, onSkip, busy = false, options = [], onChoose }) {
  return (
    <div className="barry-onboarding" style={shell}>
      <p style={{ fontSize: 20, fontWeight: 600, color: T.text, margin: 0, textAlign: 'center', maxWidth: 560 }}>
        {prompt}
      </p>
      <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 520 }}>
        <input
          autoFocus
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(); }}
          placeholder={placeholder}
          aria-label={label}
          disabled={busy}
          style={{ flex: 1, padding: '12px 14px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 15 }}
        />
        <button onClick={onSubmit} disabled={busy} style={primaryBtn(T)}>{cta}</button>
      </div>
      {options.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {options.map(o => (
            <button key={o.id} style={quietBtn(T)} onClick={() => onChoose?.(o.intent)}>{o.label}</button>
          ))}
        </div>
      )}
      {onSkip && (
        <button
          onClick={onSkip}
          style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Skip
        </button>
      )}
    </div>
  );
}

/** Barry says one thing and offers what is actually available. */
function Panel({ T, headline, detail, children }) {
  return (
    <div className="barry-onboarding" style={shell}>
      <p style={{ fontSize: 20, fontWeight: 600, color: T.text, margin: 0, textAlign: 'center', maxWidth: 560 }}>
        {headline}
      </p>
      {detail && (
        <p style={{ fontSize: 15, color: T.textMuted, margin: 0, textAlign: 'center', maxWidth: 520, lineHeight: 1.5 }}>
          {detail}
        </p>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {children}
      </div>
    </div>
  );
}
