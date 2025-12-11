import { useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase2Scoring({ phase1Data, onComplete }) {
  const [stage, setStage] = useState('loading');
  const [scoredCompanies, setScoredCompanies] = useState([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [selectionResults, setSelectionResults] = useState({
    accepted: [],
    rejected: []
  });
  const [selectionHistory, setSelectionHistory] = useState([]); // Track history for undo
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    startPhase2();
  }, []);

  const startPhase2 = async () => {
    try {
      console.log('⚖️ Starting Phase 2: AI Scoring');
      setStage('loading');
      setProgress(0);

      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + Math.random() * 15, 95));
      }, 500);

      const response = await fetch('/.netlify/functions/barry-phase2-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          companies: phase1Data.companies,
          validation: phase1Data.validation,
          scoutData: phase1Data.validation // This should have scoutData from parent
        })
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to score companies');
      }

      console.log('✅ Phase 2 complete:', data);
      setScoredCompanies(data.scoredCompanies || []);
      setAnalytics(data.analytics);
      
      // Small delay to show 100% progress
      setTimeout(() => {
        setStage('results');
      }, 500);

    } catch (err) {
      console.error('❌ Phase 2 error:', err);
      setError(err.message);
    }
  };

  const handleStartReview = () => {
    setStage('review');
    setCurrentCardIndex(0);
  };

  const handleSwipe = (action) => {
    const currentCompany = scoredCompanies[currentCardIndex];
    setLastAction(action);
    
    if (action === 'accept') {
      setSelectionResults(prev => ({
        ...prev,
        accepted: [...prev.accepted, currentCompany]
      }));
    } else {
      setSelectionResults(prev => ({
        ...prev,
        rejected: [...prev.rejected, currentCompany]
      }));
    }
    
    setShowReasonModal(true);
  };

  const handleReasonSubmit = async (reasons) => {
    const currentCompany = scoredCompanies[currentCardIndex];
    
    // Save history for undo
    setSelectionHistory(prev => [...prev, {
      cardIndex: currentCardIndex,
      action: lastAction,
      company: currentCompany,
      resultsSnapshot: JSON.parse(JSON.stringify(selectionResults))
    }]);

    setShowReasonModal(false);
    
    // Save progress immediately
    await saveProgressToFirebase(selectionResults, currentCardIndex + 1);
    
    if (currentCardIndex < scoredCompanies.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
    } else {
      showSummary();
    }
  };

  // Undo last selection
  const handleUndo = () => {
    if (selectionHistory.length === 0) return;
    
    const lastEntry = selectionHistory[selectionHistory.length - 1];
    setSelectionResults(lastEntry.resultsSnapshot);
    setCurrentCardIndex(lastEntry.cardIndex);
    setSelectionHistory(prev => prev.slice(0, -1));
    
    console.log('↩️ Undid last selection');
  };

  // ✅ FIXED: Save progress incrementally WITH selectedCompanies for Phase 3
  const saveProgressToFirebase = async (results, cardIndex) => {
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase2'), {
        scoredCompanies: scoredCompanies,
        selectionResults: results,
        selectedCompanies: results.accepted, // ✅ CRITICAL FIX: Phase 3 needs this!
        analytics: analytics,
        progress: {
          currentCard: cardIndex,
          totalCards: scoredCompanies.length,
          percentComplete: Math.round((cardIndex / scoredCompanies.length) * 100)
        },
        lastUpdated: serverTimestamp()
      }, { merge: true });
      
      console.log(`💾 Progress saved: ${cardIndex}/${scoredCompanies.length} (${results.accepted.length} selected)`);
    } catch (err) {
      console.error('Error saving progress:', err);
    }
  };

  const showSummary = async () => {
    setStage('summary');
    
    // Mark as complete (data already saved incrementally)
    try {
      const user = auth.currentUser;
      await updateDoc(doc(db, 'missions', user.uid, 'current', 'phase2'), {
        completedAt: serverTimestamp(),
        'progress.percentComplete': 100
      });
      console.log('✅ Phase 2 selection complete');
    } catch (err) {
      console.error('Error marking completion:', err);
    }
  };

  const handleProceedToPhase3 = () => {
    onComplete({
      selectedCompanies: selectionResults.accepted,
      analytics: analytics
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
        <FloatingCode codes={['[BARRY:ANALYZING]', '[AI:SCORING]', '[COMPANIES:PROCESSING]', '[ICP:MATCHING]', '[MISSION:PHASE2]', '[TARGETS:EVALUATING]']} />

        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="text-center max-w-4xl w-full">
            <div className="mb-10">
              <div className="text-9xl mb-8">⚖️</div>
            </div>
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-12">
              <div className="text-lg text-cyan-400 mb-4 font-mono tracking-widest">MISSION STATUS</div>
              <h2 className="text-6xl font-bold text-cyan-400 mb-10 font-mono tracking-tight">
                [ PHASE 2: AI SCORING ]
              </h2>
              
              <div className="mb-10">
                <div className="w-full bg-gray-800 h-6 border border-cyan-400/30 mb-4">
                  <div 
                    className="bg-gradient-to-r from-cyan-400 to-purple-400 h-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="text-cyan-300 font-mono text-2xl">{Math.round(progress)}% COMPLETE</div>
              </div>

              <div className="text-left space-y-5 text-cyan-300 font-mono text-xl">
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 30 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>BARRY AI: FILTERING TOP MATCHES FROM {phase1Data.companies.length} COMPANIES...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 60 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>ANALYZING VALIDATION PATTERNS...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 90 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>SCORING BY PERFECT FIT CRITERIA...</span>
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
              onClick={startPhase2}
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
        <FloatingCode codes={['[BARRY:COMPLETE]', '[SCORING:SUCCESS]', '[TARGETS:QUALIFIED]', '[ICP:MATCHED]', '[MISSION:PHASE2]', '[ANALYSIS:DONE]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-xl text-cyan-400 mb-4 font-mono tracking-widest">SCORING COMPLETE</div>
                <h1 className="text-7xl font-bold text-cyan-400 mb-8 font-mono">
                  [ PHASE 2: AI SCORING ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">MISSION STATUS: SUCCESS</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-cyan-400/50 bg-black/90 backdrop-blur-sm p-12 mb-6">
              <div className="flex items-center justify-between mb-12 pb-10 border-b-2 border-cyan-400/30">
                <div>
                  <div className="text-lg text-cyan-400 mb-3 font-mono tracking-widest">QUALIFIED COMPANIES</div>
                  <div className="text-9xl font-bold text-cyan-400 font-mono">
                    {scoredCompanies.length}
                  </div>
                  <div className="text-cyan-300 font-mono text-2xl mt-3">TARGETS SCORED 60+</div>
                </div>
                <div className="text-right">
                  <div className="text-lg text-gray-400 font-mono mb-3">AVERAGE SCORE</div>
                  <div className="text-6xl font-bold text-purple-400 font-mono">{analytics?.avgScore || 0}</div>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-8 mb-12">
                <div className="border border-cyan-400/30 bg-black/50 p-8 text-center">
                  <div className="text-4xl mb-4">🔥</div>
                  <div className="text-cyan-400 font-mono text-lg mb-2">HOT LEADS</div>
                  <div className="text-5xl font-bold text-red-400 font-mono">
                    {analytics?.scoreRanges?.['90-100'] || 0}
                  </div>
                  <div className="text-gray-400 font-mono text-sm mt-2">90-100 Score</div>
                </div>

                <div className="border border-cyan-400/30 bg-black/50 p-8 text-center">
                  <div className="text-4xl mb-4">⭐</div>
                  <div className="text-cyan-400 font-mono text-lg mb-2">EXCELLENT</div>
                  <div className="text-5xl font-bold text-orange-400 font-mono">
                    {analytics?.scoreRanges?.['80-89'] || 0}
                  </div>
                  <div className="text-gray-400 font-mono text-sm mt-2">80-89 Score</div>
                </div>

                <div className="border border-cyan-400/30 bg-black/50 p-8 text-center">
                  <div className="text-4xl mb-4">✓</div>
                  <div className="text-cyan-400 font-mono text-lg mb-2">GOOD</div>
                  <div className="text-5xl font-bold text-yellow-400 font-mono">
                    {(analytics?.scoreRanges?.['70-79'] || 0) + (analytics?.scoreRanges?.['60-69'] || 0)}
                  </div>
                  <div className="text-gray-400 font-mono text-sm mt-2">60-79 Score</div>
                </div>
              </div>

              <div className="border-2 border-purple-400 bg-purple-900/10 p-10 mb-10">
                <div className="flex items-start gap-6">
                  <div className="text-6xl">👥</div>
                  <div className="flex-1">
                    <h3 className="text-purple-400 font-bold font-mono text-3xl mb-4">COMPANY REVIEW REQUIRED</h3>
                    <p className="text-purple-200 font-mono text-xl mb-5">
                      Barry identified {scoredCompanies.length} qualified companies. Review and select which ones to target for decision-maker discovery.
                    </p>
                    <div className="text-base text-purple-300 font-mono">
                      Only accepted companies will proceed to Phase 3
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleStartReview}
                className="w-full py-8 bg-purple-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-purple-300 transition-all border-4 border-purple-600 shadow-lg shadow-purple-400/50"
              >
                [ REVIEW COMPANIES ] →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // REVIEW STATE - Company cards
  if (stage === 'review') {
    const currentCompany = scoredCompanies[currentCardIndex];
    const reviewProgress = ((currentCardIndex) / scoredCompanies.length) * 100;
    
    const companyLogo = currentCompany.website_url 
      ? `https://logo.clearbit.com/${new URL(currentCompany.website_url).hostname}`
      : null;

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:REVIEWING]', '[TARGET:EVALUATING]', '[COMPANY:ANALYZED]', '[ICP:MATCHING]', '[MISSION:PHASE2]', '[SELECTION:ACTIVE]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-10 mb-10">
              <div className="text-center">
                <div className="text-lg text-cyan-400 mb-3 font-mono tracking-widest">COMPANY REVIEW</div>
                <h1 className="text-5xl font-bold text-cyan-400 mb-6 font-mono">
                  [ COMPANY {currentCardIndex + 1} OF {scoredCompanies.length} ]
                </h1>
                <div className="w-full bg-gray-800 h-4 border border-cyan-400/30 mb-4">
                  <div 
                    className="bg-gradient-to-r from-purple-400 to-pink-400 h-full transition-all"
                    style={{ width: `${reviewProgress}%` }}
                  ></div>
                </div>
                <div className="flex justify-center gap-8 text-lg font-mono">
                  <span className="text-green-400">✓ SELECTED: {selectionResults.accepted.length}</span>
                  <span className="text-red-400">✗ PASSED: {selectionResults.rejected.length}</span>
                </div>
              </div>
            </div>

            {/* Undo button */}
            {selectionHistory.length > 0 && (
              <div className="mb-6">
                <button
                  onClick={handleUndo}
                  className="px-8 py-4 bg-yellow-600 text-white text-xl font-bold font-mono tracking-wider hover:bg-yellow-500 transition-all border-2 border-yellow-800 flex items-center gap-3"
                >
                  ← UNDO LAST SELECTION
                </button>
              </div>
            )}

            <div className="border-4 border-purple-400 bg-black/90 backdrop-blur-sm shadow-2xl shadow-purple-400/20">
              <div className="bg-black border-b-2 border-purple-400 p-8">
                <div className="flex items-center gap-6 mb-6">
                  {companyLogo && (
                    <div className="w-24 h-24 border-2 border-purple-400 bg-white flex items-center justify-center p-3 flex-shrink-0">
                      <img 
                        src={companyLogo} 
                        alt={currentCompany.name}
                        className="w-full h-full object-contain"
                        onError={(e) => e.target.style.display = 'none'}
                      />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-4 mb-2">
                      <div className={`text-4xl font-bold font-mono ${
                        currentCompany.barryScore >= 90 ? 'text-red-400' :
                        currentCompany.barryScore >= 80 ? 'text-orange-400' :
                        'text-yellow-400'
                      }`}>
                        {currentCompany.barryScore}/100
                      </div>
                      <div className={`text-sm font-mono px-3 py-1 border ${
                        currentCompany.barryScore >= 90 ? 'border-red-400 text-red-400' :
                        currentCompany.barryScore >= 80 ? 'border-orange-400 text-orange-400' :
                        'border-yellow-400 text-yellow-400'
                      }`}>
                        {currentCompany.barryScore >= 90 ? '🔥 HOT' :
                         currentCompany.barryScore >= 80 ? '⭐ EXCELLENT' :
                         '✓ GOOD'}
                      </div>
                    </div>
                    <div className="text-base text-purple-400 font-mono tracking-widest mb-2">TARGET COMPANY</div>
                    <h2 className="text-4xl font-bold text-white font-mono">{currentCompany.name}</h2>
                  </div>
                </div>

                {/* Barry's Assessment */}
                <div className="border-2 border-purple-400/30 bg-purple-900/20 p-6">
                  <div className="text-base text-purple-400 font-mono mb-3 tracking-widest">🧠 BARRY'S ASSESSMENT:</div>
                  <p className="text-purple-100 font-mono text-lg leading-relaxed">
                    {currentCompany.barryReason}
                  </p>
                </div>
              </div>

              <div className="p-10 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="border border-purple-400/30 bg-black/50 p-6">
                    <div className="text-base text-purple-400 font-mono mb-2">INDUSTRY</div>
                    <div className="text-2xl text-white font-mono">{currentCompany.industry || 'Unknown'}</div>
                  </div>
                  <div className="border border-purple-400/30 bg-black/50 p-6">
                    <div className="text-base text-purple-400 font-mono mb-2">WORKFORCE</div>
                    <div className="text-2xl text-white font-mono">{currentCompany.estimated_num_employees || 0} employees</div>
                  </div>
                </div>

                {currentCompany.website_url && (
                  <div className="border border-purple-400/30 bg-black/50 p-6">
                    <div className="text-base text-purple-400 font-mono mb-3">WEB PRESENCE</div>
                    <a 
                      href={currentCompany.website_url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-purple-400 hover:text-purple-300 font-mono text-xl underline flex items-center gap-2"
                    >
                      🌐 {currentCompany.website_url}
                      <span className="text-base">↗</span>
                    </a>
                  </div>
                )}
              </div>

              <div className="border-t-2 border-purple-400 bg-black p-8">
                <div className="text-center mb-8">
                  <div className="text-base text-purple-400 font-mono tracking-widest mb-3">SELECTION REQUIRED</div>
                  <p className="text-2xl text-white font-mono">Target this company for Phase 3?</p>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <button
                    onClick={() => handleSwipe('reject')}
                    className="py-6 bg-red-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-red-500 transition-all border-4 border-red-800 shadow-lg shadow-red-600/30"
                  >
                    ✗ PASS
                  </button>
                  <button
                    onClick={() => handleSwipe('accept')}
                    className="py-6 bg-green-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-green-500 transition-all border-4 border-green-800 shadow-lg shadow-green-600/30"
                  >
                    ✓ SELECT
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center mt-8">
              <p className="text-gray-400 font-mono text-lg">
                ← PASS | SELECT →
              </p>
            </div>
          </div>
        </div>

        {showReasonModal && (
          <SimpleReasonModal
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
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[PHASE2:COMPLETE]', '[COMPANIES:SELECTED]', '[BARRY:SUCCESS]', '[MISSION:ADVANCE]', '[PHASE3:READY]', '[TARGETS:LOCKED]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="border-4 border-green-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-8xl mb-6">✓</div>
                <div className="text-xl text-green-400 mb-4 font-mono tracking-widest">SELECTION COMPLETE</div>
                <h1 className="text-7xl font-bold text-green-400 mb-8 font-mono">
                  [ PHASE 2: SUCCESS ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">COMPANIES SELECTED: {selectionResults.accepted.length}</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-green-400/50 bg-black/90 backdrop-blur-sm p-12 mb-6">
              <div className="grid md:grid-cols-2 gap-8 mb-12">
                <div className="border-2 border-green-400 bg-black p-10 text-center">
                  <div className="text-base text-green-400 font-mono mb-3">COMPANIES SELECTED</div>
                  <div className="text-8xl font-bold text-green-400 mb-3 font-mono">
                    {selectionResults.accepted.length}
                  </div>
                  <div className="text-green-300 font-mono text-xl">MOVING TO PHASE 3</div>
                </div>
                <div className="border-2 border-gray-400 bg-black p-10 text-center">
                  <div className="text-base text-gray-400 font-mono mb-3">COMPANIES PASSED</div>
                  <div className="text-8xl font-bold text-gray-400 mb-3 font-mono">
                    {selectionResults.rejected.length}
                  </div>
                  <div className="text-gray-500 font-mono text-xl">NOT PURSUING</div>
                </div>
              </div>

              <div className="border-2 border-yellow-400 bg-yellow-900/10 p-10 mb-10">
                <div className="flex items-start gap-6">
                  <div className="text-6xl">→</div>
                  <div className="flex-1">
                    <h3 className="text-yellow-400 font-bold font-mono text-3xl mb-4">NEXT PHASE: DECISION MAKER DISCOVERY</h3>
                    <p className="text-yellow-200 font-mono text-xl mb-5">
                      Barry will find decision-makers in your {selectionResults.accepted.length} selected companies
                    </p>
                    <div className="text-base text-yellow-300 font-mono">
                      Expected output: Key contacts matching your target job titles
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleProceedToPhase3}
                className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
              >
                [ INITIATE PHASE 3: FIND DECISION MAKERS ] →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Simple Reason Modal (no reason required for Phase 2)
function SimpleReasonModal({ action, company, onSubmit }) {
  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-6">
      <div className={`border-4 border-${action === 'accept' ? 'green' : 'gray'}-400 bg-black/95 backdrop-blur-sm p-12 max-w-3xl w-full`}>
        <div className="text-center">
          <div className="text-8xl mb-6">{action === 'accept' ? '✓' : '→'}</div>
          <h2 className={`text-4xl font-bold text-${action === 'accept' ? 'green' : 'gray'}-400 mb-6 font-mono`}>
            {action === 'accept' ? '[ COMPANY SELECTED ]' : '[ COMPANY PASSED ]'}
          </h2>
          <p className="text-gray-300 font-mono text-xl mb-10">
            <span className="text-white font-bold">{company.name}</span> {action === 'accept' ? 'will proceed to Phase 3' : 'has been passed'}
          </p>
          <button
            onClick={() => onSubmit([])}
            className={`w-full py-6 bg-${action === 'accept' ? 'green' : 'gray'}-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-${action === 'accept' ? 'green' : 'gray'}-500 transition-all border-4 border-${action === 'accept' ? 'green' : 'gray'}-800`}
          >
            [ CONTINUE ] →
          </button>
        </div>
      </div>
    </div>
  );
}
