import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import CompanyCard from '../../components/scout/CompanyCard';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';
import { TrendingUp, TrendingDown, Target, Users, Filter, ChevronDown, CheckCircle, RotateCcw } from 'lucide-react';
import './DailyLeads.css';

export default function DailyLeads() {
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showTitleSetup, setShowTitleSetup] = useState(false);
  const [hasSeenTitleSetup, setHasSeenTitleSetup] = useState(false);
  const [dailySwipeCount, setDailySwipeCount] = useState(0);
  const [totalAcceptedCompanies, setTotalAcceptedCompanies] = useState(0);
  const [lastSwipeDate, setLastSwipeDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    quality: 'all',
    sortBy: 'score'
  });
  const [lastSwipe, setLastSwipe] = useState(null); // Track last swipe for undo
  const [showUndo, setShowUndo] = useState(false);

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

      // Count total accepted companies (all time)
      const acceptedQuery = query(companiesRef, where('status', '==', 'accepted'));
      const acceptedSnapshot = await getDocs(acceptedQuery);
      setTotalAcceptedCompanies(acceptedSnapshot.size);

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
      alert('✅ Daily limit reached! Moving you to Saved Companies to select contacts from your interested companies.');
      // Redirect to Scout with Saved Companies tab active
      navigate('/scout', { replace: true, state: { activeTab: 'saved-companies' } });
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

      // Increment total accepted companies count for real-time UI update
      if (isInterested) {
        setTotalAcceptedCompanies(totalAcceptedCompanies + 1);
      }

      // Track swipe for undo
      setLastSwipe({
        company: company,
        direction: direction,
        index: currentIndex,
        previousSwipeCount: dailySwipeCount
      });
      setShowUndo(true);

      // If accepted and haven't seen title setup modal yet, check for ICP defaults
      if (direction === 'right' && !hasSeenTitleSetup) {
        // Check if user already has title preferences
        const titlePrefsRef = doc(db, 'users', user.uid, 'contactScoring', 'titlePreferences');
        const titlePrefsDoc = await getDoc(titlePrefsRef);

        if (!titlePrefsDoc.exists()) {
          // No existing preferences - check if ICP has target titles
          const icpProfileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
          const icpProfileDoc = await getDoc(icpProfileRef);

          if (icpProfileDoc.exists() && icpProfileDoc.data().targetTitles && icpProfileDoc.data().targetTitles.length > 0) {
            // Auto-populate from ICP target titles
            const targetTitles = icpProfileDoc.data().targetTitles;
            const formattedTitles = targetTitles.map((title, index) => ({
              title,
              priority: 50, // default priority
              order: index
            }));

            await setDoc(titlePrefsRef, {
              titles: formattedTitles,
              updatedAt: new Date().toISOString()
            });

            console.log('✅ Auto-populated contact titles from ICP settings');
          } else {
            // No ICP titles - show the modal
            setShowTitleSetup(true);
          }
        }

        // Mark as seen regardless of whether modal was shown
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

  const handleUndo = async () => {
    if (!lastSwipe) return;

    const user = auth.currentUser;
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];

    try {
      // Restore company status to pending
      const companyRef = doc(db, 'users', user.uid, 'companies', lastSwipe.company.id);
      await updateDoc(companyRef, {
        status: 'pending',
        swipedAt: null,
        swipeDirection: null
      });

      // Restore swipe count if it was a right swipe
      if (lastSwipe.direction === 'right') {
        const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
        await setDoc(swipeProgressRef, {
          dailySwipeCount: lastSwipe.previousSwipeCount,
          lastSwipeDate: today,
          hasSeenTitleSetup: hasSeenTitleSetup
        });
        setDailySwipeCount(lastSwipe.previousSwipeCount);
        // Decrement total accepted companies count for real-time UI update
        setTotalAcceptedCompanies(totalAcceptedCompanies - 1);
      }

      // Go back to the previous company
      setCurrentIndex(lastSwipe.index);

      // Clear undo state
      setLastSwipe(null);
      setShowUndo(false);

    } catch (error) {
      console.error('Error undoing swipe:', error);
      alert('Failed to undo swipe. Please try again.');
    }
  };

  const handleTitleSetupComplete = () => {
    setShowTitleSetup(false);
  };

  // Calculate KPIs
  const matchRate = companies.length > 0 ? Math.round((dailySwipeCount / (currentIndex + 1)) * 100) || 0 : 0;
  const avgLeadScore = companies.length > 0
    ? Math.round(companies.reduce((sum, c) => sum + (c.fit_score || 0), 0) / companies.length)
    : 0;
  const remainingLeads = companies.length - currentIndex;

  if (loading) {
    return (
      <div className="daily-leads-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading lead insights...</p>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="empty-daily-leads">
        <div className="empty-icon">
          <Target className="w-16 h-16 text-gray-400" />
        </div>
        <h2>All Leads Reviewed</h2>
        <p>You've reviewed all available companies for today. Excellent work!</p>
        <p className="empty-hint">Fresh leads arrive Monday-Friday, or update your ICP Settings for more matches.</p>
        <button
          onClick={() => navigate('/scout', { state: { activeTab: 'icp-settings' } })}
          className="refresh-btn"
        >
          Update ICP Settings
        </button>
      </div>
    );
  }

  const currentCompany = companies[currentIndex];

  return (
    <div className="daily-leads">
      {/* Enterprise Header */}
      <div className="enterprise-header">
        <div className="header-content">
          <h1 className="page-title">Daily Lead Insights</h1>
          <p className="page-subtitle">AI-matched companies for your ICP criteria</p>
        </div>
      </div>

      {/* KPI Dashboard */}
      <div className="kpi-dashboard">
        <div className="kpi-card kpi-card-primary">
          <div className="kpi-primary-row">
            <span className="kpi-label">Matched Today</span>
            <div className="kpi-value">{dailySwipeCount}</div>
          </div>
          <div className="kpi-trend">
            <span className="trend-text neutral">Out of {DAILY_SWIPE_LIMIT} daily</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <CheckCircle className="kpi-icon" />
            <span className="kpi-label">Matches</span>
          </div>
          <div className="kpi-value">{totalAcceptedCompanies}</div>
          <div className="kpi-trend">
            {totalAcceptedCompanies > 0 ? (
              <>
                <TrendingUp className="trend-icon positive" />
                <span className="trend-text positive">Companies accepted</span>
              </>
            ) : (
              <>
                <TrendingDown className="trend-icon neutral" />
                <span className="trend-text neutral">Start reviewing leads</span>
              </>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <Users className="kpi-icon" />
            <span className="kpi-label">Leads Available</span>
          </div>
          <div className="kpi-value">{remainingLeads}</div>
          <div className="kpi-trend">
            <TrendingUp className="trend-icon positive" />
            <span className="trend-text positive">Updated daily</span>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="filters-section">
        <button
          className="filter-toggle"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="w-4 h-4" />
          <span>Filters & Sort</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        {showFilters && (
          <div className="filter-controls">
            <div className="filter-group">
              <label>Lead Quality</label>
              <select
                value={filters.quality}
                onChange={(e) => setFilters({...filters, quality: e.target.value})}
              >
                <option value="all">All Leads</option>
                <option value="high">High Quality (80+)</option>
                <option value="medium">Medium Quality (50-79)</option>
                <option value="low">Needs Review (&lt;50)</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Sort By</label>
              <select
                value={filters.sortBy}
                onChange={(e) => setFilters({...filters, sortBy: e.target.value})}
              >
                <option value="score">Lead Score (High to Low)</option>
                <option value="recent">Recently Added</option>
                <option value="revenue">Revenue (High to Low)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="progress-indicator">
        <div className="progress-text">
          Reviewing lead {currentIndex + 1} of {companies.length}
        </div>
        <div className="progress-bar-container">
          <div
            className="progress-bar-fill"
            style={{ width: `${((currentIndex + 1) / companies.length) * 100}%` }}
          />
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

      {/* Undo Button */}
      {showUndo && lastSwipe && (
        <div className="undo-container">
          <button
            className="undo-btn"
            onClick={handleUndo}
          >
            <RotateCcw className="w-5 h-5" />
            <span>Undo Last Swipe</span>
          </button>
        </div>
      )}

      {/* View Saved Companies Button */}
      <div className="action-footer">
        <button
          className="view-saved-companies-btn"
          onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
        >
          <CheckCircle className="w-5 h-5" />
          <span>View Saved Companies {dailySwipeCount > 0 && `(${dailySwipeCount})`}</span>
        </button>
      </div>

      {/* Contact Title Setup Modal */}
      {showTitleSetup && (
        <ContactTitleSetup onComplete={handleTitleSetupComplete} />
      )}
    </div>
  );
}
