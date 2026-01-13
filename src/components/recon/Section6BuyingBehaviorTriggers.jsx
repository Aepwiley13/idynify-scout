import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import './ReconEnterprise.css';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_6_QUESTIONS = [
  {
    id: "startTriggers",
    question: "What events trigger them to start looking?",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 6,
    helpText: "Select all events that typically trigger them to start evaluating solutions",
    options: [
      "Raised funding (Series A/B/C)",
      "New hire (VP Sales, CRO, etc.)",
      "Poor quarterly results",
      "Regulatory/compliance requirements",
      "Crisis/urgent problem",
      "Competitor threat",
      "Leadership change",
      "Budget cycle (new fiscal year)",
      "Product launch",
      "Scaling/growth phase",
      "Team churn/attrition"
    ]
  },
  {
    id: "researchMethods",
    question: "How do they research solutions?",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 6,
    helpText: "Select all the ways they typically research and evaluate solutions",
    options: [
      "Google search",
      "Ask peers/network",
      "Read analyst reports (Gartner, Forrester)",
      "Watch product demos",
      "Read reviews (G2, Capterra)",
      "LinkedIn recommendations",
      "Industry conferences/events",
      "Vendor website",
      "Free trial/POC",
      "Case studies",
      "Sales outreach"
    ]
  },
  {
    id: "salesCycleLength",
    question: "Typical sales cycle length",
    type: "radio",
    required: true,
    helpText: "How long from first contact to closed deal?",
    options: [
      "< 1 week (instant decision)",
      "1-4 weeks (fast)",
      "1-3 months (moderate)",
      "3-6 months (slow)",
      "6+ months (very slow)"
    ]
  },
  {
    id: "bestBuyingTimes",
    question: "Best time of year to buy",
    type: "multi-select",
    required: true,
    minSelections: 1,
    maxSelections: 5,
    helpText: "When are they most likely to make purchasing decisions?",
    options: [
      "Q1 (January-March)",
      "Q2 (April-June)",
      "Q3 (July-September)",
      "Q4 (October-December)",
      "Start of fiscal year",
      "End of fiscal year",
      "Budget refresh periods",
      "Any time (no seasonality)"
    ]
  },
  {
    id: "avoidTimes",
    question: "Times to avoid",
    type: "multi-select",
    required: false,
    helpText: "When do deals typically stall or get delayed? (Optional)",
    options: [
      "Budget freeze periods",
      "Year-end holidays (Nov-Dec)",
      "Summer (June-August)",
      "End of quarter rush",
      "Tax season",
      "Conference season",
      "None - can close year-round"
    ]
  },
  {
    id: "linkedinSignals",
    question: "LinkedIn signals of readiness",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 6,
    helpText: "What LinkedIn activity indicates they're ready to buy?",
    options: [
      "Job changes (new VP/CRO hired)",
      "Hiring posts (recruiting for sales/ops)",
      "Funding announcements",
      "Company growth posts",
      "Problem/pain posts",
      "Thought leadership content",
      "Attending industry events",
      "Profile updates",
      "Following relevant vendors",
      "Engaging with solution content"
    ]
  },
  {
    id: "competitiveAlternatives",
    question: "What competitive alternatives do they consider?",
    type: "textarea",
    required: true,
    helpText: "What else are they evaluating when they're considering you?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Direct competitors (Outreach, Salesloft), indirect (Apollo, ZoomInfo), DIY (build internal tool), do nothing (manual process)..."
  },
  {
    id: "lastStepBeforeBuy",
    question: "What's the last step before they buy?",
    type: "multi-select",
    required: true,
    minSelections: 1,
    maxSelections: 4,
    helpText: "What do they need to see/do right before signing?",
    options: [
      "Free trial (hands-on testing)",
      "Live demo with their data",
      "Customer references/calls",
      "ROI analysis/business case",
      "Security/compliance review",
      "Legal review of contract",
      "Executive approval",
      "Proof of concept (POC)"
    ]
  },
  {
    id: "stallReasons",
    question: "What causes deals to stall?",
    type: "textarea",
    required: true,
    helpText: "What typically slows down or blocks deals?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Budget approval delays, champion leaves, too many stakeholders, seasonal slowdown, competing priorities..."
  },
  {
    id: "accelerators",
    question: "What accelerates decisions?",
    type: "textarea",
    required: true,
    helpText: "What makes deals close faster than usual?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Quarterly deadline pressure, executive sponsor, urgent pain, competitor using it, strong ROI, time-limited discount..."
  }
];

export default function Section6BuyingBehaviorTriggers({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState(initialData || {
    startTriggers: [],
    researchMethods: [],
    salesCycleLength: '',
    bestBuyingTimes: [],
    avoidTimes: [],
    linkedinSignals: [],
    competitiveAlternatives: '',
    lastStepBeforeBuy: [],
    stallReasons: '',
    accelerators: ''
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
      console.log("📥 Section 6 - Loading saved answers:", initialData);
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
        section6Answers: answers,
        'reconProgress.section6LastSaved': new Date()
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

  const handleMultiSelectToggle = (field, value) => {
    setAnswers(prev => {
      const currentValues = prev[field] || [];
      const isSelected = currentValues.includes(value);
      
      const question = SECTION_6_QUESTIONS.find(q => q.id === field);
      const maxSelections = question?.maxSelections || Infinity;
      
      if (isSelected) {
        return { ...prev, [field]: currentValues.filter(v => v !== value) };
      } else if (currentValues.length < maxSelections) {
        return { ...prev, [field]: [...currentValues, value] };
      }
      
      return prev;
    });

    // Clear validation error
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
    
    SECTION_6_QUESTIONS.forEach(q => {
      if (q.required) {
        const value = answers[q.id];
        
        if (q.type === 'multi-select') {
          if (!value || value.length === 0) {
            errors[q.id] = `Please select at least ${q.minSelections || 1} option(s)`;
          } else if (q.minSelections && value.length < q.minSelections) {
            errors[q.id] = `Please select at least ${q.minSelections} option(s)`;
          }
        } else if (q.type === 'textarea') {
          if (!value || value.trim() === '') {
            errors[q.id] = `${q.question} is required`;
          } else {
            if (q.validation?.minLength && value.length < q.validation.minLength) {
              errors[q.id] = `Must be at least ${q.validation.minLength} characters`;
            }
            if (q.validation?.maxLength && value.length > q.validation.maxLength) {
              errors[q.id] = `Must be less than ${q.validation.maxLength} characters`;
            }
          }
        } else if (!value || (typeof value === 'string' && value.trim() === '')) {
          errors[q.id] = `${q.question} is required`;
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

      const response = await fetch('/.netlify/functions/generate-section-6', {
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
      setError(err.message || 'Failed to generate Buying Behavior Profile. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleEditAnswers = () => {
    console.log("✏️ Section 6 - Editing answers - current state:", answers);
    setShowOutput(false);
  };

  const renderQuestion = (q) => {
    const value = answers[q.id];
    const hasError = validationErrors[q.id];

    switch (q.type) {
      case 'textarea':
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
                {(value || '').length}/{q.validation.minLength}-{q.validation.maxLength} characters
              </p>
            )}
          </div>
        );

      case 'radio':
        return (
          <div key={q.id} className="mb-4">
            <label className="block text-lg font-semibold mb-2 text-gray-900">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <div className="space-y-2">
              {q.options.map(opt => (
                <label key={opt} className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg hover:bg-cyan-950/30 transition-all">
                  <input
                    type="radio"
                    name={q.id}
                    value={opt}
                    checked={value === opt}
                    onChange={(e) => handleInputChange(q.id, e.target.value)}
                    className="w-5 h-5 text-blue-600 focus:ring-blue-400"
                  />
                  <span className="text-gray-900">{opt}</span>
                </label>
              ))}
            </div>
            {hasError && <p className="text-red-400 text-sm mt-2">{hasError}</p>}
          </div>
        );

      case 'multi-select':
        const selectedCount = (value || []).length;
        const maxSelections = q.maxSelections || Infinity;
        const minSelections = q.minSelections || 1;
        
        return (
          <div key={q.id} className="mb-4">
            <label className="block text-lg font-semibold mb-2 text-gray-900">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <p className="text-xs text-gray-500 mb-3">
              Selected: {selectedCount}
              {maxSelections !== Infinity && ` / ${maxSelections} max`}
              {minSelections > 1 && ` (min: ${minSelections})`}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {q.options.map(opt => {
                const isSelected = (value || []).includes(opt);
                const canSelect = selectedCount < maxSelections || isSelected;
                
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleMultiSelectToggle(q.id, opt)}
                    disabled={!canSelect}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      isSelected
                        ? 'bg-cyan-500/20 border-gray-300 text-gray-900 font-semibold'
                        : canSelect
                        ? 'bg-cyan-950/30 border-gray-300/30 text-gray-300 hover:border-gray-300/50 hover:bg-gray-50'
                        : 'bg-white/30 border-gray-700/30 text-gray-600 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{opt}</span>
                      {isSelected && <span className="text-blue-600">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            {hasError && <p className="text-red-400 text-sm mt-2">{hasError}</p>}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-blue-600 mb-2">
            Section 6: Buying Behavior & Triggers
          </h1>
          <p className="text-gray-400">
            Understand when, why, and how your ideal customers make purchasing decisions
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
              {SECTION_6_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed text-lg"
              >
                {generating ? '🤖 Generating Buying Behavior Profile...' : '🎯 Generate Buying Behavior Profile'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-gray-300/50 rounded-xl p-4 mb-4">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                🛒 Buying Behavior Profile
              </h2>
              
              {output && output.buyingBehaviorProfile && (
                <div className="space-y-4">
                  {/* Hot Triggers */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Hot Triggers 🔥</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Trigger Strength:</strong> {output.buyingBehaviorProfile.hotTriggers.triggerStrength}
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300 ml-4">
                      {output.buyingBehaviorProfile.hotTriggers.eventBased.map((trigger, idx) => (
                        <li key={idx}>{trigger}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Sales Cycle Timeline */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Sales Cycle Timeline</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Average Duration:</strong> {output.buyingBehaviorProfile.salesCycleTimeline.averageDuration}
                    </p>
                    <div className="space-y-2 mt-3">
                      {output.buyingBehaviorProfile.salesCycleTimeline.stages.map((stage, idx) => (
                        <div key={idx} className="bg-gray-50 p-3 rounded-lg">
                          <p className="text-gray-900 font-semibold">{stage.stage} - {stage.duration}</p>
                          <p className="text-gray-300 text-sm">{stage.activities}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Seasonal Patterns */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Seasonal Patterns</h3>
                    <p className="text-gray-300 mb-2"><strong>Best Times:</strong></p>
                    <ul className="list-disc list-inside text-green-300 ml-4 mb-3">
                      {output.buyingBehaviorProfile.seasonalPatterns.bestTimes.map((time, idx) => (
                        <li key={idx}>✓ {time}</li>
                      ))}
                    </ul>
                    {output.buyingBehaviorProfile.seasonalPatterns.avoidTimes.length > 0 && (
                      <>
                        <p className="text-gray-300 mb-2"><strong>Avoid Times:</strong></p>
                        <ul className="list-disc list-inside text-red-300 ml-4">
                          {output.buyingBehaviorProfile.seasonalPatterns.avoidTimes.map((time, idx) => (
                            <li key={idx}>✗ {time}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>

                  {/* Readiness Signals */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">LinkedIn Readiness Signals</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Signal Reliability:</strong> {output.buyingBehaviorProfile.readinessSignals.signalReliability}
                    </p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300 ml-4">
                      {output.buyingBehaviorProfile.readinessSignals.linkedinSignals.map((signal, idx) => (
                        <li key={idx}>{signal}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Velocity Factors */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Velocity Factors</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-red-950/30 p-4 rounded-lg border border-red-500/30">
                        <p className="text-red-300 font-semibold mb-2">⚠️ Deal Stalls</p>
                        <ul className="list-disc list-inside text-gray-300 text-sm space-y-1">
                          {output.buyingBehaviorProfile.velocityFactors.stalls.commonBottlenecks.map((bottleneck, idx) => (
                            <li key={idx}>{bottleneck}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="bg-green-950/30 p-4 rounded-lg border border-green-500/30">
                        <p className="text-green-300 font-semibold mb-2">⚡ Accelerators</p>
                        <ul className="list-disc list-inside text-gray-300 text-sm space-y-1">
                          {output.buyingBehaviorProfile.velocityFactors.accelerators.speedDrivers.map((driver, idx) => (
                            <li key={idx}>{driver}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
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
                onClick={() => navigate('/recon/section-7')}
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
