import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

export default function MissionControlDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isFirstLaunch = searchParams.get('first-launch') === 'true';
  
  const [activeTab, setActiveTab] = useState("overview");
  const [scoutData, setScoutData] = useState(null);
  const [icpBrief, setIcpBrief] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(isFirstLaunch);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [minScore, setMinScore] = useState(70);
  const [sortBy, setSortBy] = useState("score");
  const [icpSection, setIcpSection] = useState('overview');
  const [generatingLeads, setGeneratingLeads] = useState(false);
  const [leadGenError, setLeadGenError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          navigate("/login");
          return;
        }

        const userDoc = await getDoc(doc(db, "users", user.uid));
        
        if (!userDoc.exists()) {
          navigate("/scout-questionnaire");
          return;
        }

        const data = userDoc.data();
        
        setScoutData(data.scoutData || null);
        setIcpBrief(data.icpBrief || null);
        setLeads(data.leads || []);
        
        setLoading(false);
      } catch (err) {
        console.error("Error loading data:", err);
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  const handleLogout = async () => {
    if (window.confirm("Abort mission and log out?")) {
      try {
        await signOut(auth);
        navigate("/login");
      } catch (error) {
        console.error("Error logging out:", error);
      }
    }
  };

  const handleEditField = (field, currentValue) => {
    setEditField(field);
    setEditValue(Array.isArray(currentValue) ? currentValue.join(", ") : currentValue || "");
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const updatedScoutData = { ...scoutData };
      
      // Handle array fields
      if (['industries', 'jobTitles', 'companySizes', 'targetStates', 'targetCities', 'locationScope'].includes(editField)) {
        updatedScoutData[editField] = editValue.split(',').map(v => v.trim()).filter(v => v);
      } else {
        updatedScoutData[editField] = editValue;
      }

      await updateDoc(doc(db, "users", user.uid), {
        scoutData: updatedScoutData
      });

      setScoutData(updatedScoutData);
      setShowEditModal(false);
      setEditField(null);
      
      alert("✅ Mission parameters updated! Regenerate ICP Brief to see changes.");
    } catch (err) {
      console.error("Error updating field:", err);
      alert("Error updating. Please try again.");
    }
  };

  const handleRegenerateICP = async () => {
    if (!window.confirm("Regenerate ICP Brief with updated parameters? This will overwrite your current brief.")) {
      return;
    }

    try {
      // Navigate to ICP validation page which will auto-generate
      navigate("/icp-validation");
    } catch (err) {
      console.error("Error:", err);
    }
  };

  const handleGenerateLeads = async () => {
    setGeneratingLeads(true);
    setLeadGenError(null);

    try {
      console.log('🚀 Initiating lead generation...');
      
      const response = await fetch('/.netlify/functions/generate-leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          scoutData,
          icpBrief
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`✅ Generated ${data.leads.length} leads`);

      // Save leads to Firebase
      const user = auth.currentUser;
      if (user) {
        await updateDoc(doc(db, "users", user.uid), {
          leads: data.leads,
          leadsGeneratedAt: new Date().toISOString()
        });

        setLeads(data.leads);
        alert(`🎯 Mission successful! ${data.leads.length} targets acquired.`);
      }

    } catch (err) {
      console.error('💥 Error generating leads:', err);
      setLeadGenError(err.message);
      alert(`Error generating leads: ${err.message}\n\nMake sure your Apollo API key is set in Netlify environment variables.`);
    } finally {
      setGeneratingLeads(false);
    }
  };

  const filteredLeads = leads
    .filter(lead => lead.score >= minScore)
    .sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "size") return b.employees - a.employees;
      if (sortBy === "alpha") return a.name.localeCompare(b.name);
      return 0;
    });

  const excellentLeads = filteredLeads.filter(l => l.score >= 85);
  const goodLeads = filteredLeads.filter(l => l.score >= 70 && l.score < 85);

  const getScoreColor = (score) => {
    if (score >= 85) return "text-green-400";
    if (score >= 70) return "text-yellow-400";
    return "text-orange-400";
  };

  const getScoreBadge = (score) => {
    if (score >= 85) return "🟢";
    if (score >= 70) return "🟡";
    return "🟠";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
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
        <div className="relative z-10 text-center">
          <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
          <div className="text-cyan-400 text-2xl font-mono">[LOADING MISSION CONTROL...]</div>
        </div>
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
        {['[MISSION:ACTIVE]', '[BARRY:ONLINE]', '[LEADS:TRACKING]', '[ICP:LOCKED]', '[TARGETS:ACQUIRED]', '[STATUS:GO]'].map((code, i) => (
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

      {/* First Launch Celebration Modal */}
      {showCelebration && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-emerald-500/20 to-teal-600/20 border-2 border-emerald-500/50 rounded-3xl p-12 max-w-2xl text-center relative overflow-hidden backdrop-blur-xl">
            {/* Confetti Effect */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(30)].map((_, i) => (
                <div
                  key={i}
                  className="absolute text-3xl animate-bounce"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 2}s`,
                    animationDuration: `${1 + Math.random()}s`
                  }}
                >
                  {['🎉', '🚀', '⭐', '💫', '✨'][Math.floor(Math.random() * 5)]}
                </div>
              ))}
            </div>
            
            <div className="relative z-10">
              <div className="text-8xl mb-6" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
              <h2 className="text-5xl font-bold text-white mb-4 font-mono">MISSION SUCCESS!</h2>
              <p className="text-2xl text-emerald-300 mb-6 font-mono">
                Barry found {leads.length} qualified targets!
              </p>
              <div className="flex justify-center gap-8 mb-8 text-white">
                <div className="bg-black/40 backdrop-blur-sm rounded-xl p-4 border border-emerald-500/30">
                  <div className="text-4xl font-bold text-emerald-400">{excellentLeads.length}</div>
                  <div className="text-sm font-mono">🟢 EXCELLENT</div>
                </div>
                <div className="bg-black/40 backdrop-blur-sm rounded-xl p-4 border border-yellow-500/30">
                  <div className="text-4xl font-bold text-yellow-400">{goodLeads.length}</div>
                  <div className="text-sm font-mono">🟡 GOOD</div>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowCelebration(false);
                  setActiveTab('leads');
                }}
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-10 py-4 rounded-xl font-bold text-xl transition-all shadow-2xl shadow-cyan-500/50 font-mono"
              >
                🚀 VIEW TARGETS →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-black/80 backdrop-blur-xl border-2 border-cyan-500/50 rounded-2xl p-8 max-w-2xl w-full">
            <h3 className="text-2xl font-bold text-cyan-400 mb-4 font-mono">
              [EDIT MISSION PARAMETER]
            </h3>
            <p className="text-gray-400 mb-4 font-mono">Field: {editField}</p>
            
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full bg-cyan-950/50 border-2 border-cyan-500/30 rounded-xl p-4 text-white placeholder-cyan-700 focus:outline-none focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/20 transition-all font-mono h-32 resize-none mb-4"
              placeholder="Enter new value..."
            />
            
            <div className="flex gap-4">
              <button
                onClick={handleSaveEdit}
                className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-all font-mono"
              >
                ✓ SAVE CHANGES
              </button>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditField(null);
                }}
                className="flex-1 bg-red-500/20 hover:bg-red-500/30 border-2 border-red-500/50 text-red-300 px-6 py-3 rounded-xl font-bold transition-all font-mono"
              >
                ✗ CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-black/80 border-b border-cyan-500/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-4xl" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent font-mono">
                  MISSION CONTROL
                </h1>
                <p className="text-xs text-gray-400 font-mono">Barry AI • Scout Tier</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {leads.length > 0 && (
                <div className="hidden md:flex items-center gap-2 bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                  <span className="text-xs font-semibold text-emerald-300 font-mono">
                    {leads.length} TARGETS
                  </span>
                </div>
              )}
              <button
                onClick={handleLogout}
                className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/50 text-red-300 px-4 py-2 rounded-lg font-mono text-xs transition-all"
              >
                🚪 LOGOUT
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <section className="relative z-10 bg-black/50 backdrop-blur-sm border-b border-cyan-500/20 sticky top-[73px]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex overflow-x-auto gap-2 py-3">
            {[
              { id: 'overview', name: '📊 OVERVIEW', icon: '📊' },
              { id: 'mission-params', name: '📝 MISSION PARAMS', icon: '📝' },
              { id: 'icp-intel', name: '🎯 ICP INTEL', icon: '🎯' },
              { id: 'leads', name: `🚀 TARGETS (${leads.length})`, icon: '🚀' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all font-mono ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-pink-500 to-cyan-500 text-white'
                    : 'text-gray-400 hover:bg-cyan-500/10 border border-cyan-500/20'
                }`}
              >
                {tab.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Content */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center mb-8">
              <h2 className="text-5xl font-bold text-white mb-4 font-mono">WELCOME, AGENT! 🎯</h2>
              <p className="text-xl text-gray-300 font-mono">
                {leads.length === 0
                  ? "ICP intelligence ready. Launch sequence to acquire targets!"
                  : `${leads.length} targets acquired and ready for engagement!`}
              </p>
            </div>

            {/* Mission Status Cards */}
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-green-500/50">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-4xl">✓</span>
                  <h3 className="text-lg font-bold text-white font-mono">SCOUT COMPLETE</h3>
                </div>
                <p className="text-green-400 text-sm font-mono">Mission parameters defined</p>
              </div>

              <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-cyan-500/50">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-4xl">🎯</span>
                  <h3 className="text-lg font-bold text-white font-mono">ICP BRIEF</h3>
                </div>
                <p className="text-cyan-400 text-sm font-mono">
                  {icpBrief ? "Intelligence analyzed" : "Generating..."}
                </p>
              </div>

              <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-6 border-2 border-purple-500/50">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-4xl">🚀</span>
                  <h3 className="text-lg font-bold text-white font-mono">TARGETS</h3>
                </div>
                <p className="text-3xl font-bold text-purple-400">{leads.length}</p>
              </div>
            </div>

            {/* Main CTAs */}
            {leads.length > 0 && (
              <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-2 border-cyan-500/30 rounded-2xl p-8 text-center backdrop-blur-xl">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-3xl font-bold text-white mb-3 font-mono">TARGETS LOCKED!</h3>
                <p className="text-gray-300 mb-6 font-mono">
                  Barry found {leads.length} targets. {excellentLeads.length} are excellent matches!
                </p>
                <button
                  onClick={() => setActiveTab('leads')}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-xl font-bold hover:from-cyan-600 hover:to-blue-700 transition-all shadow-2xl shadow-cyan-500/50 font-mono text-lg"
                >
                  🚀 VIEW TARGETS →
                </button>
              </div>
            )}

            {leads.length === 0 && (
              <div className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 border-2 border-pink-500/30 rounded-2xl p-8 text-center backdrop-blur-xl">
                <div className="text-6xl mb-4">🚀</div>
                <h3 className="text-3xl font-bold text-white mb-3 font-mono">READY FOR LAUNCH</h3>
                <p className="text-gray-300 mb-6 font-mono max-w-2xl mx-auto">
                  Your ICP intelligence is locked and loaded. Time to scan the universe for perfect-fit targets!
                </p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={handleGenerateLeads}
                    disabled={generatingLeads}
                    className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:from-pink-600 hover:to-purple-700 transition-all shadow-2xl shadow-pink-500/50 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generatingLeads ? (
                      <>
                        <span className="inline-block animate-spin mr-2">⚡</span>
                        SCANNING...
                      </>
                    ) : (
                      <>
                        🎯 GENERATE TARGETS
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('icp-intel')}
                    className="bg-gradient-to-r from-cyan-500/30 to-blue-600/30 border-2 border-cyan-500/50 hover:bg-cyan-500/40 text-white px-8 py-4 rounded-xl font-bold text-lg transition-all font-mono"
                  >
                    📋 REVIEW ICP
                  </button>
                </div>
                {leadGenError && (
                  <div className="mt-6 p-4 bg-red-500/20 border border-red-500 rounded-lg max-w-2xl mx-auto">
                    <p className="text-red-400 font-mono text-sm">{leadGenError}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* MISSION PARAMS TAB (Scout Answers) */}
        {activeTab === 'mission-params' && scoutData && (
          <div className="animate-fadeIn">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-4xl font-bold text-white mb-2 font-mono">[MISSION PARAMETERS]</h2>
                <p className="text-gray-400 font-mono">Review and update your targeting criteria</p>
              </div>
              <button
                onClick={handleRegenerateICP}
                className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg font-mono"
              >
                🔄 REGENERATE ICP
              </button>
            </div>

            <div className="space-y-4">
              {Object.entries({
                goal: { label: "90-Day Mission Goal", value: scoutData.goal },
                companyWebsite: { label: "Company Website", value: scoutData.companyWebsite },
                linkedinCompanyPage: { label: "LinkedIn Page", value: scoutData.linkedinCompanyPage },
                industries: { label: "Target Industries", value: Array.isArray(scoutData.industries) ? scoutData.industries.join(", ") : scoutData.industries },
                jobTitles: { label: "Decision Maker Titles", value: Array.isArray(scoutData.jobTitles) ? scoutData.jobTitles.join(", ") : scoutData.jobTitles },
                companySizes: { label: "Company Sizes", value: Array.isArray(scoutData.companySizes) ? scoutData.companySizes.join(", ") : scoutData.companySizes },
                locationScope: { label: "Location Scope", value: Array.isArray(scoutData.locationScope) ? scoutData.locationScope.join(", ") : scoutData.locationScope },
                targetStates: { label: "Target States", value: Array.isArray(scoutData.targetStates) ? scoutData.targetStates.join(", ") : scoutData.targetStates },
                targetCities: { label: "Target Metro Areas", value: Array.isArray(scoutData.targetCities) ? scoutData.targetCities.join(", ") : scoutData.targetCities },
                competitors: { label: "Competitors", value: scoutData.competitors },
                perfectFitCompanies: { label: "Perfect Fit Companies", value: scoutData.perfectFitCompanies },
                avoidList: { label: "Avoid List", value: scoutData.avoidList },
                painPoints: { label: "Target Pain Points", value: scoutData.painPoints },
                valueProposition: { label: "Your Solution", value: scoutData.valueProposition }
              }).map(([key, data]) => (
                data.value && (
                  <div key={key} className="bg-black/60 backdrop-blur-xl rounded-xl p-6 border border-cyan-500/30 hover:border-cyan-500/50 transition-all group">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-cyan-400 mb-2 font-mono flex items-center gap-2">
                          <span>▸</span> {data.label}
                        </h3>
                        <p className="text-gray-300 whitespace-pre-wrap">{data.value}</p>
                      </div>
                      <button
                        onClick={() => handleEditField(key, data.value)}
                        className="opacity-0 group-hover:opacity-100 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50 text-purple-300 px-4 py-2 rounded-lg font-mono text-sm transition-all"
                      >
                        ✏️ EDIT
                      </button>
                    </div>
                  </div>
                )
              ))}
            </div>

            <div className="mt-8 bg-yellow-500/10 border-2 border-yellow-500/30 rounded-xl p-6">
              <p className="text-yellow-300 font-mono text-sm">
                ⚠️ After editing parameters, click "REGENERATE ICP" to update your targeting intelligence.
              </p>
            </div>
          </div>
        )}

        {/* ICP INTEL TAB */}
        {activeTab === 'icp-intel' && icpBrief && (
          <div className="animate-fadeIn">
            <div className="mb-8">
              <h2 className="text-4xl font-bold text-white mb-2 font-mono">[ICP INTELLIGENCE BRIEF]</h2>
              <p className="text-gray-400 font-mono">Target profile analysis and engagement strategy</p>
            </div>

            {/* ICP Section Navigation */}
            <div className="mb-8 flex gap-2 overflow-x-auto">
              {[
                { id: 'overview', name: '📋 SUMMARY', icon: '📋' },
                { id: 'firmographic', name: '🏢 FIRMOGRAPHICS', icon: '🏢' },
                { id: 'psychographic', name: '🧠 PSYCHOGRAPHICS', icon: '🧠' },
                { id: 'behavioral', name: '⚡ TRIGGERS', icon: '⚡' }
              ].map((section) => (
                <button
                  key={section.id}
                  onClick={() => setIcpSection(section.id)}
                  className={`px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all font-mono ${
                    icpSection === section.id
                      ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white'
                      : 'text-gray-400 hover:bg-purple-500/10 border border-purple-500/20'
                  }`}
                >
                  {section.name}
                </button>
              ))}
            </div>

            {/* Executive Summary */}
            {icpSection === 'overview' && (
              <div className="space-y-6 animate-fadeIn">
                <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-l-4 border-emerald-500 p-8 rounded-r-xl backdrop-blur-xl">
                  <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2 font-mono">
                    <span>🎯</span> TARGET PROFILE
                  </h3>
                  <p className="text-gray-200 leading-relaxed text-lg">{icpBrief.idealCustomerGlance}</p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-black/60 backdrop-blur-xl border-2 border-green-500/30 rounded-2xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center border border-green-500/30">
                        <span className="text-2xl">✓</span>
                      </div>
                      <h4 className="text-xl font-bold text-green-400 font-mono">PERFECT FIT</h4>
                    </div>
                    <ul className="space-y-4">
                      {icpBrief.perfectFitIndicators?.map((indicator, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="text-green-400 text-xl mt-0.5">▸</span>
                          <span className="text-gray-300">{indicator}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-black/60 backdrop-blur-xl border-2 border-red-500/30 rounded-2xl p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center border border-red-500/30">
                        <span className="text-2xl">✗</span>
                      </div>
                      <h4 className="text-xl font-bold text-red-400 font-mono">AVOID ZONE</h4>
                    </div>
                    <ul className="space-y-4">
                      {icpBrief.antiProfile?.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="text-red-400 text-xl mt-0.5">▸</span>
                          <span className="text-gray-300">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-cyan-500/20 backdrop-blur-xl rounded-2xl p-8 border-2 border-yellow-500/30">
                  <h4 className="text-2xl font-bold text-white mb-4 flex items-center gap-2 font-mono">
                    <span className="text-3xl">💡</span>
                    KEY INSIGHT
                  </h4>
                  <p className="text-gray-200 leading-relaxed italic text-lg">"{icpBrief.keyInsight}"</p>
                </div>
              </div>
            )}

            {/* Firmographics */}
            {icpSection === 'firmographic' && icpBrief.firmographics && (
              <div className="space-y-6 animate-fadeIn">
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-6 rounded-2xl shadow-lg border border-emerald-400/30">
                    <span className="text-3xl mb-3 block">👥</span>
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1 font-mono">Company Size</p>
                    <p className="text-3xl font-bold">{icpBrief.firmographics.companySize?.split(' ')[0]}</p>
                  </div>
                  <div className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white p-6 rounded-2xl shadow-lg border border-blue-400/30">
                    <span className="text-3xl mb-3 block">📈</span>
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1 font-mono">Stage</p>
                    <p className="text-2xl font-bold">{icpBrief.firmographics.stage}</p>
                  </div>
                  <div className="bg-gradient-to-br from-purple-500 to-pink-600 text-white p-6 rounded-2xl shadow-lg border border-purple-400/30">
                    <span className="text-3xl mb-3 block">💰</span>
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1 font-mono">Budget</p>
                    <p className="text-2xl font-bold">{icpBrief.firmographics.budget}</p>
                  </div>
                  <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white p-6 rounded-2xl shadow-lg border border-orange-400/30">
                    <span className="text-3xl mb-3 block">⚡</span>
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1 font-mono">Decision Speed</p>
                    <p className="text-3xl font-bold">{icpBrief.firmographics.decisionSpeed?.split(' ')[0]}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-black/60 backdrop-blur-xl rounded-2xl border border-cyan-500/30 p-8">
                    <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2 font-mono">
                      <span className="text-3xl">🏢</span>
                      Industries
                    </h3>
                    <div className="space-y-3">
                      {icpBrief.firmographics.industries?.map((industry, i) => (
                        <div key={i} className="flex items-center justify-between py-3 border-b border-cyan-500/20">
                          <span className="text-gray-300">{industry.name}</span>
                          <span className={`text-sm font-semibold font-mono ${
                            industry.fit === 'High' ? 'text-cyan-400' :
                            industry.fit === 'Medium' ? 'text-green-400' :
                            'text-yellow-400'
                          }`}>{industry.fit}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-black/60 backdrop-blur-xl rounded-2xl border border-purple-500/30 p-8">
                    <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2 font-mono">
                      <span className="text-3xl">👤</span>
                      Decision Makers
                    </h3>
                    <div className="space-y-4">
                      {icpBrief.firmographics.decisionMakers?.map((dm, i) => (
                        <div key={i} className={`p-4 rounded-lg border ${
                          dm.level === 'Primary' ? 'bg-purple-500/20 border-purple-500/30' : 'bg-blue-500/20 border-blue-500/30'
                        }`}>
                          <p className="font-bold text-white mb-1 font-mono">{dm.level}: {dm.title}</p>
                          <p className="text-sm text-gray-300">{dm.role}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Psychographics */}
            {icpSection === 'psychographic' && icpBrief.psychographics && (
              <div className="space-y-6 animate-fadeIn">
                <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-2 border-purple-500/30 rounded-2xl p-8 backdrop-blur-xl">
                  <h3 className="text-3xl font-bold text-white mb-6 flex items-center gap-3 font-mono">
                    <span className="text-4xl">🧠</span>
                    PAIN POINTS
                  </h3>
                  <div className="space-y-4">
                    {icpBrief.psychographics.painPoints?.map((item, i) => (
                      <div key={i} className="bg-black/40 rounded-xl p-6 border border-purple-500/20">
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-2xl flex-shrink-0 ${
                            item.impact === 'Critical' ? 'bg-red-500/20 text-red-400 border-2 border-red-500/30' :
                            'bg-orange-500/20 text-orange-400 border-2 border-orange-500/30'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-lg font-bold text-white">{item.pain}</h4>
                              <span className={`text-xs font-semibold px-3 py-1 rounded-full font-mono ${
                                item.impact === 'Critical' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                              }`}>
                                {item.impact}
                              </span>
                            </div>
                            <p className="text-gray-300">{item.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-black/60 backdrop-blur-xl rounded-2xl border border-pink-500/30 p-8">
                  <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2 font-mono">
                    <span className="text-3xl">💬</span>
                    VALUES
                  </h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {icpBrief.psychographics.values?.map((value, i) => (
                      <div key={i} className="flex items-start gap-3 p-4 bg-pink-500/10 rounded-lg border border-pink-500/20">
                        <span className="text-pink-400 text-xl">✓</span>
                        <span className="text-gray-300">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Behavioral Triggers */}
            {icpSection === 'behavioral' && icpBrief.behavioralTriggers && (
              <div className="animate-fadeIn">
                <div className="bg-gradient-to-r from-red-500/20 to-orange-500/20 border-2 border-red-500/30 rounded-2xl p-8 backdrop-blur-xl">
                  <h3 className="text-3xl font-bold text-white mb-6 flex items-center gap-3 font-mono">
                    <span className="text-4xl">🔥</span>
                    HOT TRIGGERS
                  </h3>
                  <div className="grid md:grid-cols-2 gap-6">
                    {icpBrief.behavioralTriggers?.map((item, i) => (
                      <div key={i} className="bg-black/40 rounded-xl p-6 border border-red-500/30">
                        <div className="flex items-start gap-3 mb-4">
                          <div className="w-12 h-12 bg-red-500/20 rounded-lg flex items-center justify-center flex-shrink-0 border border-red-500/30">
                            <span className="text-2xl">⚡</span>
                          </div>
                          <div>
                            <h4 className="font-bold text-white text-lg">{item.trigger}</h4>
                            <p className="text-sm text-red-400 font-semibold font-mono">{item.timing}</p>
                          </div>
                        </div>
                        <div className="bg-red-500/10 p-4 rounded border border-red-500/20">
                          <p className="text-sm text-gray-300">
                            <strong className="text-white">Action:</strong> {item.action}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEADS TAB */}
        {activeTab === 'leads' && (
          <div className="animate-fadeIn">
            {leads.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-6xl mb-6">🎯</div>
                <h2 className="text-4xl font-bold text-white mb-4 font-mono">NO TARGETS YET</h2>
                <p className="text-gray-400 mb-8 font-mono">
                  Ready to launch target acquisition sequence!
                </p>
                
                {/* GENERATE LEADS BUTTON */}
                <button
                  onClick={handleGenerateLeads}
                  disabled={generatingLeads}
                  className="px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold font-mono rounded-lg hover:from-pink-600 hover:to-purple-600 transition-all shadow-lg shadow-pink-500/50 disabled:opacity-50 disabled:cursor-not-allowed text-xl"
                >
                  {generatingLeads ? (
                    <>
                      <span className="inline-block animate-spin mr-2">⚡</span>
                      SCANNING UNIVERSE...
                    </>
                  ) : (
                    <>
                      🚀 LAUNCH TARGET ACQUISITION
                    </>
                  )}
                </button>

                {leadGenError && (
                  <div className="mt-6 p-4 bg-red-500/20 border border-red-500 rounded-lg max-w-2xl mx-auto">
                    <p className="text-red-400 font-mono text-sm">{leadGenError}</p>
                  </div>
                )}

                <div className="mt-8 text-sm text-gray-500 font-mono">
                  Scout tier: 5-10 qualified targets
                </div>
              </div>
            ) : (
              <>
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-4xl font-bold text-white mb-2 font-mono">[TARGET ROSTER]</h2>
                      <p className="text-gray-400 font-mono">
                        {filteredLeads.length} of {leads.length} targets match filters
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-400 font-mono">MATCH QUALITY</div>
                      <div className="flex gap-4 mt-1">
                        <span className="text-green-400 font-bold font-mono">🟢 {excellentLeads.length}</span>
                        <span className="text-yellow-400 font-bold font-mono">🟡 {goodLeads.length}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Filters */}
                <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-6 border border-cyan-500/30 mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">🔍</span>
                    <h3 className="text-lg font-bold text-white font-mono">FILTER TARGETS</h3>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold mb-3 text-gray-300 font-mono">Minimum Match Score:</label>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-cyan-500/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={minScore === 85}
                            onChange={() => setMinScore(85)}
                            className="w-4 h-4"
                          />
                          <span className="text-gray-300 font-mono">85+ only (Excellent)</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-cyan-500/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={minScore === 70}
                            onChange={() => setMinScore(70)}
                            className="w-4 h-4"
                          />
                          <span className="text-gray-300 font-mono">70+ (Good & Excellent)</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-cyan-500/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={minScore === 0}
                            onChange={() => setMinScore(0)}
                            className="w-4 h-4"
                          />
                          <span className="text-gray-300 font-mono">Show all</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold mb-3 text-gray-300 font-mono">Sort by:</label>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-cyan-500/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={sortBy === "score"}
                            onChange={() => setSortBy("score")}
                            className="w-4 h-4"
                          />
                          <span className="text-gray-300 font-mono">Match Score</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-cyan-500/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={sortBy === "size"}
                            onChange={() => setSortBy("size")}
                            className="w-4 h-4"
                          />
                          <span className="text-gray-300 font-mono">Company Size</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-cyan-500/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={sortBy === "alpha"}
                            onChange={() => setSortBy("alpha")}
                            className="w-4 h-4"
                          />
                          <span className="text-gray-300 font-mono">Alphabetical</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Excellent Matches */}
                {excellentLeads.filter(l => l.score >= minScore).length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-3xl font-bold text-green-400 mb-4 flex items-center gap-2 font-mono">
                      🟢 EXCELLENT MATCHES (85-100)
                      <span className="text-gray-400 text-base">
                        - {excellentLeads.filter(l => l.score >= minScore).length} targets
                      </span>
                    </h3>
                    <div className="space-y-4">
                      {excellentLeads.filter(l => l.score >= minScore).map((lead) => (
                        <LeadCard key={lead.id} lead={lead} getScoreColor={getScoreColor} getScoreBadge={getScoreBadge} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Good Matches */}
                {goodLeads.filter(l => l.score >= minScore).length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-3xl font-bold text-yellow-400 mb-4 flex items-center gap-2 font-mono">
                      🟡 GOOD MATCHES (70-84)
                      <span className="text-gray-400 text-base">
                        - {goodLeads.filter(l => l.score >= minScore).length} targets
                      </span>
                    </h3>
                    <div className="space-y-4">
                      {goodLeads.filter(l => l.score >= minScore).map((lead) => (
                        <LeadCard key={lead.id} lead={lead} getScoreColor={getScoreColor} getScoreBadge={getScoreBadge} />
                      ))}
                    </div>
                  </div>
                )}

                {filteredLeads.length === 0 && (
                  <div className="text-center py-12 bg-black/60 backdrop-blur-xl rounded-2xl border border-cyan-500/30">
                    <p className="text-gray-400 text-lg font-mono">No targets match current filters.</p>
                    <button
                      onClick={() => { setMinScore(0); setSortBy("score"); }}
                      className="mt-4 text-cyan-400 hover:text-cyan-300 underline font-mono"
                    >
                      Reset filters
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

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
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.3s ease-in; }
      `}</style>
    </div>
  );
}

function LeadCard({ lead, getScoreColor, getScoreBadge }) {
  return (
    <div className="bg-black/60 backdrop-blur-xl rounded-xl p-6 border border-cyan-500/30 hover:border-cyan-500/50 transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-2xl font-bold text-white border-2 border-purple-400/50">
            {lead.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-1">{lead.name}</h3>
            <p className="text-purple-300 font-medium">{lead.title}</p>
            <p className="text-gray-400 text-sm font-mono">
              🏢 {lead.company} • {lead.industry} • {lead.employees} employees
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${getScoreColor(lead.score)}`}>
            {getScoreBadge(lead.score)} {lead.score}
          </div>
          <p className="text-xs text-gray-400 font-mono">MATCH</p>
        </div>
      </div>

      <div className="mb-4 space-y-1">
        {lead.matchDetails?.map((detail, i) => (
          <p key={i} className="text-sm text-gray-300">{detail}</p>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        {lead.email ? (
          <a href={`mailto:${lead.email}`} className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full hover:bg-green-500/30 font-mono">
            📧 {lead.email}
          </a>
        ) : (
          <span className="bg-gray-700/50 text-gray-400 px-3 py-1 rounded-full font-mono">
            📧 Email locked
          </span>
        )}
        {lead.linkedin && (
          <a 
            href={lead.linkedin} 
            target="_blank" 
            rel="noopener noreferrer"
            className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full hover:bg-blue-500/30 font-mono"
          >
            🔗 LinkedIn
          </a>
        )}
        {lead.phone && (
          <span className="bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full font-mono">
            📞 {lead.phone}
          </span>
        )}
      </div>

      <details className="text-xs text-gray-500 mb-4">
        <summary className="cursor-pointer hover:text-gray-400 font-mono">Score Breakdown</summary>
        <div className="mt-2 space-y-1 bg-black/50 p-3 rounded border border-cyan-500/20">
          <p>Title Match: {lead.scoreBreakdown?.title || 0}/25</p>
          <p>Industry Match: {lead.scoreBreakdown?.industry || 0}/20</p>
          <p>Company Size: {lead.scoreBreakdown?.size || 0}/20</p>
          <p>Location Match: {lead.scoreBreakdown?.location || 0}/15</p>
          <p>Not in Avoid List: {lead.scoreBreakdown?.notAvoid || 0}/10</p>
          <p>Data Quality: {lead.scoreBreakdown?.dataQuality || 0}/10</p>
        </div>
      </details>

      <div className="flex gap-3">
        <button className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:from-cyan-600 hover:to-blue-700 transition-all font-mono">
          VIEW PROFILE
        </button>
        <button className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:from-pink-600 hover:to-purple-700 transition-all font-mono">
          ADD TO CAMPAIGN
        </button>
      </div>
    </div>
  );
}