import { useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase1Discovery({ scoutData, icpBrief, onComplete }) {
  const [stage, setStage] = useState('loading');
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
  const [lastAction, setLastAction] = useState(null);
  const [error, setError] = useState(null);

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
    
    if (currentCardIndex < validationSample.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
    } else {
      showValidationSummary();
    }
  };

  const showValidationSummary = async () => {
    setStage('summary');
    
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

  // Shared components
  const SpaceBackground = () => (
    <>
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(200)].map((_, i) => (
          <div
            key={i}
            className="absolute bg-white rounded-full"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              top: Math.random() * 100 + '%',
              left: Math.random() * 100 + '%',
              opacity: Math.random() * 0.7 + 0.3,
              animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-cyan-900/20 to-transparent">
        <svg className="w-full h-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="cyan" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>
      </div>
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes floatCode {
          0% { transform: translateY(100vh) translateX(0); }
          100% { transform: translateY(-100vh) translateX(50px); }
        }
      `}</style>
    </>
  );

  const FloatingCode = ({ codes }) => (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {codes.map((code, i) => (
        <div
          key={i}
          className="absolute text-cyan-400/30 font-mono text-sm"
          style={{
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            animation: `floatCode ${15 + i * 3}s linear infinite`,
            animationDelay: `${i * 2}s`
          }}
        >
          {code}
        </div>
      ))}
    </div>
  );

  // LOADING STATE
  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:ONLINE]', '[ANALYZING...]', '[TAM:SCANNING]', '[DATA:ENCRYPTED]', '[MISSION:ACTIVE]', '[TARGETS:LOCKED]']} />

        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="text-center">
            <div className="mb-10">
              <div className="text-9xl mb-8">🎯</div>
              <div className="inline-block animate-pulse">
                <div className="flex gap-4 mb-8">
                  <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-12 max-w-4xl">
              <div className="text-lg text-cyan-400 mb-4 font-mono tracking-widest">MISSION STATUS</div>
              <h2 className="text-6xl font-bold text-cyan-400 mb-10 font-mono tracking-tight">
                [ PHASE 1: TAM DISCOVERY ]
              </h2>
              <div className="text-left space-y-5 text-cyan-300 font-mono text-xl">
                <div className="flex items-center gap-4">
                  <span className="text-green-400 text-2xl">●</span>
                  <span>BARRY AI: INITIALIZING RECONNAISSANCE...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-green-400 text-2xl">●</span>
                  <span>SCANNING APOLLO DATABASE...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-yellow-400 animate-pulse text-2xl">●</span>
                  <span>ANALYZING TOTAL ADDRESSABLE MARKET...</span>
                </div>
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
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[ERROR]', '[MISSION:FAILED]', '[BARRY:STANDBY]', '[RETRY:REQUIRED]']} />
        
        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="border-4 border-red-400 bg-black/90 backdrop-blur-sm p-12 max-w-3xl w-full">
            <div className="text-center mb-10">
              <div className="text-9xl mb-8">✗</div>
              <div className="text-lg text-red-400 mb-4 font-mono tracking-widest">MISSION FAILED</div>
              <h2 className="text-5xl font-bold text-red-400 mb-8 font-mono">[ SYSTEM ERROR ]</h2>
            </div>
            <div className="border border-red-400/30 bg-black p-8 mb-10">
              <div className="text-base text-red-400 font-mono mb-4 tracking-widest">ERROR MESSAGE:</div>
              <p className="text-red-200 font-mono text-xl">{error}</p>
            </div>
            <button
              onClick={startPhase1}
              className="w-full py-6 bg-red-600 text-white text-2xl font-bold font-mono hover:bg-red-500 transition-all border-2 border-red-800"
            >
              [ RETRY MISSION ] →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // RESULTS STATE
  if (stage === 'results') {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:ONLINE]', '[TAM:DISCOVERED]', '[TARGETS:IDENTIFIED]', '[DATA:ANALYZED]', '[MISSION:SUCCESS]', '[ICP:READY]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-xl text-cyan-400 mb-4 font-mono tracking-widest">RECONNAISSANCE COMPLETE</div>
                <h1 className="text-7xl font-bold text-cyan-400 mb-8 font-mono">
                  [ PHASE 1: TAM DISCOVERY ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">MISSION STATUS: SUCCESS</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-cyan-400/50 bg-black/90 backdrop-blur-sm p-12 mb-6">
              <div className="flex items-center justify-between mb-12 pb-10 border-b-2 border-cyan-400/30">
                <div>
                  <div className="text-lg text-cyan-400 mb-3 font-mono tracking-widest">TOTAL ADDRESSABLE MARKET</div>
                  <div className="text-9xl font-bold text-cyan-400 font-mono">
                    {discoveryData.totalCount}
                  </div>
                  <div className="text-cyan-300 font-mono text-2xl mt-3">TARGETS IDENTIFIED BY BARRY</div>
                </div>
                <div className="text-right">
                  <div className="text-lg text-gray-400 font-mono mb-3">CONFIDENCE LEVEL</div>
                  <div className="text-6xl font-bold text-green-400 font-mono">HIGH</div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8 mb-12">
                <div className="border border-cyan-400/30 bg-black/50 p-10">
                  <div className="flex items-center gap-4 mb-8 pb-6 border-b border-cyan-400/30">
                    <span className="text-4xl">📊</span>
                    <h3 className="text-cyan-400 font-bold font-mono tracking-wide text-2xl">INDUSTRY BREAKDOWN</h3>
                  </div>
                  <div className="space-y-5">
                    {discoveryData.analytics?.industries?.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-gray-800/50 p-5 border-l-2 border-cyan-400">
                        <span className="text-gray-300 font-mono text-lg">{item.industry}</span>
                        <span className="text-cyan-400 font-bold font-mono text-2xl">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-cyan-400/30 bg-black/50 p-10">
                  <div className="flex items-center gap-4 mb-8 pb-6 border-b border-cyan-400/30">
                    <span className="text-4xl">📏</span>
                    <h3 className="text-cyan-400 font-bold font-mono tracking-wide text-2xl">SIZE DISTRIBUTION</h3>
                  </div>
                  <div className="space-y-5">
                    {Object.entries(discoveryData.analytics?.sizes || {}).map(([range, count]) => (
                      count > 0 && (
                        <div key={range} className="flex justify-between items-center bg-gray-800/50 p-5 border-l-2 border-cyan-400">
                          <span className="text-gray-300 font-mono text-lg">{range} employees</span>
                          <span className="text-cyan-400 font-bold font-mono text-2xl">{count}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              </div>

              <div className="border-2 border-yellow-400 bg-yellow-900/10 p-10 mb-10">
                <div className="flex items-start gap-6">
                  <div className="text-6xl">⚠️</div>
                  <div className="flex-1">
                    <h3 className="text-yellow-400 font-bold font-mono text-3xl mb-4">VALIDATION REQUIRED</h3>
                    <p className="text-yellow-200 font-mono text-xl mb-5">
                      Review {validationSample.length} sample targets to calibrate Barry's targeting system
                    </p>
                    <div className="text-base text-yellow-300 font-mono">
                      This data will train Barry to identify perfect-fit companies from your TAM
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleStartValidation}
                className="w-full py-8 bg-cyan-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-cyan-300 transition-all border-4 border-cyan-600 shadow-lg shadow-cyan-400/50"
              >
                [ INITIATE VALIDATION PROTOCOL ] →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VALIDATION STATE
  if (stage === 'validation') {
    const currentCompany = validationSample[currentCardIndex];
    const progress = ((currentCardIndex) / validationSample.length) * 100;
    
    const companyLogo = currentCompany.website 
      ? `https://logo.clearbit.com/${new URL(currentCompany.website).hostname}`
      : null;

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:ANALYZING]', '[TARGET:LOCKED]', '[VALIDATION:ACTIVE]', '[ICP:LEARNING]', '[MISSION:PHASE1]', '[DATA:PROCESSING]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-10 mb-10">
              <div className="text-center">
                <div className="text-lg text-cyan-400 mb-3 font-mono tracking-widest">VALIDATION PROTOCOL</div>
                <h1 className="text-5xl font-bold text-cyan-400 mb-6 font-mono">
                  [ TARGET {currentCardIndex + 1} OF {validationSample.length} ]
                </h1>
                <div className="w-full bg-gray-800 h-4 border border-cyan-400/30 mb-4">
                  <div 
                    className="bg-gradient-to-r from-cyan-400 to-green-400 h-full transition-all"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="flex justify-center gap-8 text-lg font-mono">
                  <span className="text-green-400">✓ ACCEPTED: {validationResults.accepted.length}</span>
                  <span className="text-red-400">✗ REJECTED: {validationResults.rejected.length}</span>
                </div>
              </div>
            </div>

            <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm shadow-2xl shadow-cyan-400/20">
              <div className="bg-black border-b-2 border-cyan-400 p-8">
                <div className="flex items-center gap-6">
                  {companyLogo && (
                    <div className="w-24 h-24 border-2 border-cyan-400 bg-white flex items-center justify-center p-3 flex-shrink-0">
                      <img 
                        src={companyLogo} 
                        alt={currentCompany.name}
                        className="w-full h-full object-contain"
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="text-base text-cyan-400 font-mono tracking-widest mb-2">TARGET DESIGNATION</div>
                    <h2 className="text-4xl font-bold text-white font-mono">{currentCompany.name}</h2>
                  </div>
                </div>
              </div>

              <div className="p-10 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="border border-cyan-400/30 bg-black/50 p-6">
                    <div className="text-base text-cyan-400 font-mono mb-2">INDUSTRY</div>
                    <div className="text-2xl text-white font-mono">{currentCompany.industry}</div>
                  </div>
                  <div className="border border-cyan-400/30 bg-black/50 p-6">
                    <div className="text-base text-cyan-400 font-mono mb-2">WORKFORCE</div>
                    <div className="text-2xl text-white font-mono">{currentCompany.employees} employees</div>
                  </div>
                </div>

                <div className="border border-cyan-400/30 bg-black/50 p-6">
                  <div className="text-base text-cyan-400 font-mono mb-3">LOCATION</div>
                  <div className="text-white font-mono text-xl">📍 {currentCompany.location}</div>
                </div>

                {currentCompany.website && (
                  <div className="border border-cyan-400/30 bg-black/50 p-6">
                    <div className="text-base text-cyan-400 font-mono mb-3">WEB PRESENCE</div>
                    <a 
                      href={currentCompany.website} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-cyan-400 hover:text-cyan-300 font-mono text-xl underline flex items-center gap-2"
                    >
                      🌐 {currentCompany.website}
                      <span className="text-base">↗</span>
                    </a>
                  </div>
                )}

                {currentCompany.founded && (
                  <div className="border border-cyan-400/30 bg-black/50 p-6">
                    <div className="text-base text-cyan-400 font-mono mb-3">ESTABLISHED</div>
                    <div className="text-white font-mono text-xl">📅 {currentCompany.founded}</div>
                    <div className="text-base text-gray-400 font-mono mt-2">
                      {new Date().getFullYear() - currentCompany.founded} years in operation
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t-2 border-cyan-400 bg-black p-8">
                <div className="text-center mb-8">
                  <div className="text-base text-cyan-400 font-mono tracking-widest mb-3">ASSESSMENT REQUIRED</div>
                  <p className="text-2xl text-white font-mono">Does this target match your ICP?</p>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <button
                    onClick={() => handleSwipe('reject')}
                    className="py-6 bg-red-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-red-500 transition-all border-4 border-red-800 shadow-lg shadow-red-600/30"
                  >
                    ✗ REJECT
                  </button>
                  <button
                    onClick={() => handleSwipe('accept')}
                    className="py-6 bg-green-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-green-500 transition-all border-4 border-green-800 shadow-lg shadow-green-600/30"
                  >
                    ✓ ACCEPT
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center mt-8">
              <p className="text-gray-400 font-mono text-lg">
                ← REJECT | ACCEPT →
              </p>
            </div>
          </div>
        </div>

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
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:TRAINED]', '[VALIDATION:COMPLETE]', '[ICP:CALIBRATED]', '[MISSION:SUCCESS]', '[PHASE2:READY]', '[TARGETS:LOCKED]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="border-4 border-green-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-8xl mb-6">✓</div>
                <div className="text-xl text-green-400 mb-4 font-mono tracking-widest">VALIDATION COMPLETE</div>
                <h1 className="text-7xl font-bold text-green-400 mb-8 font-mono">
                  [ PHASE 1: SUCCESS ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">BARRY CALIBRATION: COMPLETE</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-green-400/50 bg-black/90 backdrop-blur-sm p-12 mb-6">
              <div className="grid md:grid-cols-2 gap-8 mb-12">
                <div className="border-2 border-green-400 bg-black p-10 text-center">
                  <div className="text-base text-green-400 font-mono mb-3">TARGETS ACCEPTED</div>
                  <div className="text-8xl font-bold text-green-400 mb-3 font-mono">
                    {validationResults.accepted.length}
                  </div>
                  <div className="text-green-300 font-mono text-xl">POSITIVE SIGNALS</div>
                </div>
                <div className="border-2 border-red-400 bg-black p-10 text-center">
                  <div className="text-base text-red-400 font-mono mb-3">TARGETS REJECTED</div>
                  <div className="text-8xl font-bold text-red-400 mb-3 font-mono">
                    {validationResults.rejected.length}
                  </div>
                  <div className="text-red-300 font-mono text-xl">NEGATIVE SIGNALS</div>
                </div>
              </div>

              <div className="border-2 border-cyan-400 bg-black p-10 mb-12">
                <div className="flex items-center gap-4 mb-8 pb-6 border-b border-cyan-400/30">
                  <span className="text-4xl">🧠</span>
                  <h3 className="text-cyan-400 font-bold font-mono tracking-wide text-3xl">INTELLIGENCE GATHERED</h3>
                </div>
                <div className="space-y-6">
                  <div>
                    <div className="text-lg text-green-400 font-mono mb-4">✓ POSITIVE PATTERNS IDENTIFIED:</div>
                    <div className="space-y-4">
                      {topAcceptReasons.map(([reason, count]) => (
                        <div key={reason} className="flex items-center gap-4 bg-green-900/20 border-l-2 border-green-400 p-5">
                          <span className="text-green-400 font-mono text-xl">●</span>
                          <span className="flex-1 text-green-200 font-mono text-xl">{reason}</span>
                          <span className="text-green-400 font-bold font-mono text-2xl">x{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {topRejectReasons.length > 0 && (
                    <div>
                      <div className="text-lg text-red-400 font-mono mb-4">✗ NEGATIVE PATTERNS IDENTIFIED:</div>
                      <div className="space-y-4">
                        {topRejectReasons.map(([reason, count]) => (
                          <div key={reason} className="flex items-center gap-4 bg-red-900/20 border-l-2 border-red-400 p-5">
                            <span className="text-red-400 font-mono text-xl">●</span>
                            <span className="flex-1 text-red-200 font-mono text-xl">{reason}</span>
                            <span className="text-red-400 font-bold font-mono text-2xl">x{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-2 border-yellow-400 bg-yellow-900/10 p-10 mb-10">
                <div className="flex items-start gap-6">
                  <div className="text-6xl">→</div>
                  <div className="flex-1">
                    <h3 className="text-yellow-400 font-bold font-mono text-3xl mb-4">NEXT PHASE: AI SCORING</h3>
                    <p className="text-yellow-200 font-mono text-xl mb-5">
                      Barry will analyze all {discoveryData.totalCount} companies using your validation patterns
                    </p>
                    <div className="text-base text-yellow-300 font-mono">
                      Expected output: High-quality scored targets matching your preferences
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleProceedToPhase2}
                className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
              >
                [ INITIATE PHASE 2: AI SCORING ] →
              </button>
            </div>
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
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-6">
      <div className={`border-4 border-${color}-400 bg-black/95 backdrop-blur-sm p-12 max-w-4xl w-full max-h-[90vh] overflow-y-auto`}>
        <div className="border-b-2 border-cyan-400 pb-8 mb-10">
          <div className="text-base text-cyan-400 font-mono tracking-widest mb-3">
            {action === 'accept' ? 'TARGET ACCEPTED' : 'TARGET REJECTED'}
          </div>
          <h2 className={`text-4xl font-bold text-${color}-400 mb-6 font-mono`}>
            [ REASONING REQUIRED ]
          </h2>
          <p className="text-gray-300 font-mono text-xl">
            Why {action === 'accept' ? 'is' : "isn't"}{' '}
            <span className="text-white font-bold">{company.name}</span> a good fit?
          </p>
        </div>

        <div className="mb-10">
          <div className="text-base text-cyan-400 font-mono mb-5 tracking-widest">SELECT REASONS:</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reasons.map((reason) => {
              const isSelected = selectedReasons.includes(reason);
              return (
                <button
                  key={reason}
                  onClick={() => toggleReason(reason)}
                  className={`p-5 text-left font-mono text-lg transition-all border-2 ${
                    isSelected
                      ? `border-${color}-400 bg-${color}-900/30 text-${color}-300`
                      : 'border-gray-600 bg-black/50 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <span className="mr-3">{isSelected ? '■' : '□'}</span>
                  {reason}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-10">
          <label className="block text-base text-cyan-400 font-mono mb-3 tracking-widest">
            CUSTOM REASON (OPTIONAL):
          </label>
          <input
            type="text"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="Type custom reason..."
            className="w-full px-6 py-4 bg-black border-2 border-gray-600 text-white font-mono text-lg focus:border-cyan-400 focus:outline-none"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={selectedReasons.length === 0 && !customReason.trim()}
          className={`w-full py-6 bg-${color}-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-${color}-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed border-4 border-${color}-800`}
        >
          [ CONTINUE ] →
        </button>
      </div>
    </div>
  );
}