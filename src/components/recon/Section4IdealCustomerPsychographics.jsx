import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_4_QUESTIONS = [
  {
    id: "nightFears",
    question: "What keeps them up at night?",
    type: "textarea",
    required: true,
    helpText: "What worries, stresses, or anxieties do they have?",
    validation: { minLength: 100, maxLength: 400 },
    placeholder: "Describe the main concerns, worries, or stresses your ideal customers deal with..."
  },
  {
    id: "goals",
    question: "What goals are they trying to achieve?",
    type: "textarea",
    required: true,
    helpText: "What are they working toward professionally?",
    validation: { minLength: 100, maxLength: 400 },
    placeholder: "Describe their professional objectives, targets, and aspirations..."
  },
  {
    id: "values",
    question: "What do they value most?",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 5,
    helpText: "Select 2-5 values that matter most to them",
    options: [
      "Speed / Quick results",
      "Quality / Excellence",
      "Cost savings / Efficiency",
      "Innovation / Being first",
      "Reliability / Consistency",
      "Simplicity / Ease of use",
      "Scalability / Growth",
      "Security / Risk mitigation",
      "Flexibility / Customization",
      "Support / Partnership"
    ]
  },
  {
    id: "commonPhrases",
    question: "Common phrases they use when describing problems",
    type: "textarea",
    required: true,
    helpText: "What exact words or phrases do they say repeatedly?",
    validation: { minLength: 50, maxLength: 300 },
    placeholder: "e.g., 'We're drowning in manual work', 'We can't scale fast enough', 'We're losing deals to faster competitors'..."
  },
  {
    id: "emotionalState",
    question: "Emotional state when seeking solutions",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 4,
    helpText: "How do they feel when they start looking for solutions?",
    options: [
      "Frustrated / Fed up",
      "Anxious / Stressed",
      "Hopeful / Optimistic",
      "Skeptical / Cautious",
      "Desperate / Urgent",
      "Curious / Exploratory",
      "Overwhelmed / Lost",
      "Determined / Focused",
      "Tired / Burned out",
      "Excited / Eager"
    ]
  },
  {
    id: "decisionFears",
    question: "What do they fear about making the wrong decision?",
    type: "textarea",
    required: true,
    helpText: "What concerns or risks worry them about choosing the wrong solution?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Wasting budget, looking bad to their boss, implementation taking too long, team not adopting it..."
  },
  {
    id: "changeAttitude",
    question: "Attitude toward change",
    type: "radio",
    required: true,
    helpText: "Where do they fall on the innovation adoption curve?",
    options: [
      "Early Adopter (loves trying new things)",
      "Early Majority (adopts after some validation)",
      "Late Majority (waits for proven solutions)",
      "Laggard (very resistant to change)",
      "Depends on the situation"
    ]
  },
  {
    id: "successMeasurement",
    question: "How do they measure success?",
    type: "textarea",
    required: true,
    helpText: "What metrics, outcomes, or results define success for them?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Revenue growth, time saved, conversion rates, team productivity, customer satisfaction..."
  },
  {
    id: "personalMotivators",
    question: "What motivates them personally?",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 5,
    helpText: "What drives them as individuals?",
    options: [
      "Career advancement",
      "Recognition / Status",
      "Job security",
      "Making an impact",
      "Financial reward",
      "Learning / Growth",
      "Work-life balance",
      "Helping their team",
      "Solving hard problems",
      "Building something new"
    ]
  },
  {
    id: "riskTolerance",
    question: "Risk tolerance",
    type: "radio",
    required: true,
    helpText: "How comfortable are they with risk?",
    options: [
      "Risk taker (bets big, moves fast)",
      "Calculated risk (data-driven decisions)",
      "Risk averse (plays it safe)",
      "Very conservative (avoids risk at all costs)"
    ]
  }
];

export default function Section4IdealCustomerPsychographics({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({
    nightFears: '',
    goals: '',
    values: [],
    commonPhrases: '',
    emotionalState: [],
    decisionFears: '',
    changeAttitude: '',
    successMeasurement: '',
    personalMotivators: [],
    riskTolerance: ''
  });
  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [lastSaved, setLastSaved] = useState(null);
  const [showOutput, setShowOutput] = useState(false);

  // Load existing data on mount
  useEffect(() => {
    const loadData = async () => {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      try {
        setLoading(true);
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        
        if (userDoc.exists()) {
          const data = userDoc.data();
          
          // Load answers if they exist
          if (data.section4Answers) {
            setAnswers(prev => ({ ...prev, ...data.section4Answers }));
          }
          
          // Load output if it exists
          if (data.section4Output) {
            setOutput(data.section4Output);
            setShowOutput(true);
          }
        }
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load saved data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

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
        section4Answers: answers,
        'reconProgress.section4LastSaved': new Date()
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
      
      const question = SECTION_4_QUESTIONS.find(q => q.id === field);
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
    
    SECTION_4_QUESTIONS.forEach(q => {
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

      const response = await fetch('/.netlify/functions/generate-section-4', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          answers,
          userId: user.uid
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
      setError(err.message || 'Failed to generate Psychographic Profile. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleEditAnswers = () => {
    setShowOutput(false);
  };

  const renderQuestion = (q) => {
    const value = answers[q.id];
    const hasError = validationErrors[q.id];

    switch (q.type) {
      case 'textarea':
        return (
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
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
              className={`w-full bg-cyan-950/50 border-2 ${hasError ? 'border-red-500' : 'border-cyan-500/30'} rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-sans resize-y`}
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
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
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
                    className="w-5 h-5 text-cyan-500 focus:ring-cyan-400"
                  />
                  <span className="text-white">{opt}</span>
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
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
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
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-semibold'
                        : canSelect
                        ? 'bg-cyan-950/30 border-cyan-500/30 text-gray-300 hover:border-cyan-400/50 hover:bg-cyan-950/50'
                        : 'bg-gray-900/30 border-gray-700/30 text-gray-600 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{opt}</span>
                      {isSelected && <span className="text-cyan-400">✓</span>}
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

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-400 text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-cyan-400 font-mono mb-2">
            Section 4: Ideal Customer Psychographics
          </h1>
          <p className="text-gray-400">
            Deep psychological profiling of your ideal customer's mindset, motivations, and behaviors
          </p>
          {lastSaved && (
            <p className="text-xs text-gray-500 mt-2">
              Last saved: {lastSaved.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border-2 border-red-500 rounded-xl">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Questions or Output */}
        {!showOutput ? (
          <>
            {/* Questions */}
            <div className="space-y-6">
              {SECTION_4_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed font-mono text-lg"
              >
                {generating ? '🤖 Generating Psychographic Profile...' : '🎯 Generate Psychographic Profile'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-cyan-500/50 rounded-xl p-6 mb-6">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4 font-mono">
                🧠 Psychographic Profile
              </h2>
              
              {output && output.psychographicProfile && (
                <div className="space-y-6">
                  {/* Pain Landscape */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Pain Landscape</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Night Fears:</strong> {output.psychographicProfile.painLandscape.nightFears}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>General Anxiety:</strong> {output.psychographicProfile.painLandscape.generalAnxiety}
                    </p>
                    <p className="text-gray-300">
                      <strong>Strategic Challenges:</strong> {output.psychographicProfile.painLandscape.strategicChallenges}
                    </p>
                  </div>

                  {/* Value System */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Value System</h3>
                    <div className="space-y-2">
                      {output.psychographicProfile.valueSystem.topValues.map((val, idx) => (
                        <div key={idx} className="bg-cyan-950/50 p-3 rounded-lg">
                          <p className="text-cyan-300 font-semibold">
                            {val.priority}. {val.value}
                          </p>
                          <p className="text-gray-300 text-sm mt-1">{val.implication}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-gray-300 mt-3">
                      <strong>Tradeoffs:</strong> {output.psychographicProfile.valueSystem.tradeoffs}
                    </p>
                  </div>

                  {/* Language Patterns */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Language Patterns</h3>
                    <p className="text-gray-300 mb-2"><strong>Exact Phrases:</strong></p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300 ml-4 mb-3">
                      {output.psychographicProfile.languagePatterns.exactPhrases.map((phrase, idx) => (
                        <li key={idx} className="italic">"{phrase}"</li>
                      ))}
                    </ul>
                    <p className="text-gray-300">
                      <strong>Pain Language:</strong> {output.psychographicProfile.languagePatterns.painLanguage}
                    </p>
                  </div>

                  {/* Change Readiness */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Change Readiness</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Adoption Curve:</strong> {output.psychographicProfile.changeReadiness.adoptionCurve}
                    </p>
                    <p className="text-gray-300">
                      <strong>Change Attitude:</strong> {output.psychographicProfile.changeReadiness.changeAttitude}
                    </p>
                  </div>

                  {/* Success Definition */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Success Definition</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Success Metrics:</strong> {output.psychographicProfile.successDefinition.successMetrics}
                    </p>
                    <p className="text-gray-300">
                      <strong>Timeframe:</strong> {output.psychographicProfile.successDefinition.timeframe}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4">
              <button
                onClick={handleEditAnswers}
                className="flex-1 bg-cyan-950/50 hover:bg-cyan-950/70 border-2 border-cyan-500 text-cyan-300 font-bold py-4 px-8 rounded-xl transition-all font-mono"
              >
                ✏️ Edit Answers
              </button>
              <button
                onClick={() => navigate('/recon/section-5')}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 font-mono"
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
