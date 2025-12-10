import { useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase1Discovery({ scoutData, icpBrief, onComplete }) {
  const [stage, setStage] = useState('loading'); // loading, results, validation, summary
  const [discoveryData, setDiscoveryData] = useState(null);
  const [validationSample, setValidationSample] = useState([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [validationResults, setValidationResults] = useState({
    accepted: [],
    rejected: [],
    acceptReasons: {},
    rejectReasons: {}
  });
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [lastAction, setLastAction] = useState(null); // 'accept' or 'reject'
  const [error, setError] = useState(null);

  // Start Phase 1 on mount
  useEffect(() => {
    startPhase1();
  }, []);

  const startPhase1 = async () => {
    try {
      console.log('🔍 Starting Phase 1: TAM Discovery');
      setStage('loading');

      const response = await fetch('/.netlify/functions/barry-phase1-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          scoutData: scoutData
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to discover companies');
      }

      console.log('✅ Phase 1 complete:', data);
      setDiscoveryData(data);
      setValidationSample(data.validationSample || []);
      setStage('results');

    } catch (err) {
      console.error('❌ Phase 1 error:', err);
      setError(err.message);
    }
  };

  const handleStartValidation = () => {
    setStage('validation');
    setCurrentCardIndex(0);
  };

  const handleSwipe = (action) => {
    const currentCompany = validationSample[currentCardIndex];
    setLastAction(action);
    
    if (action === 'accept') {
      setValidationResults(prev => ({
        ...prev,
        accepted: [...prev.accepted, currentCompany]
      }));
    } else {
      setValidationResults(prev => ({
        ...prev,
        rejected: [...prev.rejected, currentCompany]
      }));
    }
    
    setShowReasonModal(true);
  };

  const handleReasonSubmit = (reasons) => {
    const reasonKey = lastAction === 'accept' ? 'acceptReasons' : 'rejectReasons';
    
    setValidationResults(prev => {
      const newReasons = { ...prev[reasonKey] };
      reasons.forEach(reason => {
        newReasons[reason] = (newReasons[reason] || 0) + 1;
      });
      return { ...prev, [reasonKey]: newReasons };
    });

    setShowReasonModal(false);
    
    // Move to next card or show summary
    if (currentCardIndex < validationSample.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
    } else {
      showValidationSummary();
    }
  };

  const showValidationSummary = async () => {
    setStage('summary');
    
    // Save validation data to Firebase
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase1'), {
        allCompanies: discoveryData.companies,
        validationSample: validationSample,
        validationResults: validationResults,
        analytics: discoveryData.analytics,
        completedAt: serverTimestamp()
      });
      console.log('✅ Phase 1 validation saved to Firebase');
    } catch (err) {
      console.error('Error saving validation:', err);
    }
  };

  const handleProceedToPhase2 = () => {
    onComplete({
      companies: discoveryData.companies,
      validation: validationResults,
      analytics: discoveryData.analytics
    });
  };

  // LOADING STATE
  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-cyan-400 mb-6"></div>
          <h2 className="text-3xl font-bold text-cyan-400 mb-2">🔍 PHASE 1: TAM DISCOVERY</h2>
          <p className="text-blue-200 text-lg">Barry is scanning your Total Addressable Market...</p>
        </div>
      </div>
    );
  }

  // ERROR STATE
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-red-900 to-gray-900 flex items-center justify-center">
        <div className="bg-red-900/30 border border-red-500 rounded-xl p-8 max-w-lg">
          <h2 className="text-2xl font-bold text-red-400 mb-4">❌ Mission Failed</h2>
          <p className="text-red-200 mb-6">{error}</p>
          <button
            onClick={startPhase1}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Retry Phase 1
          </button>
        </div>
      </div>
    );
  }

  // RESULTS STATE - Show TAM overview
  if (stage === 'results') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-blue-900 to-gray-900 py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-cyan-400 mb-2">🔍 PHASE 1: TAM DISCOVERY</h1>
            <p className="text-blue-200 text-lg">Barry found your Total Addressable Market</p>
          </div>

          <div className="bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-xl p-8 mb-6">
            <div className="text-center mb-8">
              <div className="text-6xl font-bold text-cyan-400 mb-2">
                {discoveryData.totalCount}
              </div>
              <p className="text-blue-200 text-xl">Companies Discovered</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {/* Industry Distribution */}
              <div className="bg-blue-900/20 rounded-lg p-6">
                <h3 className="text-cyan-300 font-semibold mb-4 flex items-center gap-2">
                  📊 By Industry
                </h3>
                <div className="space-y-2">
                  {discoveryData.analytics?.industries?.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-blue-200">
                      <span>{item.industry}</span>
                      <span className="font-semibold">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Size Distribution */}
              <div className="bg-blue-900/20 rounded-lg p-6">
                <h3 className="text-cyan-300 font-semibold mb-4 flex items-center gap-2">
                  📏 By Size
                </h3>
                <div className="space-y-2">
                  {Object.entries(discoveryData.analytics?.sizes || {}).map(([range, count]) => (
                    count > 0 && (
                      <div key={range} className="flex justify-between text-blue-200">
                        <span>{range} employees</span>
                        <span className="font-semibold">{count}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-6 mb-6">
              <h3 className="text-yellow-300 font-semibold mb-2">👍 Validate Sample</h3>
              <p className="text-yellow-200 text-sm mb-4">
                Review {validationSample.length} companies to train Barry on what makes a perfect fit
              </p>
            </div>

            <button
              onClick={handleStartValidation}
              className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-xl font-bold rounded-lg hover:from-cyan-500 hover:to-blue-500 transition-all"
            >
              Validate Sample →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // VALIDATION STATE - Tinder-style swipe cards
  if (stage === 'validation') {
    const currentCompany = validationSample[currentCardIndex];
    const progress = ((currentCardIndex) / validationSample.length) * 100;

    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-purple-900 to-gray-900 py-12 px-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-purple-400 mb-2">
              👍 TRAIN BARRY: Company {currentCardIndex + 1} of {validationSample.length}
            </h1>
            <div className="w-full bg-gray-700 rounded-full h-3 mb-2">
              <div 
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-purple-200">
              Accepted: {validationResults.accepted.length} | Rejected: {validationResults.rejected.length}
            </p>
          </div>

          {/* Company Card */}
          <div className="bg-black/40 backdrop-blur-sm border-2 border-purple-500/50 rounded-2xl p-8 mb-6 shadow-2xl">
            <div className="text-center mb-6">
              <h2 className="text-3xl font-bold text-white mb-3">{currentCompany.name}</h2>
              <div className="flex items-center justify-center gap-6 text-purple-200">
                <span className="flex items-center gap-2">
                  📍 {currentCompany.industry}
                </span>
                <span className="flex items-center gap-2">
                  👥 {currentCompany.employees} employees
                </span>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="bg-purple-900/20 rounded-lg p-4">
                <p className="text-purple-200">
                  <span className="font-semibold text-purple-300">Location:</span> {currentCompany.location}
                </p>
              </div>
              {currentCompany.website && (
                <div className="bg-purple-900/20 rounded-lg p-4">
                  <p className="text-purple-200">
                    <span className="font-semibold text-purple-300">Website:</span>{' '}
                    <a href={currentCompany.website} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                      {currentCompany.website}
                    </a>
                  </p>
                </div>
              )}
              {currentCompany.founded && (
                <div className="bg-purple-900/20 rounded-lg p-4">
                  <p className="text-purple-200">
                    <span className="font-semibold text-purple-300">Founded:</span> {currentCompany.founded}
                  </p>
                </div>
              )}
            </div>

            <div className="text-center mb-4">
              <p className="text-xl text-purple-300 font-semibold">Is this your ideal customer?</p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4">
              <button
                onClick={() => handleSwipe('reject')}
                className="flex-1 py-4 bg-red-600 text-white text-xl font-bold rounded-xl hover:bg-red-500 transition-all transform hover:scale-105"
              >
                👎 Reject
              </button>
              <button
                onClick={() => handleSwipe('accept')}
                className="flex-1 py-4 bg-green-600 text-white text-xl font-bold rounded-xl hover:bg-green-500 transition-all transform hover:scale-105"
              >
                👍 Accept
              </button>
            </div>
          </div>

          <p className="text-center text-purple-300 text-sm">
            Swipe left to reject • Swipe right to accept
          </p>
        </div>

        {/* Reason Modal */}
        {showReasonModal && (
          <ReasonModal
            action={lastAction}
            company={currentCompany}
            onSubmit={handleReasonSubmit}
          />
        )}
      </div>
    );
  }

  // SUMMARY STATE
  if (stage === 'summary') {
    const topAcceptReasons = Object.entries(validationResults.acceptReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const topRejectReasons = Object.entries(validationResults.rejectReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-green-900 to-gray-900 py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-green-400 mb-2">🎯 VALIDATION COMPLETE</h1>
            <p className="text-green-200 text-lg">Barry learned your preferences!</p>
          </div>

          <div className="bg-black/40 backdrop-blur-sm border border-green-500/30 rounded-xl p-8 mb-6">
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="text-center">
                <div className="text-5xl font-bold text-green-400 mb-2">
                  {validationResults.accepted.length}
                </div>
                <p className="text-green-200">Accepted</p>
              </div>
              <div className="text-center">
                <div className="text-5xl font-bold text-red-400 mb-2">
                  {validationResults.rejected.length}
                </div>
                <p className="text-red-200">Rejected</p>
              </div>
            </div>

            <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-6 mb-6">
              <h3 className="text-green-300 font-semibold mb-4 flex items-center gap-2">
                🧠 Barry learned:
              </h3>
              <div className="space-y-3">
                {topAcceptReasons.map(([reason, count]) => (
                  <div key={reason} className="flex items-center gap-2 text-green-200">
                    <span className="text-green-400">✓</span>
                    <span>{reason} ({count} times)</span>
                  </div>
                ))}
                {topRejectReasons.map(([reason, count]) => (
                  <div key={reason} className="flex items-center gap-2 text-red-200">
                    <span className="text-red-400">✗</span>
                    <span>{reason} ({count} times)</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-6 mb-6">
              <p className="text-blue-200 text-center">
                Barry will now score all {discoveryData.totalCount} companies using your feedback!
              </p>
            </div>

            <button
              onClick={handleProceedToPhase2}
              className="w-full py-4 bg-gradient-to-r from-green-600 to-blue-600 text-white text-xl font-bold rounded-lg hover:from-green-500 hover:to-blue-500 transition-all"
            >
              🚀 Score All Companies →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Reason Modal Component
function ReasonModal({ action, company, onSubmit }) {
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [customReason, setCustomReason] = useState('');

  const acceptReasons = [
    'Perfect industry match',
    'Ideal company size',
    'Right location/market',
    'Similar to my best customers',
    'Fast-growing company',
    'Tech-forward/innovative',
    'Strong market presence',
    'Good budget fit'
  ];

  const rejectReasons = [
    'Wrong industry focus',
    'Too small / Too large',
    'Wrong geographic market',
    'Not my target customer type',
    'Company stage doesn\'t match',
    'Technology mismatch',
    'Budget concerns',
    'Poor market fit'
  ];

  const reasons = action === 'accept' ? acceptReasons : rejectReasons;
  const bgColor = action === 'accept' ? 'green' : 'red';

  const toggleReason = (reason) => {
    if (selectedReasons.includes(reason)) {
      setSelectedReasons(selectedReasons.filter(r => r !== reason));
    } else {
      setSelectedReasons([...selectedReasons, reason]);
    }
  };

  const handleSubmit = () => {
    const allReasons = [...selectedReasons];
    if (customReason.trim()) {
      allReasons.push(customReason.trim());
    }
    onSubmit(allReasons);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
      <div className={`bg-gray-900 border-2 border-${bgColor}-500 rounded-xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto`}>
        <h2 className={`text-2xl font-bold text-${bgColor}-400 mb-4`}>
          {action === 'accept' ? '✅ Great choice!' : '👎 Got it - Barry is learning'}
        </h2>
        <p className="text-gray-300 mb-6">
          Why {action === 'accept' ? 'is' : "isn't"} <span className="font-semibold text-white">{company.name}</span> a good fit?
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {reasons.map((reason) => (
            <button
              key={reason}
              onClick={() => toggleReason(reason)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedReasons.includes(reason)
                  ? `border-${bgColor}-500 bg-${bgColor}-900/30 text-${bgColor}-300`
                  : 'border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-500'
              }`}
            >
              {selectedReasons.includes(reason) ? '☑' : '☐'} {reason}
            </button>
          ))}
        </div>

        <div className="mb-6">
          <label className="block text-gray-300 mb-2">Other reason (optional):</label>
          <input
            type="text"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="Type your reason..."
            className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={selectedReasons.length === 0 && !customReason.trim()}
          className={`w-full py-4 bg-${bgColor}-600 text-white text-lg font-bold rounded-lg hover:bg-${bgColor}-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
