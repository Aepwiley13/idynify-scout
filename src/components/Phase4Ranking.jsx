import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase4Ranking({ phase3Data, scoutData, onComplete }) {
  const navigate = useNavigate();
  const [stage, setStage] = useState('loading');
  const [rankedContacts, setRankedContacts] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    startRanking();
  }, []);

  const startRanking = async () => {
    try {
      console.log('⭐ Starting Phase 4: AI Ranking');
      setStage('loading');
      setProgress(0);

      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + Math.random() * 10, 95));
      }, 300);

      const response = await fetch('/.netlify/functions/barry-phase4-rank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          contacts: phase3Data.selectedContacts,
          scoutData: scoutData
        })
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to rank contacts');
      }

      console.log('✅ Ranking complete:', data);
      setRankedContacts(data.rankedContacts || []);
      
      // Save to Firebase
      await saveRankingsToFirebase(data.rankedContacts);

      setTimeout(() => {
        setStage('review');
      }, 500);

    } catch (err) {
      console.error('❌ Phase 4 error:', err);
      setError(err.message);
    }
  };

  const saveRankingsToFirebase = async (rankings) => {
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase4'), {
        rankedContacts: rankings,
        totalContacts: rankings.length,
        completedAt: serverTimestamp()
      });
      console.log('💾 Rankings saved to Firebase');
    } catch (err) {
      console.error('Error saving rankings:', err);
    }
  };

  const handleMoveUp = (index) => {
    if (index === 0) return;
    
    const newRanked = [...rankedContacts];
    [newRanked[index - 1], newRanked[index]] = [newRanked[index], newRanked[index - 1]];
    
    // Update ranks
    newRanked.forEach((contact, idx) => {
      contact.barryRank = idx + 1;
    });
    
    setRankedContacts(newRanked);
  };

  const handleMoveDown = (index) => {
    if (index === rankedContacts.length - 1) return;
    
    const newRanked = [...rankedContacts];
    [newRanked[index], newRanked[index + 1]] = [newRanked[index + 1], newRanked[index]];
    
    // Update ranks
    newRanked.forEach((contact, idx) => {
      contact.barryRank = idx + 1;
    });
    
    setRankedContacts(newRanked);
  };

  const handleComplete = async () => {
    await saveRankingsToFirebase(rankedContacts);
    onComplete({
      rankedContacts: rankedContacts
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
        <FloatingCode codes={['[BARRY:ANALYZING]', '[RANKING:PROCESSING]', '[AI:SCORING]', '[FIT:CALCULATING]', '[MISSION:PHASE4]', '[INTELLIGENCE:ACTIVE]']} />

        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="text-center max-w-4xl w-full">
            <div className="mb-10">
              <div className="text-9xl mb-8">⭐</div>
            </div>
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-12">
              <div className="text-lg text-cyan-400 mb-4 font-mono tracking-widest">MISSION STATUS</div>
              <h2 className="text-6xl font-bold text-cyan-400 mb-10 font-mono tracking-tight">
                [ PHASE 4: AI RANKING ]
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
                  <span>BARRY AI: ANALYZING {phase3Data.selectedContacts?.length || 0} CONTACTS...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 60 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>CALCULATING FIT SCORES...</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-2xl ${progress > 90 ? 'text-green-400' : 'text-yellow-400 animate-pulse'}`}>●</span>
                  <span>GENERATING SMART RANKINGS...</span>
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
        <FloatingCode codes={['[ERROR]', '[MISSION:FAILED]', '[BARRY:STANDBY]']} />
        
        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="border-4 border-red-400 bg-black/90 backdrop-blur-sm p-12 max-w-3xl w-full">
            <div className="text-center mb-10">
              <div className="text-9xl mb-8">✗</div>
              <h2 className="text-5xl font-bold text-red-400 mb-6 font-mono">[ ERROR ]</h2>
            </div>
            <div className="border border-red-400/30 bg-black p-8 mb-10">
              <p className="text-red-200 font-mono text-xl">{error}</p>
            </div>
            <button
              onClick={startRanking}
              className="w-full py-6 bg-red-600 text-white text-2xl font-bold font-mono hover:bg-red-500 transition-all"
            >
              [ RETRY ] →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // REVIEW STATE
  if (stage === 'review') {
    const topTier = rankedContacts.filter(c => c.barryScore >= 90);
    const excellent = rankedContacts.filter(c => c.barryScore >= 80 && c.barryScore < 90);
    const good = rankedContacts.filter(c => c.barryScore >= 70 && c.barryScore < 80);

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:COMPLETE]', '[RANKING:READY]', '[CONTACTS:PRIORITIZED]', '[MISSION:PHASE4]', '[SUCCESS:100%]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-7xl mx-auto">
            
            {/* Header */}
            <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-xl text-cyan-400 mb-4 font-mono tracking-widest">RANKING COMPLETE</div>
                <h1 className="text-7xl font-bold text-cyan-400 mb-8 font-mono">
                  [ PHASE 4: PRIORITIZED TARGETS ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">
                    {rankedContacts.length} CONTACTS RANKED
                  </div>
                </div>
              </div>
            </div>

            {/* Score Distribution */}
            <div className="border-2 border-cyan-400/50 bg-black/90 backdrop-blur-sm p-10 mb-10">
              <h3 className="text-cyan-400 font-bold font-mono text-3xl mb-8">📊 SCORE DISTRIBUTION</h3>
              
              <div className="grid md:grid-cols-3 gap-6">
                <div className="border border-red-500/30 bg-red-900/10 p-6 text-center">
                  <div className="text-4xl mb-3">🔥</div>
                  <div className="text-red-400 font-mono text-lg mb-2">TOP TIER (90-100)</div>
                  <div className="text-5xl font-bold text-red-400 font-mono">{topTier.length}</div>
                </div>

                <div className="border border-orange-500/30 bg-orange-900/10 p-6 text-center">
                  <div className="text-4xl mb-3">⭐</div>
                  <div className="text-orange-400 font-mono text-lg mb-2">EXCELLENT (80-89)</div>
                  <div className="text-5xl font-bold text-orange-400 font-mono">{excellent.length}</div>
                </div>

                <div className="border border-yellow-500/30 bg-yellow-900/10 p-6 text-center">
                  <div className="text-4xl mb-3">✓</div>
                  <div className="text-yellow-400 font-mono text-lg mb-2">GOOD (70-79)</div>
                  <div className="text-5xl font-bold text-yellow-400 font-mono">{good.length}</div>
                </div>
              </div>
            </div>

            {/* Ranked List */}
            <div className="border-2 border-purple-400 bg-black/90 backdrop-blur-sm p-10 mb-6">
              <div className="flex items-center justify-between mb-8 pb-6 border-b border-purple-400/30">
                <div>
                  <h3 className="text-purple-400 font-bold font-mono text-3xl">🎯 RANKED TARGETS</h3>
                  <p className="text-purple-300 font-mono text-lg mt-2">
                    Ordered by Barry's AI fit score • Adjust manually if needed
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {rankedContacts.map((contact, idx) => (
                  <RankedContactCard
                    key={contact.id}
                    contact={contact}
                    index={idx}
                    total={rankedContacts.length}
                    onMoveUp={() => handleMoveUp(idx)}
                    onMoveDown={() => handleMoveDown(idx)}
                  />
                ))}
              </div>
            </div>

            {/* Complete Button */}
            <button
              onClick={handleComplete}
              className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
            >
              [ PROCEED TO CAMPAIGN BUILDER ] →
            </button>

          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Ranked Contact Card Component
function RankedContactCard({ contact, index, total, onMoveUp, onMoveDown }) {
  const getScoreBadge = (score) => {
    if (score >= 90) return { color: 'red', label: '🔥 TOP TIER', bg: 'bg-red-900/20', border: 'border-red-400' };
    if (score >= 80) return { color: 'orange', label: '⭐ EXCELLENT', bg: 'bg-orange-900/20', border: 'border-orange-400' };
    if (score >= 70) return { color: 'yellow', label: '✓ GOOD', bg: 'bg-yellow-900/20', border: 'border-yellow-400' };
    return { color: 'gray', label: '○ DECENT', bg: 'bg-gray-900/20', border: 'border-gray-400' };
  };

  const badge = getScoreBadge(contact.barryScore);
  const company = contact.companyContext || contact.organization || {};

  return (
    <div className={`border-2 ${badge.border} ${badge.bg} p-6`}>
      <div className="flex items-start gap-6">
        
        {/* Rank Badge */}
        <div className="flex-shrink-0">
          <div className={`w-20 h-20 border-2 ${badge.border} ${badge.bg} flex flex-col items-center justify-center`}>
            <div className="text-xs text-gray-400 font-mono">RANK</div>
            <div className={`text-3xl font-bold text-${badge.color}-400 font-mono`}>#{contact.barryRank}</div>
          </div>
        </div>

        {/* Contact Info */}
        <div className="flex-1">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="text-white font-bold font-mono text-2xl mb-2">{contact.name}</h4>
              <div className="text-cyan-300 font-mono text-lg mb-2">{contact.title}</div>
              <div className="text-gray-400 font-mono text-base">
                🏢 {company.name} ({company.size || contact.companyContext?.estimated_num_employees || '?'} employees)
              </div>
            </div>

            {/* Score */}
            <div className="text-right">
              <div className="text-sm text-gray-400 font-mono mb-1">SCORE</div>
              <div className={`text-5xl font-bold text-${badge.color}-400 font-mono`}>{contact.barryScore}</div>
              <div className={`text-${badge.color}-400 font-mono text-sm mt-1`}>{badge.label}</div>
            </div>
          </div>

          {/* Barry's Reasoning */}
          <div className="border border-cyan-400/30 bg-cyan-900/10 p-4 mb-4">
            <div className="text-xs text-cyan-400 font-mono mb-2">🧠 BARRY'S REASONING:</div>
            <p className="text-cyan-200 font-mono text-sm">{contact.barryReasoning}</p>
          </div>

          {/* Contact Details */}
          <div className="flex gap-6 text-sm font-mono text-gray-300">
            {contact.email && (
              <span className="flex items-center gap-2">
                📧 {contact.email}
                {contact.emailStatus === 'verified' && <span className="text-green-400">(✓)</span>}
              </span>
            )}
            {contact.linkedinUrl && (
              <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                💼 LinkedIn ↗
              </a>
            )}
            {contact.seniority && (
              <span className="text-purple-300">
                {contact.seniority.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Move Buttons */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="px-4 py-2 bg-gray-700 text-white text-sm font-mono hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ▲
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="px-4 py-2 bg-gray-700 text-white text-sm font-mono hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ▼
          </button>
        </div>

      </div>
    </div>
  );
}
