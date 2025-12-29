import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { APOLLO_INDUSTRIES } from '../../constants/apolloIndustries';
import { US_STATES } from '../../constants/usStates';

export default function CompanyQuestionnaire() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const [formData, setFormData] = useState({
    industries: [],
    companySizes: [],
    revenueRanges: [],
    skipRevenue: false,
    locations: [],
    isNationwide: false
  });

  // Search states for dropdowns
  const [industrySearch, setIndustrySearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');

  const companySizeOptions = [
    "1-10",
    "11-20",
    "21-50",
    "51-100",
    "101-200",
    "201-500",
    "501-1,000",
    "1,001-2,000",
    "2,001-5,000",
    "5,001-10,000",
    "10,001+"
  ];

  const revenueRangeOptions = [
    "Less than $1M",
    "$1M-$2M",
    "$2M-$5M",
    "$5M-$10M",
    "$10M-$20M",
    "$20M-$50M",
    "$50M-$100M",
    "$100M-$200M",
    "$200M-$500M",
    "$500M-$1B",
    "$1B+"
  ];

  useEffect(() => {
    checkExistingProfile();
  }, []);

  const checkExistingProfile = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Check if user already has a company profile
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);

      if (profileDoc.exists()) {
        // Load existing data
        setFormData(profileDoc.data());
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const handleIndustryToggle = (industryName) => {
    setFormData(prev => ({
      ...prev,
      industries: prev.industries.includes(industryName)
        ? prev.industries.filter(i => i !== industryName)
        : [...prev.industries, industryName]
    }));
  };

  const handleCompanySizeToggle = (size) => {
    setFormData(prev => ({
      ...prev,
      companySizes: prev.companySizes.includes(size)
        ? prev.companySizes.filter(s => s !== size)
        : [...prev.companySizes, size]
    }));
  };

  const handleRevenueToggle = (revenue) => {
    setFormData(prev => ({
      ...prev,
      revenueRanges: prev.revenueRanges.includes(revenue)
        ? prev.revenueRanges.filter(r => r !== revenue)
        : [...prev.revenueRanges, revenue],
      skipRevenue: false
    }));
  };

  const handleSkipRevenueToggle = () => {
    setFormData(prev => ({
      ...prev,
      skipRevenue: !prev.skipRevenue,
      revenueRanges: !prev.skipRevenue ? [] : prev.revenueRanges
    }));
  };

  const handleLocationToggle = (location) => {
    setFormData(prev => ({
      ...prev,
      locations: prev.locations.includes(location)
        ? prev.locations.filter(l => l !== location)
        : [...prev.locations, location],
      isNationwide: false
    }));
  };

  const handleNationwideToggle = () => {
    setFormData(prev => ({
      ...prev,
      isNationwide: !prev.isNationwide,
      locations: !prev.isNationwide ? [...US_STATES] : []
    }));
  };

  const validateForm = () => {
    const newErrors = {};

    if (formData.industries.length === 0) {
      newErrors.industries = 'Please select at least one industry';
    }

    if (formData.companySizes.length === 0) {
      newErrors.companySizes = 'Please select at least one company size';
    }

    if (formData.locations.length === 0 && !formData.isNationwide) {
      newErrors.locations = 'Please select at least one state or choose Nationwide';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSaving(true);

    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      // Save company profile
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      await setDoc(profileRef, {
        ...formData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      console.log('✅ Company profile saved!');

      // Trigger Apollo search in background
      await triggerApolloSearch(user.uid);

      // Redirect to Scout dashboard
      navigate('/mission-control-v2/scout');

    } catch (error) {
      console.error('❌ Error saving profile:', error);
      alert(`Failed to save profile: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const triggerApolloSearch = async (userId) => {
    try {
      console.log('🔍 Triggering Apollo company search...');

      const authToken = await auth.currentUser.getIdToken();

      const response = await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          authToken,
          companyProfile: formData
        })
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ Failed to parse JSON response:', jsonError);
        const text = await response.text();
        console.error('❌ Raw response:', text);
        throw new Error(`Backend returned invalid JSON (Status ${response.status}). Check Netlify function logs for details.`);
      }

      console.log('📥 Backend response:', data);

      if (!response.ok) {
        console.error('❌ Backend error response:', data);
        console.error('❌ Response status:', response.status);
        throw new Error(data.error || `Backend error: ${response.status} ${response.statusText}`);
      }

      console.log(`✅ Found ${data.companiesFound} companies!`);

    } catch (error) {
      console.error('❌ Apollo search error:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Full error:', error);
      // Don't block user flow on search error - user can still proceed to Scout
      alert(`Warning: Company search encountered an error:\n\n${error.message}\n\nYou can still access Scout, but you may not have any companies yet.\n\nPlease check the browser console for details or contact support.`);
    }
  };

  const filteredIndustries = APOLLO_INDUSTRIES.filter(ind =>
    ind.name.toLowerCase().includes(industrySearch.toLowerCase())
  );

  const filteredStates = US_STATES.filter(state =>
    state.toLowerCase().includes(locationSearch.toLowerCase())
  );

  const getCompletionPercentage = () => {
    let completed = 0;
    if (formData.industries.length > 0) completed += 25;
    if (formData.companySizes.length > 0) completed += 25;
    if (formData.skipRevenue || formData.revenueRanges.length > 0) completed += 25;
    if (formData.locations.length > 0 || formData.isNationwide) completed += 25;
    return completed;
  };

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

      {/* Main Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="text-6xl mb-4">🎯</div>
          <h1 className="text-4xl font-bold text-white mb-4 font-mono">
            Define Your Target Companies
          </h1>
          <p className="text-gray-400 text-lg mb-6">
            Answer 4 quick questions to unlock Scout and find your ideal customers
          </p>

          {/* Progress Bar */}
          <div className="max-w-md mx-auto">
            <div className="bg-gray-800 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full transition-all duration-500"
                style={{ width: `${getCompletionPercentage()}%` }}
              />
            </div>
            <p className="text-sm text-gray-500 mt-2 font-mono">
              {getCompletionPercentage()}% Complete
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Question 1: Industries */}
          <div className="bg-gradient-to-br from-gray-900/80 to-black/80 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
            <label className="block text-xl font-bold text-white mb-2 font-mono">
              1. What industry are your ideal clients in?
            </label>
            <p className="text-gray-400 mb-4">Select all that apply</p>

            {/* Search Box */}
            <input
              type="text"
              placeholder="🔍 Search industries..."
              value={industrySearch}
              onChange={(e) => setIndustrySearch(e.target.value)}
              className="w-full bg-black/60 text-white px-4 py-3 rounded-lg border border-cyan-500/30 mb-4 focus:outline-none focus:border-cyan-500"
            />

            {/* Selected Industries */}
            {formData.industries.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {formData.industries.map(industry => (
                  <span
                    key={industry}
                    className="bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded-full text-sm font-mono border border-cyan-500/30 flex items-center gap-2"
                  >
                    {industry}
                    <button
                      type="button"
                      onClick={() => handleIndustryToggle(industry)}
                      className="text-cyan-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Industry Dropdown */}
            <div className="max-h-64 overflow-y-auto bg-black/40 rounded-lg border border-cyan-500/20 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredIndustries.map(industry => (
                  <label
                    key={industry.id}
                    className="flex items-center gap-3 cursor-pointer hover:bg-cyan-500/10 p-2 rounded transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={formData.industries.includes(industry.name)}
                      onChange={() => handleIndustryToggle(industry.name)}
                      className="w-5 h-5 bg-black border border-cyan-500/30 rounded focus:ring-cyan-500"
                    />
                    <span className="text-white text-sm">{industry.name}</span>
                  </label>
                ))}
              </div>
            </div>

            {errors.industries && (
              <p className="text-red-400 text-sm mt-2">{errors.industries}</p>
            )}
          </div>

          {/* Question 2: Company Size */}
          <div className="bg-gradient-to-br from-gray-900/80 to-black/80 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
            <label className="block text-xl font-bold text-white mb-2 font-mono">
              2. What size companies do you target?
            </label>
            <p className="text-gray-400 mb-4">Select all employee ranges that fit</p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {companySizeOptions.map(size => (
                <label
                  key={size}
                  className={`flex items-center gap-3 cursor-pointer p-4 rounded-lg border-2 transition-all ${
                    formData.companySizes.includes(size)
                      ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                      : 'bg-black/40 border-gray-700 text-gray-400 hover:border-cyan-500/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.companySizes.includes(size)}
                    onChange={() => handleCompanySizeToggle(size)}
                    className="w-5 h-5"
                  />
                  <span className="font-mono text-sm">{size} employees</span>
                </label>
              ))}
            </div>

            {errors.companySizes && (
              <p className="text-red-400 text-sm mt-2">{errors.companySizes}</p>
            )}
          </div>

          {/* Question 3: Revenue Range (Optional) */}
          <div className="bg-gradient-to-br from-gray-900/80 to-black/80 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
            <label className="block text-xl font-bold text-white mb-2 font-mono">
              3. What's their revenue range? <span className="text-gray-500 text-sm">(Optional)</span>
            </label>
            <p className="text-gray-400 mb-4">Select all that apply, or skip if revenue doesn't matter</p>

            {/* Skip Checkbox */}
            <label className="flex items-center gap-3 cursor-pointer mb-4 p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <input
                type="checkbox"
                checked={formData.skipRevenue}
                onChange={handleSkipRevenueToggle}
                className="w-5 h-5"
              />
              <span className="text-purple-400 font-mono">Skip this question (revenue doesn't matter)</span>
            </label>

            {/* Revenue Options */}
            {!formData.skipRevenue && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {revenueRangeOptions.map(revenue => (
                  <label
                    key={revenue}
                    className={`flex items-center gap-3 cursor-pointer p-4 rounded-lg border-2 transition-all ${
                      formData.revenueRanges.includes(revenue)
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
                        : 'bg-black/40 border-gray-700 text-gray-400 hover:border-cyan-500/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.revenueRanges.includes(revenue)}
                      onChange={() => handleRevenueToggle(revenue)}
                      className="w-5 h-5"
                    />
                    <span className="font-mono text-sm">{revenue}</span>
                  </label>
                ))}
              </div>
            )}

            <p className="text-gray-500 text-xs mt-4">
              Note: Not all companies report revenue data publicly
            </p>
          </div>

          {/* Question 4: Location */}
          <div className="bg-gradient-to-br from-gray-900/80 to-black/80 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
            <label className="block text-xl font-bold text-white mb-2 font-mono">
              4. Which US states do you target?
            </label>
            <p className="text-gray-400 mb-4">Select specific states or choose Nationwide</p>

            {/* Nationwide Checkbox */}
            <label className="flex items-center gap-3 cursor-pointer mb-4 p-4 bg-green-500/10 rounded-lg border border-green-500/30">
              <input
                type="checkbox"
                checked={formData.isNationwide}
                onChange={handleNationwideToggle}
                className="w-5 h-5"
              />
              <span className="text-green-400 font-mono font-bold">🌎 Nationwide (All US States)</span>
            </label>

            {!formData.isNationwide && (
              <>
                {/* Search Box */}
                <input
                  type="text"
                  placeholder="🔍 Search states..."
                  value={locationSearch}
                  onChange={(e) => setLocationSearch(e.target.value)}
                  className="w-full bg-black/60 text-white px-4 py-3 rounded-lg border border-cyan-500/30 mb-4 focus:outline-none focus:border-cyan-500"
                />

                {/* Selected States */}
                {formData.locations.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {formData.locations.slice(0, 10).map(location => (
                      <span
                        key={location}
                        className="bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded-full text-sm font-mono border border-cyan-500/30 flex items-center gap-2"
                      >
                        {location}
                        <button
                          type="button"
                          onClick={() => handleLocationToggle(location)}
                          className="text-cyan-400 hover:text-white"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {formData.locations.length > 10 && (
                      <span className="bg-gray-700 text-gray-300 px-3 py-1 rounded-full text-sm font-mono">
                        +{formData.locations.length - 10} more
                      </span>
                    )}
                  </div>
                )}

                {/* State Checkboxes */}
                <div className="max-h-64 overflow-y-auto bg-black/40 rounded-lg border border-cyan-500/20 p-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {filteredStates.map(state => (
                      <label
                        key={state}
                        className="flex items-center gap-3 cursor-pointer hover:bg-cyan-500/10 p-2 rounded transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={formData.locations.includes(state)}
                          onChange={() => handleLocationToggle(state)}
                          className="w-5 h-5 bg-black border border-cyan-500/30 rounded focus:ring-cyan-500"
                        />
                        <span className="text-white text-sm">{state}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {errors.locations && (
              <p className="text-red-400 text-sm mt-2">{errors.locations}</p>
            )}
          </div>

          {/* Submit Button */}
          <div className="text-center">
            <button
              type="submit"
              disabled={saving}
              className={`font-bold py-5 px-12 rounded-xl transition-all font-mono text-lg ${
                saving
                  ? 'bg-gray-600 cursor-not-allowed text-gray-400'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white shadow-2xl shadow-cyan-500/50'
              }`}
            >
              {saving ? '⏳ FINDING COMPANIES...' : '🚀 FIND MY COMPANIES'}
            </button>

            <p className="text-gray-500 text-sm mt-4">
              This will unlock Scout and start finding companies that match your criteria
            </p>
          </div>
        </form>
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
