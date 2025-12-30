import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import CompanyCard from '../../components/scout/CompanyCard';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';
import { TrendingUp, TrendingDown, Target, Users, Filter, ChevronDown } from 'lucide-react';
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
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    quality: 'all',
    sortBy: 'score'
  });

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

        <div className="kpi-card">
          <div className="kpi-header">
            <Target className="kpi-icon" />
            <span className="kpi-label">Match Rate</span>
          </div>
          <div className="kpi-value">{matchRate}%</div>
          <div className="kpi-trend">
            {matchRate >= 50 ? (
              <>
                <TrendingUp className="trend-icon positive" />
                <span className="trend-text positive">Strong match quality</span>
              </>
            ) : (
              <>
                <TrendingDown className="trend-icon neutral" />
                <span className="trend-text neutral">Adjust ICP for better results</span>
              </>
            )}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <TrendingUp className="kpi-icon" />
            <span className="kpi-label">Avg Lead Score</span>
          </div>
          <div className="kpi-value">{avgLeadScore}</div>
          <div className="kpi-trend">
            <span className="trend-text neutral">Out of 100</span>
          </div>
        </div>

        <div className="kpi-card highlight">
          <div className="kpi-header">
            <span className="kpi-label">Matched Today</span>
          </div>
          <div className="kpi-value">{dailySwipeCount} / {DAILY_SWIPE_LIMIT}</div>
          <div className="kpi-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(dailySwipeCount / DAILY_SWIPE_LIMIT) * 100}%` }}
              />
            </div>
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

      {/* View Matched Companies Button */}
      {dailySwipeCount > 0 && (
        <div className="action-footer">
          <button
            className="view-matches-btn"
            onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
          >
            <Users className="w-5 h-5" />
            <span>View {dailySwipeCount} Matched {dailySwipeCount === 1 ? 'Company' : 'Companies'}</span>
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
