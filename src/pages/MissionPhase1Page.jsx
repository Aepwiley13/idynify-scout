import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import Phase1Discovery from '../components/Phase1Discovery';

export default function MissionPhase1Page() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setUserData(data);
        setLoading(false);
      } else {
        setError('User data not found');
        setLoading(false);
      }
    } catch (err) {
      console.error('Error loading user data:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const handlePhase1Complete = (phase1Data) => {
    console.log('✅ Phase 1 complete, data:', phase1Data);
    // Navigate to Phase 2 with data
    navigate('/mission-phase2', {
      state: { phase1Data }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        {/* Starfield Background */}
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

        {/* Floating Code */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {['[BARRY:LOADING]', '[MISSION:PREP]', '[DATA:LOADING]'].map((code, i) => (
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

        {/* Content */}
        <div className="relative z-10 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="inline-block animate-pulse mb-8">
              <div className="flex gap-3">
                <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
            <p className="text-cyan-400 text-2xl font-mono">Loading mission data...</p>
          </div>
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
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        {/* Starfield Background */}
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
              onClick={() => navigate('/dashboard')}
              className="w-full py-6 bg-red-600 text-white text-2xl font-bold font-mono hover:bg-red-500 transition-all border-2 border-red-800"
            >
              [ BACK TO DASHBOARD ] →
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

  if (!userData?.scoutData) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        {/* Starfield Background */}
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
          <div className="border-4 border-yellow-400 bg-black/90 backdrop-blur-sm p-12 max-w-3xl w-full">
            <div className="text-center mb-10">
              <div className="text-8xl mb-6">⚠</div>
              <h2 className="text-5xl font-bold text-yellow-400 mb-6 font-mono">[ NO SCOUT DATA ]</h2>
            </div>
            <div className="border border-yellow-400/30 bg-black p-8 mb-10">
              <p className="text-yellow-200 font-mono text-xl">Please complete the Scout questionnaire first.</p>
            </div>
            <button
              onClick={() => navigate('/scout-questionnaire')}
              className="w-full py-6 bg-yellow-600 text-white text-2xl font-bold font-mono hover:bg-yellow-500 transition-all border-2 border-yellow-800"
            >
              [ GO TO QUESTIONNAIRE ] →
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
    <Phase1Discovery
      scoutData={userData.scoutData}
      icpBrief={userData.icpBrief}
      onComplete={handlePhase1Complete}
    />
  );
}