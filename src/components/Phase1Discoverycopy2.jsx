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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="mb-8">
            <div className="text-6xl mb-4">🎯</div>
            <div className="inline-block animate-pulse">
              <div className="flex gap-2 mb-6">
                <div className="w-3 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-3 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-3 h-3 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
          <div className="border-2 border-cyan-400 bg-black p-8 max-w-2xl">
            <div className="text-xs text-cyan-400 mb-2 font-mono tracking-widest">MISSION STATUS</div>
            <h2 className="text-4xl font-bold text-cyan-400 mb-4 font-mono tracking-tight">
              [ PHASE 1: TAM DISCOVERY ]
            </h2>
            <div className="text-left space-y-2 text-cyan-300 font-mono text-sm">
              <div className="flex items-center gap-2">
                <span className="text-green-400">●</span>
                <span>INITIALIZING RECONNAISSANCE PROTOCOL...</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-green-400">●</span>
                <span>SCANNING APOLLO DATABASE...</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-yellow-400 animate-pulse">●</span>
                <span>ANALYZING TOTAL ADDRESSABLE MARKET...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ERROR STATE
  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <div className="border-4 border-red-400 bg-gray-900 p-8 max-w-2xl w-full">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">✗</div>
            <div className="text-xs text-red-400 mb-2 font-mono tracking-widest">MISSION FAILED</div>
            <h2 className="text-3xl font-bold text-red-400 mb-4 font-mono">[ SYSTEM ERROR ]</h2>
          </div>
          <div className="border border-red-400/30 bg-black p-6 mb-6">
            <div className="text-xs text-red-400 font-mono mb-2">ERROR MESSAGE:</div>
            <p className="text-red-200 font-mono">{error}</p>
          </div>
          <button
            onClick={startPhase1}
            className="w-full py-4 bg-red-600 text-white text-lg font-bold font-mono hover:bg-red-500 transition-all border-2 border-red-800"
          >
            [ RETRY MISSION ] →
          </button>
        </div>
      </div>
    );
  }

  // RESULTS STATE - Show TAM overview
  if (stage === 'results') {
    return (
      <div className="min-h-screen bg-black py-12 px-6">
        <div className="max-w-6xl mx-auto">
          {/* Mission Header */}
          <div className="border-4 border-cyan-400 bg-black p-8 mb-8">
            <div className="text-center">
              <div className="text-xs text-cyan-400 mb-2 font-mono tracking-widest">RECONNAISSANCE COMPLETE</div>
              <h1 className="text-5xl font-bold text-cyan-400 mb-4 font-mono">
                [ PHASE 1: TAM DISCOVERY ]
              </h1>
              <div className="inline-block border-2 border-green-400 bg-green-900/20 px-6 py-3">
                <div className="text-sm text-green-400 font-mono tracking-wider">MISSION STATUS: SUCCESS</div>
              </div>
            </div>
          </div>

          {/* Main Briefing */}
          <div className="border-2 border-cyan-400/50 bg-gray-900 p-8 mb-6">
            <div className="flex items-center justify-between mb-8 pb-6 border-b-2 border-cyan-400/30">
              <div>
                <div className="text-xs text-cyan-400 mb-1 font-mono tracking-widest">TOTAL ADDRESSABLE MARKET</div>
                <div className="text-7xl font-bold text-cyan-400 font-mono">
                  {discoveryData.totalCount}
                </div>
                <div className="text-cyan-300 font-mono text-sm mt-1">TARGETS IDENTIFIED</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400 font-mono mb-2">CONFIDENCE LEVEL</div>
                <div className="text-4xl font-bold text-green-400 font-mono">HIGH</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              {/* Industry Distribution */}
              <div className="border border-cyan-400/30 bg-black/50 p-6">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-cyan-400/30">
                  <span className="text-2xl">📊</span>
                  <h3 className="text-cyan-400 font-bold font-mono tracking-wide">INDUSTRY BREAKDOWN</h3>
                </div>
                <div className="space-y-3">
                  {discoveryData.analytics?.industries?.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-gray-800/50 p-3 border-l-2 border-cyan-400">
                      <span className="text-gray-300 font-mono text-sm">{item.industry}</span>
                      <span className="text-cyan-400 font-bold font-mono">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Size Distribution */}
              <div className="border border-cyan-400/30 bg-black/50 p-6">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-cyan-400/30">
                  <span className="text-2xl">📏</span>
                  <h3 className="text-cyan-400 font-bold font-mono tracking-wide">SIZE DISTRIBUTION</h3>
                </div>
                <div className="space-y-3">
                  {Object.entries(discoveryData.analytics?.sizes || {}).map(([range, count]) => (
                    count > 0 && (
                      <div key={range} className="flex justify-between items-center bg-gray-800/50 p-3 border-l-2 border-cyan-400">
                        <span className="text-gray-300 font-mono text-sm">{range} employees</span>
                        <span className="text-cyan-400 font-bold font-mono">{count}</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </div>

            {/* Validation Notice */}
            <div className="border-2 border-yellow-400 bg-yellow-900/10 p-6 mb-6">
              <div className="flex items-start gap-4">
                <div className="text-4xl">⚠️</div>
                <div className="flex-1">
                  <h3 className="text-yellow-400 font-bold font-mono text-lg mb-2">VALIDATION REQUIRED</h3>
                  <p className="text-yellow-200 font-mono text-sm mb-3">
                    Review {validationSample.length} sample targets to calibrate Barry's targeting system
                  </p>
                  <div className="text-xs text-yellow-300 font-mono">
                    This data will train Barry to identify perfect-fit companies from your TAM
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleStartValidation}
              className="w-full py-6 bg-cyan-400 text-black text-2xl font-bold font-mono tracking-wider hover:bg-cyan-300 transition-all border-4 border-cyan-600 shadow-lg shadow-cyan-400/50"
            >
              [ INITIATE VALIDATION PROTOCOL ] →
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
    
    // Get company logo from Clearbit
    const companyLogo = currentCompany.website 
      ? `https://logo.clearbit.com/${new URL(currentCompany.website).hostname}`
      : null;

    return (
      <div className="min-h-screen bg-black py-12 px-6">
        <div className="max-w-3xl mx-auto">
          {/* Mission Header */}
          <div className="border-2 border-cyan-400 bg-black p-6 mb-8">
            <div className="text-center">
              <div className="text-xs text-cyan-400 mb-2 font-mono tracking-widest">VALIDATION PROTOCOL</div>
              <h1 className="text-3xl font-bold text-cyan-400 mb-3 font-mono">
                [ TARGET {currentCardIndex + 1} OF {validationSample.length} ]
              </h1>
              <div className="w-full bg-gray-800 h-3 border border-cyan-400/30 mb-3">
                <div 
                  className="bg-gradient-to-r from-cyan-400 to-green-400 h-full transition-all"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <div className="flex justify-center gap-6 text-sm font-mono">
                <span className="text-green-400">✓ ACCEPTED: {validationResults.accepted.length}</span>
                <span className="text-red-400">✗ REJECTED: {validationResults.rejected.length}</span>
              </div>
            </div>
          </div>

          {/* Company Dossier Card */}
          <div className="border-4 border-cyan-400 bg-gray-900 shadow-2xl shadow-cyan-400/20">
            {/* Header with Logo */}
            <div className="bg-black border-b-2 border-cyan-400 p-6">
              <div className="flex items-center gap-6">
                {companyLogo && (
                  <div className="w-20 h-20 border-2 border-cyan-400 bg-white flex items-center justify-center p-2 flex-shrink-0">
                    <img 
                      src={companyLogo} 
                      alt={currentCompany.name}
                      className="w-full h-full object-contain"
                      onError={(e) => e.target.style.display = 'none'}
                    />
                  </div>
                )}
                <div className="flex-1">
                  <div className="text-xs text-cyan-400 font-mono tracking-widest mb-1">TARGET DESIGNATION</div>
                  <h2 className="text-3xl font-bold text-white font-mono">{currentCompany.name}</h2>
                </div>
              </div>
            </div>

            {/* Company Intel */}
            <div className="p-8 space-y-4">
              {/* Primary Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-cyan-400/30 bg-black/50 p-4">
                  <div className="text-xs text-cyan-400 font-mono mb-1">INDUSTRY</div>
                  <div className="text-lg text-white font-mono">{currentCompany.industry}</div>
                </div>
                <div className="border border-cyan-400/30 bg-black/50 p-4">
                  <div className="text-xs text-cyan-400 font-mono mb-1">WORKFORCE</div>
                  <div className="text-lg text-white font-mono">{currentCompany.employees} employees</div>
                </div>
              </div>

              {/* Secondary Intel */}
              <div className="border border-cyan-400/30 bg-black/50 p-4">
                <div className="text-xs text-cyan-400 font-mono mb-2">LOCATION</div>
                <div className="text-white font-mono">📍 {currentCompany.location}</div>
              </div>

              {currentCompany.website && (
                <div className="border border-cyan-400/30 bg-black/50 p-4">
                  <div className="text-xs text-cyan-400 font-mono mb-2">WEB PRESENCE</div>
                  <a 
                    href={currentCompany.website} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-cyan-400 hover:text-cyan-300 font-mono underline flex items-center gap-2"
                  >
                    🌐 {currentCompany.website}
                    <span className="text-xs">↗</span>
                  </a>
                </div>
              )}

              {currentCompany.founded && (
                <div className="border border-cyan-400/30 bg-black/50 p-4">
                  <div className="text-xs text-cyan-400 font-mono mb-2">ESTABLISHED</div>
                  <div className="text-white font-mono">📅 {currentCompany.founded}</div>
                  <div className="text-xs text-gray-400 font-mono mt-1">
                    {new Date().getFullYear() - currentCompany.founded} years in operation
                  </div>
                </div>
              )}
            </div>

            {/* Assessment Question */}
            <div className="border-t-2 border-cyan-400 bg-black p-6">
              <div className="text-center mb-6">
                <div className="text-xs text-cyan-400 font-mono tracking-widest mb-2">ASSESSMENT REQUIRED</div>
                <p className="text-xl text-white font-mono">Does this target match your ICP?</p>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => handleSwipe('reject')}
                  className="py-5 bg-red-600 text-white text-xl font-bold font-mono tracking-wider hover:bg-red-500 transition-all border-4 border-red-800 shadow-lg shadow-red-600/30"
                >
                  ✗ REJECT
                </button>
                <button
                  onClick={() => handleSwipe('accept')}
                  className="py-5 bg-green-600 text-white text-xl font-bold font-mono tracking-wider hover:bg-green-500 transition-all border-4 border-green-800 shadow-lg shadow-green-600/30"
                >
                  ✓ ACCEPT
                </button>
              </div>
            </div>
          </div>

          <div className="text-center mt-6">
            <p className="text-gray-400 font-mono text-sm">
              ← REJECT | ACCEPT →
            </p>
          </div>
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
      <div className="min-h-screen bg-black py-12 px-6">
        <div className="max-w-4xl mx-auto">
          {/* Mission Complete Header */}
          <div className="border-4 border-green-400 bg-black p-8 mb-8">
            <div className="text-center">
              <div className="text-6xl mb-4">✓</div>
              <div className="text-xs text-green-400 mb-2 font-mono tracking-widest">VALIDATION COMPLETE</div>
              <h1 className="text-5xl font-bold text-green-400 mb-4 font-mono">
                [ PHASE 1: SUCCESS ]
              </h1>
              <div className="inline-block border-2 border-green-400 bg-green-900/20 px-6 py-3">
                <div className="text-sm text-green-400 font-mono tracking-wider">BARRY CALIBRATION: COMPLETE</div>
              </div>
            </div>
          </div>

          <div className="border-2 border-green-400/50 bg-gray-900 p-8 mb-6">
            {/* Stats Grid */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="border-2 border-green-400 bg-black p-8 text-center">
                <div className="text-xs text-green-400 font-mono mb-2">TARGETS ACCEPTED</div>
                <div className="text-6xl font-bold text-green-400 mb-2 font-mono">
                  {validationResults.accepted.length}
                </div>
                <div className="text-green-300 font-mono text-sm">POSITIVE SIGNALS</div>
              </div>
              <div className="border-2 border-red-400 bg-black p-8 text-center">
                <div className="text-xs text-red-400 font-mono mb-2">TARGETS REJECTED</div>
                <div className="text-6xl font-bold text-red-400 mb-2 font-mono">
                  {validationResults.rejected.length}
                </div>
                <div className="text-red-300 font-mono text-sm">NEGATIVE SIGNALS</div>
              </div>
            </div>

            {/* Intelligence Report */}
            <div className="border-2 border-cyan-400 bg-black p-6 mb-8">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-cyan-400/30">
                <span className="text-2xl">🧠</span>
                <h3 className="text-cyan-400 font-bold font-mono tracking-wide">INTELLIGENCE GATHERED</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-green-400 font-mono mb-2">✓ POSITIVE PATTERNS IDENTIFIED:</div>
                  <div className="space-y-2">
                    {topAcceptReasons.map(([reason, count]) => (
                      <div key={reason} className="flex items-center gap-3 bg-green-900/20 border-l-2 border-green-400 p-3">
                        <span className="text-green-400 font-mono">●</span>
                        <span className="flex-1 text-green-200 font-mono text-sm">{reason}</span>
                        <span className="text-green-400 font-bold font-mono">x{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {topRejectReasons.length > 0 && (
                  <div>
                    <div className="text-sm text-red-400 font-mono mb-2">✗ NEGATIVE PATTERNS IDENTIFIED:</div>
                    <div className="space-y-2">
                      {topRejectReasons.map(([reason, count]) => (
                        <div key={reason} className="flex items-center gap-3 bg-red-900/20 border-l-2 border-red-400 p-3">
                          <span className="text-red-400 font-mono">●</span>
                          <span className="flex-1 text-red-200 font-mono text-sm">{reason}</span>
                          <span className="text-red-400 font-bold font-mono">x{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Next Phase Notice */}
            <div className="border-2 border-yellow-400 bg-yellow-900/10 p-6 mb-6">
              <div className="flex items-start gap-4">
                <div className="text-4xl">→</div>
                <div className="flex-1">
                  <h3 className="text-yellow-400 font-bold font-mono text-lg mb-2">NEXT PHASE: AI SCORING</h3>
                  <p className="text-yellow-200 font-mono text-sm mb-3">
                    Barry will analyze all {discoveryData.totalCount} companies using your validation patterns
                  </p>
                  <div className="text-xs text-yellow-300 font-mono">
                    Expected output: High-quality scored targets matching your preferences
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleProceedToPhase2}
              className="w-full py-6 bg-green-400 text-black text-2xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
            >
              [ INITIATE PHASE 2: AI SCORING ] →
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
  const color = action === 'accept' ? 'green' : 'red';

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
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
      <div className={`border-4 border-${color}-400 bg-gray-900 p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto`}>
        {/* Header */}
        <div className="border-b-2 border-cyan-400 pb-6 mb-6">
          <div className="text-xs text-cyan-400 font-mono tracking-widest mb-2">
            {action === 'accept' ? 'TARGET ACCEPTED' : 'TARGET REJECTED'}
          </div>
          <h2 className={`text-3xl font-bold text-${color}-400 mb-3 font-mono`}>
            [ REASONING REQUIRED ]
          </h2>
          <p className="text-gray-300 font-mono">
            Why {action === 'accept' ? 'is' : "isn't"}{' '}
            <span className="text-white font-bold">{company.name}</span> a good fit?
          </p>
        </div>

        {/* Reason Selection Grid */}
        <div className="mb-6">
          <div className="text-xs text-cyan-400 font-mono mb-3 tracking-widest">SELECT REASONS:</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {reasons.map((reason) => {
              const isSelected = selectedReasons.includes(reason);
              return (
                <button
                  key={reason}
                  onClick={() => toggleReason(reason)}
                  className={`p-4 text-left font-mono text-sm transition-all border-2 ${
                    isSelected
                      ? `border-${color}-400 bg-${color}-900/30 text-${color}-300`
                      : 'border-gray-600 bg-black text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <span className="mr-2">{isSelected ? '■' : '□'}</span>
                  {reason}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Reason */}
        <div className="mb-6">
          <label className="block text-xs text-cyan-400 font-mono mb-2 tracking-widest">
            CUSTOM REASON (OPTIONAL):
          </label>
          <input
            type="text"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="Type custom reason..."
            className="w-full px-4 py-3 bg-black border-2 border-gray-600 text-white font-mono focus:border-cyan-400 focus:outline-none"
          />
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={selectedReasons.length === 0 && !customReason.trim()}
          className={`w-full py-5 bg-${color}-600 text-white text-xl font-bold font-mono tracking-wider hover:bg-${color}-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed border-4 border-${color}-800`}
        >
          [ CONTINUE ] →
        </button>
      </div>
    </div>
  );
}