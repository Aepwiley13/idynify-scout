import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_2_QUESTIONS = [
  {
    id: "productName",
    question: "Product/service name",
    type: "text",
    required: true,
    validation: { minLength: 2, maxLength: 100 },
    placeholder: "e.g., Acme Marketing Automation"
  },
  {
    id: "category",
    question: "Product category",
    type: "dropdown",
    required: true,
    options: [
      "Software (SaaS, on-premise, mobile app)",
      "Professional Services (consulting, agency, freelance)",
      "Physical Product",
      "Platform/Marketplace",
      "Hybrid (product + services)",
      "Other"
    ],
    helpText: "What type of product or service do you offer?"
  },
  {
    id: "coreFeatures",
    question: "Top 5 core features",
    helpText: "List the 5 features your customers use most",
    type: "multi-text",
    required: true,
    count: 5,
    validation: { minLength: 30, maxLength: 100 },
    placeholder: "e.g., Email campaign builder with drag-and-drop interface"
  },
  {
    id: "differentiation",
    question: "What makes it different from competitors?",
    helpText: "Why do customers choose you over competitors?",
    type: "textarea",
    required: true,
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "Describe your unique value proposition and competitive advantages..."
  },
  {
    id: "useCases",
    question: "Primary use cases",
    helpText: "Select 2-4 main ways customers use your product",
    type: "multi-select",
    required: true,
    minSelections: 2,
    maxSelections: 4,
    options: [
      "Lead nurturing",
      "Customer onboarding",
      "Re-engagement campaigns",
      "Product education",
      "Upsell/cross-sell",
      "Retention/churn prevention",
      "Event promotion",
      "Content distribution",
      "Sales enablement",
      "Other (specify)"
    ]
  },
  {
    id: "implementationTime",
    question: "Implementation time",
    helpText: "How long does it take to get up and running?",
    type: "radio",
    required: true,
    options: [
      "Instant (self-serve, no setup)",
      "< 1 week",
      "1-4 weeks",
      "1-3 months",
      "3+ months"
    ]
  },
  {
    id: "supportLevel",
    question: "Training/support level required",
    helpText: "What level of support do customers need?",
    type: "radio",
    required: true,
    options: [
      "None (self-service)",
      "Minimal (videos, docs)",
      "Moderate (onboarding call)",
      "High (dedicated CSM, training)",
      "Very High (implementation team)"
    ]
  },
  {
    id: "pricingModel",
    question: "Pricing model",
    type: "dropdown",
    required: true,
    options: [
      "Per user/seat",
      "Flat monthly fee",
      "Usage-based",
      "Tiered pricing",
      "Enterprise/custom",
      "Other"
    ],
    helpText: "How do you charge customers?"
  },
  {
    id: "startingPrice",
    question: "Starting price",
    type: "text",
    required: true,
    placeholder: "$299/month",
    validation: { pattern: /^\$[\d,]+/ },
    helpText: "What's your entry-level price point?"
  },
  {
    id: "techStack",
    question: "What tech stack do ideal customers typically use?",
    helpText: "What tools/platforms do ideal customers already have?",
    type: "textarea",
    required: true,
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., They typically use Salesforce for CRM, Marketo for marketing automation, Slack for team communication..."
  },
  {
    id: "integrations",
    question: "Required integrations for success",
    helpText: "What integrations are essential? (Optional - list up to 5)",
    type: "multi-text",
    required: false,
    count: 5,
    placeholder: "e.g., Salesforce, HubSpot, Stripe"
  }
];

export default function Section2ProductDeepDive({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({
    productName: '',
    category: '',
    coreFeatures: ['', '', '', '', ''],
    differentiation: '',
    useCases: [],
    implementationTime: '',
    supportLevel: '',
    pricingModel: '',
    startingPrice: '',
    techStack: '',
    integrations: ['', '', '', '', '']
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
          if (data.section2Answers) {
            setAnswers(prev => ({ ...prev, ...data.section2Answers }));
          }
          
          // Load output if it exists
          if (data.section2Output) {
            setOutput(data.section2Output);
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
        section2Answers: answers,
        'reconProgress.section2LastSaved': new Date()
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

  const handleMultiTextChange = (field, index, value) => {
    setAnswers(prev => {
      const newArray = [...prev[field]];
      newArray[index] = value;
      return { ...prev, [field]: newArray };
    });
  };

  const handleMultiSelectToggle = (field, value) => {
    setAnswers(prev => {
      const currentValues = prev[field] || [];
      const isSelected = currentValues.includes(value);
      
      const question = SECTION_2_QUESTIONS.find(q => q.id === field);
      const maxSelections = question?.maxSelections || Infinity;
      
      if (isSelected) {
        return { ...prev, [field]: currentValues.filter(v => v !== value) };
      } else if (currentValues.length < maxSelections) {
        return { ...prev, [field]: [...currentValues, value] };
      }
      
      return prev;
    });
  };

  const validateAnswers = () => {
    const errors = {};
    
    SECTION_2_QUESTIONS.forEach(q => {
      if (q.required) {
        const value = answers[q.id];
        
        if (q.type === 'multi-text') {
          const filledCount = value.filter(v => v && v.trim().length > 0).length;
          if (filledCount === 0) {
            errors[q.id] = `Please provide at least one ${q.question.toLowerCase()}`;
          } else {
            // Check individual entries
            value.forEach((v, idx) => {
              if (v && v.trim().length > 0) {
                if (q.validation?.minLength && v.length < q.validation.minLength) {
                  errors[`${q.id}_${idx}`] = `Must be at least ${q.validation.minLength} characters`;
                }
                if (q.validation?.maxLength && v.length > q.validation.maxLength) {
                  errors[`${q.id}_${idx}`] = `Must be less than ${q.validation.maxLength} characters`;
                }
              }
            });
          }
        } else if (q.type === 'multi-select') {
          if (!value || value.length < (q.minSelections || 1)) {
            errors[q.id] = `Please select at least ${q.minSelections || 1} option(s)`;
          }
        } else if (!value || value.trim() === '') {
          errors[q.id] = `${q.question} is required`;
        } else {
          // Check length validation
          if (q.validation?.minLength && value.length < q.validation.minLength) {
            errors[q.id] = `Must be at least ${q.validation.minLength} characters`;
          }
          if (q.validation?.maxLength && value.length > q.validation.maxLength) {
            errors[q.id] = `Must be less than ${q.validation.maxLength} characters`;
          }
          // Check pattern validation
          if (q.validation?.pattern && !q.validation.pattern.test(value)) {
            errors[q.id] = `Invalid format`;
          }
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

      const response = await fetch('/.netlify/functions/generate-section-2', {
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
      setError(err.message || 'Failed to generate Product Intelligence Brief. Please try again.');
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
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
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
              className={`w-full bg-cyan-950/50 border-2 ${hasError ? 'border-red-500' : 'border-cyan-500/30'} rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono`}
            />
            {hasError && <p className="text-red-400 text-sm mt-2">{hasError}</p>}
            {q.validation?.maxLength && (
              <p className="text-xs text-gray-500 mt-1">
                {(value || '').length}/{q.validation.maxLength} characters
              </p>
            )}
          </div>
        );

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

      case 'dropdown':
        return (
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <select
              value={value || ''}
              onChange={(e) => handleInputChange(q.id, e.target.value)}
              className={`w-full bg-cyan-950/50 border-2 ${hasError ? 'border-red-500' : 'border-cyan-500/30'} rounded-xl p-4 text-white focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono`}
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
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <div className="space-y-2">
              {q.options.map(opt => (
                <label key={opt} className="flex items-center space-x-3 cursor-pointer">
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
        
        return (
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <p className="text-xs text-gray-500 mb-3">
              Selected: {selectedCount}/{maxSelections === Infinity ? '∞' : maxSelections}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {q.options.map(opt => {
                const isSelected = (value || []).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleMultiSelectToggle(q.id, opt)}
                    className={`p-3 rounded-lg border-2 transition-all text-left ${
                      isSelected
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                        : 'bg-cyan-950/30 border-cyan-500/30 text-gray-300 hover:border-cyan-400/50'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {hasError && <p className="text-red-400 text-sm mt-2">{hasError}</p>}
          </div>
        );

      case 'multi-text':
        return (
          <div key={q.id} className="mb-6">
            <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
              {q.question}{q.required && '*'}
            </label>
            {q.helpText && (
              <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
            )}
            <div className="space-y-3">
              {[...Array(q.count)].map((_, idx) => {
                const itemValue = value[idx] || '';
                const itemError = validationErrors[`${q.id}_${idx}`];
                return (
                  <div key={idx}>
                    <input
                      type="text"
                      value={itemValue}
                      onChange={(e) => handleMultiTextChange(q.id, idx, e.target.value)}
                      placeholder={`${q.placeholder || q.question} ${idx + 1}`}
                      className={`w-full bg-cyan-950/50 border-2 ${itemError ? 'border-red-500' : 'border-cyan-500/30'} rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono`}
                    />
                    {itemError && <p className="text-red-400 text-xs mt-1">{itemError}</p>}
                    {q.validation?.maxLength && itemValue && (
                      <p className="text-xs text-gray-500 mt-1">
                        {itemValue.length}/{q.validation.maxLength} characters
                      </p>
                    )}
                  </div>
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
            Section 2: Product/Service Deep Dive
          </h1>
          <p className="text-gray-400">
            Deep understanding of your product, features, use cases, and value delivery
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
              {SECTION_2_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed font-mono text-lg"
              >
                {generating ? '🤖 Generating Product Intelligence Brief...' : '🎯 Generate Product Intelligence Brief'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-cyan-500/50 rounded-xl p-6 mb-6">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4 font-mono">
                📊 Product Intelligence Brief
              </h2>
              
              {output && output.productIntelligence && (
                <div className="space-y-6">
                  {/* Product Profile */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Product Profile</h3>
                    <p className="text-gray-300 mb-2"><strong>Name:</strong> {output.productIntelligence.productProfile.name}</p>
                    <p className="text-gray-300 mb-2"><strong>Category:</strong> {output.productIntelligence.productProfile.category}</p>
                    <p className="text-gray-300 mb-2"><strong>Core Features:</strong></p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300 ml-4">
                      {output.productIntelligence.productProfile.coreFeatures.map((feature, idx) => (
                        <li key={idx}>{feature}</li>
                      ))}
                    </ul>
                    <p className="text-gray-300 mt-2"><strong>Feature Priority:</strong> {output.productIntelligence.productProfile.featurePriority}</p>
                  </div>

                  {/* Differentiation */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Differentiation</h3>
                    <p className="text-gray-300 mb-2"><strong>Unique Value:</strong> {output.productIntelligence.differentiation.uniqueValue}</p>
                    <p className="text-gray-300 mb-2"><strong>Competitive Advantage:</strong> {output.productIntelligence.differentiation.competitiveAdvantage}</p>
                    <p className="text-gray-300"><strong>Positioning:</strong> {output.productIntelligence.differentiation.positioning}</p>
                  </div>

                  {/* Sweet Spot Customer */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Sweet Spot Customer</h3>
                    <p className="text-gray-300 mb-2">{output.productIntelligence.sweetSpotCustomer.description}</p>
                    <ul className="list-disc list-inside space-y-1 text-gray-300 ml-4">
                      {output.productIntelligence.sweetSpotCustomer.characteristics.map((char, idx) => (
                        <li key={idx}>{char}</li>
                      ))}
                    </ul>
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
                onClick={() => navigate('/recon/section-3')}
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