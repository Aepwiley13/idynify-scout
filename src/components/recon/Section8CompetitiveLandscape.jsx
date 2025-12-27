import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, updateDoc, getDoc } from 'firebase/firestore';

const SECTION_8_QUESTIONS = [
  {
    id: "directCompetitors",
    question: "Top 3-5 direct competitors",
    type: "textarea",
    required: true,
    helpText: "List your main direct competitors (same category, solving same problem)",
    validation: { minLength: 50, maxLength: 200 },
    placeholder: "e.g., Outreach, Salesloft, Apollo.io, Groove, Reply.io..."
  },
  {
    id: "indirectCompetitors",
    question: "Indirect alternatives",
    type: "textarea",
    required: true,
    helpText: "Different approaches to solving the same problem (other categories, DIY, do nothing)",
    validation: { minLength: 50, maxLength: 200 },
    placeholder: "e.g., ZoomInfo (data only), hiring more SDRs, building internal tool, manual prospecting..."
  },
  {
    id: "whyYouWin",
    question: "Why do you win deals?",
    type: "textarea",
    required: true,
    helpText: "What are your biggest competitive advantages? Why do customers choose you?",
    validation: { minLength: 100, maxLength: 400 },
    placeholder: "e.g., Easier to use, better AI, faster implementation, better support, lower price, better integration..."
  },
  {
    id: "whyYouLose",
    question: "Why do you lose deals?",
    type: "textarea",
    required: true,
    helpText: "Be honest - what causes you to lose to competitors or status quo?",
    validation: { minLength: 100, maxLength: 400 },
    placeholder: "e.g., Higher price, fewer features, less brand recognition, integration gaps, longer implementation..."
  },
  {
    id: "uniqueDifferentiators",
    question: "Your unique differentiators (top 3)",
    type: "textarea",
    required: true,
    helpText: "What do you do that NO ONE else does? What makes you truly unique?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Only tool with AI personalization at scale, only 15-min setup, only one built for mid-market..."
  },
  {
    id: "competitorStrengths",
    question: "What do competitors do better?",
    type: "textarea",
    required: true,
    helpText: "Be honest - where are competitors stronger? What do they do well?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Enterprise features, brand recognition, more integrations, bigger team, better reporting..."
  },
  {
    id: "yourWeaknesses",
    question: "Your biggest weaknesses to address",
    type: "textarea",
    required: true,
    helpText: "What gaps or weaknesses do you need to overcome or work around?",
    validation: { minLength: 100, maxLength: 300 },
    placeholder: "e.g., Limited integrations, small team, new to market, fewer case studies, single product..."
  },
  {
    id: "pricePosition",
    question: "Price positioning",
    type: "radio",
    required: true,
    helpText: "Where do you sit on the pricing spectrum relative to competitors?",
    options: [
      "Premium (20%+ more expensive)",
      "Slightly premium (10-20% more)",
      "Market rate (competitive pricing)",
      "Slightly discount (10-20% less)",
      "Budget option (20%+ cheaper)"
    ]
  },
  {
    id: "idealCompetitor",
    question: "Who do you WANT to compete against?",
    type: "radio",
    required: true,
    helpText: "Which competitor gives you the best win rate when you go head-to-head?",
    options: [
      "Enterprise incumbents (Outreach, Salesloft, etc.)",
      "Mid-market alternatives",
      "Budget tools",
      "Do nothing / Status quo",
      "DIY / Build internal"
    ]
  },
  {
    id: "avoidCompetitor",
    question: "Who do you want to AVOID competing against?",
    type: "radio",
    required: true,
    helpText: "Which competitor do you struggle most against? Lowest win rate?",
    options: [
      "Enterprise incumbents (Outreach, Salesloft, etc.)",
      "Mid-market alternatives",
      "Budget tools",
      "Do nothing / Status quo",
      "DIY / Build internal"
    ]
  }
];

export default function Section8CompetitiveLandscape({ initialData = {}, onSave, onComplete }) {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({
    directCompetitors: '',
    indirectCompetitors: '',
    whyYouWin: '',
    whyYouLose: '',
    uniqueDifferentiators: '',
    competitorStrengths: '',
    yourWeaknesses: '',
    pricePosition: '',
    idealCompetitor: '',
    avoidCompetitor: ''
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
          if (data.section8Answers) {
            setAnswers(prev => ({ ...prev, ...data.section8Answers }));
          }
          
          // Load output if it exists
          if (data.section8Output) {
            setOutput(data.section8Output);
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
        section8Answers: answers,
        'reconProgress.section8LastSaved': new Date()
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

  const validateAnswers = () => {
    const errors = {};
    
    SECTION_8_QUESTIONS.forEach(q => {
      if (q.required) {
        const value = answers[q.id];
        
        if (q.type === 'textarea') {
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

      const response = await fetch('/.netlify/functions/generate-section-8', {
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
      setError(err.message || 'Failed to generate Competitive Landscape. Please try again.');
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
            Section 8: Competitive Landscape
          </h1>
          <p className="text-gray-400">
            Map your competitive landscape, understand win/loss patterns, and develop differentiation strategies
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
              {SECTION_8_QUESTIONS.map(q => renderQuestion(q))}
            </div>

            {/* Generate Button */}
            <div className="mt-8 flex gap-4">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 text-black font-bold py-4 px-8 rounded-xl transition-all transform hover:scale-105 disabled:scale-100 disabled:cursor-not-allowed font-mono text-lg"
              >
                {generating ? '🤖 Generating Competitive Analysis...' : '⚔️ Generate Competitive Analysis'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Output Display */}
            <div className="bg-cyan-950/30 border-2 border-cyan-500/50 rounded-xl p-6 mb-6">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4 font-mono">
                ⚔️ Competitive Landscape Analysis
              </h2>
              
              {output && output.competitiveLandscape && (
                <div className="space-y-6">
                  {/* Win/Loss Analysis */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-3">Win/Loss Analysis</h3>
                    
                    {/* Win Reasons */}
                    <div className="bg-green-950/30 p-4 rounded-lg border border-green-500/30 mb-4">
                      <p className="text-green-300 font-semibold mb-3">✅ Why You Win</p>
                      <div className="space-y-2">
                        {output.competitiveLandscape.winLossAnalysis.winReasons.slice(0, 3).map((win, idx) => (
                          <div key={idx} className="text-gray-300 text-sm">
                            <span className="font-semibold">{win.frequency}:</span> {win.reason}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Loss Reasons */}
                    <div className="bg-red-950/30 p-4 rounded-lg border border-red-500/30 mb-4">
                      <p className="text-red-300 font-semibold mb-3">❌ Why You Lose</p>
                      <div className="space-y-2">
                        {output.competitiveLandscape.winLossAnalysis.lossReasons.slice(0, 3).map((loss, idx) => (
                          <div key={idx} className="text-gray-300 text-sm">
                            <span className="font-semibold">{loss.frequency}:</span> {loss.reason}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Win Rates */}
                    <div className="bg-purple-950/30 p-4 rounded-lg border border-purple-500/30">
                      <p className="text-purple-300 font-semibold mb-2">📊 Win Rates</p>
                      <p className="text-gray-300 text-sm mb-1">
                        <strong>Overall:</strong> {output.competitiveLandscape.winLossAnalysis.winRate.estimatedOverall}
                      </p>
                      <p className="text-gray-300 text-sm mb-1">
                        <strong>vs Enterprise:</strong> {output.competitiveLandscape.winLossAnalysis.winRate.vsEnterprise}
                      </p>
                      <p className="text-gray-300 text-sm">
                        <strong>vs Status Quo:</strong> {output.competitiveLandscape.winLossAnalysis.winRate.vsStatusQuo}
                      </p>
                    </div>
                  </div>

                  {/* Positioning Strategy */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Positioning Strategy</h3>
                    <div className="bg-blue-950/30 p-4 rounded-lg border border-blue-500/30">
                      <p className="text-blue-300 font-semibold mb-2">Primary Position</p>
                      <p className="text-gray-300 text-sm">
                        {output.competitiveLandscape.positioningStrategy.primaryPosition}
                      </p>
                    </div>
                  </div>

                  {/* Unique Differentiators */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Unique Differentiators</h3>
                    <div className="space-y-2">
                      {output.competitiveLandscape.differentiation.uniqueValueProps.map((uvp, idx) => (
                        <div key={idx} className="bg-orange-950/30 p-3 rounded-lg border border-orange-500/30">
                          <p className="text-orange-300 font-semibold mb-1">
                            #{idx + 1}: {uvp.differentiator}
                          </p>
                          <p className="text-gray-300 text-sm">
                            <strong>Defendability:</strong> {uvp.defendability} | <strong>Relevance:</strong> {uvp.marketRelevance}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Market Opportunity */}
                  <div>
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Market Opportunity</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-green-950/30 p-4 rounded-lg border border-green-500/30">
                        <p className="text-green-300 font-semibold mb-2">🎯 Sweet Spot</p>
                        <p className="text-gray-300 text-sm">
                          {output.competitiveLandscape.marketOpportunity.sweetSpot.description}
                        </p>
                      </div>
                      <div className="bg-red-950/30 p-4 rounded-lg border border-red-500/30">
                        <p className="text-red-300 font-semibold mb-2">⚠️ Avoid</p>
                        <p className="text-gray-300 text-sm">
                          {output.competitiveLandscape.marketOpportunity.avoidSegment.description}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Battle Cards Preview */}
                  {output.competitiveLandscape.battleCards && (
                    <div>
                      <h3 className="text-xl font-semibold text-cyan-400 mb-2">Battle Cards</h3>
                      <div className="space-y-3">
                        {/* vs Enterprise */}
                        <div className="bg-cyan-950/50 p-4 rounded-lg border-l-4 border-cyan-400">
                          <p className="text-cyan-300 font-semibold mb-2">⚔️ vs Enterprise Tools</p>
                          <p className="text-gray-300 text-sm mb-2">
                            <strong>Positioning:</strong> {output.competitiveLandscape.battleCards.vsEnterprise.positioning}
                          </p>
                          <p className="text-gray-400 text-xs">
                            <strong>Trap Questions:</strong> {output.competitiveLandscape.battleCards.vsEnterprise.trapQuestions.length} loaded
                          </p>
                        </div>

                        {/* vs Status Quo */}
                        <div className="bg-cyan-950/50 p-4 rounded-lg border-l-4 border-cyan-400">
                          <p className="text-cyan-300 font-semibold mb-2">💤 vs Status Quo</p>
                          <p className="text-gray-300 text-sm mb-2">
                            <strong>Cost of Inaction:</strong> {output.competitiveLandscape.battleCards.vsStatusQuo.costOfInaction}
                          </p>
                        </div>
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
                onClick={() => navigate('/recon/section-9')}
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
