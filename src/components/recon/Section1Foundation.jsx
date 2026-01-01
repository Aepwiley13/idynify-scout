import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

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
      <div key={question.id} className="mb-6">
        <label className="block mb-2">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <span className="text-gray-900 font-semibold">
                {index + 1}. {question.question}
                {question.required && <span className="text-red-600 ml-1">*</span>}
              </span>
              {question.helpText && (
                <p className="text-sm text-gray-600 mt-1">{question.helpText}</p>
              )}
            </div>
            {question.type === 'textarea' && question.validation?.maxLength && (
              <span className={`text-xs ml-4 ${
                value.length > question.validation.maxLength
                  ? 'text-red-600'
                  : value.length > question.validation.maxLength * 0.9
                  ? 'text-yellow-600'
                  : 'text-gray-500'
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
              className={`w-full bg-white border ${
                hasError ? 'border-red-500' : 'border-gray-300'
              } rounded-lg p-4 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all`}
              placeholder="Enter your answer..."
            />
          )}

          {question.type === 'textarea' && (
            <textarea
              value={value}
              onChange={(e) => handleInputChange(question.id, e.target.value)}
              className={`w-full bg-white border ${
                hasError ? 'border-red-500' : 'border-gray-300'
              } rounded-lg p-4 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all resize-none`}
              rows="4"
              placeholder="Enter your answer..."
            />
          )}

          {question.type === 'dropdown' && (
            <select
              value={value}
              onChange={(e) => handleInputChange(question.id, e.target.value)}
              className={`w-full bg-white border ${
                hasError ? 'border-red-500' : 'border-gray-300'
              } rounded-lg p-4 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all`}
            >
              <option value="">-- Select --</option>
              {question.options.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          )}

          {question.type === 'radio' && (
            <div className="space-y-2 mt-2">
              {question.options.map(option => (
                <label
                  key={option}
                  className={`flex items-center p-3 rounded-lg border ${
                    value === option
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-300 bg-white'
                  } cursor-pointer hover:border-blue-400 transition-colors`}
                >
                  <input
                    type="radio"
                    name={question.id}
                    value={option}
                    checked={value === option}
                    onChange={(e) => handleInputChange(question.id, e.target.value)}
                    className="mr-3 accent-blue-600"
                  />
                  <span className="text-gray-900 text-sm">{option}</span>
                </label>
              ))}
            </div>
          )}
        </label>

        {hasError && (
          <div className="mt-2 space-y-1">
            {fieldErrors.map((error, idx) => (
              <p key={idx} className="text-red-600 text-xs">⚠️ {error}</p>
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
      <div className="space-y-6">
        {/* Company Overview */}
        <div className="bg-purple-50 rounded-2xl p-6 border border-purple-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">🏢 Company Overview</h3>
          <div className="space-y-2 text-gray-700">
            <p><strong className="text-gray-900">Name:</strong> {executiveSummary.companyOverview.name}</p>
            <p><strong className="text-gray-900">Industry:</strong> {executiveSummary.companyOverview.industry}</p>
            <p><strong className="text-gray-900">Stage:</strong> {executiveSummary.companyOverview.stage}</p>
            <p className="mt-4 text-gray-900 italic bg-white p-4 rounded-lg border border-purple-200">"{executiveSummary.companyOverview.elevatorPitch}"</p>
          </div>
        </div>

        {/* Core Offering */}
        <div className="bg-blue-50 rounded-2xl p-6 border border-blue-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">🎯 Core Offering</h3>
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
        <div className="bg-blue-50 rounded-2xl p-6 border border-blue-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">👥 Ideal Customer at a Glance</h3>
          <p className="text-gray-700 leading-relaxed">{executiveSummary.idealCustomerGlance}</p>
        </div>

        {/* Perfect Fit Indicators */}
        <div className="bg-green-50 rounded-2xl p-6 border border-green-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">✅ Perfect Fit Indicators</h3>
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
        <div className="bg-red-50 rounded-2xl p-6 border border-red-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">🚫 Anti-Profile</h3>
          <p className="text-xs text-gray-600 mb-3 font-semibold">Companies to avoid targeting:</p>
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
        <div className="bg-yellow-50 rounded-2xl p-6 border border-yellow-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">📊 Current State</h3>
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
        <div className="bg-pink-50 rounded-2xl p-6 border border-pink-200">
          <h3 className="text-xl font-bold text-gray-900 mb-4">💡 Key Insight</h3>
          <p className="text-gray-900 text-lg leading-relaxed">{executiveSummary.keyInsight}</p>
        </div>

        {/* Metadata */}
        {output.metadata && (
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <p className="text-xs text-gray-600">
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
            className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-semibold py-4 px-6 rounded-xl transition-all border border-gray-300"
          >
            ✏️ Edit Answers
          </button>
          <button
            onClick={handleNextSection}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-md"
          >
            Next Section →
          </button>
        </div>

        {/* Mission Control Button */}
        <button
          onClick={handleMissionControl}
          className="w-full bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold py-3 px-6 rounded-xl transition-all border border-purple-300"
        >
          🏠 Return to Mission Control
        </button>
      </div>
    );
  };

  if (showOutput && output) {
    return (
      <div className="space-y-6">
        <div className="bg-green-50 rounded-2xl p-6 border border-green-200">
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
        <div className="flex-1 bg-blue-50 rounded-2xl p-6 border border-blue-200">
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
          <p className="text-xs text-gray-600 mt-2">
            Required fields: {requiredCompleted}/{requiredQuestions.length}
          </p>
        </div>

        <button
          onClick={handleMissionControl}
          className="bg-purple-100 hover:bg-purple-200 text-purple-700 font-semibold px-8 rounded-2xl transition-all border border-purple-300 whitespace-nowrap"
        >
          🏠 Mission Control
        </button>
      </div>

      {/* Questions */}
      <div className="bg-white rounded-2xl p-8 border border-gray-200 shadow-sm">
        <h3 className="text-2xl font-bold text-gray-900 mb-6">
          Section 1: Company Identity & Foundation
        </h3>

        {SECTION_1_QUESTIONS.map((question, index) => renderQuestion(question, index))}
      </div>

      {/* Action Buttons */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
        {/* Save Button */}
        <button
          onClick={handleManualSave}
          disabled={saving || !hasUnsavedChanges}
          className={`w-full font-semibold py-4 px-6 rounded-xl transition-all ${
            hasUnsavedChanges && !saving
              ? 'bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300'
              : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-200'
          }`}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⚙️</span>
              Saving...
            </span>
          ) : hasUnsavedChanges ? (
            '💾 Save Progress'
          ) : (
            '✅ All Changes Saved'
          )}
        </button>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generating}
          className={`w-full font-semibold py-4 px-6 rounded-xl transition-all ${
            canGenerate && !generating
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
          }`}
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⚙️</span>
              Generating Executive Summary...
            </span>
          ) : canGenerate ? (
            '🚀 Generate Executive Summary'
          ) : (
            `⚠️ Complete all required fields (${requiredCompleted}/${requiredQuestions.length})`
          )}
        </button>

        {!canGenerate && (
          <p className="text-xs text-gray-600 text-center">
            Please complete all required fields (*) before generating
          </p>
        )}

        {canGenerate && !generating && (
          <p className="text-xs text-gray-600 text-center">
            This will analyze your answers and generate your ICP foundation insights
          </p>
        )}
      </div>
    </div>
  );
}
