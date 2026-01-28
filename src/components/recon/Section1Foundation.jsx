import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import ReconTooltip from './ReconTooltip';
import './ReconEnterprise.css';

const SECTION_1_QUESTIONS = [
  {
    id: "companyName",
    question: "Company name",
    type: "text",
    required: true,
    validation: { minLength: 2, maxLength: 500 },
    barryContext: "Identify your company in every context generation and conversation starter."
  },
  {
    id: "whatYouDo",
    question: "What does your company do?",
    helpText: "In plain English, what does your company do? (Imagine explaining to a friend)",
    type: "textarea",
    required: true,
    validation: { minLength: 50, maxLength: 500 },
    barryContext: "Understand your business so context generation is relevant to your industry and offering — not generic."
  },
  {
    id: "industry",
    question: "Primary industry/sector",
    type: "dropdown",
    required: true,
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
    ],
    barryContext: "Match prospects by industry relevance and tailor conversation starters to your sector."
  },
  {
    id: "stage",
    question: "Company stage",
    type: "radio",
    required: true,
    options: [
      "Pre-revenue / Startup (0-1 years)",
      "Early stage (1-3 years, <$1M revenue)",
      "Growth stage ($1M-$10M revenue)",
      "Established ($10M-$50M revenue)",
      "Enterprise ($50M+ revenue)"
    ],
    barryContext: "Calibrate language and recommendations to your company's maturity level."
  },
  {
    id: "role",
    question: "Your role/title",
    type: "text",
    required: true,
    validation: { minLength: 2, maxLength: 500 },
    barryContext: "Frame context from your perspective — what a VP Sales needs is different from what a founder needs."
  },
  {
    id: "mainProduct",
    question: "Main product/service",
    helpText: "What is the ONE thing you sell that generates the most revenue?",
    type: "textarea",
    required: true,
    validation: { minLength: 50, maxLength: 500 },
    barryContext: "Understand what you're selling so conversation starters subtly align with prospect needs, without being salesy."
  },
  {
    id: "problemSolved",
    question: "What problem does it solve?",
    helpText: "In your customers' words, what problem were they trying to solve when they found you?",
    type: "textarea",
    required: true,
    validation: { minLength: 50, maxLength: 500 },
    barryContext: "Identify when a prospect's challenges overlap with the problems you solve — the core of relevance."
  },
  {
    id: "currentCustomers",
    question: "Who do you sell to today?",
    helpText: "Describe your current customers. What do they have in common?",
    type: "textarea",
    required: true,
    validation: { minLength: 100, maxLength: 500 },
    barryContext: "Assess whether new prospects look like your existing customer base — pattern matching for lead quality."
  },
  {
    id: "ninetyDayGoal",
    question: "What's your 90-day goal?",
    type: "textarea",
    required: false,
    validation: { maxLength: 500 },
    barryContext: "Prioritize context that's relevant to your current business objective, not just general intelligence."
  },
  {
    id: "biggestChallenge",
    question: "What's your biggest sales challenge right now?",
    type: "textarea",
    required: false,
    validation: { maxLength: 500 },
    barryContext: "Surface insights that directly address your current challenge when generating prospect context."
  }
];

export default function Section1Foundation({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState(initialData || {});
  const [output, setOutput] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [showOutput, setShowOutput] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Initialize answers from initialData
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        if (initialData && Object.keys(initialData).length > 0) {
          console.log('📥 Loading saved answers:', initialData);
          setAnswers(initialData);
          setHasUnsavedChanges(false);
        }

        // Check for saved output
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists() && userDoc.data().section1Output) {
          setOutput(userDoc.data().section1Output);
          setShowOutput(true);
        }
      } catch (error) {
        console.error('Error loading saved data:', error);
      }
    };

    loadSavedData();
  }, [initialData]);

  // Auto-save functionality
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const autoSaveTimer = setTimeout(() => {
      console.log('💾 Auto-saving progress...');
      handleManualSave();
    }, 30000);

    return () => clearTimeout(autoSaveTimer);
  }, [answers, hasUnsavedChanges]);

  const handleManualSave = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        alert('❌ You must be logged in to save');
        return;
      }

      setSaving(true);

      if (onSave) {
        await onSave(answers);
      } else {
        await updateDoc(doc(db, 'users', user.uid), {
          section1Answers: answers,
          'section1Answers.lastSaved': new Date()
        });
      }

      setHasUnsavedChanges(false);
      console.log('✅ Progress saved');
    } catch (error) {
      console.error('Save error:', error);
      alert('❌ Failed to save progress. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const validateField = (question, value) => {
    const validationErrors = [];

    if (question.required && (!value || value.trim() === '')) {
      validationErrors.push('This field is required');
    }

    if (value && question.validation) {
      const { minLength, maxLength } = question.validation;

      if (minLength && value.length < minLength) {
        validationErrors.push(`Minimum ${minLength} characters required`);
      }

      if (maxLength && value.length > maxLength) {
        validationErrors.push(`Maximum ${maxLength} characters allowed`);
      }
    }

    return validationErrors;
  };

  const validateAllFields = () => {
    const newErrors = {};
    let isValid = true;

    SECTION_1_QUESTIONS.forEach(question => {
      const fieldErrors = validateField(question, answers[question.id]);
      if (fieldErrors.length > 0) {
        newErrors[question.id] = fieldErrors;
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleInputChange = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));

    setHasUnsavedChanges(true);

    if (errors[questionId]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[questionId];
        return newErrors;
      });
    }
  };

  const getCompletedCount = () => {
    return SECTION_1_QUESTIONS.filter(q => answers[q.id] && answers[q.id].trim() !== '').length;
  };

  const handleGenerate = async () => {
    if (!validateAllFields()) {
      alert('⚠️ Please fix all validation errors before generating');
      return;
    }

    // Save before generating
    await handleManualSave();

    setGenerating(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User not authenticated');

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/generate-section-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          userId: user.uid,
          authToken
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Generation failed');
      }

      const data = await response.json();

      if (data.success) {
        setOutput(data.output);
        setShowOutput(true);

        if (onComplete) {
          await onComplete(data.output);
        } else {
          await updateDoc(doc(db, 'users', user.uid), {
            section1Output: data.output,
            'reconProgress.currentSection': 1,
            'reconProgress.section1Completed': true,
            'reconProgress.lastUpdated': new Date()
          });
        }
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Generation error:', error);
      alert(`❌ Generation failed: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleEditAnswers = () => {
    console.log('✏️ Editing answers - current state:', answers);
    setShowOutput(false);
  };

  const handleNextSection = () => {
    navigate('/mission-control-v2/recon');
  };

  const handleMissionControl = () => {
    navigate('/mission-control-v2');
  };

  const renderQuestion = (question, index) => {
    const value = answers[question.id] || '';
    const fieldErrors = errors[question.id] || [];
    const hasError = fieldErrors.length > 0;

    return (
      <div key={question.id} className="recon-form-group">
        <label>
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <span className="recon-form-label">
                {index + 1}. {question.question}
                {question.required && <span className="recon-form-required">*</span>}
                {question.barryContext && (
                  <ReconTooltip
                    text={question.helpText ? null : 'This field trains Barry\'s understanding of your business.'}
                    barryUses={question.barryContext}
                  />
                )}
              </span>
              {question.helpText && (
                <p className="recon-form-help">{question.helpText}</p>
              )}
            </div>
            {question.type === 'textarea' && question.validation?.maxLength && (
              <span className={`recon-char-count ml-4 ${
                value.length > question.validation.maxLength
                  ? 'error'
                  : value.length > question.validation.maxLength * 0.9
                  ? 'warning'
                  : ''
              }`}>
                {value.length}/{question.validation.maxLength}
              </span>
            )}
          </div>

          {question.type === 'text' && (
            <input
              type="text"
              value={value}
              onChange={(e) => handleInputChange(question.id, e.target.value)}
              className={`recon-form-input ${hasError ? 'error' : ''}`}
              placeholder="Enter your answer..."
            />
          )}

          {question.type === 'textarea' && (
            <textarea
              value={value}
              onChange={(e) => handleInputChange(question.id, e.target.value)}
              className={`recon-form-textarea ${hasError ? 'error' : ''}`}
              rows="4"
              placeholder="Enter your answer..."
            />
          )}

          {question.type === 'dropdown' && (
            <select
              value={value}
              onChange={(e) => handleInputChange(question.id, e.target.value)}
              className={`recon-form-select ${hasError ? 'error' : ''}`}
            >
              <option value="">-- Select --</option>
              {question.options.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          )}

          {question.type === 'radio' && (
            <div className="recon-radio-group mt-2">
              {question.options.map(option => (
                <div
                  key={option}
                  className={`recon-radio-option ${value === option ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={option}
                    checked={value === option}
                    onChange={(e) => handleInputChange(question.id, e.target.value)}
                  />
                  <label>{option}</label>
                </div>
              ))}
            </div>
          )}
        </label>

        {hasError && (
          <div className="mt-2">
            {fieldErrors.map((error, idx) => (
              <p key={idx} className="recon-form-error">
                <span>⚠</span> {error}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderOutput = () => {
    if (!output || !output.executiveSummary) return null;

    const { executiveSummary } = output;

    return (
      <div className="space-y-4">
        {/* Company Overview */}
        <div className="recon-result-card">
          <div className="recon-result-header">
            <span className="recon-result-icon">🏢</span>
            <h3 className="recon-result-title">Company Overview</h3>
          </div>
          <div className="recon-result-content space-y-2">
            <p><strong>Name:</strong> {executiveSummary.companyOverview.name}</p>
            <p><strong>Industry:</strong> {executiveSummary.companyOverview.industry}</p>
            <p><strong>Stage:</strong> {executiveSummary.companyOverview.stage}</p>
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-gray-700 italic">"{executiveSummary.companyOverview.elevatorPitch}"</p>
            </div>
          </div>
        </div>

        {/* Core Offering */}
        <div className="recon-result-card">
          <div className="recon-result-header">
            <span className="recon-result-icon">🎯</span>
            <h3 className="recon-result-title">Core Offering</h3>
          </div>
          <div className="recon-result-content space-y-3">
            <div>
              <strong>Product:</strong>
              <p className="mt-1">{executiveSummary.coreOffering.product}</p>
            </div>
            <div>
              <strong>Problem Solved:</strong>
              <p className="mt-1">{executiveSummary.coreOffering.problemSolved}</p>
            </div>
            <div>
              <strong>Target Customer:</strong>
              <p className="mt-1">{executiveSummary.coreOffering.targetCustomer}</p>
            </div>
          </div>
        </div>

        {/* Ideal Customer */}
        <div className="recon-result-card">
          <div className="recon-result-header">
            <span className="recon-result-icon">👥</span>
            <h3 className="recon-result-title">Ideal Customer at a Glance</h3>
          </div>
          <div className="recon-result-content">
            <p>{executiveSummary.idealCustomerGlance}</p>
          </div>
        </div>

        {/* Perfect Fit Indicators */}
        <div className="recon-result-card">
          <div className="recon-result-header">
            <span className="recon-result-icon">✅</span>
            <h3 className="recon-result-title">Perfect Fit Indicators</h3>
          </div>
          <ul className="recon-result-list">
            {executiveSummary.perfectFitIndicators.map((indicator, idx) => (
              <li key={idx}>{indicator}</li>
            ))}
          </ul>
        </div>

        {/* Anti-Profile */}
        <div className="recon-result-card">
          <div className="recon-result-header">
            <span className="recon-result-icon">🚫</span>
            <h3 className="recon-result-title">Anti-Profile</h3>
          </div>
          <p className="text-xs text-gray-600 mb-3 font-semibold px-6">Companies to avoid targeting:</p>
          <ul className="recon-result-list">
            {executiveSummary.antiProfile.map((profile, idx) => (
              <li key={idx}>{profile}</li>
            ))}
          </ul>
        </div>

        {/* Current State */}
        <div className="recon-result-card">
          <div className="recon-result-header">
            <span className="recon-result-icon">📊</span>
            <h3 className="recon-result-title">Current State</h3>
          </div>
          <div className="recon-result-content space-y-3">
            <div>
              <strong>90-Day Goal:</strong>
              <p className="mt-1">{executiveSummary.currentState.ninetyDayGoal}</p>
            </div>
            <div>
              <strong>Biggest Challenge:</strong>
              <p className="mt-1">{executiveSummary.currentState.biggestChallenge}</p>
            </div>
            <div>
              <strong>Implication for ICP:</strong>
              <p className="mt-1">{executiveSummary.currentState.implication}</p>
            </div>
          </div>
        </div>

        {/* Key Insight */}
        <div className="recon-result-card">
          <div className="recon-result-header">
            <span className="recon-result-icon">💡</span>
            <h3 className="recon-result-title">Key Insight</h3>
          </div>
          <div className="recon-result-content">
            <p className="text-base leading-relaxed font-medium">{executiveSummary.keyInsight}</p>
          </div>
        </div>

        {/* Metadata */}
        {output.metadata && (
          <div className="recon-metadata">
            <p className="recon-metadata-text">
              Generated in {output.metadata.generationTime?.toFixed(1)}s |
              Model: {output.metadata.model} |
              Tokens: {output.metadata.tokensUsed}
            </p>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="recon-actions">
          <button onClick={handleEditAnswers} className="recon-secondary-btn">
            Edit Answers
          </button>
          <button onClick={handleNextSection} className="recon-primary-btn">
            Next Section →
          </button>
        </div>

        {/* Mission Control Button */}
        <button onClick={handleMissionControl} className="recon-secondary-btn w-full">
          Return to Mission Control
        </button>
      </div>
    );
  };

  if (showOutput && output) {
    return (
      <div className="space-y-4">
        <div className="recon-success-banner">
          <span className="recon-success-icon">✅</span>
          <div className="recon-success-text">
            <h3 className="recon-success-title">Section 1 Complete</h3>
            <p className="recon-success-subtitle">Executive Summary Generated</p>
          </div>
        </div>

        {renderOutput()}
      </div>
    );
  }

  const completedCount = getCompletedCount();
  const totalQuestions = SECTION_1_QUESTIONS.length;
  const requiredQuestions = SECTION_1_QUESTIONS.filter(q => q.required);
  const requiredCompleted = requiredQuestions.filter(q => answers[q.id] && answers[q.id].trim() !== '').length;
  const canGenerate = requiredCompleted === requiredQuestions.length;

  return (
    <div className="space-y-4">
      {/* Progress & Mission Control Button */}
      <div className="flex gap-4">
        <div className="flex-1 recon-progress-container">
          <div className="recon-progress-header">
            <span className="recon-progress-label">Progress</span>
            <span className="recon-progress-count">{completedCount}/{totalQuestions}</span>
          </div>
          <div className="recon-progress-bar">
            <div
              className="recon-progress-fill"
              style={{ width: `${(completedCount / totalQuestions) * 100}%` }}
            />
          </div>
          <p className="recon-metadata-text mt-2">
            Required fields: {requiredCompleted}/{requiredQuestions.length}
          </p>
        </div>

        <button onClick={handleMissionControl} className="recon-secondary-btn">
          Mission Control
        </button>
      </div>

      {/* Questions */}
      <div className="recon-card">
        <h3 className="recon-card-title">Section 1: Company Identity & Foundation</h3>
        {SECTION_1_QUESTIONS.map((question, index) => renderQuestion(question, index))}
      </div>

      {/* Action Buttons */}
      <div className="recon-card space-y-4">
        <button
          onClick={handleManualSave}
          disabled={saving || !hasUnsavedChanges}
          className={`w-full ${hasUnsavedChanges && !saving ? 'recon-secondary-btn' : 'recon-primary-btn opacity-50 cursor-not-allowed'}`}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⚙️</span>
              Saving...
            </span>
          ) : hasUnsavedChanges ? (
            'Save Progress'
          ) : (
            '✓ All Changes Saved'
          )}
        </button>

        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generating}
          className={`w-full ${canGenerate && !generating ? 'recon-primary-btn' : 'recon-secondary-btn opacity-50 cursor-not-allowed'}`}
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⚙️</span>
              Generating Executive Summary...
            </span>
          ) : canGenerate ? (
            'Generate Executive Summary'
          ) : (
            `Complete all required fields (${requiredCompleted}/${requiredQuestions.length})`
          )}
        </button>

        {!canGenerate && (
          <p className="recon-metadata-text text-center">
            Please complete all required fields (*) before generating
          </p>
        )}

        {canGenerate && !generating && (
          <p className="recon-metadata-text text-center">
            This will analyze your answers and generate your ICP foundation insights
          </p>
        )}
      </div>
    </div>
  );
}
