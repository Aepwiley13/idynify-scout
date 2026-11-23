import { useEffect, useState, useRef } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';

import { APOLLO_INDUSTRIES } from '../../constants/apolloIndustries';
import { US_STATES } from '../../constants/usStates';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Users, MapPin, Search, X, Save, RefreshCw, CheckCircle, AlertCircle, Globe, Filter, Sliders, TrendingUp, Brain, MessageSquare, Calendar, FileText, Zap, ChevronDown } from 'lucide-react';
import { SAVE_OUTCOME, SAVE_OUTCOME_COPY, saveOutcomeFor } from '../../utils/icpSaveOutcome';
import NumericRangeFilter from '../../components/scout/NumericRangeFilter';
import { DEFAULT_WEIGHTS } from '../../utils/icpScoring';
import './ICPSettings.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import BarryICPPanel from '../../components/scout/BarryICPPanel';
import Section9MessagingFlow from '../../components/icp/Section9MessagingFlow';
import { setActiveIcpProfile, nextLifecycleState } from '../../utils/setActiveIcpProfile';
import { buildIcpCriteriaWrite } from '../../utils/icpProfileWrite';
import { resolveActiveIcp, isResolved } from '../../utils/resolveActiveIcp';
import { criteriaChanged } from '../../utils/normalizeIcpCriteria';
import { describeIcpProfile, PROFILE_STATE } from '../../utils/icpProfileState';

export default function ICPSettings() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showBarryPanel, setShowBarryPanel] = useState(false);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // #006.2 — what a save actually did about discovery. Kept until the next save,
  // because 'Barry is searching' is only true until the search ends.
  const [saveOutcome, setSaveOutcome] = useState(null); // { kind: SAVE_OUTCOME.* } | null
  const [autoSearching, setAutoSearching] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null); // { count: number } | null

  // Multi-ICP state
  const [icpList, setIcpList] = useState([]);
  const [selectedICPId, setSelectedICPId] = useState(null);
  const [icpUnresolvedReason, setIcpUnresolvedReason] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [showMessagingFlow, setShowMessagingFlow] = useState(false);
  const [messagingFlowIcpId, setMessagingFlowIcpId] = useState(null);

  // Search states for dropdowns
  const [industrySearch, setIndustrySearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');
  const [newTitleInput, setNewTitleInput] = useState('');

  const savedCriteriaRef = useRef(null);
  const discoveryInFlightRef = useRef(false);
  // #006.9 — scoring weights live in a collapsed "Advanced" section. A save
  // blocked by an invalid total opens it and moves focus to the message.
  const [advancedScoringOpen, setAdvancedScoringOpen] = useState(false);
  const [weightsSaveBlocked, setWeightsSaveBlocked] = useState(0);
  const weightsErrorRef = useRef(null);
  useEffect(() => {
    if (weightsSaveBlocked) weightsErrorRef.current?.focus();
  }, [weightsSaveBlocked]);

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

      // Opening this page must not create an ICP. It used to: an empty
      // collection silently produced `icp_${Date.now()}` from whatever the
      // bridge held — with no isActive and no status, so the canonical resolver
      // could never see the profile it had just made. An ICP now originates
      // only from an explicit creation or confirmation event. With zero ICPs
      // this page renders its empty state, where the existing "+" create
      // action is reachable.
      setIcpList(icps);

      if (icps.length === 0) {
        setSelectedICPId(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      // If a specific ICP was requested via URL (e.g. double-click from
      // Daily Discoveries), select it directly; otherwise resolve through
      // the canonical contract.
      const deepLinkId = searchParams.get('icpId');
      const deepLinked = deepLinkId ? icps.find(i => i.id === deepLinkId) : null;

      let selected;
      if (deepLinked) {
        selected = deepLinked;
      } else {
        const resolution = await resolveActiveIcp(user.uid);
        selected = isResolved(resolution)
          ? icps.find(i => i.id === resolution.icpId) || icps[0]
          : icps[0];
        setIcpUnresolvedReason(isResolved(resolution) ? null : resolution.reason);
      }
      setSelectedICPId(selected.id);
      setNameInput(selected.name || 'My ICP');
      applyICPToState(selected);
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
    savedCriteriaRef.current = icp;
    // A blocked save belongs to the profile it was attempted on (#006.8).
    setWeightsSaveBlocked(0);
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

  /**
   * Reflect an activation in local state.
   *
   * `icpList` and `profile` are two views of the same documents, and this
   * screen used to update only the first. The second went on holding the
   * lifecycle it was mounted with, and the next save wrote that stale pair back
   * over the activation. Both are derived here from nextLifecycleState — the
   * same rule setActiveIcpProfile commits — so they cannot disagree.
   */
  function applyActivationToState(activatedId) {
    setIcpList(prev => prev.map(i => ({ ...i, ...nextLifecycleState(i, i.id === activatedId) })));
    setProfile(prev => (prev ? { ...prev, ...nextLifecycleState(prev, selectedICPId === activatedId) } : prev));
  }

  async function handleSetActive(icpId) {
    try {
      const user = getEffectiveUser();
      await setActiveIcpProfile(user.uid, icpId, {}, icpList);
      applyActivationToState(icpId);
    } catch (error) {
      // setActiveIcpProfile refuses to run when it cannot find the target, so a
      // failure here means nothing changed. Say so: an activation that silently
      // does nothing reads as a working button.
      console.error('Failed to set active ICP:', error);
      alert('Could not activate this ICP. Please reload and try again.');
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
        setAdvancedScoringOpen(true);
        setWeightsSaveBlocked(n => n + 1);
        setSaving(false);
        return;
      }
      setWeightsSaveBlocked(0);

      const updatedProfile = {
        ...profile,
        name: nameInput.trim() || profile.name || 'My ICP',
        updatedAt: new Date().toISOString(),
      };

      // This screen edits targeting criteria. It does not own identity or
      // lifecycle, so it writes neither: only the fields in ICP_CRITERIA_FIELDS,
      // merged into whatever is stored.
      //
      // It used to persist `updatedProfile` wholesale with a non-merging
      // setDoc. `profile` is a spread of the ICP as it was when this screen
      // mounted, so that write replayed a stale isActive/status pair — most
      // visibly right after an activation performed on this very screen, which
      // it silently undid. isActive and status change through
      // setActiveIcpProfile or they do not change.
      const criteriaWrite = {
        ...buildIcpCriteriaWrite(updatedProfile),
        updatedAt: updatedProfile.updatedAt,
      };

      // Save to icpProfiles collection
      await setDoc(
        doc(db, 'users', user.uid, 'icpProfiles', selectedICPId),
        criteriaWrite,
        { merge: true }
      );

      // Sync to bridge cache if this is the active profile.
      //
      // The bridge is a projection of the active ICP, and it is asserting that
      // this profile is current — so it must never be handed a snapshot that
      // says otherwise. Same allowlist, same merge: the lifecycle
      // setActiveIcpProfile wrote here stays intact.
      const isActiveProfile = icpList.find(i => i.id === selectedICPId)?.isActive === true;
      if (isActiveProfile) {
        await setDoc(
          doc(db, 'users', user.uid, 'companyProfile', 'current'),
          { ...criteriaWrite, icpId: selectedICPId, icpIdSource: 'icp-settings-save' },
          { merge: true }
        );
      }

      // Update local list — criteria only, for the same reason. Spreading the
      // whole profile here pushed its stale lifecycle back into icpList, which
      // is the source the bridge gate above reads.
      setIcpList(prev => prev.map(i => i.id === selectedICPId ? { ...i, ...criteriaWrite } : i));
      setProfile(updatedProfile);

      // Match is no longer recomputed and persisted here. See the note where
      // recalculateAllScores used to live: every live surface derives Match on
      // demand against the ICP it is actually showing, so saving one ICP can no
      // longer overwrite another ICP's stored scores.

      const changed = criteriaChanged(savedCriteriaRef.current, updatedProfile);
      setSaveOutcome({ kind: saveOutcomeFor({ isActiveProfile, changed, searchAlreadyRunning: discoveryInFlightRef.current }) });
      if (isActiveProfile && !discoveryInFlightRef.current && changed) {
        discoveryInFlightRef.current = true;
        setAutoSearching(true);
        await setDoc(doc(db, 'users', user.uid), {
          barryState: 'SEARCHING',
          companiesFoundCount: 0,
        }, { merge: true });
        const authToken = await user.getIdToken();
        fetch('/.netlify/functions/search-companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            authToken,
            companyProfile: updatedProfile,
            icpId: selectedICPId,
            forceRefresh: true,
          }),
        }).then((res) => {
          discoveryInFlightRef.current = false;
          setAutoSearching(false);
          setSaveOutcome({ kind: res?.ok ? SAVE_OUTCOME.SEARCH_FINISHED : SAVE_OUTCOME.SEARCH_FAILED });
        }).catch(() => {
          discoveryInFlightRef.current = false;
          setAutoSearching(false);
          setSaveOutcome({ kind: SAVE_OUTCOME.SEARCH_FAILED });
        });
      }

      savedCriteriaRef.current = updatedProfile;
      setSaving(false);
    } catch (error) {
      console.error('Failed to save ICP:', error);
      alert('Failed to save changes. Please try again.');
      setSaving(false);
    }
  }

  /*
   * recalculateAllScores was removed here.
   *
   * It iterated EVERY company in the user's collection and overwrote
   * `fit_score`, `fit_reasons` and `fit_reason` using whichever ICP had just
   * been saved — without checking which ICP each company was discovered for.
   * Saving ICP B rewrote the stored Match of every company found under ICP A,
   * and left `icpId` untouched, so the row then claimed A's identity while
   * carrying B's score. That is cross-ICP contamination at the source.
   *
   * Match's subject is Company × ICP; it is not a property a company carries on
   * its own. Persisting one number per company cannot express that, and building
   * something that could is a Company × ICP persistence schema — Category 2, not
   * authorized here. So the unsafe persistence is retired rather than patched:
   * every live surface now derives Match on demand against the ICP it is
   * displaying, which is both correct and free of stored contamination.
   *
   * Category 2 debt this leaves behind is recorded in the Tier 2 report:
   * existing `fit_score` values written by this function remain in Firestore
   * with no reliable ICP attribution. Nothing reads them as authoritative any
   * more, and no migration is performed here.
   */

  async function handleRefreshResults() {
    // #006.2 — a save may have just started a search; never start a second one.
    if (refreshing || discoveryInFlightRef.current) return;
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
          icpId: selectedICPId,
          forceRefresh: true
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to refresh results');
      }

      setRefreshResult({ count: data.companiesAdded || 0, currentQueueSize: data.currentQueueSize || 0, at: Date.now() });
      setRefreshing(false);
    } catch (error) {
      console.error('Failed to refresh:', error);
      setRefreshResult({ error: error.message, at: Date.now() });
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

  const selectedIcpData = icpList.find(i => i.id === selectedICPId) || null;
  const profileState = describeIcpProfile(selectedIcpData, profile);

  if (loading) {
    return (
      <div className="icp-settings-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading ICP settings...</p>
      </div>
    );
  }

  // Zero ICPs is a valid state, not a broken account — most of IDYNIFY works
  // without one. This is the surface whose purpose IS the ICP, so it is the
  // surface that offers to create one. handleCreateICP already existed; it was
  // simply unreachable, because the "+" control renders below this early return.
  if (!profile) {
    return (
      <div className="icp-empty">
        <Filter className="w-16 h-16 text-gray-400 mb-4" />
        <h2>No target profile yet</h2>
        <p>A target profile tells Scout which companies to look for. You only need one when you want to discover new companies — the rest of IDYNIFY works without it.</p>
        <button className="icp-empty-create-btn" onClick={handleCreateICP}>
          Create a target profile
        </button>
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
      {icpUnresolvedReason === 'none-active' && (
        <div className="icp-selection-required">
          None of your target profiles is active. Scout uses the active profile — pick one below to start discovering against it.
        </div>
      )}
      {icpUnresolvedReason === 'read-failed' && (
        <div className="icp-selection-required">
          Couldn&apos;t confirm which target profile is active. Reload to try again.
        </div>
      )}
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

        {/* Profile status (#006.8): one explanation for the selected profile,
            with the existing Finish setup / Set as Active action beside it. */}
        {profileState && (
          <div
            className={`icp-profile-actions icp-profile-status icp-profile-status--${profileState.state}`}
            data-testid="icp-profile-status"
            data-state={profileState.state}
          >
            <p className="icp-profile-status-text">
              <span className="icp-profile-status-main">{profileState.text}</span>
              {profileState.state === PROFILE_STATE.SETUP && (
                <span className="icp-profile-status-detail">
                  {' '}Messaging setup {selectedIcpData.messagingProgress || 0}% complete.
                </span>
              )}
              {profileState.managedText && (
                <span className="icp-profile-status-managed">{' '}{profileState.managedText}</span>
              )}
            </p>
            {profileState.canFinishSetup && (
              <button
                className="icp-finish-setup-btn"
                onClick={() => { setMessagingFlowIcpId(selectedICPId); setShowMessagingFlow(true); }}
              >
                Finish setup
              </button>
            )}
            {profileState.canActivate && (
              <button
                className="icp-set-active-btn"
                onClick={() => handleSetActive(selectedICPId)}
              >
                <Zap size={13} />
                Set as Active
              </button>
            )}
          </div>
        )}
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
            <span className="header-refresh-success" role="status">
              <CheckCircle className="w-4 h-4" aria-hidden="true" />
              {refreshResult.count > 0
                ? `${refreshResult.count} new companies added to Daily Discoveries`
                : refreshResult.currentQueueSize > 0
                  ? 'Queue is already full — review current targets'
                  : 'No new matches found. Try adjusting your ICP criteria.'}
              {' · '}{new Date(refreshResult.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          {refreshResult?.error && (
            <span className="header-refresh-error" role="alert">Last refresh didn't finish · {new Date(refreshResult.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} — try Refresh Results again</span>
          )}
          <button
            onClick={handleRefreshResults}
            disabled={refreshing || saving || autoSearching || !profile}
            title={autoSearching ? 'Barry is already searching with your saved changes' : undefined}
            className="header-refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'spinning' : ''}`} />
            <span>{refreshing ? 'Searching...' : 'Refresh Results'}</span>
          </button>
        </div>
      </div>

      {/* Refine with Barry (#006.8): the one Barry entry on this page. It opens
          the same BarryICPPanel the two earlier cards opened. */}
      <div className="barry-cta-banner barry-refine" data-testid="refine-with-barry">
        <div className="barry-cta-content">
          <div className="barry-icon" aria-hidden="true">
            <Brain className="w-5 h-5" />
          </div>
          <div className="barry-text">
            <h2 className="barry-title" id="refine-with-barry-title">Refine with Barry</h2>
            <p className="barry-subtitle">
              Describe your best customers in your own words. Barry will help you define and refine who Scout looks for.
            </p>
            {profile?.managedByBarry && profile.lookalikeSeed?.name && (
              <p className="barry-subtitle barry-lookalike-info">
                Search strategy: Finding companies similar to <strong>{profile.lookalikeSeed.name}</strong>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowBarryPanel(true)}
            className="use-barry-btn"
            aria-describedby="refine-with-barry-title"
          >
            <MessageSquare className="w-4 h-4" aria-hidden="true" />
            <span>Ask Barry</span>
          </button>
        </div>
      </div>

      {/* Who you're looking for (#006.8): the targeting fields under one heading. */}
      <section className="icp-targeting" aria-labelledby="icp-targeting-heading">
      <div className="icp-group-intro">
        <h2 className="icp-group-heading" id="icp-targeting-heading">Who you&apos;re looking for</h2>
        <p className="icp-group-description">
          The companies and people Scout should find for you. Barry searches with these choices.
        </p>
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

      </div>
      </section>

      <div className="settings-content icp-more-settings">
        {/* ICP Scoring Weights Section */}
        <div className="setting-section scoring-weights-section advanced-scoring">
          <div className="section-header">
            <h3 className="advanced-scoring-heading">
              <button
                type="button"
                className="advanced-scoring-toggle"
                aria-expanded={advancedScoringOpen}
                aria-controls="advanced-scoring-panel"
                onClick={() => setAdvancedScoringOpen(open => !open)}
              >
                <Sliders className="section-icon" aria-hidden="true" />
                <span>Advanced: How Matches Are Scored</span>
                <ChevronDown className="advanced-scoring-chevron" aria-hidden="true" />
              </button>
            </h3>
            <span className={`selection-count ${totalWeight !== 100 ? 'error' : ''}`}>
              {totalWeight !== 100 ? `Weights must total 100% · now ${totalWeight}%` : `${totalWeight}%`}
            </span>
          </div>
          <p className="section-description advanced-scoring-intro">
            Adjust how important each factor is when Scout evaluates companies. Most users can leave these settings as they are.
          </p>

          <div id="advanced-scoring-panel" className="advanced-scoring-panel" hidden={!advancedScoringOpen}>
          <p className="section-description">
            Adjust how much each criterion contributes to the lead score. Total must equal 100%.
          </p>

          {profile.scoringWeights && (
            <div className="weights-grid">
              {/* Industry Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <Building2 className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                  <label className="weight-label" htmlFor="weight-industry">Industry Match</label>
                  <span className="weight-value">{profile.scoringWeights.industry}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.industry}
                  onChange={(e) => handleWeightChange('industry', e.target.value)}
                  className="weight-slider"
                  aria-label="Industry Match weight (slider)"
                  aria-invalid={totalWeight !== 100 || undefined}
                  aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    id="weight-industry"
                    value={profile.scoringWeights.industry}
                    onChange={(e) => handleWeightChange('industry', e.target.value)}
                    className="weight-input"
                    aria-invalid={totalWeight !== 100 || undefined}
                    aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>

              {/* Location Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <MapPin className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                  <label className="weight-label" htmlFor="weight-location">Location Match</label>
                  <span className="weight-value">{profile.scoringWeights.location}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.location}
                  onChange={(e) => handleWeightChange('location', e.target.value)}
                  className="weight-slider"
                  aria-label="Location Match weight (slider)"
                  aria-invalid={totalWeight !== 100 || undefined}
                  aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    id="weight-location"
                    value={profile.scoringWeights.location}
                    onChange={(e) => handleWeightChange('location', e.target.value)}
                    className="weight-input"
                    aria-invalid={totalWeight !== 100 || undefined}
                    aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>

              {/* Employee Size Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <Users className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                  <label className="weight-label" htmlFor="weight-employeeSize">Employee Size Match</label>
                  <span className="weight-value">{profile.scoringWeights.employeeSize}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.employeeSize}
                  onChange={(e) => handleWeightChange('employeeSize', e.target.value)}
                  className="weight-slider"
                  aria-label="Employee Size Match weight (slider)"
                  aria-invalid={totalWeight !== 100 || undefined}
                  aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    id="weight-employeeSize"
                    value={profile.scoringWeights.employeeSize}
                    onChange={(e) => handleWeightChange('employeeSize', e.target.value)}
                    className="weight-input"
                    aria-invalid={totalWeight !== 100 || undefined}
                    aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>

              {/* Revenue Weight */}
              <div className="weight-control">
                <div className="weight-header">
                  <TrendingUp className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                  <label className="weight-label" htmlFor="weight-revenue">Revenue Match</label>
                  <span className="weight-value">{profile.scoringWeights.revenue}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={profile.scoringWeights.revenue}
                  onChange={(e) => handleWeightChange('revenue', e.target.value)}
                  className="weight-slider"
                  aria-label="Revenue Match weight (slider)"
                  aria-invalid={totalWeight !== 100 || undefined}
                  aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                />
                <div className="weight-input-group">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    id="weight-revenue"
                    value={profile.scoringWeights.revenue}
                    onChange={(e) => handleWeightChange('revenue', e.target.value)}
                    className="weight-input"
                    aria-invalid={totalWeight !== 100 || undefined}
                    aria-describedby={totalWeight !== 100 ? 'weights-total-error' : undefined}
                  />
                  <span className="weight-unit">%</span>
                </div>
              </div>
            </div>
          )}

          {totalWeight !== 100 && (
            <div
              id="weights-total-error"
              className="weight-warning"
              ref={weightsErrorRef}
              tabIndex={-1}
              role={weightsSaveBlocked ? 'alert' : undefined}
              data-testid="weights-total-error"
            >
              <X className="w-5 h-5" aria-hidden="true" />
              <span>
                {weightsSaveBlocked ? 'Not saved. ' : ''}
                Total must equal 100%. Currently at {totalWeight}%.
                {totalWeight > 100 ? ` Reduce by ${totalWeight - 100}%.` : ` Add ${100 - totalWeight}%.`}
              </span>
            </div>
          )}
          </div>
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
          {saveOutcome && (
            <div
              className={SAVE_OUTCOME_COPY[saveOutcome.kind].tone === 'error' ? 'error-message' : 'success-message'}
              role={SAVE_OUTCOME_COPY[saveOutcome.kind].tone === 'error' ? 'alert' : 'status'}
              data-save-outcome={saveOutcome.kind}
            >
              {SAVE_OUTCOME_COPY[saveOutcome.kind].tone === 'error'
                ? <AlertCircle className="w-5 h-5" aria-hidden="true" />
                : <CheckCircle className="w-5 h-5" aria-hidden="true" />}
              <span>
                {SAVE_OUTCOME_COPY[saveOutcome.kind].text}
                {profile.foundedAgeRange && ' Note: companies without founding year data will still appear — look for the Year unknown badge.'}
                {SAVE_OUTCOME_COPY[saveOutcome.kind].link && (
                  <>
                    {' '}
                    <button type="button" className="inline-link" onClick={() => navigate('/scout?tab=daily-leads')}>
                      Go to Daily Discoveries
                    </button>
                  </>
                )}
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
              disabled={refreshing || saving || autoSearching}
              title={autoSearching ? 'Barry is already searching with your saved changes' : undefined}
              className="refresh-btn"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'spinning' : ''}`} />
              <span>{refreshing ? 'Searching...' : 'Refresh Results'}</span>
            </button>
          </div>

          <p className="action-hint">
            <Filter className="w-4 h-4" />
            <span>Saving changes to your active profile starts a new search automatically. Use Refresh Results to search again with your current settings.</span>
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
          icpList={icpList}
          existingAnswers={icpList.find(i => i.id === messagingFlowIcpId)?.messaging || {}}
          onComplete={({ activated, icpId: completedId }) => {
            setShowMessagingFlow(false);
            setMessagingFlowIcpId(null);
            // Refresh local state to reflect new status/isActive. An
            // activation goes through the shared rule, because the flow can
            // activate the ICP this screen is currently editing and `profile`
            // has to learn about it too — otherwise the next save carries a
            // lifecycle that contradicts the one just committed.
            if (activated) {
              applyActivationToState(completedId);
            } else {
              // Finishing the flow without activating retires 'pending'.
              setIcpList(prev => prev.map(i => (
                i.id === completedId ? { ...i, isActive: false, status: 'inactive' } : i
              )));
              if (completedId === selectedICPId) {
                setProfile(prev => (prev ? { ...prev, isActive: false, status: 'inactive' } : prev));
              }
            }

            const markComplete = entry => (entry ? { ...entry, messagingProgress: 100 } : entry);
            setIcpList(prev => prev.map(i => (i.id === completedId ? markComplete(i) : i)));
            if (completedId === selectedICPId) setProfile(markComplete);
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
