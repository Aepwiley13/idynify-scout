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
    // For now, just go to mission control
    // Later we'll go to Phase 2
    navigate('/mission-control');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-cyan-400 mb-6"></div>
          <p className="text-blue-200 text-lg">Loading mission data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-red-900 to-gray-900 flex items-center justify-center">
        <div className="bg-red-900/30 border border-red-500 rounded-xl p-8 max-w-lg">
          <h2 className="text-2xl font-bold text-red-400 mb-4">Error</h2>
          <p className="text-red-200 mb-6">{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!userData?.scoutData) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 via-yellow-900 to-gray-900 flex items-center justify-center">
        <div className="bg-yellow-900/30 border border-yellow-500 rounded-xl p-8 max-w-lg">
          <h2 className="text-2xl font-bold text-yellow-400 mb-4">No Scout Data Found</h2>
          <p className="text-yellow-200 mb-6">Please complete the Scout questionnaire first.</p>
          <button
            onClick={() => navigate('/scout-questionnaire')}
            className="px-6 py-3 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
          >
            Go to Questionnaire
          </button>
        </div>
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
