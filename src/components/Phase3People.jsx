import { useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase3People({ phase2Data, scoutData, onComplete }) {
  const [stage, setStage] = useState('loading');
  const [people, setPeople] = useState([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [selectionResults, setSelectionResults] = useState({
    accepted: [],
    rejected: []
  });
  const [selectionHistory, setSelectionHistory] = useState([]);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    startPhase3();
  }, []);

  const startPhase3 = async () => {
    try {
      console.log('👥 Starting Phase 3: Decision Maker Discovery');
      setStage('loading');
      setProgress(0);

      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + Math.random() * 15, 95));
      }, 500);

      const response = await fetch('/.netlify/functions/barry-phase3-people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          selectedCompanies: phase2Data.selectedCompanies,
          targetTitles: scoutData.targetTitles || []
        })
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to find decision makers');
      }

      console.log('✅ Phase 3 complete:', data);
      setPeople(data.people || []);
      setAnalytics(data.analytics);
      
      setTimeout(() => {
        setStage('results');
      }, 500);

    } catch (err) {
      console.error('❌ Phase 3 error:', err);
      setError(err.message);
    }
  };

  const handleStartReview = () => {
    setStage('review');
    setCurrentCardIndex(0);
  };

  const handleSwipe = (action) => {
    const currentPerson = people[currentCardIndex];
    setLastAction(action);
    
    if (action === 'accept') {
      setSelectionResults(prev => ({
        ...prev,
        accepted: [...prev.accepted, currentPerson]
      }));
    } else {
      setSelectionResults(prev => ({
        ...prev,
        rejected: [...prev.rejected, currentPerson]
      }));
    }
    
    setShowReasonModal(true);
  };

  const handleReasonSubmit = async (reasons) => {
    const currentPerson = people[currentCardIndex];
    
    setSelectionHistory(prev => [...prev, {
      cardIndex: currentCardIndex,
      action: lastAction,
      person: currentPerson,
      resultsSnapshot: JSON.parse(JSON.stringify(selectionResults))
    }]);

    setShowReasonModal(false);
    
    await saveProgressToFirebase(selectionResults, currentCardIndex + 1);
    
    if (currentCardIndex < people.length - 1) {
      setCurrentCardIndex(currentCardIndex + 1);
    } else {
      showSummary();
    }
  };

  const handleUndo = () => {
    if (selectionHistory.length === 0) return;
    
    const lastEntry = selectionHistory[selectionHistory.length - 1];
    setSelectionResults(lastEntry.resultsSnapshot);
    setCurrentCardIndex(lastEntry.cardIndex);
    setSelectionHistory(prev => prev.slice(0, -1));
    
    console.log('↩️ Undid last selection');
  };

  const saveProgressToFirebase = async (results, cardIndex) => {
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase3'), {
        people: people,
        selectionResults: results,
        analytics: analytics,
        progress: {
          currentCard: cardIndex,
          totalCards: people.length,
          percentComplete: Math.round((cardIndex / people.length) * 100)
        },
        lastUpdated: serverTimestamp()
      }, { merge: true });
      
      console.log(`💾 Progress saved: ${cardIndex}/${people.length}`);
    } catch (err) {
      console.error('Error saving progress:', err);
    }
  };

  const showSummary = async () => {
    setStage('summary');
    
    try {
      const user = auth.currentUser;
      await updateDoc(doc(db, 'missions', user.uid, 'current', 'phase3'), {
        completedAt: serverTimestamp(),
        'progress.percentComplete': 100
      });
      console.log('✅ Phase 3 selection complete');
    } catch (err) {
      console.error('Error marking completion:', err);
    }
  };

  const handleProceedToPhase4 = () => {
    onComplete({
      selectedPeople: selectionResults.accepted,
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
        <FloatingCode codes={['[BARRY:SEARCHING]', '[PEOPLE:DISCOVERING]', '[LINKEDIN:ANALYZING]', '[CONTACTS:FINDING]', '[MISSION:PHASE3]', '[TARGETS:IDENTIFYING]']} />

        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="text-center max-w-4xl w-full">
            <div className="mb-10">
              <div className="text-9xl mb-8">👥</div>
            </div>
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-12">
              <div className="text-lg text-cyan-400 mb-4 font-mono tracking-widest">MISSION STATUS</div>
              <h2 className="text-6xl font-bold text-cyan-400 mb-10 font-mono tracking-tight">
                [ PHASE 3: DECISION MAKER DISCOVERY ]
              </h2>
              
              <div className="mb-10">
                <div className="w-full bg-gray-800 h-6 border border-cyan-400/30 mb-4">
                  <div 
                    className="bg-gradient-to-r from-cyan-400 to-green-400 h-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="text-cyan-300 font-mono text-2xl">{Math.round(progress)}% COMPLETE</div>
              </div>

              <div className="text-left space-y-5 text-cyan-300 font-mono text-xl">
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 30 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>BARRY AI: SEARCHING {phase2Data.selectedCompanies.length} COMPANIES...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 60 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>IDENTIFYING DECISION MAKERS...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 90 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>ENRICHING LINKEDIN PROFILES...</span>
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
              onClick={startPhase3}
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
        <FloatingCode codes={['[BARRY:COMPLETE]', '[PEOPLE:FOUND]', '[CONTACTS:READY]', '[LINKEDIN:ENRICHED]', '[MISSION:PHASE3]', '[REVIEW:PENDING]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-7xl mx-auto">
            <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-xl text-cyan-400 mb-4 font-mono tracking-widest">DISCOVERY COMPLETE</div>
                <h1 className="text-7xl font-bold text-cyan-400 mb-8 font-mono">
                  [ PHASE 3: DECISION MAKERS ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">MISSION STATUS: SUCCESS</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-cyan-400/50 bg-black/90 backdrop-blur-sm p-12 mb-6">
              <div className="flex items-center justify-between mb-12 pb-10 border-b-2 border-cyan-400/30">
                <div>
                  <div className="text-lg text-cyan-400 mb-3 font-mono tracking-widest">DECISION MAKERS FOUND</div>
                  <div className="text-9xl font-bold text-cyan-400 font-mono">
                    {people.length}
                  </div>
                  <div className="text-cyan-300 font-mono text-2xl mt-3">CONTACTS DISCOVERED</div>
                </div>
                <div className="text-right">
                  <div className="text-lg text-gray-400 font-mono mb-3">AVG PER COMPANY</div>
                  <div className="text-6xl font-bold text-purple-400 font-mono">{analytics?.avgPerCompany || 0}</div>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-8 mb-12">
                <div className="border border-cyan-400/30 bg-black/50 p-8 text-center">
                  <div className="text-4xl mb-4">📧</div>
                  <div className="text-cyan-400 font-mono text-lg mb-2">WITH EMAIL</div>
                  <div className="text-5xl font-bold text-green-400 font-mono">
                    {analytics?.withEmail || 0}
                  </div>
                  <div className="text-gray-400 font-mono text-sm mt-2">Contacts</div>
                </div>

                <div className="border border-cyan-400/30 bg-black/50 p-8 text-center">
                  <div className="text-4xl mb-4">💼</div>
                  <div className="text-cyan-400 font-mono text-lg mb-2">WITH LINKEDIN</div>
                  <div className="text-5xl font-bold text-blue-400 font-mono">
                    {analytics?.withLinkedIn || 0}
                  </div>
                  <div className="text-gray-400 font-mono text-sm mt-2">Profiles</div>
                </div>

                <div className="border border-cyan-400/30 bg-black/50 p-8 text-center">
                  <div className="text-4xl mb-4">📱</div>
                  <div className="text-cyan-400 font-mono text-lg mb-2">WITH PHONE</div>
                  <div className="text-5xl font-bold text-orange-400 font-mono">
                    {analytics?.withPhone || 0}
                  </div>
                  <div className="text-gray-400 font-mono text-sm mt-2">Numbers</div>
                </div>
              </div>

              <div className="border-2 border-purple-400 bg-purple-900/10 p-10 mb-10">
                <div className="flex items-start gap-6">
                  <div className="text-6xl">👤</div>
                  <div className="flex-1">
                    <h3 className="text-purple-400 font-bold font-mono text-3xl mb-4">CONTACT REVIEW REQUIRED</h3>
                    <p className="text-purple-200 font-mono text-xl mb-5">
                      Review each decision maker and select who to target for outreach.
                    </p>
                    <div className="text-base text-purple-300 font-mono">
                      Only selected contacts will move to Phase 4
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleStartReview}
                className="w-full py-8 bg-purple-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-purple-300 transition-all border-4 border-purple-600 shadow-lg shadow-purple-400/50"
              >
                [ REVIEW CONTACTS ] →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // REVIEW STATE
  if (stage === 'review') {
    const currentPerson = people[currentCardIndex];
    const reviewProgress = ((currentCardIndex) / people.length) * 100;

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:REVIEWING]', '[CONTACT:EVALUATING]', '[LINKEDIN:ANALYZED]', '[PROFILE:ENRICHED]', '[MISSION:PHASE3]', '[SELECTION:ACTIVE]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-10 mb-10">
              <div className="text-center">
                <div className="text-lg text-cyan-400 mb-3 font-mono tracking-widest">CONTACT REVIEW</div>
                <h1 className="text-5xl font-bold text-cyan-400 mb-6 font-mono">
                  [ CONTACT {currentCardIndex + 1} OF {people.length} ]
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
              {/* Header with photo and company */}
              <div className="bg-black border-b-2 border-purple-400 p-10">
                <div className="flex items-start gap-8 mb-6">
                  {/* Profile Photo */}
                  {currentPerson.photoUrl ? (
                    <div className="w-32 h-32 border-4 border-purple-400 bg-gray-900 flex-shrink-0 overflow-hidden">
                      <img 
                        src={currentPerson.photoUrl} 
                        alt={currentPerson.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.innerHTML = '<div class="w-full h-full flex items-center justify-center text-6xl">👤</div>';
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-32 h-32 border-4 border-purple-400 bg-gray-900 flex items-center justify-center flex-shrink-0">
                      <div className="text-6xl">👤</div>
                    </div>
                  )}

                  <div className="flex-1">
                    <div className="text-base text-purple-400 font-mono tracking-widest mb-2">DECISION MAKER</div>
                    <h2 className="text-5xl font-bold text-white font-mono mb-3">{currentPerson.name}</h2>
                    <div className="text-2xl text-cyan-400 font-mono mb-4">{currentPerson.title}</div>
                    
                    {/* Company Badge */}
                    <div className="inline-block border-2 border-cyan-400 bg-cyan-900/20 px-6 py-3 mb-4">
                      <div className="text-cyan-400 font-mono text-lg">
                        🏢 {currentPerson.companyContext.name}
                      </div>
                    </div>

                    {/* Seniority Badge */}
                    {currentPerson.seniority && (
                      <div className="inline-block border border-purple-400/50 bg-purple-900/20 px-4 py-2 ml-3">
                        <div className="text-purple-300 font-mono text-sm">
                          {currentPerson.seniority.toUpperCase()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* LinkedIn Headline */}
                {currentPerson.headline && (
                  <div className="border-2 border-purple-400/30 bg-purple-900/20 p-6">
                    <div className="text-base text-purple-400 font-mono mb-3 tracking-widest">💼 LINKEDIN HEADLINE:</div>
                    <p className="text-purple-100 font-mono text-lg leading-relaxed">
                      {currentPerson.headline}
                    </p>
                  </div>
                )}
              </div>

              {/* Contact & Professional Details */}
              <div className="p-10 space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Email */}
                  {currentPerson.email && (
                    <div className="border border-purple-400/30 bg-black/50 p-6">
                      <div className="text-base text-purple-400 font-mono mb-3 flex items-center gap-2">
                        📧 EMAIL 
                        {currentPerson.emailStatus === 'verified' && (
                          <span className="text-xs text-green-400">(VERIFIED)</span>
                        )}
                      </div>
                      <a 
                        href={`mailto:${currentPerson.email}`}
                        className="text-purple-300 hover:text-purple-200 font-mono text-lg break-all"
                      >
                        {currentPerson.email}
                      </a>
                    </div>
                  )}

                  {/* LinkedIn */}
                  {currentPerson.linkedinUrl && (
                    <div className="border border-purple-400/30 bg-black/50 p-6">
                      <div className="text-base text-purple-400 font-mono mb-3">💼 LINKEDIN PROFILE</div>
                      <a 
                        href={currentPerson.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-mono text-lg underline flex items-center gap-2"
                      >
                        View Profile ↗
                      </a>
                    </div>
                  )}
                </div>

                {/* Phone */}
                {currentPerson.phone && (
                  <div className="border border-purple-400/30 bg-black/50 p-6">
                    <div className="text-base text-purple-400 font-mono mb-3">📱 PHONE</div>
                    <a 
                      href={`tel:${currentPerson.phone}`}
                      className="text-purple-300 hover:text-purple-200 font-mono text-xl"
                    >
                      {currentPerson.phone}
                    </a>
                  </div>
                )}

                {/* Employment History */}
                {currentPerson.employmentHistory && currentPerson.employmentHistory.length > 0 && (
                  <div className="border border-purple-400/30 bg-black/50 p-6">
                    <div className="text-base text-purple-400 font-mono mb-4 tracking-widest">📋 EMPLOYMENT HISTORY</div>
                    <div className="space-y-4">
                      {currentPerson.employmentHistory.slice(0, 3).map((job, idx) => (
                        <div key={idx} className="border-l-2 border-purple-400/50 pl-4">
                          <div className="text-white font-mono text-lg font-bold">{job.title}</div>
                          <div className="text-purple-300 font-mono text-base">{job.company}</div>
                          <div className="text-gray-400 font-mono text-sm">
                            {job.startDate || 'N/A'} - {job.current ? 'Present' : (job.endDate || 'N/A')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Departments */}
                {currentPerson.departments && currentPerson.departments.length > 0 && (
                  <div className="border border-purple-400/30 bg-black/50 p-6">
                    <div className="text-base text-purple-400 font-mono mb-3">🎯 DEPARTMENTS</div>
                    <div className="flex flex-wrap gap-2">
                      {currentPerson.departments.map((dept, idx) => (
                        <span 
                          key={idx}
                          className="px-4 py-2 border border-purple-400/50 bg-purple-900/20 text-purple-300 font-mono text-sm"
                        >
                          {dept}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="border-t-2 border-purple-400 bg-black p-8">
                <div className="text-center mb-8">
                  <div className="text-base text-purple-400 font-mono tracking-widest mb-3">SELECTION REQUIRED</div>
                  <p className="text-2xl text-white font-mono">Target this decision maker?</p>
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
            person={currentPerson}
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
        <FloatingCode codes={['[PHASE3:COMPLETE]', '[CONTACTS:SELECTED]', '[BARRY:SUCCESS]', '[MISSION:ADVANCE]', '[PHASE4:READY]', '[TARGETS:LOCKED]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="border-4 border-green-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-8xl mb-6">✓</div>
                <div className="text-xl text-green-400 mb-4 font-mono tracking-widest">SELECTION COMPLETE</div>
                <h1 className="text-7xl font-bold text-green-400 mb-8 font-mono">
                  [ PHASE 3: SUCCESS ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">CONTACTS SELECTED: {selectionResults.accepted.length}</div>
                </div>
              </div>
            </div>

            <div className="border-2 border-green-400/50 bg-black/90 backdrop-blur-sm p-12 mb-6">
              <div className="grid md:grid-cols-2 gap-8 mb-12">
                <div className="border-2 border-green-400 bg-black p-10 text-center">
                  <div className="text-base text-green-400 font-mono mb-3">CONTACTS SELECTED</div>
                  <div className="text-8xl font-bold text-green-400 mb-3 font-mono">
                    {selectionResults.accepted.length}
                  </div>
                  <div className="text-green-300 font-mono text-xl">READY FOR OUTREACH</div>
                </div>
                <div className="border-2 border-gray-400 bg-black p-10 text-center">
                  <div className="text-base text-gray-400 font-mono mb-3">CONTACTS PASSED</div>
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
                    <h3 className="text-yellow-400 font-bold font-mono text-3xl mb-4">MISSION COMPLETE!</h3>
                    <p className="text-yellow-200 font-mono text-xl mb-5">
                      You've identified {selectionResults.accepted.length} high-value decision makers ready for targeted outreach.
                    </p>
                    <div className="text-base text-yellow-300 font-mono">
                      Next: Profile enrichment, AI ranking, and campaign activation
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={handleProceedToPhase4}
                className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
              >
                [ COMPLETE MISSION ] →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Simple Reason Modal
function SimpleReasonModal({ action, person, onSubmit }) {
  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-6">
      <div className={`border-4 border-${action === 'accept' ? 'green' : 'gray'}-400 bg-black/95 backdrop-blur-sm p-12 max-w-3xl w-full`}>
        <div className="text-center">
          <div className="text-8xl mb-6">{action === 'accept' ? '✓' : '→'}</div>
          <h2 className={`text-4xl font-bold text-${action === 'accept' ? 'green' : 'gray'}-400 mb-6 font-mono`}>
            {action === 'accept' ? '[ CONTACT SELECTED ]' : '[ CONTACT PASSED ]'}
          </h2>
          <p className="text-gray-300 font-mono text-xl mb-10">
            <span className="text-white font-bold">{person.name}</span> at <span className="text-white font-bold">{person.companyContext.name}</span>
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