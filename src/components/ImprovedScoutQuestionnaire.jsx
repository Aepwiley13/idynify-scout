import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

export default function ImprovedScoutQuestionnaire() {
  const navigate = useNavigate();
  const [currentSection, setCurrentSection] = useState(1);
  const [loading, setLoading] = useState(true);
  const [lastSaved, setLastSaved] = useState(null);
  const [answers, setAnswers] = useState({
    goal: "",
    companyWebsite: "",
    linkedinCompanyPage: "",
    industries: [],
    jobTitles: [],
    otherJobTitles: "",
    companySizes: [],
    targetStates: [],
    targetCities: [],
    locationScope: [], // "Remote", "All US", or specific states/cities
    competitors: "",
    perfectFitCompanies: "",
    avoidList: "",
    painPoints: "",
    valueProposition: ""
  });

  const industryOptions = [
    "Technology / Software / SaaS",
    "Professional Services / Consulting",
    "Marketing / Advertising",
    "Financial Services / Insurance",
    "Healthcare / Medical",
    "Manufacturing / Industrial",
    "Real Estate / Construction",
    "Retail / E-commerce",
    "Recruiting / Staffing / HR",
    "Education / Training",
    "Non-profit / Government"
  ];

  const [otherIndustry, setOtherIndustry] = useState("");

  const companySizeOptions = [
    "1-10 employees (Micro)",
    "11-50 employees (Small)",
    "51-200 employees (Mid-size)",
    "201-500 employees (Growth)",
    "501-1000 employees (Large)",
    "1000+ employees (Enterprise)"
  ];

  // US States organized by region
  const statesByRegion = {
    "West": ["California", "Oregon", "Washington", "Nevada", "Arizona", "Utah", "Colorado", "Idaho", "Montana", "Wyoming"],
    "Southwest": ["Texas", "New Mexico", "Oklahoma"],
    "Midwest": ["Illinois", "Ohio", "Michigan", "Indiana", "Wisconsin", "Minnesota", "Iowa", "Missouri", "Kansas", "Nebraska", "North Dakota", "South Dakota"],
    "Southeast": ["Florida", "Georgia", "North Carolina", "South Carolina", "Virginia", "Tennessee", "Alabama", "Mississippi", "Louisiana", "Arkansas", "Kentucky", "West Virginia"],
    "Northeast": ["New York", "Pennsylvania", "New Jersey", "Massachusetts", "Connecticut", "Rhode Island", "New Hampshire", "Vermont", "Maine", "Maryland", "Delaware"],
    "Alaska & Hawaii": ["Alaska", "Hawaii"]
  };

  // Major metro areas
  const majorMetroAreas = [
    "New York City Metro",
    "Los Angeles Metro",
    "Chicago Metro",
    "Dallas-Fort Worth Metro",
    "Houston Metro",
    "Washington DC Metro",
    "Philadelphia Metro",
    "Miami Metro",
    "Atlanta Metro",
    "Boston Metro",
    "San Francisco Bay Area",
    "Phoenix Metro",
    "Seattle Metro",
    "Minneapolis Metro",
    "San Diego Metro",
    "Denver Metro",
    "Austin Metro",
    "Las Vegas Metro",
    "Portland Metro",
    "Salt Lake City Metro"
  ];

  // Job Title Categories
  const jobTitleCategories = {
    "EXECUTIVE LEADERSHIP": {
      emoji: "👔",
      titles: [
        "CEO / Chief Executive Officer",
        "Founder / Co-Founder",
        "President",
        "Owner",
        "Managing Director",
        "General Manager"
      ]
    },
    "REVENUE & SALES": {
      emoji: "💰",
      titles: [
        "Chief Revenue Officer (CRO)",
        "VP Sales / VP Revenue",
        "Head of Sales",
        "Director of Sales",
        "Sales Manager",
        "Business Development Director",
        "VP Business Development"
      ]
    },
    "MARKETING": {
      emoji: "📢",
      titles: [
        "Chief Marketing Officer (CMO)",
        "VP Marketing",
        "Head of Marketing",
        "Director of Marketing",
        "Marketing Manager",
        "Head of Growth",
        "Growth Director"
      ]
    },
    "OPERATIONS": {
      emoji: "⚙️",
      titles: [
        "Chief Operating Officer (COO)",
        "VP Operations",
        "Director of Operations",
        "Operations Manager",
        "Head of Operations"
      ]
    },
    "PEOPLE & HR": {
      emoji: "👥",
      titles: [
        "Chief Human Resources Officer (CHRO)",
        "VP Human Resources",
        "Head of People",
        "Director of Talent",
        "HR Director",
        "Recruiting Director",
        "Talent Acquisition Manager"
      ]
    },
    "TECHNOLOGY & ENGINEERING": {
      emoji: "💻",
      titles: [
        "Chief Technology Officer (CTO)",
        "VP Engineering",
        "Head of Engineering",
        "Director of Engineering",
        "Engineering Manager",
        "VP Product",
        "Head of Product"
      ]
    },
    "FINANCE": {
      emoji: "💵",
      titles: [
        "Chief Financial Officer (CFO)",
        "VP Finance",
        "Controller",
        "Finance Director",
        "Head of Finance"
      ]
    }
  };

  // Load saved data on mount
  useEffect(() => {
    loadSavedData();
  }, []);

  // Auto-save whenever answers change
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        autoSave();
      }, 2000); // Save 2 seconds after user stops typing
      return () => clearTimeout(timer);
    }
  }, [answers]);

  const loadSavedData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate("/login");
        return;
      }

      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.scoutData) {
          setAnswers(data.scoutData);
          console.log("✅ Loaded saved Scout data");
        }
      }
      setLoading(false);
    } catch (error) {
      console.error("Error loading data:", error);
      setLoading(false);
    }
  };

  const autoSave = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        scoutData: answers,
        lastModified: new Date().toISOString()
      });
      
      setLastSaved(new Date());
      console.log("💾 Auto-saved");
    } catch (error) {
      console.error("Error auto-saving:", error);
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to log out? Your progress has been saved.")) {
      try {
        await signOut(auth);
        navigate("/login");
      } catch (error) {
        console.error("Error logging out:", error);
      }
    }
  };

  const handleCheckbox = (field, value) => {
    setAnswers(prev => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter(item => item !== value)
        : [...prev[field], value]
    }));
  };

  const handleInputChange = (field, value) => {
    setAnswers(prev => ({ ...prev, [field]: value }));
  };

  const validateSection = () => {
    if (currentSection === 1) {
      if (!answers.goal.trim()) {
        alert("Please enter your 90-day goal");
        return false;
      }
    } else if (currentSection === 2) {
      if (answers.industries.length === 0) {
        alert("Please select at least one industry");
        return false;
      }
      if (answers.jobTitles.length === 0 && !answers.otherJobTitles.trim()) {
        alert("Please select at least one job title or enter custom titles");
        return false;
      }
      if (answers.companySizes.length === 0) {
        alert("Please select at least one company size");
        return false;
      }
    } else if (currentSection === 3) {
      if (answers.locationScope.length === 0 && answers.targetStates.length === 0 && answers.targetCities.length === 0) {
        alert("Please select at least one location option");
        return false;
      }
    } else if (currentSection === 4) {
      if (!answers.perfectFitCompanies.trim()) {
        alert("Please name 2-3 perfect fit companies");
        return false;
      }
      if (!answers.painPoints.trim()) {
        alert("Please describe the pain points your customers have");
        return false;
      }
      if (!answers.valueProposition.trim()) {
        alert("Please describe how you solve their problems");
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (!validateSection()) return;
    
    if (currentSection < 4) {
      setCurrentSection(currentSection + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentSection > 1) {
      setCurrentSection(currentSection - 1);
    }
  };

  const handleSubmit = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        alert("Please log in first");
        navigate("/login");
        return;
      }

      console.log("🚀 Submitting Scout data:", answers);

      // Combine selected job titles with custom ones
      const allJobTitles = [...answers.jobTitles];
      if (answers.otherJobTitles.trim()) {
        allJobTitles.push(...answers.otherJobTitles.split(',').map(t => t.trim()));
      }

      const scoutData = {
        ...answers,
        jobTitles: allJobTitles,
        submittedAt: new Date().toISOString()
      };

      // Save to Firebase
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        scoutData: scoutData,
        scoutCompleted: true,
        scoutCompletedAt: new Date().toISOString()
      });

      console.log("✅ Scout data saved to Firebase!");

      // Navigate to launch sequence
      navigate("/icp-validation");

    } catch (error) {
      console.error("Error saving Scout data:", error);
      alert("Error saving your data. Please try again.");
    }
  };

  const progress = (currentSection / 4) * 100;

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-cyan-400 text-2xl font-mono">LOADING MISSION DATA...</div>
      </div>
    );
  }

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

      {/* Floating Code Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {['[ANALYZING...]', '[ICP:LOCKED]', '[LEAD:QUALIFIED]', '[DATA:ENCRYPTED]', '[MISSION:ACTIVE]', '[BARRY:ONLINE]'].map((code, i) => (
          <div
            key={i}
            className="absolute text-cyan-400/30 font-mono text-xs"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animation: `floatCode ${15 + i * 3}s linear infinite`,
              animationDelay: `${i * 2}s`
            }}
          >
            {code}
          </div>
        ))}
      </div>

      {/* Grid Pattern at Bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-cyan-900/20 to-transparent">
        <svg className="w-full h-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="cyan" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>
      </div>

      {/* Top Left Status */}
      <div className="absolute top-6 left-6 text-cyan-400 font-mono text-xs space-y-1 z-20">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>MISSION ACTIVE</span>
        </div>
        <div>SECTOR: {currentSection}/4</div>
        {lastSaved && (
          <div className="text-green-400">
            SAVED: {lastSaved.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Top Right - Logout */}
      <div className="absolute top-6 right-6 z-20">
        <button
          onClick={handleLogout}
          className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg font-mono text-xs transition-all"
        >
          🚪 LOGOUT
        </button>
      </div>

      {/* Bottom Left Radar Circle */}
      <div className="absolute bottom-6 left-6 w-24 h-24 border-2 border-cyan-500/30 rounded-full z-20">
        <div className="absolute inset-0 rounded-full" style={{
          background: 'conic-gradient(from 0deg, transparent 0deg, cyan 90deg, transparent 90deg)',
          animation: 'spin 4s linear infinite',
          opacity: 0.3
        }}></div>
        <div className="absolute inset-4 border border-cyan-500/20 rounded-full"></div>
        <div className="absolute inset-8 border border-cyan-500/20 rounded-full"></div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* Header Card */}
        <div className="bg-black/60 backdrop-blur-xl rounded-3xl p-8 mb-8 text-center border border-cyan-500/30">
          <div className="text-7xl mb-4" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
          <h1 className="text-5xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent mb-2">
            Barry AI
          </h1>
          <h2 className="text-3xl font-bold text-cyan-300 mb-4">
            Scout Mission Briefing
          </h2>
          <p className="text-gray-300 text-lg">
            Intel Collection • Target Analysis • Mission Parameters
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-cyan-400 font-mono mb-2">
            <span>SECTOR {currentSection} OF 4</span>
            <span>{Math.round(progress)}% COMPLETE</span>
          </div>
          <div className="w-full bg-cyan-950/30 rounded-full h-3 border border-cyan-500/30">
            <div
              className="bg-gradient-to-r from-pink-500 to-cyan-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {/* Section Indicator */}
        <div className="mb-8 flex justify-center gap-4 flex-wrap">
          <div className={`px-4 py-2 rounded-full font-semibold font-mono text-sm ${currentSection === 1 ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white' : 'bg-cyan-950/30 border border-cyan-500/30 text-cyan-400'}`}>
            1. MISSION
          </div>
          <div className={`px-4 py-2 rounded-full font-semibold font-mono text-sm ${currentSection === 2 ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white' : 'bg-cyan-950/30 border border-cyan-500/30 text-cyan-400'}`}>
            2. TARGETS
          </div>
          <div className={`px-4 py-2 rounded-full font-semibold font-mono text-sm ${currentSection === 3 ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white' : 'bg-cyan-950/30 border border-cyan-500/30 text-cyan-400'}`}>
            3. TERRITORY
          </div>
          <div className={`px-4 py-2 rounded-full font-semibold font-mono text-sm ${currentSection === 4 ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white' : 'bg-cyan-950/30 border border-cyan-500/30 text-cyan-400'}`}>
            4. INTEL
          </div>
        </div>

        {/* SECTION 1: YOUR MISSION */}
        {currentSection === 1 && (
          <div className="space-y-6">
            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
              <h2 className="text-3xl font-bold mb-6 bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent font-mono">
                [SECTOR 1: MISSION OBJECTIVES]
              </h2>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → 90-DAY MISSION GOAL *
                </label>
                <p className="text-sm text-gray-400 mb-3">
                  Example: "Sign 50 new customers" or "Book 20 demos"
                </p>
                <input
                  type="text"
                  value={answers.goal}
                  onChange={(e) => handleInputChange('goal', e.target.value)}
                  placeholder="Enter your 90-day goal"
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → COMPANY WEBSITE
                </label>
                <p className="text-sm text-gray-400 mb-3">Barry will analyze your site (Optional)</p>
                <input
                  type="url"
                  value={answers.companyWebsite}
                  onChange={(e) => handleInputChange('companyWebsite', e.target.value)}
                  placeholder="https://www.yourcompany.com"
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → LINKEDIN COMPANY PAGE
                </label>
                <p className="text-sm text-gray-400 mb-3">Barry will scan for intel (Optional)</p>
                <input
                  type="url"
                  value={answers.linkedinCompanyPage}
                  onChange={(e) => handleInputChange('linkedinCompanyPage', e.target.value)}
                  placeholder="https://linkedin.com/company/yourcompany"
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: WHO YOU'RE TARGETING */}
        {currentSection === 2 && (
          <div className="space-y-6">
            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
              <h2 className="text-3xl font-bold mb-6 bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent font-mono">
                [SECTOR 2: TARGET IDENTIFICATION]
              </h2>

              <div className="mb-8">
                <label className="block text-lg font-semibold mb-3 text-cyan-300 font-mono">
                  → TARGET INDUSTRIES *
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {industryOptions.map((industry) => (
                    <label key={industry} className="flex items-center space-x-3 cursor-pointer hover:bg-cyan-500/10 p-3 rounded-lg border border-cyan-500/20 transition-all">
                      <input
                        type="checkbox"
                        checked={answers.industries.includes(industry)}
                        onChange={() => handleCheckbox('industries', industry)}
                        className="w-5 h-5 rounded border-cyan-500 bg-cyan-950/50"
                      />
                      <span className="text-gray-300">{industry}</span>
                    </label>
                  ))}
                  <div className="flex items-center space-x-3 p-3 border border-cyan-500/20 rounded-lg">
                    <input
                      type="checkbox"
                      checked={answers.industries.includes('Other')}
                      onChange={() => handleCheckbox('industries', 'Other')}
                      className="w-5 h-5 rounded border-cyan-500 bg-cyan-950/50"
                    />
                    <input
                      type="text"
                      value={otherIndustry}
                      onChange={(e) => setOtherIndustry(e.target.value)}
                      placeholder="Other: specify..."
                      className="flex-1 bg-cyan-950/50 border border-cyan-500/30 rounded p-2 text-white placeholder-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* JOB TITLES */}
              <div className="mb-8">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → DECISION MAKERS TO CONTACT *
                </label>
                <p className="text-sm text-gray-400 mb-4">
                  Select all relevant titles or add custom ones
                </p>
                
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                  {Object.entries(jobTitleCategories).map(([category, data]) => (
                    <div key={category} className="bg-cyan-950/20 rounded-lg p-4 border border-cyan-500/20">
                      <h3 className="text-cyan-400 font-semibold mb-3 flex items-center gap-2 font-mono">
                        <span>{data.emoji}</span> {category}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {data.titles.map(title => (
                          <label key={title} className="flex items-center space-x-3 cursor-pointer hover:bg-cyan-500/10 p-2 rounded">
                            <input
                              type="checkbox"
                              checked={answers.jobTitles.includes(title)}
                              onChange={() => handleCheckbox('jobTitles', title)}
                              className="w-4 h-4 rounded border-cyan-500 bg-cyan-950/50"
                            />
                            <span className="text-gray-300 text-sm">{title}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* CUSTOM TITLES */}
                  <div className="bg-cyan-950/20 rounded-lg p-4 border border-cyan-500/20">
                    <h3 className="text-cyan-400 font-semibold mb-3 flex items-center gap-2 font-mono">
                      <span>🎯</span> CUSTOM TITLES
                    </h3>
                    <input
                      type="text"
                      value={answers.otherJobTitles}
                      onChange={(e) => handleInputChange('otherJobTitles', e.target.value)}
                      placeholder="Enter custom job titles separated by commas..."
                      className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-lg p-3 text-white placeholder-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                    />
                  </div>
                </div>

                {answers.jobTitles.length > 0 && (
                  <div className="mt-3 text-sm text-green-400 font-mono">
                    ✓ {answers.jobTitles.length} title{answers.jobTitles.length !== 1 ? 's' : ''} selected
                  </div>
                )}
              </div>

              {/* COMPANY SIZES */}
              <div className="mb-6">
                <label className="block text-lg font-semibold mb-3 text-cyan-300 font-mono">
                  → TARGET COMPANY SIZES *
                </label>
                <div className="space-y-2">
                  {companySizeOptions.map((size) => (
                    <label key={size} className="flex items-center space-x-3 cursor-pointer hover:bg-cyan-500/10 p-3 rounded-lg border border-cyan-500/20 transition-all">
                      <input
                        type="checkbox"
                        checked={answers.companySizes.includes(size)}
                        onChange={() => handleCheckbox('companySizes', size)}
                        className="w-5 h-5 rounded border-cyan-500 bg-cyan-950/50"
                      />
                      <span className="text-gray-300">{size}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: LOCATION TARGETING */}
        {currentSection === 3 && (
          <div className="space-y-6">
            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
              <h2 className="text-3xl font-bold mb-6 bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent font-mono">
                [SECTOR 3: TERRITORY MAPPING]
              </h2>

              {/* Location Scope */}
              <div className="mb-8">
                <label className="block text-lg font-semibold mb-3 text-cyan-300 font-mono">
                  → LOCATION SCOPE *
                </label>
                <div className="space-y-2">
                  <label className="flex items-center space-x-3 cursor-pointer hover:bg-cyan-500/10 p-4 rounded-lg border-2 border-cyan-500/30 transition-all">
                    <input
                      type="checkbox"
                      checked={answers.locationScope.includes('All US')}
                      onChange={() => handleCheckbox('locationScope', 'All US')}
                      className="w-5 h-5 rounded border-cyan-500 bg-cyan-950/50"
                    />
                    <div>
                      <span className="text-white font-semibold">🇺🇸 All United States</span>
                      <p className="text-sm text-gray-400">Target companies nationwide</p>
                    </div>
                  </label>
                  <label className="flex items-center space-x-3 cursor-pointer hover:bg-cyan-500/10 p-4 rounded-lg border-2 border-cyan-500/30 transition-all">
                    <input
                      type="checkbox"
                      checked={answers.locationScope.includes('Remote')}
                      onChange={() => handleCheckbox('locationScope', 'Remote')}
                      className="w-5 h-5 rounded border-cyan-500 bg-cyan-950/50"
                    />
                    <div>
                      <span className="text-white font-semibold">🌐 Remote/No Location Preference</span>
                      <p className="text-sm text-gray-400">Location doesn't matter</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* US States by Region */}
              {!answers.locationScope.includes('All US') && !answers.locationScope.includes('Remote') && (
                <>
                  <div className="mb-8">
                    <label className="block text-lg font-semibold mb-3 text-cyan-300 font-mono">
                      → TARGET STATES (Optional - Select Specific States)
                    </label>
                    <div className="space-y-4">
                      {Object.entries(statesByRegion).map(([region, states]) => (
                        <div key={region} className="bg-cyan-950/20 rounded-lg p-4 border border-cyan-500/20">
                          <h3 className="text-pink-400 font-semibold mb-3 font-mono">{region}</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                            {states.map(state => (
                              <label key={state} className="flex items-center space-x-2 cursor-pointer hover:bg-cyan-500/10 p-2 rounded">
                                <input
                                  type="checkbox"
                                  checked={answers.targetStates.includes(state)}
                                  onChange={() => handleCheckbox('targetStates', state)}
                                  className="w-4 h-4 rounded border-cyan-500 bg-cyan-950/50"
                                />
                                <span className="text-gray-300 text-sm">{state}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {answers.targetStates.length > 0 && (
                      <div className="mt-3 text-sm text-green-400 font-mono">
                        ✓ {answers.targetStates.length} state{answers.targetStates.length !== 1 ? 's' : ''} selected
                      </div>
                    )}
                  </div>

                  {/* Major Metro Areas */}
                  <div className="mb-6">
                    <label className="block text-lg font-semibold mb-3 text-cyan-300 font-mono">
                      → TARGET METRO AREAS (Optional)
                    </label>
                    <p className="text-sm text-gray-400 mb-4">
                      Focus on specific metropolitan areas
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {majorMetroAreas.map(city => (
                        <label key={city} className="flex items-center space-x-3 cursor-pointer hover:bg-cyan-500/10 p-3 rounded-lg border border-cyan-500/20">
                          <input
                            type="checkbox"
                            checked={answers.targetCities.includes(city)}
                            onChange={() => handleCheckbox('targetCities', city)}
                            className="w-4 h-4 rounded border-cyan-500 bg-cyan-950/50"
                          />
                          <span className="text-gray-300 text-sm">{city}</span>
                        </label>
                      ))}
                    </div>
                    {answers.targetCities.length > 0 && (
                      <div className="mt-3 text-sm text-green-400 font-mono">
                        ✓ {answers.targetCities.length} metro{answers.targetCities.length !== 1 ? 's' : ''} selected
                      </div>
                    )}
                  </div>
                </>
              )}

              {(answers.locationScope.includes('All US') || answers.locationScope.includes('Remote')) && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                  <p className="text-green-300 font-mono text-sm">
                    ✓ Location targeting: {answers.locationScope.join(', ')}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECTION 4: REFINE YOUR TARGET */}
        {currentSection === 4 && (
          <div className="space-y-6">
            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
              <h2 className="text-3xl font-bold mb-6 bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent font-mono">
                [SECTOR 4: INTEL GATHERING]
              </h2>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → COMPETITOR ANALYSIS
                </label>
                <p className="text-sm text-gray-400 mb-3">
                  Helps us find similar buyers. Examples: "HubSpot, Salesforce"
                </p>
                <input
                  type="text"
                  value={answers.competitors}
                  onChange={(e) => handleInputChange('competitors', e.target.value)}
                  placeholder="Enter competitor names"
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → PERFECT FIT COMPANIES *
                </label>
                <p className="text-sm text-gray-400 mb-3">
                  Name 2-3 dream customers or describe them
                </p>
                <textarea
                  value={answers.perfectFitCompanies}
                  onChange={(e) => handleInputChange('perfectFitCompanies', e.target.value)}
                  placeholder="e.g., Acme Corp, TechFlow Inc, or 'Fast-growing SaaS companies with 50-200 employees'"
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono h-24 resize-none"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → EXCLUSION LIST
                </label>
                <p className="text-sm text-gray-400 mb-3">
                  Who should you AVOID? Example: "Large enterprises, B2C companies"
                </p>
                <textarea
                  value={answers.avoidList}
                  onChange={(e) => handleInputChange('avoidList', e.target.value)}
                  placeholder="Enter company types to avoid"
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono h-24 resize-none"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → TARGET PAIN POINTS *
                </label>
                <p className="text-sm text-gray-400 mb-3">
                  Problems they face BEFORE buying from you
                </p>
                <textarea
                  value={answers.painPoints}
                  onChange={(e) => handleInputChange('painPoints', e.target.value)}
                  placeholder="e.g., Sales teams spend 60% of time prospecting instead of selling. They can't find qualified leads..."
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono h-32 resize-none"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-cyan-300 font-mono">
                  → YOUR SOLUTION *
                </label>
                <p className="text-sm text-gray-400 mb-3">
                  How do you solve their problems? (One sentence)
                </p>
                <textarea
                  value={answers.valueProposition}
                  onChange={(e) => handleInputChange('valueProposition', e.target.value)}
                  placeholder="e.g., We identify your ICP in 5 minutes and deliver 30 qualified leads daily. Save 10+ hours/week on prospecting..."
                  className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono h-32 resize-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-8">
          <button
            onClick={handleBack}
            disabled={currentSection === 1}
            className="px-6 py-3 rounded-full bg-cyan-950/50 hover:bg-cyan-900/50 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-cyan-400 font-semibold border border-cyan-500/30 font-mono"
          >
            ← BACK
          </button>

          <button
            onClick={handleNext}
            className="px-8 py-3 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 font-bold transition-all shadow-2xl shadow-pink-500/50 text-white font-mono"
          >
            {currentSection === 4 ? "🚀 LAUNCH MISSION" : "NEXT →"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes floatBear {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        @keyframes floatCode {
          0% { transform: translateY(100vh) translateX(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-100vh) translateX(100px); opacity: 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}