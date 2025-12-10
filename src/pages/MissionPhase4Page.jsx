import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import Phase4Ranking from '../components/Phase4Ranking';

export default function MissionPhase4Page() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [phase3Data, setPhase3Data] = useState(null);
  const [scoutData, setScoutData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check if we have phase3 data from navigation state
      if (location.state?.phase3Data) {
        setPhase3Data(location.state.phase3Data);
      } else {
        // Load from Firebase
        const phase3Doc = await getDoc(doc(db, 'missions', user.uid, 'current', 'phase3'));
        
        if (phase3Doc.exists()) {
          const data = phase3Doc.data();
          
          // Flatten all accepted contacts from all companies
          const allAcceptedContacts = [];
          if (data.allSelections) {
            Object.values(data.allSelections).forEach(selection => {
              if (selection.accepted) {
                allAcceptedContacts.push(...selection.accepted);
              }
            });
          }
          
          setPhase3Data({
            selectedContacts: allAcceptedContacts
          });
        } else {
          setError('Phase 3 data not found. Please complete Phase 3 first.');
          setLoading(false);
          return;
        }
      }

      // Load scout data
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        setScoutData(userDoc.data().scoutData || {});
      }

      setLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const handlePhase4Complete = (phase4Data) => {
    console.log('✅ Phase 4 complete, data:', phase4Data);
    // Navigate to Phase 5 (Campaign Builder)
    navigate('/mission-phase5', {
      state: { phase4Data }
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
            <p className="text-cyan-400 text-2xl font-mono">Loading Phase 4...</p>
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
              onClick={() => navigate('/mission-phase3')}
              className="w-full py-6 bg-red-600 text-white text-2xl font-bold font-mono hover:bg-red-500 transition-all border-2 border-red-800"
            >
              [ BACK TO PHASE 3 ] →
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
    <Phase4Ranking
      phase3Data={phase3Data}
      scoutData={scoutData}
      onComplete={handlePhase4Complete}
    />
  );
}
