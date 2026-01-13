import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import './ReconEnterprise.css';

const SECTION_1_QUESTIONS = [
  {
    id: "companyName",
    question: "Company name",
    type: "text",
    required: true,
    validation: { minLength: 2, maxLength: 500 }
  },
  {
    id: "whatYouDo",
    question: "What does your company do?",
    helpText: "In plain English, what does your company do? (Imagine explaining to a friend)",
    type: "textarea",
    required: true,
    validation: { minLength: 50, maxLength: 500 }
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
    ]
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
    ]
  },
  {
    id: "role",
    question: "Your role/title",
    type: "text",
    required: true,
    validation: { minLength: 2, maxLength: 500 }
  },
  {
    id: "mainProduct",
    question: "Main product/service",
    helpText: "What is the ONE thing you sell that generates the most revenue?",
    type: "textarea",
    required: true,
    validation: { minLength: 50, maxLength: 500 }
  },
  {
    id: "problemSolved",
    question: "What problem does it solve?",
    helpText: "In your customers' words, what problem were they trying to solve when they found you?",
    type: "textarea",
    required: true,
    validation: { minLength: 50, maxLength: 500 }
  },
  {
    id: "currentCustomers",
    question: "Who do you sell to today?",
    helpText: "Describe your current customers. What do they have in common?",
    type: "textarea",
    required: true,
    validation: { minLength: 100, maxLength: 500 }
  },
  {
    id: "ninetyDayGoal",
    question: "What's your 90-day goal?",
    type: "textarea",
    required: false,
    validation: { maxLength: 500 }
  },
  {
    id: "biggestChallenge",
    question: "What's your biggest sales challenge right now?",
    type: "textarea",
    required: false,
    validation: { maxLength: 500 }
  }
];

export default function Section1Foundation({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({});
  const [output, setOutput] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [showOutput, setShowOutput] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Initialize answers from initialData (preferred) or fallback to legacy storage
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        // Prefer initialData from dashboard state (unified state management)
        if (initialData && Object.keys(initialData).length > 0) {
          setAnswers(initialData);
          setHasUnsavedChanges(false);
        } else {
          // Fallback: Check legacy storage for migration
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();

            if (userData.section1Answers) {
              setAnswers(userData.section1Answers);
            }
          }
        }

        // Check for saved output in legacy storage
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

  // Auto-save functionality - saves every 30 seconds when there are unsaved changes
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    console.log('🔄 Auto-save scheduled in 30 seconds...');
    const autoSaveTimer = setTimeout(() => {
      console.log('💾 Auto-saving progress...');
      handleManualSave();
    }, 30000); // 30 seconds

    return () => {
      clearTimeout(autoSaveTimer);
    };
  }, [answers, hasUnsavedChanges]);

  const handleManualSave = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        alert('❌ You must be logged in to save');
        return;
      }

      setSaving(true);

      // Use unified state management through parent's onSave
      if (onSave) {
        await onSave(answers);
      } else {
        // Fallback: Save directly to legacy location if no parent handler
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

    // Clear error for this field
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
    // Validate all fields first
    if (!validateAllFields()) {
      alert('⚠️ Please fix all validation errors before generating');
      return;
    }

    setGenerating(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('User not authenticated');
      }

      console.log('🚀 Calling generate-section-1 function...');

      // Get fresh auth token
      const authToken = await user.getIdToken();

      // Call Netlify function
      const response = await fetch('/.netlify/functions/generate-section-1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          answers,
          userId: user.uid,
          authToken
        })
      });

      console.log('📡 Response status:', response.status);

      if (!response.ok) {
        // Try to parse error response
        let errorMessage = 'Generation failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
          console.error('❌ Error response:', errorData);
        } catch (parseError) {
          console.error('❌ Could not parse error response');
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log('✅ Response data:', data);

      if (data.success) {
        console.log('💾 Setting output and showing results...');
        setOutput(data.output);
        setShowOutput(true);

        // Complete the section using unified state management
        if (onComplete) {
          try {
            console.log('📤 Calling onComplete to mark section as completed...');
            console.log('🔍 onComplete type:', typeof onComplete);
            await onComplete(data.output);
            console.log('✅ onComplete returned successfully!');
            console.log('🎉 Section marked as completed, Section 2 should be unlocked');
            console.log('⏳ Parent component should now show alert and navigate...');
            // Success handled by parent component (shows alert and navigates)
          } catch (completeError) {
            console.error('❌ Error in onComplete:', completeError);
            console.error('❌ Error stack:', completeError.stack);
            alert(`⚠️ Executive Summary generated but failed to mark section as complete:\n\n${completeError.message}\n\nPlease refresh the page and check the console for details.`);
            // Still save to legacy location as fallback
            await updateDoc(doc(db, 'users', user.uid), {
              section1Output: data.output,
              'reconProgress.currentSection': 1,
              'reconProgress.section1Completed': true,
              'reconProgress.lastUpdated': new Date()
            });
          }
        } else {
          // Fallback: Save to legacy location if no onComplete handler
          console.warn('⚠️ No onComplete handler provided, using legacy save');
          await updateDoc(doc(db, 'users', user.uid), {
            section1Output: data.output,
            'reconProgress.currentSection': 1,
            'reconProgress.section1Completed': true,
            'reconProgress.lastUpdated': new Date()
          });
          alert('✅ Executive Summary generated successfully!\n\nNote: Using legacy save mode. Progress may not sync properly.');
        }
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('💥 Generation error:', error);
      alert(`❌ Generation failed: ${error.message}\n\nPlease check:\n1. Are you connected to the internet?\n2. Try refreshing the page\n3. Contact support if issue persists`);
    } finally {
      setGenerating(false);
    }
  };

  const handleEditAnswers = () => {
    setShowOutput(false);
  };

  const handleNextSection = () => {
    // Navigate back to RECON overview where Section 2 should now be unlocked
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
          <div className="space-y-2 text-gray-700">
            <p><strong className="text-gray-900">Name:</strong> {executiveSummary.companyOverview.name}</p>
            <p><strong className="text-gray-900">Industry:</strong> {executiveSummary.companyOverview.industry}</p>
            <p><strong className="text-gray-900">Stage:</strong> {executiveSummary.companyOverview.stage}</p>
            <p className="mt-4 text-gray-900 italic bg-white p-4 rounded-lg border border-purple-200">"{executiveSummary.companyOverview.elevatorPitch}"</p>
          </div>
        </div>

        {/* Core Offering */}
        <div className="recon-result-card">
          <h3 className="recon-result-title">🎯 Core Offering</h3>
          <div className="space-y-3 text-gray-700">
            <div>
              <strong className="text-gray-900">Product:</strong>
              <p className="mt-1">{executiveSummary.coreOffering.product}</p>
            </div>
            <div>
              <strong className="text-gray-900">Problem Solved:</strong>
              <p className="mt-1">{executiveSummary.coreOffering.problemSolved}</p>
            </div>
            <div>
              <strong className="text-gray-900">Target Customer:</strong>
              <p className="mt-1">{executiveSummary.coreOffering.targetCustomer}</p>
            </div>
          </div>
        </div>

        {/* Ideal Customer at a Glance */}
        <div className="recon-result-card">
          <h3 className="recon-result-title">👥 Ideal Customer at a Glance</h3>
          <p className="text-gray-700 leading-relaxed">{executiveSummary.idealCustomerGlance}</p>
        </div>

        {/* Perfect Fit Indicators */}
        <div className="recon-result-card">
          <h3 className="recon-result-title">✅ Perfect Fit Indicators</h3>
          <ul className="space-y-2">
            {executiveSummary.perfectFitIndicators.map((indicator, idx) => (
              <li key={idx} className="flex items-start gap-2 text-gray-700">
                <span className="text-green-600 mt-1">▪</span>
                <span>{indicator}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Anti-Profile */}
        <div className="recon-result-card">
          <h3 className="recon-result-title">🚫 Anti-Profile</h3>
          <p className="recon-metadata-text mb-3 font-semibold">Companies to avoid targeting:</p>
          <ul className="space-y-2">
            {executiveSummary.antiProfile.map((profile, idx) => (
              <li key={idx} className="flex items-start gap-2 text-gray-700">
                <span className="text-red-600 mt-1">✖</span>
                <span>{profile}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Current State */}
        <div className="recon-result-card">
          <h3 className="recon-result-title">📊 Current State</h3>
          <div className="space-y-3 text-gray-700">
            <div>
              <strong className="text-gray-900">90-Day Goal:</strong>
              <p className="mt-1">{executiveSummary.currentState.ninetyDayGoal}</p>
            </div>
            <div>
              <strong className="text-gray-900">Biggest Challenge:</strong>
              <p className="mt-1">{executiveSummary.currentState.biggestChallenge}</p>
            </div>
            <div>
              <strong className="text-gray-900">Implication for ICP:</strong>
              <p className="mt-1 text-gray-900">{executiveSummary.currentState.implication}</p>
            </div>
          </div>
        </div>

        {/* Key Insight */}
        <div className="recon-result-card">
          <h3 className="recon-result-title">💡 Key Insight</h3>
          <p className="text-gray-900 text-lg leading-relaxed">{executiveSummary.keyInsight}</p>
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
        <div className="flex gap-4">
          <button
            onClick={handleEditAnswers}
            className="recon-secondary-btn flex-1"
          >
            ✏️ Edit Answers
          </button>
          <button
            onClick={handleNextSection}
            className="recon-primary-btn flex-1"
          >
            Next Section →
          </button>
        </div>

        {/* Mission Control Button */}
        <button
          onClick={handleMissionControl}
          className="recon-secondary-btn w-full"
        >
          🏠 Return to Mission Control
        </button>
      </div>
    );
  };

  if (showOutput && output) {
    return (
      <div className="space-y-6">
        <div className="recon-result-card">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">✅</span>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Section 1 Complete</h3>
              <p className="text-sm text-gray-600">Executive Summary Generated</p>
            </div>
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
    <div className="space-y-6">
      {/* Progress & Mission Control Button */}
      <div className="flex gap-4">
        <div className="flex-1 recon-result-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-gray-900">📋 Progress</h3>
            <span className="text-blue-600 font-bold">{completedCount}/{totalQuestions}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all duration-500"
              style={{ width: `${(completedCount / totalQuestions) * 100}%` }}
            />
          </div>
          <p className="recon-metadata-text mt-2">
            Required fields: {requiredCompleted}/{requiredQuestions.length}
          </p>
        </div>

        <button
          onClick={handleMissionControl}
          className="recon-secondary-btn"
        >
          🏠 Mission Control
        </button>
      </div>

      {/* Questions */}
      <div className="recon-card">
        <h3 className="recon-card-title">
          Section 1: Company Identity & Foundation
        </h3>

        {SECTION_1_QUESTIONS.map((question, index) => renderQuestion(question, index))}
      </div>

      {/* Action Buttons */}
      <div className="recon-card space-y-4">
        {/* Save Button */}
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

        {/* Generate Button */}
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
