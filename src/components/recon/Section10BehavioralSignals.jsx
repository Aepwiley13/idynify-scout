import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import './ReconEnterprise.css';

const SECTION_10_QUESTIONS = [
  {
    id: "buyingTriggers",
    question: "What triggers your ideal customer to start looking for a solution like yours?",
    helpText: "e.g., Hit revenue milestone, raised funding, hired new VP, launched new product",
    type: "textarea",
    required: true,
    validation: { minLength: 100, maxLength: 500 }
  },
  {
    id: "timingIndicators",
    question: "What signals indicate they're ready to buy NOW vs. just researching?",
    helpText: "Observable behaviors that show purchase intent",
    type: "textarea",
    required: true,
    validation: { minLength: 100, maxLength: 500 }
  },
  {
    id: "buyingWindow",
    question: "What's the typical buying window once they start evaluating?",
    type: "radio",
    required: true,
    options: [
      "Less than 2 weeks",
      "2-4 weeks",
      "1-3 months",
      "3-6 months",
      "6+ months"
    ]
  },
  {
    id: "engagementPatterns",
    question: "How do ideal customers typically engage before buying?",
    helpText: "e.g., Download whitepapers, attend webinars, book demos, trial the product",
    type: "textarea",
    required: true,
    validation: { minLength: 100, maxLength: 500 }
  },
  {
    id: "contentConsumption",
    question: "What content do they consume during the buying journey?",
    helpText: "Case studies, product comparisons, ROI calculators, etc.",
    type: "textarea",
    required: false,
    validation: { maxLength: 500 }
  },
  {
    id: "seasonalPatterns",
    question: "Are there seasonal or cyclical buying patterns?",
    helpText: "e.g., Q4 budget planning, post-funding, start of fiscal year",
    type: "textarea",
    required: false,
    validation: { maxLength: 500 }
  }
];

export default function Section10BehavioralSignals({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({});
  const [output, setOutput] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [showOutput, setShowOutput] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setAnswers(initialData);
    }
  }, [initialData]);

  const saveAnswers = async () => {
    if (onSave) {
      await onSave(answers);
    }
  };

  const validateAnswers = () => {
    const errors = {};
    let isValid = true;

    SECTION_10_QUESTIONS.forEach(q => {
      if (q.required && (!answers[q.id] || answers[q.id].trim() === '')) {
        errors[q.id] = 'This field is required';
        isValid = false;
      }

      if (answers[q.id] && q.validation) {
        const value = answers[q.id];
        if (q.validation.minLength && value.length < q.validation.minLength) {
          errors[q.id] = `Minimum ${q.validation.minLength} characters required`;
          isValid = false;
        }
        if (q.validation.maxLength && value.length > q.validation.maxLength) {
          errors[q.id] = `Maximum ${q.validation.maxLength} characters allowed`;
          isValid = false;
        }
      }
    });

    setValidationErrors(errors);
    return isValid;
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
      await saveAnswers();

      // Get fresh auth token
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-section-10', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          answers,
          userId: user.uid,
          authToken
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Generation failed');
      }

      setOutput(data.output);
      setShowOutput(true);

      if (onComplete) {
        await onComplete(data.output);
      }

    } catch (err) {
      console.error('Generation error:', err);
      setError(err.message || 'Failed to generate Behavioral Signals Intelligence. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleInputChange = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));

    if (validationErrors[questionId]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[questionId];
        return newErrors;
      });
    }
  };

  const renderQuestion = (q) => {
    const value = answers[q.id] || '';
    const hasError = validationErrors[q.id];

    return (
      <div key={q.id} className="mb-4">
        <label className="block text-lg font-semibold mb-2 text-gray-900">
          {q.question}
          {q.required && <span className="text-red-400 ml-1">*</span>}
        </label>
        {q.helpText && (
          <p className="text-sm text-gray-400 mb-3">{q.helpText}</p>
        )}

        {q.type === 'textarea' && (
          <textarea
            value={value}
            onChange={(e) => handleInputChange(q.id, e.target.value)}
            className={`w-full bg-white/40 border ${
              hasError ? 'border-red-500' : 'border-gray-300/30'
            } rounded-lg p-4 text-gray-900 focus:border-gray-300 focus:outline-none transition-colors resize-none`}
            rows="4"
            placeholder="Enter your answer..."
          />
        )}

        {q.type === 'radio' && (
          <div className="space-y-2">
            {q.options.map(option => (
              <label key={option} className="flex items-center gap-3 p-3 bg-white/40 border border-gray-300/20 rounded-lg cursor-pointer hover:border-gray-300/40 transition-colors">
                <input
                  type="radio"
                  name={q.id}
                  value={option}
                  checked={value === option}
                  onChange={(e) => handleInputChange(q.id, e.target.value)}
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span className="text-gray-300 text-sm">{option}</span>
              </label>
            ))}
          </div>
        )}

        {hasError && (
          <p className="text-red-400 text-sm mt-2">⚠️ {hasError}</p>
        )}

        {q.validation?.maxLength && q.type === 'textarea' && (
          <p className={`text-xs mt-2 ${
            value.length > q.validation.maxLength
              ? 'text-red-400'
              : value.length > q.validation.maxLength * 0.9
              ? 'text-yellow-400'
              : 'text-gray-500'
          }`}>
            {value.length}/{q.validation.maxLength}
          </p>
        )}
      </div>
    );
  };

  if (showOutput && output) {
    return (
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-green-900/20 to-cyan-900/20 backdrop-blur-xl rounded-xl p-4 border border-green-500/30">
          <h3 className="text-xl font-bold text-green-400 mb-2">✅ SECTION 10 COMPLETE</h3>
          <p className="text-sm text-gray-400">Behavioral Signals Intelligence Generated</p>
        </div>

        <div className="bg-gradient-to-br from-purple-900/20 to-cyan-900/20 backdrop-blur-xl rounded-xl p-6 border border-gray-300/30">
          <h3 className="text-2xl font-bold text-blue-600 mb-4">📊 Behavioral & Timing Intelligence</h3>

          {output.executiveSummary && (
            <div className="space-y-4">
              <div>
                <h4 className="text-lg font-bold text-gray-900 mb-3">Overview</h4>
                <p className="text-gray-300 leading-relaxed">{output.executiveSummary.overview}</p>
              </div>

              <div>
                <h4 className="text-lg font-bold text-gray-900 mb-3">Key Findings</h4>
                <ul className="space-y-2">
                  {output.executiveSummary.keyFindings?.map((finding, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-gray-300">
                      <span className="text-blue-600 mt-1">▪</span>
                      <span>{finding}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="text-lg font-bold text-gray-900 mb-3">💡 Key Insight</h4>
                <p className="text-gray-700 text-lg italic">{output.executiveSummary.keyInsight}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => setShowOutput(false)}
            className="flex-1 bg-gray-700/50 hover:bg-gray-700 text-gray-900 font-bold py-4 px-6 rounded-xl transition-all border border-gray-500/30"
          >
            ✏️ EDIT ANSWERS
          </button>
          <button
            onClick={() => navigate('/mission-control-v2/recon')}
            className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-gray-900 font-bold py-4 px-6 rounded-xl transition-all shadow-lg shadow-green-500/50"
          >
            🎉 COMPLETE RECON MODULE →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-purple-900/20 to-cyan-900/20 backdrop-blur-xl rounded-xl p-4 border border-gray-300/30">
        <h3 className="text-xl font-bold text-gray-900 mb-4">Section 10: Behavioral & Timing Signals</h3>
        <p className="text-gray-300">
          Identify buying triggers, timing patterns, and engagement signals that indicate purchase readiness.
        </p>
      </div>

      <div className="space-y-4">
        {SECTION_10_QUESTIONS.map(renderQuestion)}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500 rounded-xl p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      <div className="flex gap-4">
        <button
          onClick={saveAnswers}
          className="flex-1 bg-purple-700/50 hover:bg-purple-700 text-gray-900 font-bold py-4 px-6 rounded-xl transition-all border border-purple-500/30"
        >
          💾 SAVE PROGRESS
        </button>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className={`flex-1 font-bold py-4 px-6 rounded-xl transition-all ${
            generating
              ? 'bg-gray-600 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 shadow-lg shadow-cyan-500/50'
          } text-gray-900`}
        >
          {generating ? '⏳ GENERATING...' : '🚀 GENERATE BEHAVIORAL INTELLIGENCE'}
        </button>
      </div>
    </div>
  );
}
