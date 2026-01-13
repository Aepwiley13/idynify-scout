import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import './ReconEnterprise.css';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_5_QUESTIONS = [
  {
    id: "primaryPain",
    question: "Their #1 pain point (in their exact words)",
    type: "textarea",
    required: true,
    helpText: "What is the single biggest problem they're trying to solve? Use their language, not yours.",
    validation: { minLength: 100, maxLength: 400 },
    placeholder: "Describe their #1 pain in their exact words. What do they say when complaining about this problem?"
  },
  {
    id: "painCost",
    question: "How much does this pain cost them? (time, money, opportunity)",
    type: "textarea",
    required: true,
    helpText: "Quantify the cost - be specific with numbers if possible",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Wasting 15 hours/week on manual work ($60K/year in lost productivity), missing $500K in pipeline, losing 2 reps/year to burnout..."
  },
  {
    id: "triedBefore",
    question: "What have they tried before to solve it?",
    type: "textarea",
    required: true,
    helpText: "List previous solutions, tools, or approaches they've attempted",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Tried Salesforce, hired more reps, outsourced to agency, built internal tool, trained team on new process..."
  },
  {
    id: "whyFailed",
    question: "Why didn't those solutions work?",
    type: "textarea",
    required: true,
    helpText: "What went wrong with previous attempts?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Too complex, team didn't adopt it, data quality was poor, too expensive, took too long to implement..."
  },
  {
    id: "doNothing",
    question: "What happens if they do nothing?",
    type: "textarea",
    required: true,
    helpText: "What are the consequences of not solving this problem?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Miss revenue targets, lose to competitors, team burns out, can't scale, get blamed by CEO..."
  },
  {
    id: "urgentTrigger",
    question: "What triggers URGENT need to solve now?",
    type: "textarea",
    required: true,
    helpText: "What events or situations force immediate action?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Quarterly deadline approaching, CEO pressure, recent funding requires growth, competitor threat, team churn..."
  },
  {
    id: "successLooksLike",
    question: "What would success look like? (specific outcome)",
    type: "textarea",
    required: true,
    helpText: "Describe the specific, measurable outcome they want",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Double meetings booked, cut manual work by 75%, hit $1M pipeline from outbound, reduce SDR churn to <10%..."
  },
  {
    id: "workarounds",
    question: "How do they work around this today?",
    type: "textarea",
    required: true,
    helpText: "What are they currently doing to cope with the problem?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Working nights/weekends, hiring temps, ignoring non-urgent leads, using spreadsheets, manual copy-paste..."
  },
  {
    id: "whoElseFeels",
    question: "Who else in the company feels this pain?",
    type: "textarea",
    required: true,
    helpText: "Which other roles or departments are affected?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., CEO (worried about growth), CFO (ROI pressure), Sales reps (burnout), Marketing (lead waste), Ops (data cleanup)..."
  },
  {
    id: "churnReasons",
    question: "Why do customers churn or fail with your solution?",
    type: "textarea",
    required: false,
    helpText: "If you have existing customers, why do some leave or not get value? (Optional)",
    validation: { maxLength: 400 },
    placeholder: "e.g., Didn't integrate with CRM, team didn't adopt, data quality issues, too complex, needed more support..."
  }
];

export default function Section5PainPointsMotivations({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState(initialData || {
    primaryPain: '',
    painCost: '',
    triedBefore: '',
    whyFailed: '',
    doNothing: '',
    urgentTrigger: '',
    successLooksLike: '',
    workarounds: '',
    whoElseFeels: '',
    churnReasons: ''
  });
  const [output, setOutput] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [lastSaved, setLastSaved] = useState(null);
  const [showOutput, setShowOutput] = useState(false);

  // Load existing data on mount
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      console.log("📥 Section 5 - Loading saved answers:", initialData);
      setAnswers(initialData);
    }
  }, [initialData]);

  // Auto-save every 30 seconds
  useEffect(() => {
    const autoSave = setInterval(() => {
      saveAnswers();
    }, 30000);

    return () => clearInterval(autoSave);
  }, [answers]);

  const saveAnswers = async () => {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        section5Answers: answers,
        'reconProgress.section5LastSaved': new Date()
      });
      setLastSaved(new Date());
      if (onSave) onSave(answers);
    } catch (err) {
      console.error('Error saving answers:', err);
    }
  };

  const handleInputChange = (field, value) => {
    setAnswers(prev => ({ ...prev, [field]: value }));
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const validateAnswers = () => {
    const errors = {};
    
    SECTION_5_QUESTIONS.forEach(q => {
      if (q.required) {
        const value = answers[q.id];
        
        if (!value || value.trim() === '') {
          errors[q.id] = `${q.question} is required`;
        } else {
          // Check length validation
          if (q.validation?.minLength && value.length < q.validation.minLength) {
            errors[q.id] = `Must be at least ${q.validation.minLength} characters`;
          }
          if (q.validation?.maxLength && value.length > q.validation.maxLength) {
            errors[q.id] = `Must be less than ${q.validation.maxLength} characters`;
          }
        }
      }
    });
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleGenerate = async () => {
    // Save before generating
    await handleManualSave();
    if (!validateAnswers()) {
      setError('Please complete all required fields correctly');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      navigate('/login');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      // Save answers first
      await saveAnswers();

      // Get fresh auth token
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-section-5', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          answers,
          userId: user.uid,
          authToken  // Send token for server-side verification
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Generation failed');
      }

      setOutput(data.output);
      setShowOutput(true);

      if (onComplete) {
        onComplete(data.output);
      }

    } catch (err) {
      console.error('Generation error:', err);
      setError(err.message || 'Failed to generate Pain & Motivation Map. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleEditAnswers = () => {
    console.log("✏️ Section 5 - Editing answers - current state:", answers);
    setShowOutput(false);
  };

  const renderQuestion = (q) => {
    const value = answers[q.id];
    const hasError = validationErrors[q.id];

    return (
      <div key={q.id} className="mb-4">
        <label className="block text-lg font-semibold mb-2 text-gray-900">
          {q.question}{q.required && '*'}
        </label>
        {q.helpText && (
          <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
        )}
        <textarea
          value={value || ''}
          onChange={(e) => handleInputChange(q.id, e.target.value)}
          placeholder={q.placeholder}
          rows={4}
          className={`w-full bg-gray-50 border-2 ${hasError ? 'border-red-500' : 'border-gray-300/30'} rounded-xl p-4 text-gray-900 placeholder-cyan-700 focus:outline-none focus:border-gray-300 focus:ring-4 focus:ring-blue-400/20 transition-all font-sans resize-y`}
        />
        {hasError && <p className="text-red-400 text-sm mt-2">{hasError}</p>}
        {q.validation?.minLength && (
          <p className="text-xs text-gray-500 mt-1">
            {(value || '').length}/{q.validation.minLength}-{q.validation.maxLength || '∞'} characters
            {!q.required && ' (optional)'}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-blue-600 mb-2">
            Section 5: Pain Points & Motivations
          </h1>
          <p className="text-gray-400">
            Quantify the pain, urgency, and motivation driving your ideal customers to seek solutions
          </p>
          {lastSaved && (
            <p className="text-xs text-gray-500 mt-2">
              Last saved: {lastSaved.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border-2 border-red-500 rounded-xl">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Questions or Output */}
        {!showOutput ? (
          <>
            {/* Questions */}
            <div className="space-y-4">
              {SECTION_5_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed text-lg"
              >
                {generating ? '🤖 Generating Pain & Motivation Map...' : '🎯 Generate Pain & Motivation Map'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-gray-300/50 rounded-xl p-4 mb-4">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                💢 Pain & Motivation Map
              </h2>
              
              {output && output.painMotivationMap && (
                <div className="space-y-4">
                  {/* Primary Pain Point */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Primary Pain Point</h3>
                    <p className="text-gray-300 mb-2 italic">
                      "{output.painMotivationMap.primaryPainPoint.customerLanguage}"
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Severity:</strong> {output.painMotivationMap.primaryPainPoint.severity}/10
                    </p>
                    <p className="text-gray-300">
                      <strong>Frequency:</strong> {output.painMotivationMap.primaryPainPoint.frequency}
                    </p>
                  </div>

                  {/* Cost of Inaction */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Cost of Inaction</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Time Wasted:</strong> {output.painMotivationMap.costOfInaction.timeWasted}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Money Lost:</strong> {output.painMotivationMap.costOfInaction.moneyLost}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Opportunity Missed:</strong> {output.painMotivationMap.costOfInaction.opportunityMissed}
                    </p>
                    <p className="text-gray-900 font-bold text-lg mt-3">
                      💰 Total Annual Cost: {output.painMotivationMap.costOfInaction.totalCost}
                    </p>
                    <p className="text-green-400 mt-2">
                      <strong>Potential ROI:</strong> {output.painMotivationMap.costOfInaction.painROI}
                    </p>
                  </div>

                  {/* Failed Solution History */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Failed Solution History</h3>
                    <div className="space-y-3">
                      {output.painMotivationMap.failedSolutionHistory.attemptedSolutions.map((attempt, idx) => (
                        <div key={idx} className="bg-red-950/30 p-3 rounded-lg border border-red-500/30">
                          <p className="text-red-300 font-semibold mb-1">❌ {attempt.solution}</p>
                          <p className="text-gray-300 text-sm mb-1">
                            <strong>Why it failed:</strong> {attempt.failureReason}
                          </p>
                          <p className="text-gray-400 text-sm">
                            <strong>Lesson learned:</strong> {attempt.lessonLearned}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-gray-300 mt-3">
                      <strong>Skepticism Level:</strong> {output.painMotivationMap.failedSolutionHistory.skepticismLevel}
                    </p>
                  </div>

                  {/* Urgency Triggers */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Urgency Triggers</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Urgency Level:</strong> <span className="text-red-400 font-bold">{output.painMotivationMap.urgencyTriggers.urgencyLevel}</span>
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300 ml-4">
                      {output.painMotivationMap.urgencyTriggers.hotTriggers.map((trigger, idx) => (
                        <li key={idx} className="text-red-300">🔥 {trigger}</li>
                      ))}
                    </ul>
                    <p className="text-gray-300 mt-3">
                      <strong>Window:</strong> {output.painMotivationMap.urgencyTriggers.windowOfOpportunity}
                    </p>
                  </div>

                  {/* Success Vision */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Success Vision</h3>
                    <p className="text-gray-300 mb-3">{output.painMotivationMap.successVision.idealEndState}</p>
                    <p className="text-gray-300 mb-2"><strong>Key Metrics:</strong></p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300 ml-4">
                      {output.painMotivationMap.successVision.successMetrics.map((metric, idx) => (
                        <li key={idx}>{metric}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Pain Severity */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Pain Severity Assessment</h3>
                    <div className="flex items-center gap-4 mb-3">
                      <div className="text-4xl font-bold text-red-400">
                        {output.painMotivationMap.painSeverityScale.rating}/10
                      </div>
                      <div className="flex-1">
                        <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-yellow-500 via-orange-500 to-red-500"
                            style={{ width: `${output.painMotivationMap.painSeverityScale.rating * 10}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <p className="text-gray-300">{output.painMotivationMap.painSeverityScale.rationale}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4">
              <button
                onClick={handleEditAnswers}
                className="flex-1 bg-gray-50 hover:bg-gray-100 border-2 border-gray-300 text-gray-900 font-bold py-4 px-8 rounded-xl transition-all"
              >
                ✏️ Edit Answers
              </button>
              <button
                onClick={() => navigate('/recon/section-6')}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105"
              >
                Next Section →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
