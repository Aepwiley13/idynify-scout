import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import CompanyCard from '../components/scout/CompanyCard';
import ContactTitleSetup from '../components/scout/ContactTitleSetup';

export default function ScoutDashboardPage() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showTitleSetup, setShowTitleSetup] = useState(false);
  const [hasSeenTitleSetup, setHasSeenTitleSetup] = useState(false);
  const [dailySwipeCount, setDailySwipeCount] = useState(0);
  const [lastSwipeDate, setLastSwipeDate] = useState('');

  const DAILY_SWIPE_LIMIT = 25; // 25 interested companies for testing

  useEffect(() => {
    loadCompaniesAndProgress();
  }, []);

  const loadCompaniesAndProgress = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check if user has completed the company questionnaire
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);

      if (!profileDoc.exists()) {
        // No profile - redirect to questionnaire
        navigate('/onboarding/company-profile');
        return;
      }

      // Load companies with status 'pending' (not yet swiped)
      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const q = query(companiesRef, where('status', '==', 'pending'));
      const snapshot = await getDocs(q);

      const companiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by fit_score descending
      companiesData.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

      setCompanies(companiesData);

      // Load user's swipe progress
      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      const swipeProgressDoc = await getDoc(swipeProgressRef);

      if (swipeProgressDoc.exists()) {
        const data = swipeProgressDoc.data();
        const today = new Date().toISOString().split('T')[0];

        if (data.lastSwipeDate === today) {
          setDailySwipeCount(data.dailySwipeCount || 0);
        } else {
          // New day - reset counter
          setDailySwipeCount(0);
        }
        setLastSwipeDate(data.lastSwipeDate || '');
        setHasSeenTitleSetup(data.hasSeenTitleSetup || false);
      }

    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSwipe = async (direction) => {
    const user = auth.currentUser;
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];

    // Check daily swipe limit
    if (dailySwipeCount >= DAILY_SWIPE_LIMIT && lastSwipeDate === today) {
      alert(`Daily swipe limit reached! You can swipe ${DAILY_SWIPE_LIMIT} companies per day. Come back tomorrow for more! 🚀`);
      return;
    }

    const company = companies[currentIndex];

    try {
      // Update company status in Firestore
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      await updateDoc(companyRef, {
        status: direction === 'right' ? 'accepted' : 'rejected',
        swipedAt: new Date().toISOString(),
        swipeDirection: direction
      });

      // Update swipe progress
      const newSwipeCount = lastSwipeDate === today ? dailySwipeCount + 1 : 1;
      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      await setDoc(swipeProgressRef, {
        dailySwipeCount: newSwipeCount,
        lastSwipeDate: today,
        hasSeenTitleSetup: hasSeenTitleSetup
      });

      setDailySwipeCount(newSwipeCount);
      setLastSwipeDate(today);

      // If accepted and haven't seen title setup modal yet, show it
      if (direction === 'right' && !hasSeenTitleSetup) {
        setShowTitleSetup(true);
        setHasSeenTitleSetup(true);
        await setDoc(swipeProgressRef, {
          dailySwipeCount: newSwipeCount,
          lastSwipeDate: today,
          hasSeenTitleSetup: true
        });
      }

      // Move to next company
      if (currentIndex < companies.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        // No more companies
        navigate('/mission-control-v2');
      }

    } catch (error) {
      console.error('Error handling swipe:', error);
      alert('Failed to save swipe. Please try again.');
    }
  };

  const handleTitleSetupComplete = () => {
    setShowTitleSetup(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
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
        <div className="relative z-10 text-cyan-400 text-2xl font-mono animate-pulse">
          [LOADING SCOUT...]
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

  if (companies.length === 0) {
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

        <div className="relative z-10 min-h-screen flex items-center justify-center">
          <div className="max-w-2xl mx-auto px-6 text-center">
            <div className="text-6xl mb-6">🎯</div>
            <h1 className="text-4xl font-bold text-white mb-4 font-mono">All Caught Up!</h1>
            <p className="text-gray-400 text-lg mb-8">
              You've reviewed all available companies. Great work! 🚀
            </p>
            <div className="space-y-4">
              <button
                onClick={() => navigate('/mission-control-v2')}
                className="w-full px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold rounded-xl transition-all font-mono"
              >
                ⬅️ BACK TO MISSION CONTROL
              </button>
              <button
                onClick={() => navigate('/onboarding/company-profile')}
                className="w-full px-8 py-4 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border border-purple-500/30 font-bold rounded-xl transition-all font-mono"
              >
                🔄 UPDATE SEARCH CRITERIA
              </button>
            </div>
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

  const currentCompany = companies[currentIndex];
  const remainingToday = DAILY_SWIPE_LIMIT - dailySwipeCount;

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

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-black/80 border-b border-cyan-500/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/mission-control-v2')}
                className="text-2xl hover:scale-110 transition-transform"
              >
                ⬅️
              </button>
              <div className="text-4xl">🎯</div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
                  SCOUT
                </h1>
                <p className="text-xs text-gray-400 font-mono">Swipe to find your ideal customers</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/onboarding/company-profile')}
                className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 border border-purple-500/30 rounded-lg font-mono font-bold text-sm transition-all"
              >
                🔄 UPDATE SEARCH
              </button>
              <div className="text-right">
                <p className="text-xs text-gray-500 font-mono">Daily Swipes Remaining</p>
                <p className="text-2xl font-bold text-cyan-400 font-mono">{remainingToday}/{DAILY_SWIPE_LIMIT}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* Progress */}
        <div className="mb-8 text-center">
          <p className="text-gray-400 font-mono">
            Company {currentIndex + 1} of {companies.length}
          </p>
        </div>

        {/* Company Card */}
        <CompanyCard
          company={currentCompany}
          onSwipe={handleSwipe}
        />

        {/* Instructions */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-6 bg-black/60 backdrop-blur-xl rounded-2xl p-6 border border-cyan-500/20">
            <div className="flex items-center gap-2">
              <div className="text-2xl">👈</div>
              <span className="text-red-400 font-mono text-sm">SWIPE LEFT = Not Interested</span>
            </div>
            <div className="w-px h-8 bg-gray-700"></div>
            <div className="flex items-center gap-2">
              <span className="text-green-400 font-mono text-sm">SWIPE RIGHT = Interested</span>
              <div className="text-2xl">👉</div>
            </div>
          </div>
        </div>
      </main>

      {/* Contact Title Setup Modal */}
      {showTitleSetup && (
        <ContactTitleSetup onComplete={handleTitleSetupComplete} />
      )}

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
