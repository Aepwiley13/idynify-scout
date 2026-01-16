import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { calculateICPScore } from '../../utils/icpScoring';
import { APOLLO_INDUSTRIES } from '../../constants/apolloIndustries';
import { US_STATES } from '../../constants/usStates';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, MapPin, Search, X, Save, RefreshCw, CheckCircle, Globe, Filter, Sliders, TrendingUp } from 'lucide-react';
import { DEFAULT_WEIGHTS } from '../../utils/icpScoring';
import './ICPSettings.css';

export default function ICPSettings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Search states for dropdowns
  const [industrySearch, setIndustrySearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [newTitleInput, setNewTitleInput] = useState('');

  const companySizeOptions = [
    "1-10", "11-20", "21-50", "51-100", "101-200", "201-500",
    "501-1,000", "1,001-2,000", "2,001-5,000", "5,001-10,000", "10,001+"
  ];

  const revenueRangeOptions = [
    "Less than $1M", "$1M-$2M", "$2M-$5M", "$5M-$10M", "$10M-$20M",
    "$20M-$50M", "$50M-$100M", "$100M-$200M", "$200M-$500M", "$500M-$1B", "$1B+"
  ];

  useEffect(() => {
    loadICPProfile();
  }, []);

  async function loadICPProfile() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const profileDoc = await getDoc(
        doc(db, 'users', user.uid, 'companyProfile', 'current')
      );

      if (profileDoc.exists()) {
        const data = profileDoc.data();
        // Ensure scoring weights exist (for existing profiles)
        if (!data.scoringWeights) {
          data.scoringWeights = DEFAULT_WEIGHTS;
        }
        // Ensure targetTitles exist (for existing profiles)
        if (!data.targetTitles) {
          data.targetTitles = [];
        }
        setProfile(data);
      } else {
        // No profile yet - set defaults
        setProfile({
          industries: [],
          companySizes: [],
          revenueRanges: [],
          skipRevenue: false,
          locations: [],
          isNationwide: false,
          targetTitles: [],
          scoringWeights: DEFAULT_WEIGHTS
        });
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to load ICP:', error);
      setLoading(false);
    }
  }

  async function handleSaveChanges() {
    try {
      setSaving(true);
      const user = auth.currentUser;

      // Validate weights if they exist
      if (profile.scoringWeights && totalWeight !== 100) {
        alert(`Scoring weights must total 100%. Currently at ${totalWeight}%.`);
        setSaving(false);
        return;
      }

      // Save profile
      await setDoc(
        doc(db, 'users', user.uid, 'companyProfile', 'current'),
        {
          ...profile,
          updatedAt: new Date().toISOString()
        }
      );

      // Recalculate all company scores with new weights
      if (profile.scoringWeights) {
        await recalculateAllScores(user.uid, profile, profile.scoringWeights);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setSaving(false);
    } catch (error) {
      console.error('Failed to save ICP:', error);
      alert('Failed to save changes. Please try again.');
      setSaving(false);
    }
  }

  async function recalculateAllScores(userId, icpProfile, weights) {
    try {
      console.log('🔄 Recalculating scores for all companies...');

      // Get all companies
      const companiesSnapshot = await getDocs(
        collection(db, 'users', userId, 'companies')
      );

      const updates = [];

      for (const companyDoc of companiesSnapshot.docs) {
        const company = companyDoc.data();
        const newScore = calculateICPScore(company, icpProfile, weights);

        // Update company with new fit_score
        updates.push(
          updateDoc(doc(db, 'users', userId, 'companies', companyDoc.id), {
            fit_score: newScore,
            lastScoreUpdate: new Date().toISOString()
          })
        );
      }

      await Promise.all(updates);
      console.log(`✅ Updated ${updates.length} company scores`);
    } catch (error) {
      console.error('❌ Failed to recalculate scores:', error);
      // Don't throw - just log the error
    }
  }

  async function handleRefreshResults() {
    try {
      setRefreshing(true);

      const user = auth.currentUser;
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: profile
        })
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Success! Found ${data.companiesFound} new companies. Check the Daily Leads tab!`);
      } else {
        throw new Error(data.error || 'Failed to refresh results');
      }

      setRefreshing(false);
    } catch (error) {
      console.error('Failed to refresh:', error);
      alert(`Failed to refresh results: ${error.message}`);
      setRefreshing(false);
    }
  }

  const handleIndustryToggle = (industryName) => {
    setProfile(prev => ({
      ...prev,
      industries: prev.industries.includes(industryName)
        ? prev.industries.filter(i => i !== industryName)
        : [...prev.industries, industryName]
    }));
  };

  const handleCompanySizeToggle = (size) => {
    setProfile(prev => ({
      ...prev,
      companySizes: prev.companySizes.includes(size)
        ? prev.companySizes.filter(s => s !== size)
        : [...prev.companySizes, size]
    }));
  };

  const handleLocationToggle = (location) => {
    setProfile(prev => ({
      ...prev,
      locations: prev.locations.includes(location)
        ? prev.locations.filter(l => l !== location)
        : [...prev.locations, location],
      isNationwide: false
    }));
  };

  const handleNationwideToggle = () => {
    setProfile(prev => ({
      ...prev,
      isNationwide: !prev.isNationwide,
      locations: !prev.isNationwide ? [...US_STATES] : []
    }));
  };

  const handleWeightChange = (key, value) => {
    const newValue = parseInt(value) || 0;
    setProfile(prev => ({
      ...prev,
      scoringWeights: {
        ...prev.scoringWeights,
        [key]: newValue
      }
    }));
  };

  const handleAddTitle = () => {
    const trimmedTitle = newTitleInput.trim();
    if (!trimmedTitle) return;

    // Check if already exists (case-insensitive)
    if (profile.targetTitles.some(t => t.toLowerCase() === trimmedTitle.toLowerCase())) {
      setNewTitleInput('');
      return;
    }

    setProfile(prev => ({
      ...prev,
      targetTitles: [...prev.targetTitles, trimmedTitle]
    }));
    setNewTitleInput('');
  };

  const handleRemoveTitle = (titleToRemove) => {
    setProfile(prev => ({
      ...prev,
      targetTitles: prev.targetTitles.filter(t => t !== titleToRemove)
    }));
  };

  const handleTitleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTitle();
    }
  };

  // Calculate total weight for validation
  const totalWeight = profile?.scoringWeights
    ? profile.scoringWeights.industry + profile.scoringWeights.location +
      profile.scoringWeights.employeeSize + profile.scoringWeights.revenue
    : 100;

  if (loading) {
    return (
      <div className="icp-settings-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading ICP settings...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="icp-empty">
        <Filter className="w-16 h-16 text-gray-400 mb-4" />
        <h2>No ICP Profile Found</h2>
        <p>Please complete the questionnaire first to set up your Ideal Customer Profile.</p>
      </div>
    );
  }

  const filteredIndustries = APOLLO_INDUSTRIES.filter(ind =>
    ind.name.toLowerCase().includes(industrySearch.toLowerCase())
  );

  const filteredStates = US_STATES.filter(state =>
    state.toLowerCase().includes(locationSearch.toLowerCase())
  );

  return (
    <div className="icp-settings">
      {/* Enterprise Header */}
      <div className="enterprise-header">
        <div className="header-content">
          <h1 className="page-title">ICP Settings</h1>
          <p className="page-subtitle">Define and refine your Ideal Customer Profile criteria</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-icon">
            <Building2 className="w-5 h-5" />
          </div>
          <div className="summary-content">
            <p className="summary-label">Industries Selected</p>
            <p className="summary-value">{profile.industries.length}</p>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon">
            <Users className="w-5 h-5" />
          </div>
          <div className="summary-content">
            <p className="summary-label">Company Sizes</p>
            <p className="summary-value">{profile.companySizes.length}</p>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon">
            <MapPin className="w-5 h-5" />
          </div>
          <div className="summary-content">
            <p className="summary-label">Target Locations</p>
            <p className="summary-value">
              {profile.isNationwide ? 'Nationwide' : `${profile.locations.length} states`}
            </p>
          </div>
        </div>
      </div>

      <div className="settings-content">
        {/* Industries Section */}
        <div className="setting-section">
          <div className="section-header">
            <div className="section-title-group">
              <Building2 className="section-icon" />
              <h3>Industries</h3>
            </div>
            <span className="selection-count">{profile.industries.length} selected</span>
          </div>
          <p className="section-description">Select all industries that match your ideal customers</p>

          {profile.industries.length > 0 && (
            <div className="selected-items">
              {profile.industries.map(industry => (
                <span key={industry} className="selected-item">
                  {industry}
                  <button onClick={() => handleIndustryToggle(industry)} className="remove-btn">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="search-wrapper">
            <Search className="search-icon-input" />
            <input
              type="text"
              placeholder="Search industries..."
              value={industrySearch}
              onChange={(e) => setIndustrySearch(e.target.value)}
              className="search-input"
            />
            {industrySearch && (
              <button
                className="clear-search-btn"
                onClick={() => setIndustrySearch('')}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="checkbox-grid">
            {filteredIndustries.slice(0, 20).map(industry => (
              <label key={industry.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={profile.industries.includes(industry.name)}
                  onChange={() => handleIndustryToggle(industry.name)}
                />
                <span>{industry.name}</span>
              </label>
            ))}
          </div>
          {filteredIndustries.length > 20 && (
            <p className="showing-more">Showing first 20 of {filteredIndustries.length} results. Use search to narrow down.</p>
          )}
        </div>

        {/* Company Sizes Section */}
        <div className="setting-section">
          <div className="section-header">
            <div className="section-title-group">
              <Users className="section-icon" />
              <h3>Company Sizes</h3>
            </div>
            <span className="selection-count">{profile.companySizes.length} selected</span>
          </div>
          <p className="section-description">Select all employee ranges that fit your target companies</p>

          <div className="size-grid">
            {companySizeOptions.map(size => (
              <label
                key={size}
                className={`size-option ${profile.companySizes.includes(size) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={profile.companySizes.includes(size)}
                  onChange={() => handleCompanySizeToggle(size)}
                />
                <span>{size} employees</span>
              </label>
            ))}
          </div>
        </div>

        {/* Locations Section */}
        <div className="setting-section">
          <div className="section-header">
            <div className="section-title-group">
              <MapPin className="section-icon" />
              <h3>Target Locations</h3>
            </div>
            <span className="selection-count">
              {profile.isNationwide ? 'All US' : `${profile.locations.length} states`}
            </span>
          </div>
          <p className="section-description">Select specific US states or choose Nationwide coverage</p>

          <label className="nationwide-option">
            <input
              type="checkbox"
              checked={profile.isNationwide}
              onChange={handleNationwideToggle}
            />
            <Globe className="w-5 h-5" />
            <span className="nationwide-label">Nationwide (All US States)</span>
            {profile.isNationwide && (
              <CheckCircle className="w-5 h-5 check-icon" />
            )}
          </label>

          {!profile.isNationwide && (
            <>
              {profile.locations.length > 0 && (
                <div className="selected-items">
                  {profile.locations.slice(0, 10).map(location => (
                    <span key={location} className="selected-item">
                      {location}
                      <button onClick={() => handleLocationToggle(location)} className="remove-btn">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {profile.locations.length > 10 && (
                    <span className="more-count">+{profile.locations.length - 10} more</span>
                  )}
                </div>
              )}

              <div className="search-wrapper">
                <Search className="search-icon-input" />
                <input
                  type="text"
                  placeholder="Search states..."
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  className="search-input"
                />
                {locationSearch && (
                  <button
                    className="clear-search-btn"
                    onClick={() => setLocationSearch('')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="checkbox-grid">
                {filteredStates.slice(0, 20).map(state => (
                  <label key={state} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={profile.locations.includes(state)}
                      onChange={() => handleLocationToggle(state)}
                    />
                    <span>{state}</span>
                  </label>
                ))}
              </div>
              {filteredStates.length > 20 && (
                <p className="showing-more">Showing first 20 of {filteredStates.length} results. Use search to narrow down.</p>
              )}
            </>
          )}
        </div>

        {/* Target Contact Titles Section */}
        <div className="setting-section">
          <div className="section-header">
            <div className="section-title-group">
              <Users className="section-icon" />
              <h3>Target Contact Titles</h3>
            </div>
            <span className="selection-count">{profile.targetTitles?.length || 0} titles</span>
          </div>
          <p className="section-description">
            These titles will be used to pre-populate contacts when you select a company. Optional - leave empty to choose titles manually each time.
          </p>

          {profile.targetTitles && profile.targetTitles.length > 0 && (
            <div className="selected-items">
              {profile.targetTitles.map(title => (
                <span key={title} className="selected-item">
                  {title}
                  <button onClick={() => handleRemoveTitle(title)} className="remove-btn">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="title-input-wrapper">
            <input
              type="text"
              placeholder="e.g., VP Sales, Head of RevOps, Founder"
              value={newTitleInput}
              onChange={(e) => setNewTitleInput(e.target.value)}
              onKeyPress={handleTitleKeyPress}
              className="title-input"
            />
            <button
              onClick={handleAddTitle}
              disabled={!newTitleInput.trim()}
              className="add-title-btn"
            >
              Add Title
            </button>
          </div>

          <p className="helper-text">
            <span className="helper-icon">💡</span>
            Examples: VP Sales, Sales Operations, Head of RevOps, Director of Marketing, Founder
          </p>
        </div>

        {/* ICP Scoring Weights Section */}
        <div className="setting-section scoring-weights-section">
          <div className="section-header">
            <div className="section-title-group">
              <Sliders className="section-icon" />
              <h3>ICP Scoring Weights</h3>
            </div>
            <span className={`selection-count ${totalWeight !== 100 ? 'error' : ''}`}>
              {totalWeight}%
            </span>
          </div>
          <p className="section-description">
            Adjust how much each criterion contributes to the lead score. Total must equal 100%.
          </p>

          {profile.scoringWeights && (
            <div className="weights-grid">
              {/* Industry Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <Building2 className="w-5 h-5 text-blue-600" />
                  <label className="weight-label">Industry Match</label>
                  <span className="weight-value">{profile.scoringWeights.industry}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.industry}
                  onChange={(e) => handleWeightChange('industry', e.target.value)}
                  className="weight-slider"
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={profile.scoringWeights.industry}
                    onChange={(e) => handleWeightChange('industry', e.target.value)}
                    className="weight-input"
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>

              {/* Location Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <MapPin className="w-5 h-5 text-blue-600" />
                  <label className="weight-label">Location Match</label>
                  <span className="weight-value">{profile.scoringWeights.location}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.location}
                  onChange={(e) => handleWeightChange('location', e.target.value)}
                  className="weight-slider"
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={profile.scoringWeights.location}
                    onChange={(e) => handleWeightChange('location', e.target.value)}
                    className="weight-input"
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>

              {/* Employee Size Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <Users className="w-5 h-5 text-blue-600" />
                  <label className="weight-label">Employee Size Match</label>
                  <span className="weight-value">{profile.scoringWeights.employeeSize}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.employeeSize}
                  onChange={(e) => handleWeightChange('employeeSize', e.target.value)}
                  className="weight-slider"
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={profile.scoringWeights.employeeSize}
                    onChange={(e) => handleWeightChange('employeeSize', e.target.value)}
                    className="weight-input"
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>

              {/* Revenue Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  <label className="weight-label">Revenue Match</label>
                  <span className="weight-value">{profile.scoringWeights.revenue}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.revenue}
                  onChange={(e) => handleWeightChange('revenue', e.target.value)}
                  className="weight-slider"
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={profile.scoringWeights.revenue}
                    onChange={(e) => handleWeightChange('revenue', e.target.value)}
                    className="weight-input"
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>
            </div>
          )}

          {totalWeight !== 100 && (
            <div className="weight-warning">
              <X className="w-5 h-5" />
              <span>
                Total must equal 100%. Currently at {totalWeight}%.
                {totalWeight > 100 ? ` Reduce by ${totalWeight - 100}%.` : ` Add ${100 - totalWeight}%.`}
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="action-section">
          {saveSuccess && (
            <div className="success-message">
              <CheckCircle className="w-5 h-5" />
              <span>Settings saved successfully! Click "Refresh Results" to fetch new companies.</span>
            </div>
          )}

          <div className="action-buttons">
            <button
              onClick={handleSaveChanges}
              disabled={saving}
              className="save-btn"
            >
              <Save className="w-5 h-5" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>

            <button
              onClick={handleRefreshResults}
              disabled={refreshing || saving}
              className="refresh-btn"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'spinning' : ''}`} />
              <span>{refreshing ? 'Searching...' : 'Refresh Results'}</span>
            </button>
          </div>

          <p className="action-hint">
            <Filter className="w-4 h-4" />
            <span>Save your changes first, then click "Refresh Results" to fetch new companies</span>
          </p>
        </div>
      </div>
    </div>
  );
}
