import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import CompanyCard from '../../components/scout/CompanyCard';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';
import { TrendingUp, TrendingDown, Target, Users, Filter, ChevronDown, CheckCircle, RotateCcw, RefreshCw, Loader } from 'lucide-react';
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
  const [showSessionOverview, setShowSessionOverview] = useState(false); // Collapsible session stats
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');

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

  // Manual refresh - triggers search-companies immediately
  const handleManualRefresh = async () => {
    const user = auth.currentUser;
    if (!user || isRefreshing) return;

    setIsRefreshing(true);
    setRefreshMessage('Barry is finding new targets...');

    try {
      const authToken = await user.getIdToken();

      // Get user's ICP profile
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);

      if (!profileDoc.exists()) {
        setRefreshMessage('Set up your ICP first to find targets.');
        setIsRefreshing(false);
        return;
      }

      const companyProfile = profileDoc.data();

      // Call search-companies to refresh the queue
      const response = await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile
        })
      });

      const data = await response.json();

      if (data.success) {
        if (data.companiesAdded > 0) {
          setRefreshMessage(`Found ${data.companiesAdded} new targets.`);
          // Reload the leads after a short delay
          setTimeout(() => {
            setRefreshMessage('');
            loadTodayLeads();
          }, 1500);
        } else if (data.currentQueueSize > 0) {
          setRefreshMessage('Queue is already full. Review your current targets.');
          setTimeout(() => setRefreshMessage(''), 3000);
        } else {
          setRefreshMessage('No new matches found. Try refining your ICP.');
          setTimeout(() => setRefreshMessage(''), 3000);
        }
      } else {
        setRefreshMessage(data.error || 'Refresh failed. Try again.');
        setTimeout(() => setRefreshMessage(''), 3000);
      }
    } catch (error) {
      console.error('Error refreshing leads:', error);
      setRefreshMessage('Refresh failed. Try again.');
      setTimeout(() => setRefreshMessage(''), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSwipe = async (direction) => {
    const user = auth.currentUser;
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];

    // Check daily swipe limit (only for interested/right swipes)
    if (direction === 'right' && dailySwipeCount >= DAILY_SWIPE_LIMIT && lastSwipeDate === today) {
      alert('Daily hunt limit reached. Time to engage with your catches — select contacts and start outreach.');
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

  // Calculate next refresh time for user-friendly display
  const getNextRefreshInfo = () => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getUTCHours();

    // Refresh happens at 9am UTC Monday-Friday
    let daysUntilRefresh = 0;
    if (dayOfWeek === 0) daysUntilRefresh = 1; // Sunday -> Monday
    else if (dayOfWeek === 6) daysUntilRefresh = 2; // Saturday -> Monday
    else if (dayOfWeek === 5 && hour >= 9) daysUntilRefresh = 3; // Friday after 9am -> Monday
    else if (hour >= 9) daysUntilRefresh = 1; // After 9am -> next weekday

    if (daysUntilRefresh === 0) {
      return 'New targets arriving at 9am UTC (4am ET)';
    } else if (daysUntilRefresh === 1) {
      return 'New targets arriving tomorrow at 9am UTC';
    } else {
      return `New targets arriving Monday at 9am UTC`;
    }
  };

  if (companies.length === 0) {
    return (
      <div className="empty-daily-leads">
        <div className="empty-icon">
          <Target className="w-16 h-16 text-gray-400" />
        </div>
        <h2>Hunt Complete</h2>
        <p>You've reviewed all available targets. Your saved companies are ready for outreach.</p>

        {/* Refresh status message */}
        {refreshMessage && (
          <div className="refresh-status">
            {isRefreshing && <Loader className="w-4 h-4 animate-spin" />}
            <span>{refreshMessage}</span>
          </div>
        )}

        {!refreshMessage && (
          <p className="empty-hint">{getNextRefreshInfo()}</p>
        )}

        <div className="empty-actions">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="primary-btn refresh-btn"
          >
            {isRefreshing ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                <span>Finding targets...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>Refresh Leads Now</span>
              </>
            )}
          </button>
          <button
            onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
            className="secondary-btn"
          >
            View Saved Companies
          </button>
        </div>
        <button
          onClick={() => navigate('/scout', { state: { activeTab: 'icp-settings' } })}
          className="tertiary-btn"
        >
          Refine Targets
        </button>
      </div>
    );
  }

  const currentCompany = companies[currentIndex];

  return (
    <div className="daily-leads">
      {/* Discovery Header - Swipe App Style */}
      <div className="discovery-header">
        <h1 className="discovery-title">Today's Targets</h1>
        <p className="discovery-subtitle">AI-curated prospects matching your ICP</p>
      </div>

      {/* Compact Filters Button - Top Right */}
      <button
        className="filters-compact-btn"
        onClick={() => setShowFilters(!showFilters)}
        title="Filters & Sort"
      >
        <Filter size={18} />
        {showFilters && <span>Close</span>}
        {!showFilters && <span>Filters</span>}
      </button>

      {/* Filters Panel (Collapsed by Default) */}
      {showFilters && (
        <div className="filters-panel">
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

      {/* Visual Progress - Dots Style */}
      <div className="progress-dots">
        {companies.slice(0, Math.min(companies.length, 7)).map((_, index) => (
          <div
            key={index}
            className={`progress-dot ${index === currentIndex ? 'active' : ''} ${index < currentIndex ? 'completed' : ''}`}
          />
        ))}
        {companies.length > 7 && <span className="progress-more">+{companies.length - 7}</span>}
      </div>
      <div className="progress-count">
        {currentIndex + 1} of {companies.length}
      </div>

      {/* Company Card - Hero Element */}
      {currentCompany && (
        <div className="swipe-card-hero">
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
            <span>Undo</span>
          </button>
        </div>
      )}

      {/* Swipe Button Microcopy */}
      <div className="swipe-microcopy">
        <div className="microcopy-item reject-hint">
          <span className="microcopy-icon">👈</span>
          <span className="microcopy-text">Sharpens your targeting</span>
        </div>
        <div className="microcopy-item accept-hint">
          <span className="microcopy-text">Add to your hunt list</span>
          <span className="microcopy-icon">👉</span>
        </div>
      </div>

      {/* Collapsible Session Overview */}
      <div className="session-overview-wrapper">
        <button
          className="session-overview-toggle"
          onClick={() => setShowSessionOverview(!showSessionOverview)}
        >
          <span>Session Overview</span>
          <ChevronDown className={`toggle-icon ${showSessionOverview ? 'rotated' : ''}`} size={18} />
        </button>

        {showSessionOverview && (
          <div className="session-stats">
            <div className="session-stat">
              <div className="stat-label">Targets Left</div>
              <div className="stat-value">{remainingLeads}</div>
            </div>
            <div className="session-stat primary">
              <div className="stat-label">Today's Catches</div>
              <div className="stat-value">{dailySwipeCount} <span className="stat-max">/ {DAILY_SWIPE_LIMIT}</span></div>
            </div>
            <div className="session-stat">
              <div className="stat-label">Total Hunt List</div>
              <div className="stat-value">{totalAcceptedCompanies}</div>
            </div>
          </div>
        )}
      </div>

      {/* View Saved Companies Button */}
      {dailySwipeCount > 0 && (
        <div className="action-footer">
          <button
            className="view-saved-companies-btn"
            onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
          >
            <CheckCircle className="w-5 h-5" />
            <span>View Saved Companies ({dailySwipeCount})</span>
          </button>
        </div>
      )}

      {/* Contact Title Setup Modal */}
      {showTitleSetup && (
        <ContactTitleSetup onComplete={handleTitleSetupComplete} />
      )}
    </div>
  );
}
