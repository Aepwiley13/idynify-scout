import { useState, useEffect, useRef, Fragment, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Brain, ArrowRight, ArrowLeft, Check, RefreshCw } from 'lucide-react';
import BarryTyping from '../../components/onboarding/BarryTyping';
import TargetingProposal from '../../components/onboarding/TargetingProposal';
import { buildProposal, hasRetrievalConstraint, retrievalConstraints } from '../../utils/targetingProposal';
import { readWebsite, acceleratorQuestion } from '../../utils/websiteAccelerator';
import { logEvent, EVENTS } from '../../services/analytics';
import { resolveActiveIcp, isResolved } from '../../utils/resolveActiveIcp';
import { setActiveIcpProfile } from '../../utils/setActiveIcpProfile';
import { appendTurn } from '../../utils/barryCanonical';
import './BarryOnboarding.css';

const DEFAULT_WEIGHTS = {
  industry: 50,
  location: 25,
  employeeSize: 15,
  revenue: 10
};

/**
 * Build authoritative return greeting for Barry (Phase 2 + 3 requirement)
 * Deterministic template - no Claude involved
 */
function buildReturnGreeting(icpData) {
  // Build the "what Barry is doing" statement
  const strategyLine = icpData.lookalikeSeed?.name
    ? `I'm actively finding companies similar to ${icpData.lookalikeSeed.name}`
    : `I'm actively finding ${icpData.industries?.[0] || 'target'} companies`;

  // Build size/location context
  const sizeContext = icpData.companySizes?.length
    ? ` — ${icpData.companySizes[0]} employees`
    : '';

  const locationContext = icpData.isNationwide
    ? ' nationwide'
    : icpData.locations?.length
      ? ` in ${icpData.locations.slice(0, 2).join(' and ')}${icpData.locations.length > 2 ? ' and more' : ''}`
      : '';

  // Strategy explanation for lookalike
  const strategyExplanation = icpData.lookalikeSeed?.name
    ? `\n\nThis prioritizes real ${icpData.companyKeywords?.[0] || 'companies'} like ${icpData.lookalikeSeed.name}, not just broad ${icpData.industries?.[0] || 'industry'} matches.`
    : '';

  // Build context summary (Phase 3 requirement)
  const summaryLines = [
    `• Strategy: ${icpData.searchStrategy === 'lookalike' ? `Lookalike (${icpData.lookalikeSeed?.name})` : 'Industry filter'}`,
    `• Industry: ${icpData.industries?.join(', ') || 'Not set'}`,
    icpData.companySizes?.length ? `• Size: ${icpData.companySizes.join(', ')} employees` : null,
    icpData.isNationwide ? '• Location: Nationwide' : icpData.locations?.length ? `• Location: ${icpData.locations.join(', ')}` : null
  ].filter(Boolean);

  const contextSummary = `\n\nHere's what I'm working with:\n${summaryLines.join('\n')}`;

  // Weekend-aware refresh timing
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const refreshNote = isWeekend
    ? `\n\nAutomatic refresh resumes Monday. You can refresh leads manually anytime in Scout.`
    : '';

  // Final action prompt - declarative, not asking permission
  const actionPrompt = `\n\nWant to adjust anything, or should I keep going?`;

  return `${strategyLine}${sizeContext}${locationContext}.${strategyExplanation}${contextSummary}${refreshNote}${actionPrompt}`;
}

const BarryOnboarding = forwardRef(function BarryOnboarding({
  knownName = null,
  goal = null,
  embedded = false,
  onBarryMessage = null,
  onProcessing = null,
  onStepChange = null,
}, ref) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('welcome'); // welcome, asking, clarifying, confirming, saving
  const [userInput, setUserInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [extractedICP, setExtractedICP] = useState(null);
  const [existingICP, setExistingICP] = useState(null);
  const [barryMessage, setBarryMessage] = useState('');
  const [followUpCount, setFollowUpCount] = useState(0);
  const [error, setError] = useState(null);
  const [savedICP, setSavedICP] = useState(null); // populated when step === 'saving'
  const [siteUrl, setSiteUrl] = useState('');
  const [reading, setReading] = useState(null);
  const [readingSite, setReadingSite] = useState(false);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  function emitMessage(msg) { if (embedded && onBarryMessage) onBarryMessage(msg); }
  function emitStep(s) { if (embedded && onStepChange) onStepChange(s); }
  function emitProcessing(busy) { if (embedded && onProcessing) onProcessing(busy); }

  useImperativeHandle(ref, () => ({
    submit: (text) => handleSubmit(null, text),
  }));

  useEffect(() => {
    checkExistingICP();
  }, []);

  useEffect(() => {
    // Scroll to bottom when conversation updates
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationHistory]);

  useEffect(() => {
    if (!embedded && (step === 'asking' || step === 'clarifying') && inputRef.current) {
      inputRef.current.focus();
    }
    // Scroll to bottom when confirmation card or saving screen appears
    if (step === 'confirming' || step === 'saving') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [step]);

  useEffect(() => {
    if (embedded && onStepChange) onStepChange(step);
  }, [step, embedded, onStepChange]);

  useEffect(() => {
    if (embedded && onProcessing) onProcessing(isProcessing);
  }, [isProcessing, embedded, onProcessing]);

  const didEmitInitialRef = useRef(false);
  useEffect(() => {
    if (!loading && embedded && !didEmitInitialRef.current && barryMessage) {
      didEmitInitialRef.current = true;
      emitMessage(barryMessage);
    }
  }, [loading, embedded, barryMessage]);

  async function checkExistingICP() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check for existing ICP
      const profileDoc = await getDoc(
        doc(db, 'users', user.uid, 'companyProfile', 'current')
      );

      if (profileDoc.exists()) {
        const data = profileDoc.data();
        if (data.industries && data.industries.length > 0) {
          setExistingICP(data);
          // Build authoritative return greeting (Phase 2 requirement)
          const returnGreeting = buildReturnGreeting(data);
          setBarryMessage(returnGreeting);
        } else {
          setBarryMessage("I'm Barry. Your profile is started, but I don't have a target yet — tell me that once and Scout and Hunter will know who matters to you.\n\nWho are you hunting?");
        }
      } else {
        setBarryMessage(`${knownName ? `Good to meet you, ${knownName}. ` : ''}I'm Barry. I use the context you give IDYNIFY so Scout and Hunter know who matters to you — you only tell me once.\n\nWho are you hunting?`);
      }

      // Check for existing in-progress conversation
      const conversationDoc = await getDoc(
        doc(db, 'users', user.uid, 'barryConversations', 'icp')
      );

      let conversationRestored = false;

      if (conversationDoc.exists()) {
        const data = conversationDoc.data();
        console.log('[Barry] barryConversations/icp doc found. status:', data.status, 'messages:', data.messages?.length);
        if (data.status === 'in_progress' && data.messages?.length > 0) {
          // Resume conversation — restore all state BEFORE calling setLoading(false)
          conversationRestored = true;
          setConversationHistory(data.messages);
          setExtractedICP(data.extractedICP || null);
          setFollowUpCount(data.followUpCount || 0);
          // Gate 0 (P0-A): the persisted step already reflects the gated
          // decision (C0-1), so restoring it preserves the ambiguity
          // boundary. Legacy documents written before Gate 0 may carry
          // currentStep='confirming' with no isAmbiguous field. Without
          // proof that ambiguity was resolved, fail safe to 'clarifying' —
          // one extra clarification turn is preferable to allowing
          // potentially ambiguous targeting to become authoritative.
          let resumeStep = data.currentStep || 'asking';
          if (resumeStep === 'confirming' && data.isAmbiguous !== false) {
            resumeStep = 'clarifying';
          }
          setStep(resumeStep);
          if (data.extractedICP) {
            if (resumeStep === 'clarifying' && data.currentStep === 'confirming') {
              setBarryMessage("Welcome back. Let me confirm I have the right picture before we move forward.");
            } else if (data.isAmbiguous && resumeStep === 'clarifying') {
              setBarryMessage("Welcome back. I still need a bit of clarification before I can put together a targeting proposal.");
            } else {
              setBarryMessage('Welcome back. Let me show you where we left off.');
            }
          }
          console.log('[Barry] Conversation restored. step:', data.currentStep, 'isAmbiguous:', data.isAmbiguous, 'messages:', data.messages.length);
        } else {
          console.log('[Barry] Conversation doc exists but not resumable. status:', data.status);
        }
      } else {
        console.log('[Barry] No barryConversations/icp doc found for this user.');
      }

      setLoading(false);
      // Only default to 'asking' if no prior conversation was restored
      if (!conversationRestored) {
        setStep('asking');
      }
    } catch (error) {
      console.error('Error checking existing ICP:', error);
      setLoading(false);
      setStep('asking');
      setBarryMessage("I'm Barry. I use the context you give IDYNIFY so Scout and Hunter know who matters to you. Let's start there.\n\nWho are you hunting?");
    }
  }

  async function handleSubmit(e, externalText = null) {
    if (e) e.preventDefault();
    const input = (externalText || userInput).trim();
    if (!input || isProcessing) return;
    if (!externalText) setUserInput('');
    setIsProcessing(true);
    setError(null);

    // Add user message to history
    const newHistory = [
      ...conversationHistory,
      { role: 'user', content: input, timestamp: new Date().toISOString() }
    ];
    setConversationHistory(newHistory);

    try {
      const user = auth.currentUser;

      if (!embedded) {
        appendTurn(db, user.uid, { role: 'user', content: input, surface: 'onboarding' })
          .catch(err => console.warn('[BarryOnboarding] canonical append failed:', err.message));
      }

      const authToken = await user.getIdToken();

      const action = conversationHistory.length === 0 ? 'process_initial_input' : 'process_followup';

      const response = await fetch('/.netlify/functions/barryICPConversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          action,
          userInput: input,
          currentStep: step,
          conversationHistory: newHistory,
          existingICP,
          // Send current accumulated ICP state so backend enforcement checks
          // (hasPendingTitles, etc.) can see what was extracted in prior turns
          pendingICP: extractedICP
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to process input');
      }

      const { barryResponse, step: newStep } = data;

      // Update extracted ICP
      if (barryResponse.understood) {
        setExtractedICP(prev => ({
          ...prev,
          ...barryResponse.understood,
          confidenceScore: barryResponse.confidenceScore
        }));
      }

      // Generate Barry's response message
      let barryMsg = '';

      if (barryResponse.mappingExplanation) {
        barryMsg = barryResponse.mappingExplanation;
      }

      if (barryResponse.needsClarification || barryResponse.needsMoreInfo) {
        if (barryResponse.isAmbiguous && barryResponse.ambiguityDetails) {
          barryMsg += `\n\n${barryResponse.ambiguityDetails}`;
        }
        if (barryResponse.followUpQuestion) {
          barryMsg += `\n\n${barryResponse.followUpQuestion}`;
        }
        setFollowUpCount(prev => prev + 1);
      } else if (barryResponse.readyToConfirm || newStep === 'confirming') {
        barryMsg += "\n\nI have enough to get started. Let me show you what I understood.";
      }

      // Add Barry's response to history
      const updatedHistory = [
        ...newHistory,
        { role: 'barry', content: barryMsg, timestamp: new Date().toISOString() }
      ];
      setConversationHistory(updatedHistory);
      setBarryMessage(barryMsg);
      emitMessage(barryMsg);

      if (!embedded) {
        appendTurn(db, user.uid, { role: 'assistant', content: barryMsg, surface: 'onboarding' })
          .catch(err => console.warn('[BarryOnboarding] canonical append failed:', err.message));
      }

      // Determine the gated step — the step Barry actually allows the user
      // to enter. The backend may return newStep='confirming' while flagging
      // isAmbiguous; the gate prevents that from reaching the user or being
      // persisted. One authoritative progression: what we persist is what we
      // show.
      const merged = { ...extractedICP, ...barryResponse.understood };
      const isAmbiguous = Boolean(barryResponse.isAmbiguous);
      let gatedStep;
      if (!isAmbiguous && (newStep === 'confirming' || barryResponse.readyToConfirm || hasRetrievalConstraint(merged))) {
        const constraints = retrievalConstraints(merged);
        logEvent(EVENTS.TARGETING_PROPOSAL_CREATED, { constraint_count: constraints.length, constraint_types: constraints, website_contributed: Boolean(reading?.ok) });
        logEvent(EVENTS.TARGETING_CONFIRMATION_REQUESTED);
        gatedStep = 'confirming';
      } else {
        logEvent(EVENTS.TARGETING_CLARIFICATION_REQUESTED, { follow_up_count: followUpCount + 1, is_ambiguous: isAmbiguous });
        gatedStep = 'clarifying';
      }

      // Persist the gated step and ambiguity state. The persisted step must
      // represent the state Barry actually allowed the user to enter, so a
      // reload restores the same boundary. isAmbiguous is carried so resume
      // can distinguish "clarifying because ambiguous" from "clarifying
      // because not enough constraints."
      await saveConversationState(user.uid, updatedHistory, barryResponse.understood, gatedStep, isAmbiguous);
      setStep(gatedStep);

    } catch (error) {
      console.error('Error processing input:', error);
      // Barry-voiced error - preserve trust even when AI fails
      const barryErrorMsg = "Hit a snag processing that.\n\nTry again, or set your targets manually in Settings — I'll track them from there.";
      const errorHistory = [
        ...newHistory,
        { role: 'barry', content: barryErrorMsg, timestamp: new Date().toISOString() }
      ];
      setConversationHistory(errorHistory);
      setBarryMessage(barryErrorMsg);
      emitMessage(barryErrorMsg);

      if (!embedded) {
        const errUser = auth.currentUser;
        if (errUser) {
          appendTurn(db, errUser.uid, { role: 'assistant', content: barryErrorMsg, surface: 'onboarding' })
            .catch(() => {});
        }
      }
    } finally {
      setIsProcessing(false);
    }
  }

  /**
   * Barry reads the site and says what he found.
   *
   * What comes back is free text, so the two fields that describe who the user
   * sells to go through T-1. Whatever it can support becomes proposed
   * targeting; whatever it cannot is simply absent, and Barry asks one short
   * question about the business rather than showing the user a field that
   * failed to map. Nothing here is authoritative — this is a proposal, and the
   * confirmation event is still the only thing that makes targeting real.
   */
  async function analyzeSite(e) {
    e?.preventDefault?.();
    const url = siteUrl.trim();
    if (!url || readingSite) return;

    setReadingSite(true);
    setError(null);
    logEvent(EVENTS.WEBSITE_ANALYSIS_ATTEMPTED);

    let result;
    try {
      const user = auth.currentUser;
      const authToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/analyze-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, userId: user.uid, authToken }),
      });
      result = readWebsite(response.ok ? await response.json() : null);
    } catch (err) {
      console.warn('[BarryOnboarding] website read failed:', err.message);
      result = readWebsite(null);
    }

    setReading(result);
    setReadingSite(false);

    if (!result.ok) {
      logEvent(EVENTS.WEBSITE_ANALYSIS_FAILED, { reason: result.message ? 'unreadable' : 'request_failed' });
      const failMsg = `${result.message || "I couldn't get much from that site."}\n\nNo problem — tell me who you're trying to reach and I'll work from that.`;
      setBarryMessage(failMsg);
      emitMessage(failMsg);
      setStep('asking');
      return;
    }

    logEvent(EVENTS.WEBSITE_ANALYSIS_SUCCEEDED, { fields_read: result.proposed ? Object.keys(result.proposed).filter(k => result.proposed[k] != null && result.proposed[k] !== '').length : 0 });

    // What Barry learned becomes proposed targeting, exactly as if the user had
    // said it out loud. It is merged, not substituted: anything already
    // established in conversation wins.
    const prior = extractedICP || {};
    const next = {
      ...prior,
      industries: prior.industries?.length ? prior.industries : result.proposed.industries,
      companySizes: prior.companySizes?.length ? prior.companySizes : result.proposed.companySizes,
      locations: prior.locations?.length ? prior.locations : result.proposed.locations,
      isNationwide: Boolean(prior.isNationwide || result.proposed.isNationwide),
    };
    setExtractedICP(next);

    const normalizedCount = retrievalConstraints(next).length;
    if (normalizedCount > 0) {
      logEvent(EVENTS.WEBSITE_TARGETING_NORMALIZED, { constraint_count: normalizedCount, constraint_types: retrievalConstraints(next) });
    }

    const opener = [
      `I looked at ${result.companyName || 'your website'}.`,
      result.recognition,
    ].filter(Boolean).join(' ');

    if (hasRetrievalConstraint(next)) {
      const confirmMsg = `${opener}\n\nIs that still accurate?`;
      setBarryMessage(confirmMsg);
      emitMessage(confirmMsg);
      setStep('confirming');
    } else {
      const question = acceleratorQuestion(result) || "Who are you trying to reach?";
      const askMsg = `${opener}\n\n${question}`;
      setBarryMessage(askMsg);
      emitMessage(askMsg);
      setStep('asking');
    }
  }

  async function saveConversationState(userId, history, icp, currentStep, isAmbiguous) {
    try {
      await setDoc(
        doc(db, 'users', userId, 'barryConversations', 'icp'),
        {
          status: 'in_progress',
          currentStep,
          messages: history,
          extractedICP: icp,
          followUpCount,
          // Gate 0 (P0-A): persist unresolved ambiguity so a reload cannot
          // erase the fact that Barry is waiting for clarification. Cleared
          // on the next turn where isAmbiguous is false — it cannot become
          // stale authority because every backend response re-evaluates it.
          isAmbiguous: Boolean(isAmbiguous),
          startedAt: history[0]?.timestamp || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'barry_onboarding'
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Error saving conversation state:', error);
    }
  }

  async function handleConfirm() {
    if (!extractedICP) return;

    setStep('saving');
    setIsProcessing(true);
    const constraints = retrievalConstraints(extractedICP);
    logEvent(EVENTS.TARGETING_CONFIRMED, { constraint_count: constraints.length, constraint_types: constraints });

    try {
      const user = auth.currentUser;

      // Prepare ICP profile with lookalike strategy support
      const icpProfile = {
        industries: extractedICP.industries || [],
        companySizes: extractedICP.companySizes || [],
        revenueRanges: [],
        skipRevenue: true,
        locations: extractedICP.locations === 'nationwide' ? [] : (extractedICP.locations || []),
        isNationwide: extractedICP.locations === 'nationwide',
        targetTitles: extractedICP.targetTitles || [],
        // NEW: Lookalike strategy fields
        searchStrategy: extractedICP.searchStrategy || 'industry_only',
        lookalikeSeed: extractedICP.lookalikeSeed || null,
        companyKeywords: extractedICP.companyKeywords || [],
        foundedAgeRange: extractedICP.foundedAgeRange || null,
        // Standard fields
        scoringWeights: DEFAULT_WEIGHTS,
        updatedAt: new Date().toISOString(),
        source: 'barry_onboarding',
        barryConfidenceScore: extractedICP.confidenceScore || 0.8,
        managedByBarry: true
      };

      // Show confirmation screen before redirect
      setSavedICP(icpProfile);

      // ── The authorized ICP creation/confirmation event ────────────────────
      //
      // Onboarding does not create an ICP because onboarding ran. It creates
      // one because the user has just explicitly confirmed the targeting
      // definition Barry proposed — this function IS that confirmation. Only
      // the targeting fields above become ICP criteria; nothing else collected
      // during onboarding is reinterpreted as ICP intelligence.
      //
      // The authoritative icpProfiles document is written first. The bridge is
      // written afterward as a projection carrying that identity.
      const resolution = await resolveActiveIcp(user.uid);

      if (resolution.status === 'unresolved' && resolution.reason === 'read-failed') {
        // A transient read failure must not cause a duplicate ICP. It is not
        // evidence that the user has none.
        throw new Error('Could not confirm your existing target profile. Please try again.');
      }

      let icpId;
      if (isResolved(resolution)) {
        // An ICP already exists and is active — write through to it rather
        // than creating a second one.
        icpId = resolution.icpId;
        await setDoc(
          doc(db, 'users', user.uid, 'icpProfiles', icpId),
          { ...resolution.profile, ...icpProfile, isActive: true, status: 'active' },
          { merge: true }
        );
      } else {
        // 'no-profiles', or ICPs exist but none is active. Either way the user
        // has explicitly confirmed this definition, so it becomes a new ICP and
        // that confirmation activates it. No existing candidate is silently
        // promoted on their behalf.
        icpId = `icp_${Date.now()}`;
        await setDoc(doc(db, 'users', user.uid, 'icpProfiles', icpId), {
          ...icpProfile,
          name: 'My ICP',
          isActive: true,
          status: 'active',
          messaging: null,
          messagingProgress: 0,
          source: 'barry_onboarding_confirmed',
          createdAt: new Date().toISOString(),
        });
        await setActiveIcpProfile(user.uid, icpId);
      }

      // Projection of the ICP just confirmed, carrying its identity.
      await setDoc(
        doc(db, 'users', user.uid, 'companyProfile', 'current'),
        { ...icpProfile, icpId, icpIdSource: 'barry_onboarding_confirmed' }
      );

      // Update conversation as completed
      await setDoc(
        doc(db, 'users', user.uid, 'barryConversations', 'icp'),
        {
          status: 'completed',
          completedAt: new Date().toISOString(),
          confirmedICP: icpProfile
        },
        { merge: true }
      );

      // A search may only be called ICP-targeted when at least one retrieval
      // constraint derived from the ICP actually narrows the result set. The
      // rule itself now lives in targetingProposal.js, so the floor Barry
      // proposes against and the floor the search is gated on cannot drift
      // apart — and the field list behind it is unchanged: targetTitles do not
      // constrain a company search, revenue is never sent to Apollo, and
      // lookalikeSeed is received and logged by the query builder but never
      // becomes a query parameter.
      const canSearch = hasRetrievalConstraint(icpProfile);

      // Mark onboarding complete on the user doc and set Barry's initial
      // execution state so Mission Control can read where Barry is. The
      // search-companies function flips barryState to READY (or ERROR) once
      // the background search below resolves.
      await setDoc(
        doc(db, 'users', user.uid),
        {
          onboardingComplete: true,
          onboardingCompletedAt: serverTimestamp(),
          onboardingSource: 'barry_onboarding',
          barryState: canSearch ? 'SEARCHING' : 'NEEDS_TARGETING',
          companiesFoundCount: 0,
          hasSeenMCWelcome: false
        },
        { merge: true }
      );

      // Trigger immediate lead search in the background, carrying the identity
      // of the ICP the user just confirmed.
      if (canSearch) {
        logEvent(EVENTS.FIRST_DISCOVERY_STARTED, { constraint_count: retrievalConstraints(icpProfile).length });
        const authToken = await user.getIdToken();
        fetch('/.netlify/functions/search-companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            companyProfile: icpProfile,
            icpId
          })
        }).then(res => {
          if (!res.ok) throw new Error(`search failed (${res.status})`);
          return res.json();
        }).then(data => {
          const added = data.companiesAdded || 0;
          const band = added === 0 ? 'zero' : added <= 3 ? 'low' : 'meaningful';
          logEvent(EVENTS.FIRST_DISCOVERY_COMPLETED, { outcome: 'success', result_band: band });
          if (added > 0) {
            logEvent(EVENTS.FIRST_VALUE_DELIVERED, { intent: 'PROSPECTING', branch: 'in-place', result_band: band });
          }
        }).catch(err => {
          console.error('Background search failed:', err);
          logEvent(EVENTS.FIRST_DISCOVERY_COMPLETED, { outcome: 'error', result_band: 'zero' });
        });
      } else {
        console.warn('[BarryOnboarding] confirmed ICP carries no retrieval constraint — search not started');
      }

      // Build Barry's "work in progress" message
      const strategyContext = extractedICP.lookalikeSeed?.name
        ? `companies similar to ${extractedICP.lookalikeSeed.name}`
        : `${extractedICP.industries?.[0] || 'your target'} companies`;

      const locationContext = extractedICP.locations === 'nationwide' || !extractedICP.locations?.length
        ? 'nationwide'
        : `in ${extractedICP.locations.slice(0, 2).join(' and ')}`;

      const sizeContext = extractedICP.companySizes?.length
        ? ` (${extractedICP.companySizes[0]} employees)`
        : '';

      const finalMessage = `I'm finding ${strategyContext}${sizeContext} ${locationContext}.\n\nNew targets will appear in Scout shortly. You can also refresh leads manually anytime.`;

      const finalHistory = [
        ...conversationHistory,
        {
          role: 'barry',
          content: finalMessage,
          timestamp: new Date().toISOString()
        }
      ];
      setConversationHistory(finalHistory);
      emitMessage(finalMessage);

      if (!embedded) {
        appendTurn(db, user.uid, { role: 'assistant', content: finalMessage, surface: 'onboarding' })
          .catch(err => console.warn('[BarryOnboarding] canonical append failed:', err.message));
      }

      setTimeout(() => {
        navigate('/mission-control-v2');
      }, 2500);

    } catch (error) {
      console.error('Error saving ICP:', error);
      setError('Failed to save your ICP. Please try again.');
      setStep('confirming');
    } finally {
      setIsProcessing(false);
    }
  }

  function handleRefine() {
    setStep('asking');
    const msg = "No problem. Tell me more about who you're hunting.";
    setBarryMessage(msg);
    emitMessage(msg);
  }

  if (loading && embedded) return null;

  if (loading) {
    return (
      <div className="barry-onboarding-loading">
        <div className="loading-content">
          <Brain className="w-12 h-12 text-purple-600 animate-pulse" />
          <p>Loading Barry...</p>
        </div>
      </div>
    );
  }

  // Map internal step to onboarding progress
  const ONBOARDING_STEPS = [
    { key: 'define', label: 'Define ICP' },
    { key: 'confirm', label: 'Review' },
    { key: 'search', label: 'Find Targets' },
  ];
  const activeStepIndex = step === 'saving' ? 2 : step === 'confirming' ? 1 : 0;

  return (
    <div className="barry-onboarding">
      {/* Header: back button + progress — hidden in embedded mode */}
      {!embedded && <div className="barry-onboarding-header">
        <button
          className="barry-onboarding-back"
          onClick={() => navigate('/scout?tab=icp-settings')}
        >
          <ArrowLeft className="w-4 h-4" />
          ICP Settings
        </button>
        <div className="barry-onboarding-progress">
          {ONBOARDING_STEPS.map((s, i) => (
          <Fragment key={s.key}>
            <div className={`progress-step ${i < activeStepIndex ? 'completed' : i === activeStepIndex ? 'active' : ''}`}>
              <div className="progress-dot">
                {i < activeStepIndex ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
              </div>
              <span className="progress-label">{s.label}</span>
            </div>
            {i < ONBOARDING_STEPS.length - 1 && (
              <div className={`progress-connector ${i < activeStepIndex ? 'completed' : ''}`} />
            )}
          </Fragment>
        ))}
        </div>
      </div>}

      {/* Conversation Area */}
      <div className="barry-conversation">
        {/* Initial Barry Message — hidden in embedded mode */}
        {!embedded && conversationHistory.length === 0 && (
          <div className="barry-message-container">
            <div className="message-avatar">
              <Brain className="w-5 h-5 text-purple-600" />
            </div>
            <div className="barry-message">
              {barryMessage}
            </div>
          </div>
        )}

        {/* Conversation History — hidden in embedded mode */}
        {!embedded && conversationHistory.map((msg, idx) => (
          <div
            key={idx}
            className={`message-container ${msg.role === 'user' ? 'user-message-container' : 'barry-message-container'}`}
          >
            {msg.role === 'barry' && (
              <div className="message-avatar">
                <Brain className="w-5 h-5 text-purple-600" />
              </div>
            )}
            <div className={msg.role === 'user' ? 'user-message' : 'barry-message'}>
              {msg.content.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          </div>
        ))}

        {/* Processing Indicator — hidden in embedded mode (workspace has its own) */}
        {!embedded && isProcessing && step !== 'saving' && (
          <div className="barry-message-container">
            <div className="message-avatar">
              <Brain className="w-5 h-5 text-purple-600" />
            </div>
            <BarryTyping />
          </div>
        )}

        {/* Confirmation Card */}
        {step === 'confirming' && extractedICP && !isProcessing && (
          <div className="confirmation-section">
            <TargetingProposal
              proposal={buildProposal({
                icp: extractedICP,
                goal,
                name: knownName,
                website: reading?.ok
                  ? {
                      summary: reading.summary ? `Your site frames it as: ${reading.summary}` : null,
                      uncertain: [
                        ...(reading.lowConfidence ? ['There wasn\u2019t much on the site to go on, so this is a rough read.'] : []),
                        ...reading.dropped
                          .filter(d => d.field === 'industry')
                          .map(d => `I couldn\u2019t place \u201c${d.input}\u201d against anything I can search on, so I\u2019ve left it out.`),
                      ],
                    }
                  : null,
              })}
              onConfirm={handleConfirm}
              onRefine={handleRefine}
              onAnswer={handleRefine}
            />
          </div>
        )}

        {/* Save Confirmation Screen */}
        {step === 'saving' && savedICP && (
          <div className="save-confirmation-screen">
            <div className="save-confirmation-card">
              <div className="save-confirmation-header">
                <div className="save-check-icon">
                  <Check className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="save-confirmation-title">ICP Saved</h2>
                  <p className="save-confirmation-subtitle">Barry is now searching for your targets</p>
                </div>
              </div>

              <div className="save-confirmation-summary">
                {savedICP.lookalikeSeed?.name && (
                  <div className="save-summary-row save-summary-highlight">
                    <span className="save-summary-label">Search anchor</span>
                    <span className="save-summary-value">{savedICP.lookalikeSeed.name}</span>
                  </div>
                )}
                {savedICP.industries?.length > 0 && (
                  <div className="save-summary-row">
                    <span className="save-summary-label">Industries</span>
                    <span className="save-summary-value">{savedICP.industries.slice(0, 3).join(', ')}{savedICP.industries.length > 3 ? ` +${savedICP.industries.length - 3} more` : ''}</span>
                  </div>
                )}
                {savedICP.companySizes?.length > 0 && (
                  <div className="save-summary-row">
                    <span className="save-summary-label">Company size</span>
                    <span className="save-summary-value">{savedICP.companySizes.join(', ')} employees</span>
                  </div>
                )}
                <div className="save-summary-row">
                  <span className="save-summary-label">Location</span>
                  <span className="save-summary-value">
                    {savedICP.isNationwide ? 'Nationwide' : savedICP.locations?.slice(0, 3).join(', ') || 'Nationwide'}
                    {!savedICP.isNationwide && savedICP.locations?.length > 3 ? ` +${savedICP.locations.length - 3} more` : ''}
                  </span>
                </div>
                {savedICP.targetTitles?.length > 0 && (
                  <div className="save-summary-row">
                    <span className="save-summary-label">Target contacts</span>
                    <span className="save-summary-value">{savedICP.targetTitles.slice(0, 4).join(', ')}{savedICP.targetTitles.length > 4 ? ` +${savedICP.targetTitles.length - 4} more` : ''}</span>
                  </div>
                )}
              </div>

              <div className="save-searching-indicator">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Finding companies matching your ICP...</span>
              </div>

              <p className="save-redirect-note">Taking you to Daily Discoveries in a moment</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Optional accelerator — offered once, before the conversation starts.
          Skipping it is not a lesser path: everything it produces is reachable
          by typing a sentence instead. */}
      {step === 'asking' && conversationHistory.length === 0 && !reading && !isProcessing && (
        <form onSubmit={analyzeSite} className="barry-accelerator">
          <span className="barry-accelerator-label">
            Or give me your website and I&rsquo;ll do the reading.
          </span>
          <div className="barry-accelerator-row">
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="yourcompany.com"
              aria-label="Your website"
              className="barry-accelerator-input"
              disabled={readingSite}
            />
            <button type="submit" className="barry-accelerator-btn" disabled={!siteUrl.trim() || readingSite}>
              {readingSite ? 'Reading\u2026' : 'Have a look'}
            </button>
          </div>
        </form>
      )}

      {/* Input Area — hidden in embedded mode (workspace composer is authoritative) */}
      {!embedded && (step === 'asking' || step === 'clarifying') && !isProcessing && (
        <form onSubmit={handleSubmit} className="barry-input-form">
          <div className="input-wrapper">
            <textarea
              ref={inputRef}
              value={userInput}
              onChange={(e) => {
                setUserInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (userInput.trim() && !isProcessing) {
                    handleSubmit(e);
                  }
                }
              }}
              placeholder={
                conversationHistory.length === 0
                  ? "e.g., Marketing agencies in California, 50-200 employees"
                  : "Type your response..."
              }
              className="barry-input"
              disabled={isProcessing}
              rows={1}
            />
            <button
              type="submit"
              disabled={!userInput.trim() || isProcessing}
              className="barry-submit"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
          {followUpCount > 0 && followUpCount < 3 && (
            <p className="input-hint">
              {3 - followUpCount} clarification{3 - followUpCount !== 1 ? 's' : ''} remaining
            </p>
          )}
        </form>
      )}
    </div>
  );
});

export default BarryOnboarding;
