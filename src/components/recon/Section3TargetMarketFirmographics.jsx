import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import './ReconEnterprise.css';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_3_QUESTIONS = [
  {
    id: "companySize",
    question: "Target company size (employees)",
    type: "multi-select",
    required: true,
    helpText: "Select all company sizes that fit your ideal customer profile",
    options: [
      "1-10",
      "11-50",
      "51-200",
      "201-500",
      "501-1000",
      "1000+"
    ]
  },
  {
    id: "revenueRange",
    question: "Target revenue range",
    type: "multi-select",
    required: true,
    helpText: "Select all revenue ranges that match your ideal customers",
    options: [
      "<$1M",
      "$1M-$5M",
      "$5M-$20M",
      "$20M-$50M",
      "$50M-$100M",
      "$100M+"
    ]
  },
  {
    id: "growthStage",
    question: "Company growth stage",
    type: "multi-select",
    required: true,
    helpText: "Which stages of company maturity are your best fit?",
    options: [
      "Seed/Early stage",
      "Series A-B",
      "Series C+",
      "Bootstrapped/Profitable",
      "Mature/Public",
      "Any stage"
    ]
  },
  {
    id: "geography",
    question: "Geographic focus",
    type: "multi-select",
    required: true,
    helpText: "Where are your ideal customers located?",
    options: [
      "Local (city/metro)",
      "Regional (state/province)",
      "Nationwide (US)",
      "North America",
      "Europe",
      "APAC",
      "Global"
    ]
  },
  {
    id: "targetIndustries",
    question: "Top 3 target industries",
    type: "multi-select",
    required: true,
    minSelections: 1,
    maxSelections: 3,
    helpText: "Select up to 3 industries where you have the best fit",
    options: [
      "Technology / SaaS",
      "Professional Services",
      "Financial Services",
      "Healthcare",
      "Manufacturing",
      "Retail / E-commerce",
      "Education",
      "Marketing / Advertising",
      "Real Estate",
      "Other"
    ]
  },
  {
    id: "avoidIndustries",
    question: "Industries to avoid",
    type: "text",
    required: false,
    helpText: "Any industries that are bad fit? (Optional)",
    placeholder: "e.g., Government, Non-profit, Hospitality"
  },
  {
    id: "companyType",
    question: "Company type",
    type: "radio",
    required: true,
    helpText: "What type of business model do your ideal customers have?",
    options: [
      "B2B",
      "B2C",
      "B2B2C",
      "Marketplace",
      "Platform",
      "Other"
    ]
  },
  {
    id: "budgetRange",
    question: "Typical budget range for solutions like yours",
    type: "dropdown",
    required: true,
    helpText: "What do your ideal customers typically spend on solutions like yours?",
    options: [
      "<$5K",
      "$5K-$25K",
      "$25K-$100K",
      "$100K-$500K",
      "$500K-$1M",
      "$1M+"
    ]
  },
  {
    id: "decisionSpeed",
    question: "Decision-making speed",
    type: "radio",
    required: true,
    helpText: "How quickly do your ideal customers typically make buying decisions?",
    options: [
      "Very fast (<1 week)",
      "Fast (1-4 weeks)",
      "Moderate (1-3 months)",
      "Slow (3-6 months)",
      "Very slow (6+ months)"
    ]
  },
  {
    id: "marketSize",
    question: "Estimated market size",
    helpText: "How many companies match your ideal criteria?",
    type: "radio",
    required: true,
    options: [
      "<100 companies",
      "100-500 companies",
      "500-2,000 companies",
      "2,000-10,000 companies",
      "10,000-50,000 companies",
      "50,000+ companies"
    ]
  }
];

export default function Section3TargetMarketFirmographics({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({
    companySize: [],
    revenueRange: [],
    growthStage: [],
    geography: [],
    targetIndustries: [],
    avoidIndustries: '',
    companyType: '',
    budgetRange: '',
    decisionSpeed: '',
    marketSize: ''
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
          if (data.section3Answers) {
            setAnswers(prev => ({ ...prev, ...data.section3Answers }));
          }
          
          // Load output if it exists
          if (data.section3Output) {
            setOutput(data.section3Output);
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
        section3Answers: answers,
        'reconProgress.section3LastSaved': new Date()
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
      
      const question = SECTION_3_QUESTIONS.find(q => q.id === field);
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
    
    SECTION_3_QUESTIONS.forEach(q => {
      if (q.required) {
        const value = answers[q.id];
        
        if (q.type === 'multi-select') {
          if (!value || value.length === 0) {
            errors[q.id] = `Please select at least one option for ${q.question}`;
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
    if (!validateAnswers()) {
      setError('Please complete all required fields');
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

      const response = await fetch('/.netlify/functions/generate-section-3', {
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
      setError(err.message || 'Failed to generate Firmographic Profile. Please try again.');
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
      case 'text':
        return (
          <div key={q.id} className="mb-4">
            <label className="block text-lg font-semibold mb-2 text-gray-900">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <input
              type="text"
              value={value || ''}
              onChange={(e) => handleInputChange(q.id, e.target.value)}
              placeholder={q.placeholder}
              className={`w-full bg-gray-50 border-2 ${hasError ? 'border-red-500' : 'border-gray-300/30'} rounded-xl p-4 text-gray-900 placeholder-cyan-700 focus:outline-none focus:border-gray-300 focus:ring-4 focus:ring-blue-400/20 transition-all`}
            />
            {hasError && <p className="text-red-400 text-sm mt-2">{hasError}</p>}
          </div>
        );

      case 'dropdown':
        return (
          <div key={q.id} className="mb-4">
            <label className="block text-lg font-semibold mb-2 text-gray-900">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <select
              value={value || ''}
              onChange={(e) => handleInputChange(q.id, e.target.value)}
              className={`w-full bg-gray-50 border-2 ${hasError ? 'border-red-500' : 'border-gray-300/30'} rounded-xl p-4 text-gray-900 focus:outline-none focus:border-gray-300 focus:ring-4 focus:ring-blue-400/20 transition-all`}
            >
              <option value="">-- Select --</option>
              {q.options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {hasError && <p className="text-red-400 text-sm mt-2">{hasError}</p>}
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

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-blue-600 text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-blue-600 mb-2">
            Section 3: Target Market Firmographics
          </h1>
          <p className="text-gray-400">
            Define the concrete attributes of your ideal customer companies
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
              {SECTION_3_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed text-lg"
              >
                {generating ? '🤖 Generating Firmographic Profile...' : '🎯 Generate Firmographic Profile'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-gray-300/50 rounded-xl p-4 mb-4">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                📊 Firmographic Profile
              </h2>
              
              {output && output.firmographicProfile && (
                <div className="space-y-4">
                  {/* Company Size */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Company Size Parameters</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Employee Ranges:</strong> {output.firmographicProfile.companySizeParameters.employees.ranges.join(', ')}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Primary Range:</strong> {output.firmographicProfile.companySizeParameters.employees.primary}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Rationale:</strong> {output.firmographicProfile.companySizeParameters.employees.rationale}
                    </p>
                    <p className="text-gray-300 mb-2 mt-4">
                      <strong>Revenue Ranges:</strong> {output.firmographicProfile.companySizeParameters.revenue.ranges.join(', ')}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Primary Range:</strong> {output.firmographicProfile.companySizeParameters.revenue.primary}
                    </p>
                    <p className="text-gray-300">
                      <strong>Rationale:</strong> {output.firmographicProfile.companySizeParameters.revenue.rationale}
                    </p>
                  </div>

                  {/* Market Size */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Market Size</h3>
                    <p className="text-gray-300 mb-2">
                      <strong>Your Estimate:</strong> {output.firmographicProfile.marketSize.userEstimate}
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>TAM (Total Addressable Market):</strong> {output.firmographicProfile.marketSize.tamEstimate.toLocaleString()} companies
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>SAM (Serviceable Market):</strong> {output.firmographicProfile.marketSize.samEstimate.toLocaleString()} companies
                    </p>
                    <p className="text-gray-300 mb-2">
                      <strong>Confidence:</strong> {output.firmographicProfile.marketSize.confidence}
                    </p>
                    <p className="text-gray-300">
                      <strong>Methodology:</strong> {output.firmographicProfile.marketSize.methodology}
                    </p>
                  </div>

                  {/* Firmographic Scoring */}
                  <div>
                    <h3 className="text-xl font-semibold text-blue-600 mb-2">Firmographic Scoring Algorithm</h3>
                    <div className="space-y-3">
                      {output.firmographicProfile.firmographicScoring.criteria.map((criterion, idx) => (
                        <div key={idx} className="bg-gray-50 p-4 rounded-lg">
                          <p className="text-gray-900 font-semibold mb-1">
                            {criterion.factor.toUpperCase()} ({criterion.weight}%)
                          </p>
                          <p className="text-gray-300 text-sm">{criterion.scoring}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-gray-300 mt-4">
                      <strong>Scoring Formula:</strong> {output.firmographicProfile.firmographicScoring.scoringFormula}
                    </p>
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
                onClick={() => navigate('/recon/section-4')}
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
