import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { APOLLO_INDUSTRIES } from '../../constants/apolloIndustries';
import { US_STATES } from '../../constants/usStates';
import { DEFAULT_WEIGHTS } from '../../utils/icpScoring';
import { ArrowLeft, Save, Building2, MapPin, Users, Target, Sliders, FileText, CheckCircle, AlertCircle } from 'lucide-react';

export default function AdminICPEditor() {
  const { uid } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // 'success' | 'error' | null
  const [userEmail, setUserEmail] = useState('');

  // ICP list & selection
  const [icpList, setIcpList] = useState([]);
  const [selectedICPId, setSelectedICPId] = useState(null);
  const [profile, setProfile] = useState(null);

  // Search / input state
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
  }, [uid]);

  async function getAuthToken() {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Not authenticated');
    return currentUser.getIdToken();
  }

  async function loadICPProfiles() {
    try {
      setLoading(true);
      setError(null);
      const authToken = await getAuthToken();

      const response = await fetch('/.netlify/functions/adminGetUserICPProfiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authToken, targetUserId: uid })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load ICP profiles');
      }

      const profiles = data.icpProfiles || [];
      setIcpList(profiles);

      if (profiles.length > 0) {
        setSelectedICPId(profiles[0].id);
        setProfile({ ...profiles[0], scoringWeights: profiles[0].scoringWeights || DEFAULT_WEIGHTS });
      }

      setLoading(false);
    } catch (err) {
      console.error('Failed to load ICP profiles:', err);
      setError(err.message);
      setLoading(false);
    }
  }

  function selectICP(icp) {
    setSelectedICPId(icp.id);
    setProfile({ ...icp, scoringWeights: icp.scoringWeights || DEFAULT_WEIGHTS });
    setSaveStatus(null);
  }

  async function handleSave() {
    const reason = window.prompt(
      `You are about to update ICP settings for ${userEmail || uid}.\n\nPlease enter a reason for this change (required for audit log):`
    );

    if (!reason || reason.trim() === '') {
      alert('A reason is required to save admin ICP changes.');
      return;
    }

    if (profile.scoringWeights) {
      const total = profile.scoringWeights.industry + profile.scoringWeights.location +
        profile.scoringWeights.employeeSize + profile.scoringWeights.revenue;
      if (total !== 100) {
        alert(`Scoring weights must total 100%. Currently at ${total}%.`);
        return;
      }
    }

    try {
      setSaving(true);
      setSaveStatus(null);
      const authToken = await getAuthToken();

      const response = await fetch('/.netlify/functions/adminUpdateUserICP', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authToken,
          targetUserId: uid,
          icpId: selectedICPId,
          icpData: profile,
          reason: reason.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save ICP');
      }

      // Update local list
      setIcpList(prev => prev.map(i => i.id === selectedICPId ? { ...i, ...profile } : i));
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (err) {
      console.error('Failed to save ICP:', err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  // Field handlers
  const toggleArray = (field, value) => {
    setProfile(prev => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter(v => v !== value)
        : [...prev[field], value]
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
    setProfile(prev => ({
      ...prev,
      scoringWeights: { ...prev.scoringWeights, [key]: parseInt(value) || 0 }
    }));
  };

  const handleAddTitle = () => {
    const trimmed = newTitleInput.trim();
    if (!trimmed) return;
    if (profile.targetTitles.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
      setNewTitleInput('');
      return;
    }
    setProfile(prev => ({ ...prev, targetTitles: [...prev.targetTitles, trimmed] }));
    setNewTitleInput('');
  };

  const handleRemoveTitle = (title) => {
    setProfile(prev => ({ ...prev, targetTitles: prev.targetTitles.filter(t => t !== title) }));
  };

  const totalWeight = profile?.scoringWeights
    ? profile.scoringWeights.industry + profile.scoringWeights.location +
      profile.scoringWeights.employeeSize + profile.scoringWeights.revenue
    : 100;

  const filteredIndustries = APOLLO_INDUSTRIES.filter(ind =>
    ind.name.toLowerCase().includes(industrySearch.toLowerCase())
  );

  const filteredStates = US_STATES.filter(state =>
    state.toLowerCase().includes(locationSearch.toLowerCase())
  );

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <div className="loading-spinner" style={{ margin: '0 auto 1rem' }}></div>
        <p>Loading ICP profiles...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
        <button onClick={() => navigate(`/admin/user/${uid}`)} className="back-button" style={{ marginBottom: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowLeft className="w-4 h-4" /> Back to User
        </button>
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '1rem', color: '#991b1b' }}>
          <strong>Error loading ICP profiles:</strong> {error}
        </div>
      </div>
    );
  }

  if (icpList.length === 0 || !profile) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
        <button onClick={() => navigate(`/admin/user/${uid}`)} className="back-button" style={{ marginBottom: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowLeft className="w-4 h-4" /> Back to User
        </button>
        <p style={{ color: 'var(--text-secondary)' }}>This user has no ICP profiles set up yet.</p>
      </div>
    );
  }

  // ── Main UI ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button
          onClick={() => navigate(`/admin/user/${uid}`)}
          className="back-button"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to User
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {saveStatus === 'success' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#16a34a', fontSize: '0.875rem', fontWeight: 600 }}>
              <CheckCircle className="w-4 h-4" /> Saved successfully
            </span>
          )}
          {saveStatus === 'error' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#dc2626', fontSize: '0.875rem', fontWeight: 600 }}>
              <AlertCircle className="w-4 h-4" /> Save failed — try again
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.6rem 1.25rem',
              background: saving ? '#9ca3af' : '#3b82f6',
              color: '#fff', border: 'none', borderRadius: 8,
              fontWeight: 600, fontSize: '0.9rem', cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Page title */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Edit ICP Settings
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          UID: {uid}
        </p>
        <div style={{
          marginTop: '0.5rem', padding: '0.5rem 0.75rem',
          background: '#fef9c3', border: '1px solid #fde047',
          borderRadius: 6, fontSize: '0.8125rem', color: '#854d0e'
        }}>
          You are editing this user's ICP as an admin. All changes are audit-logged with your identity.
        </div>
      </div>

      {/* ICP Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {icpList.map(icp => (
          <button
            key={icp.id}
            onClick={() => selectICP(icp)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 6,
              border: `2px solid ${selectedICPId === icp.id ? '#3b82f6' : 'var(--border)'}`,
              background: selectedICPId === icp.id ? '#eff6ff' : 'var(--bg-card)',
              color: selectedICPId === icp.id ? '#1d4ed8' : 'var(--text-secondary)',
              fontWeight: selectedICPId === icp.id ? 700 : 400,
              cursor: 'pointer', fontSize: '0.875rem'
            }}
          >
            {icp.name || 'My ICP'}
          </button>
        ))}
      </div>

      {/* ICP Name */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>
          ICP Name
        </label>
        <input
          type="text"
          value={profile.name || ''}
          onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))}
          style={{
            width: '100%', maxWidth: 400,
            padding: '0.6rem 0.75rem',
            border: '1.5px solid var(--border)',
            borderRadius: 6, fontSize: '0.9rem',
            background: 'var(--bg-card)', color: 'var(--text-primary)'
          }}
        />
      </div>

      <div style={{ display: 'grid', gap: '1.5rem' }}>

        {/* Industries */}
        <Section icon={<Building2 className="w-5 h-5" />} title="Industries" count={profile.industries?.length}>
          <input
            type="text"
            placeholder="Search industries..."
            value={industrySearch}
            onChange={e => setIndustrySearch(e.target.value)}
            style={searchInputStyle}
          />
          <div style={tagGridStyle}>
            {filteredIndustries.map(ind => {
              const active = profile.industries?.includes(ind.name);
              return (
                <button
                  key={ind.name}
                  onClick={() => toggleArray('industries', ind.name)}
                  style={tagStyle(active)}
                >
                  {ind.name}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Company Sizes */}
        <Section icon={<Users className="w-5 h-5" />} title="Company Sizes" count={profile.companySizes?.length}>
          <div style={tagGridStyle}>
            {companySizeOptions.map(size => {
              const active = profile.companySizes?.includes(size);
              return (
                <button key={size} onClick={() => toggleArray('companySizes', size)} style={tagStyle(active)}>
                  {size}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Revenue Ranges */}
        <Section icon={<Sliders className="w-5 h-5" />} title="Revenue Ranges">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={profile.skipRevenue || false}
              onChange={e => setProfile(prev => ({ ...prev, skipRevenue: e.target.checked }))}
            />
            Skip revenue filtering
          </label>
          {!profile.skipRevenue && (
            <div style={tagGridStyle}>
              {revenueRangeOptions.map(range => {
                const active = profile.revenueRanges?.includes(range);
                return (
                  <button key={range} onClick={() => toggleArray('revenueRanges', range)} style={tagStyle(active)}>
                    {range}
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        {/* Locations */}
        <Section icon={<MapPin className="w-5 h-5" />} title="Locations" count={profile.isNationwide ? 'Nationwide' : profile.locations?.length}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={profile.isNationwide || false}
              onChange={handleNationwideToggle}
            />
            Target all US states (Nationwide)
          </label>
          {!profile.isNationwide && (
            <>
              <input
                type="text"
                placeholder="Search states..."
                value={locationSearch}
                onChange={e => setLocationSearch(e.target.value)}
                style={{ ...searchInputStyle, marginBottom: '0.5rem' }}
              />
              <div style={tagGridStyle}>
                {filteredStates.map(state => {
                  const active = profile.locations?.includes(state);
                  return (
                    <button key={state} onClick={() => toggleArray('locations', state)} style={tagStyle(active)}>
                      {state}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </Section>

        {/* Target Titles */}
        <Section icon={<Target className="w-5 h-5" />} title="Target Job Titles" count={profile.targetTitles?.length}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="Add a job title..."
              value={newTitleInput}
              onChange={e => setNewTitleInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTitle(); } }}
              style={{ ...searchInputStyle, flex: 1, marginBottom: 0 }}
            />
            <button
              onClick={handleAddTitle}
              style={{ padding: '0.5rem 1rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
            >
              Add
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {(profile.targetTitles || []).map(title => (
              <span
                key={title}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', background: '#dbeafe', color: '#1d4ed8', borderRadius: 999, fontSize: '0.8125rem', fontWeight: 600 }}
              >
                {title}
                <button
                  onClick={() => handleRemoveTitle(title)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6', padding: 0, fontSize: '1rem', lineHeight: 1 }}
                  title="Remove"
                >
                  ×
                </button>
              </span>
            ))}
            {profile.targetTitles?.length === 0 && (
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No titles added</span>
            )}
          </div>
        </Section>

        {/* Scoring Weights */}
        <Section icon={<Sliders className="w-5 h-5" />} title="Scoring Weights">
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Weights must total 100%. Currently: <strong style={{ color: totalWeight === 100 ? '#16a34a' : '#dc2626' }}>{totalWeight}%</strong>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {[
              { key: 'industry', label: 'Industry' },
              { key: 'location', label: 'Location' },
              { key: 'employeeSize', label: 'Employee Size' },
              { key: 'revenue', label: 'Revenue' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{label}</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={profile.scoringWeights?.[key] ?? 0}
                  onChange={e => handleWeightChange(key, e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.6rem', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: '0.9rem', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                />
              </div>
            ))}
          </div>
        </Section>

        {/* Admin Notes */}
        <Section icon={<FileText className="w-5 h-5" />} title="Admin Notes">
          <textarea
            value={profile.notes || ''}
            onChange={e => setProfile(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Internal notes about this user's ICP (visible to admins only)..."
            rows={4}
            style={{
              width: '100%', padding: '0.6rem 0.75rem',
              border: '1.5px solid var(--border)', borderRadius: 6,
              fontSize: '0.875rem', background: 'var(--bg-card)',
              color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit'
            }}
          />
        </Section>

      </div>

      {/* Footer save */}
      <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.75rem 1.5rem',
            background: saving ? '#9ca3af' : '#3b82f6',
            color: '#fff', border: 'none', borderRadius: 8,
            fontWeight: 700, fontSize: '1rem', cursor: saving ? 'not-allowed' : 'pointer'
          }}
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save ICP Changes'}
        </button>
      </div>
    </div>
  );
}

// ── Shared sub-components & styles ────────────────────────────────────────────

function Section({ icon, title, count, children }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1.5px solid var(--border)', borderRadius: 10, padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <span style={{ color: '#3b82f6' }}>{icon}</span>
        <h3 style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{title}</h3>
        {count !== undefined && count !== null && (
          <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            {count} selected
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

const searchInputStyle = {
  width: '100%', padding: '0.5rem 0.75rem',
  border: '1.5px solid var(--border)', borderRadius: 6,
  fontSize: '0.875rem', background: 'var(--bg-card)',
  color: 'var(--text-primary)', marginBottom: '0.75rem',
  boxSizing: 'border-box'
};

const tagGridStyle = {
  display: 'flex', flexWrap: 'wrap', gap: '0.375rem',
  maxHeight: 220, overflowY: 'auto', paddingRight: 4
};

const tagStyle = (active) => ({
  padding: '0.3rem 0.65rem',
  border: `1.5px solid ${active ? '#3b82f6' : 'var(--border)'}`,
  borderRadius: 999,
  background: active ? '#dbeafe' : 'var(--bg-secondary)',
  color: active ? '#1d4ed8' : 'var(--text-secondary)',
  fontWeight: active ? 700 : 400,
  fontSize: '0.8125rem',
  cursor: 'pointer'
});
