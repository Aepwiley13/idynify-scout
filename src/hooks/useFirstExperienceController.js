/**
 * useFirstExperienceController — drives the First Experience as a conversation.
 *
 * Instead of rendering WHO and INTENT as form screens, this hook produces
 * conversation turns that render in the Barry Workspace thread. The user
 * types into the same composer they will use post-onboarding.
 *
 * Phases: loading → greeting → who → intent → classifying → handoff
 *
 * On handoff, the decision and who are available for FirstExperience.jsx
 * to render the First Value (BarryOnboarding, RelationshipFirstValue, etc.).
 *
 * Nothing here creates a new conversation authority. Canonical turns are NOT
 * written by this hook — that remains the workspace's responsibility after
 * the handoff is complete and the user is in a real Barry conversation.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { auth, db } from '../firebase/config';
import { doc, getDoc, getDocs, collection, query, limit } from 'firebase/firestore';
import { getEffectiveUser } from '../context/ImpersonationContext';
import { resolveWho, rememberName } from '../utils/resolveWho';
import { resolveActiveIcp } from '../utils/resolveActiveIcp';
import {
  resolveFirstExperienceMode,
  shouldIntroduce,
  MODE_BEGIN,
} from '../utils/firstExperienceMode';
import {
  normalizeClassification,
  unclearClassification,
  orderCompound,
  INTENT_PROSPECTING,
} from '../utils/firstExperienceIntent';
import {
  routeIntent,
  intentLabel,
  ROUTE_CLARIFY,
  ROUTE_CONFIRM,
} from '../utils/firstValueRouting';
import { logEvent, EVENTS } from '../services/analytics';

const ASKED_KEY = 'idynify_who_asked';

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

export default function useFirstExperienceController(arrival = null) {
  const [phase, setPhase] = useState('loading');
  const [turns, setTurns] = useState([]);
  const [who, setWho] = useState(null);
  const [decision, setDecision] = useState(null);
  const [readiness, setReadiness] = useState({ hasContacts: false, gmailConnected: false });
  const [classifying, setClassifying] = useState(false);
  const [pending, setPending] = useState(null);
  const [held, setHeld] = useState(null);

  const readinessRef = useRef(readiness);
  readinessRef.current = readiness;
  const whoRef = useRef(who);
  whoRef.current = who;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const user = getEffectiveUser() || auth.currentUser;
      if (!user) { setPhase('loading'); return; }

      let userData = null;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        userData = snap.exists() ? snap.data() : null;
      } catch (err) {
        console.warn('[FirstExpCtrl] user read failed:', err.message);
      }

      let conversation = null;
      try {
        const convSnap = await getDoc(doc(db, 'users', user.uid, 'barryConversations', 'icp'));
        conversation = convSnap.exists() ? convSnap.data() : null;
      } catch (err) {
        console.warn('[FirstExpCtrl] conversation read failed:', err.message);
      }

      const icpResolution = await resolveActiveIcp(user.uid);
      const facts = await readReadiness(user.uid);

      if (cancelled) return;

      const resolved = resolveWho(user, userData);
      setWho(resolved);
      setReadiness(facts);

      const { mode } = resolveFirstExperienceMode(conversation, icpResolution, arrival);
      logEvent(EVENTS.FIRST_EXPERIENCE_STARTED, { mode: mode === MODE_BEGIN ? 'begin' : 'resume' });
      logEvent(EVENTS.WHO_RESOLVED, { source: resolved.source });

      if (mode !== MODE_BEGIN) {
        setDecision(routeIntent({ intent: INTENT_PROSPECTING, confidence: 1 }, facts));
        setPhase('handoff');
        return;
      }

      const alreadyAsked = sessionStorage.getItem(ASKED_KEY) === '1';
      const wantsName = resolved.shouldAsk && !alreadyAsked && shouldIntroduce(mode);

      const greeting = resolved.name
        ? `Hey ${resolved.name}! I'm Barry, your sales intelligence co-pilot. I'm here to help you find the right people to reach and figure out the best way to get in front of them.`
        : `Hey there! I'm Barry, your sales intelligence co-pilot. I'm here to help you find the right people to reach and figure out the best way to get in front of them.`;

      const openingTurns = [{ role: 'assistant', content: greeting }];

      if (wantsName) {
        logEvent(EVENTS.WHO_ASKED);
        openingTurns.push({
          role: 'assistant',
          content: 'What should I call you?',
          _fePhase: 'who',
          _feSkippable: true,
        });
        setTurns(openingTurns);
        setPhase('who');
      } else {
        const intentPrompt = resolved.name
          ? `So ${resolved.name}, what are you hoping to get done?`
          : `What are you hoping to get done?`;
        openingTurns.push({ role: 'assistant', content: intentPrompt });
        setTurns(openingTurns);
        setPhase('intent');
      }
    })();

    return () => { cancelled = true; };
  }, [arrival]);

  const handleUserInput = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (phase === 'who') {
      sessionStorage.setItem(ASKED_KEY, '1');
      const user = getEffectiveUser() || auth.currentUser;

      setTurns(prev => [...prev, { role: 'user', content: trimmed }]);

      logEvent(EVENTS.WHO_PROVIDED, { source: 'conversational' });
      const updatedWho = { name: trimmed, source: 'stored', shouldAsk: false };
      setWho(updatedWho);

      if (user) {
        rememberName(user.uid, trimmed);
      }

      const intentPrompt = `Nice to meet you, ${trimmed}! What are you hoping to get done?`;
      setTurns(prev => [...prev, { role: 'assistant', content: intentPrompt }]);
      setPhase('intent');
      return;
    }

    if (phase === 'intent') {
      setTurns(prev => [...prev, { role: 'user', content: trimmed }]);
      setClassifying(true);
      setPhase('classifying');

      let classification;
      try {
        const user = getEffectiveUser() || auth.currentUser;
        const authToken = await user.getIdToken();
        logEvent(EVENTS.INTENT_CLASSIFICATION_ATTEMPTED);

        const res = await fetch('/.netlify/functions/barryMissionChat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            firstExperience: true,
            message: trimmed,
            knownName: whoRef.current?.name || null,
          }),
        });
        const data = res.ok ? await res.json() : null;
        classification = data?.classification
          ? normalizeClassification(data.classification)
          : unclearClassification('unclassified');
      } catch (err) {
        console.warn('[FirstExpCtrl] classification failed:', err.message);
        classification = unclearClassification('request-failed');
      }

      logEvent(EVENTS.INTENT_CLASSIFIED, {
        intent: classification.intent,
        confidence_band: classification.confidence >= 0.6 ? 'high' : 'low',
        has_secondary: Boolean(classification.secondaryIntent),
      });

      const [first, second] = orderCompound(classification.intent, classification.secondaryIntent);
      setHeld(second);
      const resolvedClassification = { ...classification, intent: first };
      setPending(resolvedClassification);
      const routed = routeIntent(resolvedClassification, readinessRef.current);

      if (routed.kind === ROUTE_CLARIFY) {
        logEvent(EVENTS.INTENT_CLARIFICATION_REQUESTED, { intent: first });
        setTurns(prev => [...prev, { role: 'assistant', content: routed.headline }]);
        setClassifying(false);
        setPhase('intent');
        return;
      }

      if (routed.kind === ROUTE_CONFIRM) {
        const confirmMsg = routed.headline + (routed.detail ? ` ${routed.detail}` : '');
        setTurns(prev => [...prev, {
          role: 'assistant',
          content: confirmMsg,
          _fePhase: 'confirm',
        }]);
        setDecision(routed);
        setClassifying(false);
        setPhase('confirm');
        return;
      }

      logEvent(EVENTS.FIRST_VALUE_BRANCH_SELECTED, { intent: first, branch: routed.kind });
      setDecision(routed);
      setClassifying(false);
      setPhase('handoff');
      return;
    }

    if (phase === 'confirm') {
      const lower = trimmed.toLowerCase();
      const affirmative = ['yes', 'yeah', 'yep', 'sure', 'correct', 'right', "that's it", 'thats it', 'exactly', 'y'];
      if (affirmative.some(a => lower.includes(a))) {
        confirmIntent();
      } else {
        rejectIntent();
      }
      setTurns(prev => [...prev, { role: 'user', content: trimmed }]);
      return;
    }
  }, [phase]);

  const skipName = useCallback(() => {
    sessionStorage.setItem(ASKED_KEY, '1');
    const name = whoRef.current?.name;
    const intentPrompt = name
      ? `No problem! So ${name}, what are you hoping to get done?`
      : `No problem! What are you hoping to get done?`;

    setTurns(prev => [...prev, { role: 'assistant', content: intentPrompt }]);
    setPhase('intent');
  }, []);

  function confirmIntent() {
    const settled = { ...pendingRef.current, needsConfirmation: false };
    setPending(settled);
    const routed = routeIntent(settled, readinessRef.current);
    logEvent(EVENTS.FIRST_VALUE_BRANCH_SELECTED, { intent: settled.intent, branch: routed.kind });
    setDecision(routed);
    setPhase('handoff');
  }

  function rejectIntent() {
    setPending(null);
    setDecision(null);
    setHeld(null);
    const retryPrompt = 'No problem — tell me more about what you\'re looking for.';
    setTurns(prev => [...prev, { role: 'assistant', content: retryPrompt }]);
    setPhase('intent');
  }

  const chooseIntent = useCallback((intent) => {
    setHeld(prev => (prev === intent ? null : prev));
    setPending({ intent, confidence: 1 });
    const routed = routeIntent({ intent, confidence: 1 }, readinessRef.current);
    logEvent(EVENTS.FIRST_VALUE_BRANCH_SELECTED, { intent, branch: routed.kind });
    setDecision(routed);
    setPhase('handoff');
  }, []);

  return {
    phase,
    turns,
    who,
    decision,
    classifying,
    pending,
    held,
    handleUserInput,
    skipName,
    chooseIntent,
  };
}
