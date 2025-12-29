import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import CompanyCard from '../../components/scout/CompanyCard';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';
import './DailyLeads.css';

export default function DailyLeads() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showTitleSetup, setShowTitleSetup] = useState(false);
  const [hasSeenTitleSetup, setHasSeenTitleSetup] = useState(false);
  const [dailySwipeCount, setDailySwipeCount] = useState(0);
  const [lastSwipeDate, setLastSwipeDate] = useState('');

  const DAILY_SWIPE_LIMIT = 25; // 25 interested companies per day

  useEffect(() => {
    loadTodayLeads();
  }, []);

  const loadTodayLeads = async () => {
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
        // No profile - show message to complete ICP settings
        setLoading(false);
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

      // Sort by fit_score descending (if exists)
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

      setLoading(false);
    } catch (error) {
      console.error('Error loading daily leads:', error);
      setLoading(false);
    }
  };

  const handleSwipe = async (direction) => {
    const user = auth.currentUser;
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];

    // Check daily swipe limit (only for interested/right swipes)
    if (direction === 'right' && dailySwipeCount >= DAILY_SWIPE_LIMIT && lastSwipeDate === today) {
      alert(`Daily limit reached! You can mark ${DAILY_SWIPE_LIMIT} companies as interested per day. Come back tomorrow for more! 🚀`);
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

      // Update swipe progress - only count right swipes (interested companies)
      const isInterested = direction === 'right';
      const newSwipeCount = isInterested
        ? (lastSwipeDate === today ? dailySwipeCount + 1 : 1)
        : dailySwipeCount;

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
        // No more companies - reload to check if there are new ones
        loadTodayLeads();
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
      <div className="daily-leads-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">[LOADING TODAY'S LEADS...]</p>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="empty-daily-leads">
        <div className="empty-icon">🎉</div>
        <h2>All Done for Today!</h2>
        <p>You've reviewed all available companies. Great work!</p>
        <p className="empty-hint">Come back tomorrow for fresh leads (Mon-Fri), or update your ICP Settings to get more companies.</p>
        <button
          onClick={() => navigate('/scout')}
          className="refresh-btn"
        >
          🔄 Go to ICP Settings
        </button>
      </div>
    );
  }

  const currentCompany = companies[currentIndex];

  return (
    <div className="daily-leads">
      {/* Daily Stats Header */}
      <div className="daily-header">
        <div className="daily-stats">
          <div className="stat-item">
            <span className="stat-label">Progress</span>
            <span className="stat-value">{currentIndex + 1} / {companies.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Interested Today</span>
            <span className="stat-value">{dailySwipeCount} / {DAILY_SWIPE_LIMIT}</span>
          </div>
        </div>
      </div>

      {/* Company Card */}
      {currentCompany && (
        <div className="company-card-container">
          <CompanyCard
            company={currentCompany}
            onSwipe={handleSwipe}
          />
        </div>
      )}

      {/* Instructions */}
      <div className="swipe-instructions">
        <div className="instruction-item">
          <span className="instruction-icon">👈</span>
          <span className="instruction-text red">SWIPE LEFT = Not Interested</span>
        </div>
        <div className="instruction-divider"></div>
        <div className="instruction-item">
          <span className="instruction-text green">SWIPE RIGHT = Interested</span>
          <span className="instruction-icon">👉</span>
        </div>
      </div>

      {/* Contact Title Setup Modal */}
      {showTitleSetup && (
        <ContactTitleSetup onComplete={handleTitleSetupComplete} />
      )}
    </div>
  );
}
