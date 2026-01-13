import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import './ReconEnterprise.css';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_9_QUESTIONS = [
  {
    id: "emailTone",
    question: "Preferred email tone",
    type: "radio",
    required: true,
    helpText: "What tone resonates best with your audience?",
    options: [
      "Professional & formal",
      "Professional but friendly",
      "Conversational & casual",
      "Direct & to-the-point",
      "Consultative & educational"
    ]
  },
  {
    id: "emailLength",
    question: "Ideal email length",
    type: "radio",
    required: true,
    helpText: "What length gets best response from your audience?",
    options: [
      "Very short (2-3 sentences)",
      "Short (4-5 sentences)",
      "Medium (6-8 sentences)",
      "Long (9-12 sentences)",
      "Varies by sequence stage"
    ]
  },
  {
    id: "keyMessages",
    question: "Key messages to emphasize",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 5,
    helpText: "What do you most want prospects to understand?",
    options: [
      "Time savings / efficiency",
      "Revenue impact / growth",
      "Cost reduction / ROI",
      "Risk mitigation / security",
      "Ease of use / simplicity",
      "Speed to value / quick wins",
      "Innovation / competitive edge",
      "Team productivity / morale",
      "Scalability / future-proofing",
      "Data quality / insights"
    ]
  },
  {
    id: "callsToAction",
    question: "Primary calls to action",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 4,
    helpText: "What do you want prospects to do?",
    options: [
      "Book a demo",
      "Quick 15-min call",
      "Watch a video",
      "Try free trial",
      "Download resource",
      "Reply with interest",
      "Schedule discovery call",
      "Review case study"
    ]
  },
  {
    id: "meetingTypes",
    question: "Meeting types to offer",
    type: "multi-select",
    required: true,
    minSelections: 1,
    maxSelections: 3,
    helpText: "What meeting formats work best?",
    options: [
      "15-min intro call",
      "30-min discovery call",
      "45-min demo",
      "60-min deep dive",
      "Executive briefing",
      "Technical review"
    ]
  },
  {
    id: "socialProofEmphasis",
    question: "Social proof emphasis",
    type: "radio",
    required: true,
    helpText: "How much to emphasize customer stories and proof?",
    options: [
      "Very high (mention in every email)",
      "High (mention frequently)",
      "Moderate (mention occasionally)",
      "Low (minimal mentions)",
      "None (data-driven only)"
    ]
  },
  {
    id: "personalizationLevel",
    question: "Personalization approach",
    type: "radio",
    required: true,
    helpText: "How personalized should outreach be?",
    options: [
      "Highly personalized (research each prospect)",
      "Moderately personalized (company + role)",
      "Template-based with variables",
      "Mass outreach (minimal personalization)"
    ]
  },
  {
    id: "urgencyTactics",
    question: "Urgency creation approach",
    type: "radio",
    required: true,
    helpText: "How to create urgency without being pushy?",
    options: [
      "Strong (deadlines, scarcity)",
      "Moderate (timely relevance)",
      "Soft (natural urgency only)",
      "None (no urgency tactics)"
    ]
  }
];

export default function Section9Messaging({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState(initialData || {
    emailTone: '',
    emailLength: '',
    keyMessages: [],
    callsToAction: [],
    meetingTypes: [],
    socialProofEmphasis: '',
    personalizationLevel: '',
    urgencyTactics: ''
  });
  const [output, setOutput] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [lastSaved, setLastSaved] = useState(null);
  const [showOutput, setShowOutput] = useState(false);
  const [sectionsAvailable, setSectionsAvailable] = useState({
    section4: false,
    section5: false,
    section6: false,
    section7: false,
    section8: false
  });

  // Load existing data on mount
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      console.log("📥 Section 9 - Loading saved answers:", initialData);
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
        section9Answers: answers,
        'reconProgress.section9LastSaved': new Date()
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
      
      const question = SECTION_9_QUESTIONS.find(q => q.id === field);
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
    
    SECTION_9_QUESTIONS.forEach(q => {
      if (q.required) {
        const value = answers[q.id];
        
        if (q.type === 'multi-select') {
          if (!value || value.length === 0) {
            errors[q.id] = `Please select at least ${q.minSelections || 1} option(s)`;
          } else if (q.minSelections && value.length < q.minSelections) {
            errors[q.id] = `Please select at least ${q.minSelections} option(s)`;
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

      const response = await fetch('/.netlify/functions/generate-section-9', {
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
      setError(err.message || 'Failed to generate Messaging Framework. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleEditAnswers = () => {
    console.log("✏️ Section 9 - Editing answers - current state:", answers);
    setShowOutput(false);
  };

  const renderQuestion = (q) => {
    const value = answers[q.id];
    const hasError = validationErrors[q.id];

    switch (q.type) {
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
            Section 9: Messaging & Communication
          </h1>
          <p className="text-gray-400">
            Generate email sequences, value propositions, and objection handling using insights from previous sections
          </p>
          {lastSaved && (
            <p className="text-xs text-gray-500 mt-2">
              Last saved: {lastSaved.toLocaleTimeString()}
            </p>
          )}
          
          {/* Previous Sections Status */}
          <div className="mt-4 p-4 bg-cyan-950/30 rounded-lg border border-gray-300/30">
            <p className="text-sm text-gray-900 font-semibold mb-2">Data Available from Previous Sections:</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div className={`p-2 rounded ${sectionsAvailable.section4 ? 'bg-green-500/20 text-green-300' : 'bg-gray-700/20 text-gray-500'}`}>
                Section 4: {sectionsAvailable.section4 ? '✓' : '✗'}
              </div>
              <div className={`p-2 rounded ${sectionsAvailable.section5 ? 'bg-green-500/20 text-green-300' : 'bg-gray-700/20 text-gray-500'}`}>
                Section 5: {sectionsAvailable.section5 ? '✓' : '✗'}
              </div>
              <div className={`p-2 rounded ${sectionsAvailable.section6 ? 'bg-green-500/20 text-green-300' : 'bg-gray-700/20 text-gray-500'}`}>
                Section 6: {sectionsAvailable.section6 ? '✓' : '✗'}
              </div>
              <div className={`p-2 rounded ${sectionsAvailable.section7 ? 'bg-green-500/20 text-green-300' : 'bg-gray-700/20 text-gray-500'}`}>
                Section 7: {sectionsAvailable.section7 ? '✓' : '✗'}
              </div>
              <div className={`p-2 rounded ${sectionsAvailable.section8 ? 'bg-green-500/20 text-green-300' : 'bg-gray-700/20 text-gray-500'}`}>
                Section 8: {sectionsAvailable.section8 ? '✓' : '✗'}
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Messaging will use data from completed sections to generate personalized content
            </p>
          </div>
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
              {SECTION_9_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed text-lg"
              >
                {generating ? '🤖 Generating Messaging Framework...' : '📧 Generate Messaging Framework'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-gray-300/50 rounded-xl p-4 mb-4">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                📧 Messaging Framework
              </h2>
              
              {output && output.messagingFramework && (
                <div className="space-y-4">
                  {/* Email Sequences */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-3">5-Touch Cold Outreach Sequence</h3>
                    <div className="space-y-3">
                      {output.messagingFramework.emailSequences?.coldOutreach?.sequence?.map((touch, idx) => (
                        <div key={idx} className="bg-blue-950/30 p-4 rounded-lg border border-blue-500/30">
                          <p className="text-blue-300 font-semibold mb-2">
                            Touch {touch.touchNumber}: {touch.timing} - {touch.channel}
                          </p>
                          <p className="text-gray-900 text-sm font-semibold mb-1">
                            Subject: {touch.subjectLine}
                          </p>
                          <p className="text-gray-300 text-sm whitespace-pre-wrap mb-2">
                            {touch.body}
                          </p>
                          <p className="text-gray-400 text-xs">
                            <strong>CTA:</strong> {touch.cta}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Subject Lines */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Subject Line Library</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      {output.messagingFramework.subjectLines?.painFocused && (
                        <div className="bg-red-950/30 p-3 rounded-lg border border-red-500/30">
                          <p className="text-red-300 font-semibold mb-2 text-sm">🔥 Pain-Focused</p>
                          <ul className="space-y-1">
                            {output.messagingFramework.subjectLines.painFocused.slice(0, 3).map((subject, idx) => (
                              <li key={idx} className="text-gray-300 text-xs">• {subject}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {output.messagingFramework.subjectLines?.valueFocused && (
                        <div className="bg-green-950/30 p-3 rounded-lg border border-green-500/30">
                          <p className="text-green-300 font-semibold mb-2 text-sm">✨ Value-Focused</p>
                          <ul className="space-y-1">
                            {output.messagingFramework.subjectLines.valueFocused.slice(0, 3).map((subject, idx) => (
                              <li key={idx} className="text-gray-300 text-xs">• {subject}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Objection Handling */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Objection Handling Scripts</h3>
                    <div className="space-y-2">
                      {output.messagingFramework.objectionHandling?.priceObjection && (
                        <div className="bg-orange-950/30 p-3 rounded-lg border border-orange-500/30">
                          <p className="text-orange-300 font-semibold mb-1 text-sm">
                            💰 Price Objection
                          </p>
                          <p className="text-gray-300 text-xs mb-1">
                            <strong>Objection:</strong> {output.messagingFramework.objectionHandling.priceObjection.objection}
                          </p>
                          <p className="text-gray-300 text-xs">
                            <strong>Response:</strong> {output.messagingFramework.objectionHandling.priceObjection.response.substring(0, 150)}...
                          </p>
                        </div>
                      )}
                      {output.messagingFramework.objectionHandling?.statusQuoObjection && (
                        <div className="bg-purple-950/30 p-3 rounded-lg border border-purple-500/30">
                          <p className="text-purple-300 font-semibold mb-1 text-sm">
                            💤 Status Quo Objection
                          </p>
                          <p className="text-gray-300 text-xs mb-1">
                            <strong>Objection:</strong> {output.messagingFramework.objectionHandling.statusQuoObjection.objection}
                          </p>
                          <p className="text-gray-300 text-xs">
                            <strong>Response:</strong> {output.messagingFramework.objectionHandling.statusQuoObjection.response.substring(0, 150)}...
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Value Props */}
                  {output.messagingFramework.coreValueProps && output.messagingFramework.coreValueProps.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold text-blue-600 mb-2">Core Value Propositions</h3>
                      <div className="space-y-2">
                        {output.messagingFramework.coreValueProps.slice(0, 2).map((vp, idx) => (
                          <div key={idx} className="bg-gray-50 p-3 rounded-lg border-l-4 border-gray-300">
                            <p className="text-gray-900 font-semibold text-sm mb-1">
                              For: {vp.audience}
                            </p>
                            <p className="text-gray-300 text-xs">
                              {vp.valueProp}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                onClick={() => navigate('/recon/section-10')}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105"
              >
                Final Section →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
