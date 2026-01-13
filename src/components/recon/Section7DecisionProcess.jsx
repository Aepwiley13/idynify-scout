import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import './ReconEnterprise.css';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_7_QUESTIONS = [
  {
    id: "economicBuyer",
    question: "Who is the Economic Buyer? (signs the contract, owns budget)",
    type: "radio",
    required: true,
    helpText: "Who has the authority to approve the purchase and allocate budget?",
    options: [
      "CEO / Founder",
      "CFO / Finance Leader",
      "CRO / Chief Revenue Officer",
      "VP Sales",
      "VP Marketing",
      "Head of Operations",
      "Department Head",
      "Other Executive"
    ]
  },
  {
    id: "champion",
    question: "Who is the Champion? (internal advocate, drives process)",
    type: "radio",
    required: true,
    helpText: "Who internally champions the solution and drives the buying process?",
    options: [
      "Same as Economic Buyer",
      "VP Sales",
      "Sales Operations Manager",
      "Marketing Operations Manager",
      "Sales Development Manager",
      "RevOps Leader",
      "Individual Contributor",
      "Other"
    ]
  },
  {
    id: "otherStakeholders",
    question: "Other stakeholders involved in decision",
    type: "multi-select",
    required: true,
    minSelections: 1,
    maxSelections: 6,
    helpText: "Who else needs to be involved or give approval?",
    options: [
      "IT / Security",
      "Legal / Compliance",
      "Procurement",
      "Finance Team",
      "End Users (SDRs/AEs)",
      "Marketing Team",
      "Sales Leadership",
      "Customer Success",
      "Data/Analytics Team",
      "No other stakeholders"
    ]
  },
  {
    id: "committeeDecision",
    question: "Is this a committee decision?",
    type: "radio",
    required: true,
    helpText: "Does this require consensus from multiple people or is it one person's call?",
    options: [
      "Single decision maker (one person decides)",
      "Small committee (2-3 people)",
      "Large committee (4-6 people)",
      "Very large committee (7+ people)"
    ]
  },
  {
    id: "approvalLevels",
    question: "How many approval levels?",
    type: "radio",
    required: true,
    helpText: "How many levels of approval are typically needed?",
    options: [
      "1 level (champion approves)",
      "2 levels (champion → manager)",
      "3 levels (champion → manager → executive)",
      "4+ levels (multiple layers)"
    ]
  },
  {
    id: "technicalEvaluation",
    question: "Who does technical/security evaluation?",
    type: "multi-select",
    required: true,
    minSelections: 1,
    maxSelections: 4,
    helpText: "Who evaluates technical fit, security, integration?",
    options: [
      "IT/Security team",
      "Sales Operations",
      "RevOps",
      "Engineering team",
      "No technical evaluation",
      "Champion handles it themselves"
    ]
  },
  {
    id: "userInput",
    question: "How much do end users influence the decision?",
    type: "radio",
    required: true,
    helpText: "How much weight do actual users (SDRs, AEs) have in the decision?",
    options: [
      "Very high (users can veto)",
      "High (users heavily influence)",
      "Moderate (users consulted)",
      "Low (users informed after)",
      "None (top-down decision)"
    ]
  },
  {
    id: "consensusOrTopDown",
    question: "Decision-making style",
    type: "radio",
    required: true,
    helpText: "How are decisions typically made in this organization?",
    options: [
      "Consensus-driven (everyone must agree)",
      "Collaborative (input sought, leader decides)",
      "Top-down (executive decides, team executes)",
      "Democratic (majority vote)",
      "Varies by situation"
    ]
  },
  {
    id: "procurementInvolved",
    question: "Is procurement/legal involved?",
    type: "radio",
    required: true,
    helpText: "Does this go through formal procurement or legal review?",
    options: [
      "Always (formal process)",
      "Usually (depends on deal size)",
      "Sometimes (for large deals only)",
      "Rarely (fast-track approvals)",
      "Never (direct to signature)"
    ]
  },
  {
    id: "decisionCriteria",
    question: "Key decision criteria (in priority order)",
    type: "textarea",
    required: true,
    helpText: "What factors matter most in the decision? List in priority order.",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., 1) ROI/cost savings, 2) Ease of use for team, 3) Integration with Salesforce, 4) Implementation time, 5) Vendor reputation..."
  }
];

export default function Section7DecisionProcess({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({
    economicBuyer: '',
    champion: '',
    otherStakeholders: [],
    committeeDecision: '',
    approvalLevels: '',
    technicalEvaluation: [],
    userInput: '',
    consensusOrTopDown: '',
    procurementInvolved: '',
    decisionCriteria: ''
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
          if (data.section7Answers) {
            setAnswers(prev => ({ ...prev, ...data.section7Answers }));
          }
          
          // Load output if it exists
          if (data.section7Output) {
            setOutput(data.section7Output);
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
        section7Answers: answers,
        'reconProgress.section7LastSaved': new Date()
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
      
      const question = SECTION_7_QUESTIONS.find(q => q.id === field);
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
    
    SECTION_7_QUESTIONS.forEach(q => {
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

      // Get fresh auth token
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-section-7', {
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
      setError(err.message || 'Failed to generate Decision Process Map. Please try again.');
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
            Section 7: Decision Process & Stakeholders
          </h1>
          <p className="text-gray-400">
            Map out who makes the buying decision, their roles, influence levels, and the approval workflow
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
              {SECTION_7_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed font-mono text-lg"
              >
                {generating ? '🤖 Generating Decision Process Map...' : '🎯 Generate Decision Process Map'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-cyan-500/50 rounded-xl p-6 mb-6">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4 font-mono">
                🎯 Decision Process Map
              </h2>
              
              {output && output.decisionProcessMap && (
                <div className="space-y-6">
                  {/* Stakeholder Map */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-3">Stakeholder Map</h3>
                    
                    {/* Economic Buyer */}
                    <div className="bg-green-950/30 p-4 rounded-lg border border-green-500/30 mb-3">
                      <p className="text-green-300 font-semibold mb-2">💰 Economic Buyer: {output.decisionProcessMap.stakeholderMap.economicBuyer.role}</p>
                      <p className="text-gray-300 text-sm mb-2">
                        <strong>Authority:</strong> {output.decisionProcessMap.stakeholderMap.economicBuyer.authority}
                      </p>
                      <p className="text-gray-300 text-sm">
                        <strong>Motivations:</strong> {output.decisionProcessMap.stakeholderMap.economicBuyer.motivations}
                      </p>
                    </div>

                    {/* Champion */}
                    <div className="bg-blue-950/30 p-4 rounded-lg border border-blue-500/30 mb-3">
                      <p className="text-blue-300 font-semibold mb-2">🏆 Champion: {output.decisionProcessMap.stakeholderMap.champion.role}</p>
                      <p className="text-gray-300 text-sm mb-2">
                        <strong>Influence:</strong> {output.decisionProcessMap.stakeholderMap.champion.influence}
                      </p>
                      <p className="text-gray-300 text-sm">
                        <strong>Support Needed:</strong> {output.decisionProcessMap.stakeholderMap.champion.support}
                      </p>
                    </div>
                  </div>

                  {/* Decision Complexity */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Decision Complexity</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Committee Size:</strong> {output.decisionProcessMap.decisionComplexity.committeeSize}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Approval Layers:</strong> {output.decisionProcessMap.decisionComplexity.approvalLayers}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Complexity:</strong> {output.decisionProcessMap.decisionComplexity.complexity}
                    </p>
                    <p className="text-cyan-300 font-bold">
                      ⏱️ Average Decision Time: {output.decisionProcessMap.decisionComplexity.averageDecisionTime}
                    </p>
                  </div>

                  {/* Approval Workflow */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Approval Workflow</h3>
                    <div className="space-y-3">
                      {output.decisionProcessMap.approvalWorkflow.stages.map((stage, idx) => (
                        <div key={idx} className="bg-cyan-950/50 p-4 rounded-lg border-l-4 border-cyan-400">
                          <p className="text-cyan-300 font-semibold mb-1">
                            Stage {stage.stage}: {stage.name} ({stage.duration})
                          </p>
                          <p className="text-gray-300 text-sm mb-2">{stage.activities}</p>
                          <p className="text-gray-400 text-sm">
                            <strong>Success:</strong> {stage.successCriteria}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Decision Criteria */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Decision Criteria (Ranked)</h3>
                    <div className="space-y-2">
                      {output.decisionProcessMap.decisionCriteria.rankedCriteria.map((criterion, idx) => (
                        <div key={idx} className="bg-purple-950/30 p-3 rounded-lg border border-purple-500/30">
                          <p className="text-purple-300 font-semibold">
                            #{criterion.rank}: {criterion.criterion}
                          </p>
                          <p className="text-gray-300 text-sm mt-1">
                            <strong>Weight:</strong> {criterion.weight} | <strong>Owner:</strong> {criterion.stakeholderOwner}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Multi-threading Strategy */}
                  {output.decisionProcessMap.sellingStrategy && (
                    <div>
                      <h3 className="text-xl font-semibold text-cyan-400 mb-2">Selling Strategy</h3>
                      <div className="bg-orange-950/30 p-4 rounded-lg border border-orange-500/30">
                        <p className="text-orange-300 font-semibold mb-2">
                          Multi-threading Required: {output.decisionProcessMap.sellingStrategy.multiThreading.required ? 'Yes' : 'No'}
                        </p>
                        <p className="text-gray-300 text-sm mb-2"><strong>Key Relationships:</strong></p>
                        <ul className="list-disc list-inside text-gray-300 text-sm space-y-1 ml-4">
                          {output.decisionProcessMap.sellingStrategy.multiThreading.keyRelationships.map((rel, idx) => (
                            <li key={idx}>{rel}</li>
                          ))}
                        </ul>
                        <p className="text-gray-300 text-sm mt-3">
                          <strong>Priority:</strong> {output.decisionProcessMap.sellingStrategy.multiThreading.priority}
                        </p>
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
                className="flex-1 bg-cyan-950/50 hover:bg-cyan-950/70 border-2 border-cyan-500 text-cyan-300 font-bold py-4 px-8 rounded-xl transition-all font-mono"
              >
                ✏️ Edit Answers
              </button>
              <button
                onClick={() => navigate('/recon/section-8')}
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
