import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, getDoc, setDoc, collection } from 'firebase/firestore';
import { Brain, ArrowRight, Check, RefreshCw } from 'lucide-react';
import BarryTyping from '../../components/onboarding/BarryTyping';
import ICPConfirmationCard from '../../components/onboarding/ICPConfirmationCard';
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

export default function BarryOnboarding() {
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
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    checkExistingICP();
  }, []);

  useEffect(() => {
    // Scroll to bottom when conversation updates
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationHistory]);

  useEffect(() => {
    // Focus input when step changes to asking or clarifying
    if ((step === 'asking' || step === 'clarifying') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

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
          setBarryMessage("I'm Barry. I power Scout and Hunter by learning who you're after — once — so every search and outreach hits the mark.\n\nWho are you hunting?");
        }
      } else {
        setBarryMessage("I'm Barry. I power Scout and Hunter by learning who you're after — once — so every search and outreach hits the mark.\n\nWho are you hunting?");
      }

      // Check for existing conversation
      const conversationDoc = await getDoc(
        doc(db, 'users', user.uid, 'barryConversations', 'icp')
      );

      if (conversationDoc.exists()) {
        const data = conversationDoc.data();
        if (data.status === 'in_progress' && data.messages?.length > 0) {
          // Resume conversation
          setConversationHistory(data.messages);
          setExtractedICP(data.extractedICP || null);
          setFollowUpCount(data.followUpCount || 0);
          setStep(data.currentStep || 'asking');
          if (data.extractedICP) {
            setBarryMessage('Welcome back. Let me show you where we left off.');
          }
        }
      }

      setLoading(false);
      setStep('asking');
    } catch (error) {
      console.error('Error checking existing ICP:', error);
      setLoading(false);
      setStep('asking');
      setBarryMessage("I'm Barry. I power Scout and Hunter by learning who you're after — once — so every search and outreach hits the mark.\n\nWho are you hunting?");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userInput.trim() || isProcessing) return;

    const input = userInput.trim();
    setUserInput('');
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
          existingICP
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

      // Save conversation state
      await saveConversationState(user.uid, updatedHistory, barryResponse.understood, newStep);

      // Update step
      if (newStep === 'confirming' || barryResponse.readyToConfirm) {
        setStep('confirming');
      } else {
        setStep('clarifying');
      }

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
    } finally {
      setIsProcessing(false);
    }
  }

  async function saveConversationState(userId, history, icp, currentStep) {
    try {
      await setDoc(
        doc(db, 'users', userId, 'barryConversations', 'icp'),
        {
          status: 'in_progress',
          currentStep,
          messages: history,
          extractedICP: icp,
          followUpCount,
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
        // Standard fields
        scoringWeights: DEFAULT_WEIGHTS,
        updatedAt: new Date().toISOString(),
        source: 'barry_onboarding',
        barryConfidenceScore: extractedICP.confidenceScore || 0.8,
        managedByBarry: true
      };

      // Save to companyProfile/current
      await setDoc(
        doc(db, 'users', user.uid, 'companyProfile', 'current'),
        icpProfile
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

      // Trigger immediate lead search in the background
      const authToken = await user.getIdToken();
      fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: icpProfile
        })
      }).catch(err => console.error('Background search failed:', err));

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

      // Navigate to Scout after a brief delay
      setTimeout(() => {
        navigate('/scout/daily-leads');
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
    setBarryMessage("No problem. Tell me more about who you're hunting.");
  }

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

  return (
    <div className="barry-onboarding">
      {/* Header */}
      <div className="barry-header">
        <div className="barry-avatar">
          <Brain className="w-6 h-6 text-purple-600" />
        </div>
        <div className="barry-header-text">
          <h1>Barry</h1>
          <p>ICP Intelligence</p>
        </div>
      </div>

      {/* Conversation Area */}
      <div className="barry-conversation">
        {/* Initial Barry Message */}
        {conversationHistory.length === 0 && (
          <div className="barry-message-container">
            <div className="message-avatar">
              <Brain className="w-5 h-5 text-purple-600" />
            </div>
            <div className="barry-message">
              {barryMessage}
            </div>
          </div>
        )}

        {/* Conversation History */}
        {conversationHistory.map((msg, idx) => (
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

        {/* Processing Indicator */}
        {isProcessing && step !== 'saving' && (
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
            <ICPConfirmationCard
              icp={extractedICP}
              onConfirm={handleConfirm}
              onRefine={handleRefine}
            />
          </div>
        )}

        {/* Saving State */}
        {step === 'saving' && (
          <div className="saving-section">
            <div className="saving-content">
              <RefreshCw className="w-6 h-6 text-purple-600 animate-spin" />
              <p>Saving your ICP...</p>
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

      {/* Input Area */}
      {(step === 'asking' || step === 'clarifying') && !isProcessing && (
        <form onSubmit={handleSubmit} className="barry-input-form">
          <div className="input-wrapper">
            <input
              ref={inputRef}
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={
                conversationHistory.length === 0
                  ? "e.g., Marketing agencies in California, 50-200 employees"
                  : "Type your response..."
              }
              className="barry-input"
              disabled={isProcessing}
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
}
