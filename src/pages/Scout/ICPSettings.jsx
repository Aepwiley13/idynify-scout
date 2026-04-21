import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { calculateICPScore } from '../../utils/icpScoring';
import { APOLLO_INDUSTRIES } from '../../constants/apolloIndustries';
import { US_STATES } from '../../constants/usStates';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, MapPin, Search, X, Save, RefreshCw, CheckCircle, Globe, Filter, Sliders, TrendingUp, Brain, MessageSquare, Calendar, FileText, Zap } from 'lucide-react';
import NumericRangeFilter from '../../components/scout/NumericRangeFilter';
import { DEFAULT_WEIGHTS } from '../../utils/icpScoring';
import './ICPSettings.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import BarryICPPanel from '../../components/scout/BarryICPPanel';
import Section9MessagingFlow from '../../components/icp/Section9MessagingFlow';

export default function ICPSettings() {
  const navigate = useNavigate();
  const [showBarryPanel, setShowBarryPanel] = useState(false);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null); // { count: number } | null

  // Multi-ICP state
  const [icpList, setIcpList] = useState([]);
  const [selectedICPId, setSelectedICPId] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [showMessagingFlow, setShowMessagingFlow] = useState(false);
  const [messagingFlowIcpId, setMessagingFlowIcpId] = useState(null);

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
    loadICPProfiles();
  }, []);

  async function loadICPProfiles() {
    try {
      const user = getEffectiveUser();
      if (!user) { navigate('/login'); return; }

      // Load from icpProfiles collection
      const profilesSnap = await getDocs(collection(db, 'users', user.uid, 'icpProfiles'));
      let icps = profilesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      icps.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

      if (icps.length === 0) {
        // Migrate from legacy companyProfile/current if it exists
        const legacyDoc = await getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current'));
        const legacyData = legacyDoc.exists() ? legacyDoc.data() : null;
        const newId = `icp_${Date.now()}`;
        const newICP = {
          name: 'My ICP',
          industries: legacyData?.industries || [],
          companySizes: legacyData?.companySizes || [],
          revenueRanges: legacyData?.revenueRanges || [],
          skipRevenue: legacyData?.skipRevenue || false,
          locations: legacyData?.locations || [],
          isNationwide: legacyData?.isNationwide || false,
          targetTitles: legacyData?.targetTitles || [],
          scoringWeights: legacyData?.scoringWeights || DEFAULT_WEIGHTS,
          foundedAgeRange: legacyData?.foundedAgeRange || null,
          managedByBarry: legacyData?.managedByBarry || false,
          lookalikeSeed: legacyData?.lookalikeSeed || null,
          notes: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await setDoc(doc(db, 'users', user.uid, 'icpProfiles', newId), newICP);
        icps = [{ id: newId, ...newICP }];
      }

      setIcpList(icps);
      const active = icps.find(i => i.isActive && i.status === 'active') || icps[0];
      setSelectedICPId(active.id);
      setNameInput(active.name || 'My ICP');
      applyICPToState(active);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load ICP profiles:', error);
      setLoading(false);
    }
  }

  function applyICPToState(icp) {
    setProfile({
      ...icp,
      scoringWeights: icp.scoringWeights || DEFAULT_WEIGHTS,
      targetTitles: icp.targetTitles || [],
    });
  }

  function selectICP(icp) {
    setSelectedICPId(icp.id);
    setNameInput(icp.name || 'My ICP');
    setEditingName(false);
    applyICPToState(icp);
  }

  async function handleCreateICP() {
    try {
      const user = getEffectiveUser();
      const newId = `icp_${Date.now()}`;
      const newICP = {
        name: `ICP ${icpList.length + 1}`,
        industries: [],
        companySizes: [],
        revenueRanges: [],
        skipRevenue: false,
        locations: [],
        isNationwide: false,
        targetTitles: [],
        scoringWeights: DEFAULT_WEIGHTS,
        foundedAgeRange: null,
        managedByBarry: false,
        notes: '',
        isActive: false,
        status: 'pending',
        messagingProgress: 0,
        messaging: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'users', user.uid, 'icpProfiles', newId), newICP);
      const newICPWithId = { id: newId, ...newICP };
      setIcpList(prev => [...prev, newICPWithId]);
      selectICP(newICPWithId);
      setMessagingFlowIcpId(newId);
      setShowMessagingFlow(true);
    } catch (error) {
      console.error('Failed to create ICP:', error);
      alert('Failed to create ICP. Please try again.');
    }
  }

  async function handleSetActive(icpId) {
    try {
      const user = getEffectiveUser();
      const batch = writeBatch(db);
      icpList.forEach(icp => {
        const isTarget = icp.id === icpId;
        batch.update(doc(db, 'users', user.uid, 'icpProfiles', icp.id), {
          isActive: isTarget,
          status: isTarget ? 'active' : (icp.status === 'active' ? 'inactive' : icp.status),
          updatedAt: new Date().toISOString(),
        });
      });
      const targetIcp = icpList.find(i => i.id === icpId);
      if (targetIcp) {
        batch.set(doc(db, 'users', user.uid, 'companyProfile', 'current'), {
          ...targetIcp,
          isActive: true,
          status: 'active',
          updatedAt: new Date().toISOString(),
        });
      }
      await batch.commit();
      setIcpList(prev => prev.map(i => ({
        ...i,
        isActive: i.id === icpId,
        status: i.id === icpId ? 'active' : (i.status === 'active' ? 'inactive' : i.status),
      })));
    } catch (error) {
      console.error('Failed to set active ICP:', error);
    }
  }

  async function handleDeleteICP(icpId) {
    if (icpList.length <= 1) {
      alert('You must have at least one ICP profile.');
      return;
    }
    if (!window.confirm('Delete this ICP? This cannot be undone.')) return;
    try {
      const user = getEffectiveUser();
      await deleteDoc(doc(db, 'users', user.uid, 'icpProfiles', icpId));
      const newList = icpList.filter(i => i.id !== icpId);
      setIcpList(newList);
      if (selectedICPId === icpId) {
        selectICP(newList[0]);
      }
    } catch (error) {
      console.error('Failed to delete ICP:', error);
      alert('Failed to delete ICP. Please try again.');
    }
  }

  async function handleRenameICP() {
    if (!nameInput.trim()) return;
    try {
      const user = getEffectiveUser();
      await updateDoc(doc(db, 'users', user.uid, 'icpProfiles', selectedICPId), {
        name: nameInput.trim(),
      });
      setIcpList(prev => prev.map(i => i.id === selectedICPId ? { ...i, name: nameInput.trim() } : i));
      setProfile(prev => ({ ...prev, name: nameInput.trim() }));
      setEditingName(false);
    } catch (error) {
      console.error('Failed to rename ICP:', error);
    }
  }

  async function handleSaveChanges() {
    try {
      setSaving(true);
      const user = getEffectiveUser();

      // Validate weights if they exist
      if (profile.scoringWeights && totalWeight !== 100) {
        alert(`Scoring weights must total 100%. Currently at ${totalWeight}%.`);
        setSaving(false);
        return;
      }

      const updatedProfile = {
        ...profile,
        name: nameInput.trim() || profile.name || 'My ICP',
        updatedAt: new Date().toISOString(),
      };

      // Save to icpProfiles collection
      await setDoc(
        doc(db, 'users', user.uid, 'icpProfiles', selectedICPId),
        updatedProfile
      );

      // Sync to bridge cache if this is the active profile
      const isActiveProfile = icpList.find(i => i.id === selectedICPId)?.isActive === true;
      if (isActiveProfile) {
        await setDoc(
          doc(db, 'users', user.uid, 'companyProfile', 'current'),
          updatedProfile
        );
      }

      // Update local list
      setIcpList(prev => prev.map(i => i.id === selectedICPId ? { ...i, ...updatedProfile } : i));
      setProfile(updatedProfile);

      // Recalculate all company scores with new weights
      if (profile.scoringWeights) {
        await recalculateAllScores(user.uid, updatedProfile, updatedProfile.scoringWeights);
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
      setRefreshResult(null);

      const user = getEffectiveUser();
      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: profile,
          icpId: selectedICPId
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh results');
      }

      setRefreshResult({ count: data.companiesAdded || 0 });
      setTimeout(() => setRefreshResult(null), 6000);
      setRefreshing(false);
    } catch (error) {
      console.error('Failed to refresh:', error);
      setRefreshResult({ error: error.message });
      setTimeout(() => setRefreshResult(null), 6000);
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

  const handleFoundedAgeChange = (minAge, maxAge) => {
    const bothNull = (minAge === null || minAge === undefined) &&
                     (maxAge === null || maxAge === undefined);
    setProfile(prev => ({
      ...prev,
      foundedAgeRange: bothNull ? null : { minAge: minAge ?? null, maxAge: maxAge ?? null, includeUnknown: true }
    }));
  };

  const handleClearFoundedAge = () => {
    setProfile(prev => ({ ...prev, foundedAgeRange: null }));
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
      {/* Multi-ICP Selector */}
      <div className="icp-profile-selector">
        <div className="icp-tabs-row">
          {icpList.map(icp => (
            <div
              key={icp.id}
              className={`icp-profile-tab ${selectedICPId === icp.id ? 'icp-profile-tab--active' : ''}`}
              onClick={() => selectICP(icp)}
            >
              {selectedICPId === icp.id && editingName ? (
                <input
                  className="icp-name-input"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onBlur={handleRenameICP}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameICP(); if (e.key === 'Escape') { setEditingName(false); setNameInput(icp.name || 'My ICP'); } }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span
                  className="icp-tab-name"
                  onDoubleClick={e => { e.stopPropagation(); if (selectedICPId === icp.id) { setEditingName(true); setNameInput(icp.name || 'My ICP'); } }}
                  title={selectedICPId === icp.id ? 'Double-click to rename' : ''}
                >
                  {icp.name || 'My ICP'}
                </span>
              )}
              {icp.isActive && icp.status === 'active' && (
                <span className="icp-status-badge icp-status-badge--active">Active</span>
              )}
              {icp.status === 'inactive' && (
                <span className="icp-status-badge icp-status-badge--ready">Ready</span>
              )}
              {icp.status === 'pending' && (
                <span className="icp-status-badge icp-status-badge--pending">{icp.messagingProgress || 0}%</span>
              )}
              {icpList.length > 1 && selectedICPId === icp.id && !editingName && (
                <button
                  className="icp-tab-delete"
                  onClick={e => { e.stopPropagation(); handleDeleteICP(icp.id); }}
                  title="Delete this ICP"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="icp-add-tab-btn" onClick={handleCreateICP} title="Add new ICP profile">
            + Add Profile
          </button>
        </div>

        {/* Profile action bar — shown for non-active selected profiles */}
        {selectedICPId && (() => {
          const sel = icpList.find(i => i.id === selectedICPId);
          if (!sel || (sel.isActive && sel.status === 'active')) return null;
          return (
            <div className="icp-profile-actions">
              {sel.status === 'pending' && (
                <>
                  <span className="icp-profile-action-note">
                    Messaging setup {sel.messagingProgress || 0}% complete
                  </span>
                  <button
                    className="icp-finish-setup-btn"
                    onClick={() => { setMessagingFlowIcpId(selectedICPId); setShowMessagingFlow(true); }}
                  >
                    Finish setup
                  </button>
                </>
              )}
              {sel.status === 'inactive' && (
                <>
                  <span className="icp-profile-action-note">Ready to activate</span>
                  <button
                    className="icp-set-active-btn"
                    onClick={() => handleSetActive(selectedICPId)}
                  >
                    <Zap size={13} />
                    Set as Active
                  </button>
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* Enterprise Header */}
      <div className="enterprise-header">
        <div className="header-content">
          <h1 className="page-title">
            {icpList.find(i => i.id === selectedICPId)?.name || 'ICP Settings'}
          </h1>
          <p className="page-subtitle">Define and refine your Ideal Customer Profile criteria</p>
        </div>
        <div className="header-actions">
          {refreshResult && !refreshResult.error && (
            <span className="header-refresh-success">
              <CheckCircle className="w-4 h-4" />
              {refreshResult.count > 0 ? `${refreshResult.count} new companies added to Daily Leads` : 'Queue is full — review current targets'}
            </span>
          )}
          {refreshResult?.error && (
            <span className="header-refresh-error">Refresh failed — try again</span>
          )}
          <button
            onClick={handleRefreshResults}
            disabled={refreshing || saving || !profile}
            className="header-refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'spinning' : ''}`} />
            <span>{refreshing ? 'Searching...' : 'Refresh Results'}</span>
          </button>
        </div>
      </div>

      {/* Managed by Barry Banner */}
      {profile?.managedByBarry && (
        <div className="barry-managed-banner">
          <div className="barry-managed-content">
            <div className="barry-icon">
              <Brain className="w-5 h-5" />
            </div>
            <div className="barry-text">
              <p className="barry-title">Managed by Barry</p>
              <p className="barry-subtitle">
                Your ICP was configured by Barry. Barry will begin refining this over time as you use Scout and Hunter.
              </p>
              {/* Show lookalike strategy info if present */}
              {profile.lookalikeSeed?.name && (
                <p className="barry-subtitle barry-lookalike-info">
                  Search strategy: Finding companies similar to <strong>{profile.lookalikeSeed.name}</strong>
                </p>
              )}
              <p className="barry-subtitle barry-override-note">
                Changes made here will override Barry's settings.
              </p>
            </div>
            <button
              onClick={() => setShowBarryPanel(true)}
              className="edit-with-barry-btn"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Edit with Barry</span>
            </button>
          </div>
        </div>
      )}

      {/* Edit with Barry CTA (when not managed by Barry) */}
      {!profile?.managedByBarry && (
        <div className="barry-cta-banner">
          <div className="barry-cta-content">
            <div className="barry-icon">
              <Brain className="w-5 h-5" />
            </div>
            <div className="barry-text">
              <p className="barry-title">Want Barry to help?</p>
              <p className="barry-subtitle">
                Let Barry guide you through defining your ICP conversationally.
              </p>
            </div>
            <button
              onClick={() => setShowBarryPanel(true)}
              className="use-barry-btn"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Talk to Barry</span>
            </button>
          </div>
        </div>
      )}

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

        {profile.foundedAgeRange && (
          <div className="summary-card">
            <div className="summary-icon">
              <Calendar className="w-5 h-5" />
            </div>
            <div className="summary-content">
              <p className="summary-label">Company Age</p>
              <p className="summary-value">
                {profile.foundedAgeRange.minAge != null && profile.foundedAgeRange.maxAge != null
                  ? `${profile.foundedAgeRange.minAge}–${profile.foundedAgeRange.maxAge} yrs`
                  : profile.foundedAgeRange.minAge != null
                    ? `${profile.foundedAgeRange.minAge}+ yrs`
                    : `Up to ${profile.foundedAgeRange.maxAge} yrs`}
              </p>
            </div>
          </div>
        )}
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

        {/* Company Age Section */}
        <NumericRangeFilter
          label="Company Age"
          unit="years"
          minValue={profile.foundedAgeRange?.minAge ?? null}
          maxValue={profile.foundedAgeRange?.maxAge ?? null}
          presets={[
            { label: 'Startup (0–5 yrs)', minValue: null, maxValue: 5 },
            { label: 'Growth (5–10 yrs)', minValue: 5, maxValue: 10 },
            { label: 'Established (10+ yrs)', minValue: 10, maxValue: null }
          ]}
          helperText={(minAge, maxAge) => {
            const currentYear = new Date().getFullYear();
            const fromYear = maxAge != null ? currentYear - maxAge : null;
            const toYear = minAge != null ? currentYear - minAge : null;
            if (fromYear && toYear) return `Companies founded between ${fromYear} and ${toYear}`;
            if (fromYear) return `Companies founded ${fromYear} or later`;
            if (toYear) return `Companies founded ${toYear} or earlier`;
            return '';
          }}
          onChange={handleFoundedAgeChange}
          onClear={handleClearFoundedAge}
        />

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
                  <Building2 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
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
                  <MapPin className="w-5 h-5" style={{ color: 'var(--accent)' }} />
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
                  <Users className="w-5 h-5" style={{ color: 'var(--accent)' }} />
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
                  <TrendingUp className="w-5 h-5" style={{ color: 'var(--accent)' }} />
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

        {/* Notes Section */}
        <div className="setting-section">
          <div className="section-header">
            <div className="section-title-group">
              <FileText className="section-icon" />
              <h3>Notes</h3>
            </div>
          </div>
          <p className="section-description">
            Add any context, strategy notes, or reminders for this ICP. These are for your reference only.
          </p>
          <textarea
            className="icp-notes-textarea"
            placeholder="e.g. Focus on post-Series A companies. Avoid Fortune 500. Ideal contact is Head of RevOps or VP Sales..."
            value={profile.notes || ''}
            onChange={(e) => setProfile(prev => ({ ...prev, notes: e.target.value }))}
            rows={4}
          />
        </div>

        {/* Action Buttons */}
        <div className="action-section">
          {saveSuccess && (
            <div className="success-message">
              <CheckCircle className="w-5 h-5" />
              <span>
                Settings saved successfully! Click "Refresh Results" to fetch new companies.
                {profile.foundedAgeRange && ' Note: companies without founding year data will still appear — look for the Year unknown badge.'}
              </span>
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

      {showBarryPanel && (
        <BarryICPPanel
          userId={auth.currentUser?.uid}
          icpProfile={profile}
          onClose={() => setShowBarryPanel(false)}
          onSearchComplete={() => {
            setShowBarryPanel(false);
            const user = getEffectiveUser();
            if (user) {
              getDoc(doc(db, 'users', user.uid, 'companyProfile', 'current'))
                .then(snap => { if (snap.exists()) setProfile(snap.data()); })
                .catch(() => {});
            }
          }}
        />
      )}

      {showMessagingFlow && messagingFlowIcpId && (
        <Section9MessagingFlow
          icpId={messagingFlowIcpId}
          icpName={icpList.find(i => i.id === messagingFlowIcpId)?.name || 'New Profile'}
          existingAnswers={icpList.find(i => i.id === messagingFlowIcpId)?.messaging || {}}
          onComplete={({ activated, icpId: completedId }) => {
            setShowMessagingFlow(false);
            setMessagingFlowIcpId(null);
            // Refresh local state to reflect new status/isActive
            setIcpList(prev => prev.map(i => {
              if (i.id === completedId) {
                return { ...i, messagingProgress: 100, status: activated ? 'active' : 'inactive', isActive: activated };
              }
              if (activated && i.id !== completedId) {
                return { ...i, isActive: false, status: i.status === 'active' ? 'inactive' : i.status };
              }
              return i;
            }));
          }}
          onDismiss={() => {
            setShowMessagingFlow(false);
            setMessagingFlowIcpId(null);
            // Reload to pick up partial progress saved by the flow
            loadICPProfiles();
          }}
        />
      )}
    </div>
  );
}
