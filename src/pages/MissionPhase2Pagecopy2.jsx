import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import Phase2Scoring from '../components/Phase2Scoring';

export default function MissionPhase2Page() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [phase1Data, setPhase1Data] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadPhase1Data();
  }, []);

  const loadPhase1Data = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check if we have phase1 data from navigation state
      if (location.state?.phase1Data) {
        setPhase1Data(location.state.phase1Data);
        setLoading(false);
        return;
      }

      // Otherwise load from Firebase
      const phase1Doc = await getDoc(doc(db, 'missions', user.uid, 'current', 'phase1'));
      
      if (phase1Doc.exists()) {
        const data = phase1Doc.data();
        setPhase1Data({
          companies: data.allCompanies,
          validation: data.validationResults,
          analytics: data.analytics
        });
        setLoading(false);
      } else {
        setError('Phase 1 data not found. Please complete Phase 1 first.');
        setLoading(false);
      }
    } catch (err) {
      console.error('Error loading Phase 1 data:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const handlePhase2Complete = (phase2Data) => {
    console.log('✅ Phase 2 complete, data:', phase2Data);
    // For now, go back to mission control
    // Later we'll go to Phase 3
    navigate('/mission-control', {
      state: { phase2Complete: true, phase2Data }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
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

        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="inline-block animate-pulse mb-8">
              <div className="flex gap-3">
                <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
            <p className="text-cyan-400 text-2xl font-mono">Loading Phase 2...</p>
          </div>
        </div>

        <style>{`
          @keyframes twinkle {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
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

        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="border-4 border-red-400 bg-black/90 backdrop-blur-sm p-12 max-w-3xl w-full">
            <div className="text-center mb-10">
              <div className="text-8xl mb-6">✗</div>
              <h2 className="text-5xl font-bold text-red-400 mb-6 font-mono">[ ERROR ]</h2>
            </div>
            <div className="border border-red-400/30 bg-black p-8 mb-10">
              <p className="text-red-200 font-mono text-xl">{error}</p>
            </div>
            <button
              onClick={() => navigate('/mission-phase1')}
              className="w-full py-6 bg-red-600 text-white text-2xl font-bold font-mono hover:bg-red-500 transition-all border-2 border-red-800"
            >
              [ BACK TO PHASE 1 ] →
            </button>
          </div>
        </div>

        <style>{`
          @keyframes twinkle {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <Phase2Scoring
      phase1Data={phase1Data}
      onComplete={handlePhase2Complete}
    />
  );
}
