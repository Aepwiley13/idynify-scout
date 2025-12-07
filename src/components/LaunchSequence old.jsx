import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

const LaunchSequence = () => {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);

  const stages = [
    { text: '🎯 LOCKING COORDINATES...', duration: 2000 },
    { text: '🌌 SCANNING THE GALAXY...', duration: 3000 },
    { text: '🔍 IDENTIFYING TARGETS...', duration: 4000 },
    { text: '🚀 PREPARING WARP DRIVE...', duration: 3000 },
    { text: '⚡ IDYNIFYING YOUR PROSPECTS...', duration: 4000 },
    { text: '✨ TARGETS ACQUIRED!', duration: 2000 }
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        navigate('/login');
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (!userDoc.exists() || !userDoc.data().scoutCompleted) {
          navigate('/scout-questionnaire');
          return;
        }

        // Start generating leads in the background
        generateLeads(currentUser.uid, userDoc.data());
      } catch (error) {
        console.error('Error:', error);
      }
    });

    return () => unsubscribe();
  }, [navigate]);

  useEffect(() => {
    // Progress bar animation
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) return 100;
        return prev + 1;
      });
    }, 180); // 18 seconds total (180ms x 100)

    // Stage progression
    let currentStage = 0;
    const stageTimeout = () => {
      if (currentStage < stages.length) {
        setStage(currentStage);
        currentStage++;
        setTimeout(stageTimeout, stages[currentStage - 1]?.duration || 2000);
      } else {
        // All stages complete - go to dashboard
        setTimeout(() => {
          navigate('/dashboard?first-launch=true');
        }, 1000);
      }
    };
    stageTimeout();

    return () => {
      clearInterval(progressInterval);
    };
  }, [navigate, stages.length]);

  const generateLeads = async (userId, userData) => {
    try {
      // Call the Apollo API function
      const response = await fetch('/.netlify/functions/generate-leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: userId,
          scoutData: userData.scoutData,
          additionalRequirements: userData.additionalRequirements || '',
          executiveSummary: userData.executiveSummary
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate leads');
      }

      const data = await response.json();
      
      // Save leads to Firebase
      await updateDoc(doc(db, 'users', userId), {
        leads: data.leads,
        leadsGeneratedAt: new Date().toISOString(),
        leadsCount: data.leads.length,
        tier: 'scout'
      });

    } catch (error) {
      console.error('Error generating leads:', error);
      // Still navigate to dashboard even if lead generation fails
      // They can retry from there
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden">
      {/* Animated Stars Background */}
      <div className="absolute inset-0">
        {[...Array(50)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${2 + Math.random() * 2}s`
            }}
          />
        ))}
      </div>

      {/* Animated Background Blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-96 h-96 bg-pink-500/20 rounded-full blur-3xl -top-48 -left-48 animate-pulse"></div>
        <div className="absolute w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl -bottom-48 -right-48 animate-pulse" style={{animationDelay: '1s'}}></div>
        <div className="absolute w-64 h-64 bg-purple-500/30 rounded-full blur-3xl top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 animate-pulse" style={{animationDelay: '0.5s'}}></div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
        <div className="max-w-2xl w-full text-center">
          
          {/* Mission Control Badge */}
          <div className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500/20 to-cyan-500/20 backdrop-blur-sm px-6 py-3 rounded-full mb-8 border border-pink-500/30">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-sm font-bold text-cyan-300 tracking-wider">MISSION CONTROL ACTIVATED</span>
          </div>

          {/* Barry + Rocket Animation */}
          <div className="mb-8 relative">
            <div className="relative inline-block">
              {/* Barry */}
              <div className="text-9xl animate-bounce" style={{animationDuration: '1s'}}>
                🐻
              </div>
              
              {/* Rocket orbiting Barry */}
              <div 
                className="absolute text-5xl"
                style={{
                  animation: 'orbit 3s linear infinite',
                  transformOrigin: 'center'
                }}
              >
                🚀
              </div>

              {/* Sparkles */}
              <div className="absolute -top-4 -left-6 text-3xl animate-pulse">✨</div>
              <div className="absolute -top-6 -right-4 text-2xl animate-pulse" style={{animationDelay: '0.5s'}}>⭐</div>
              <div className="absolute -bottom-4 -right-8 text-3xl animate-pulse" style={{animationDelay: '1s'}}>💫</div>
            </div>
          </div>

          {/* Status Text */}
          <div className="mb-8">
            <h1 className="text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
                LAUNCH SEQUENCE
              </span>
            </h1>
            
            <div className="h-24 flex items-center justify-center">
              <p className="text-3xl font-bold text-white animate-pulse">
                {stages[stage]?.text || '🎯 INITIALIZING...'}
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-8">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-full h-6 overflow-hidden border-2 border-purple-500/30 mb-3">
              <div
                className="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 transition-all duration-300"
                style={{ 
                  width: `${progress}%`,
                  backgroundSize: '200% 100%',
                  animation: 'gradient-shift 2s ease infinite'
                }}
              />
            </div>
            <p className="text-cyan-300 font-mono text-sm">{progress}% COMPLETE</p>
          </div>

          {/* Status Indicators */}
          <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto">
            {[
              { icon: '🎯', label: 'ICP LOCKED', active: stage >= 0 },
              { icon: '🔍', label: 'SCANNING', active: stage >= 2 },
              { icon: '✅', label: 'TARGETS FOUND', active: stage >= 5 }
            ].map((item, i) => (
              <div
                key={i}
                className={`p-4 rounded-xl border-2 transition-all ${
                  item.active
                    ? 'bg-green-500/20 border-green-500/50'
                    : 'bg-slate-800/30 border-slate-700/50'
                }`}
              >
                <div className="text-3xl mb-2">{item.icon}</div>
                <p className={`text-xs font-bold ${item.active ? 'text-green-300' : 'text-slate-500'}`}>
                  {item.label}
                </p>
              </div>
            ))}
          </div>

          {/* Fun Messages */}
          <div className="mt-8">
            <div className="inline-flex items-center gap-3 bg-blue-500/20 backdrop-blur-sm px-6 py-3 rounded-xl border border-blue-500/30">
              <span className="text-2xl">🐻</span>
              <p className="text-blue-200 text-sm">
                {stage === 0 && "Activating targeting systems..."}
                {stage === 1 && "Scanning the B2B universe..."}
                {stage === 2 && "Found some juicy prospects!"}
                {stage === 3 && "Preparing your lead dashboard..."}
                {stage === 4 && "Almost there, Captain!"}
                {stage === 5 && "Mission accomplished! 🎉"}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes orbit {
          0% {
            transform: rotate(0deg) translateX(80px) rotate(0deg);
          }
          100% {
            transform: rotate(360deg) translateX(80px) rotate(-360deg);
          }
        }

        @keyframes gradient-shift {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
      `}</style>
    </div>
  );
};

export default LaunchSequence;