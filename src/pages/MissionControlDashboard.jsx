import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, getDoc, updateDoc, onSnapshot } from "firebase/firestore";
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
  const [useEnhancedVersion, setUseEnhancedVersion] = useState(false);
  const [leadGenError, setLeadGenError] = useState(null);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      navigate("/login");
      return;
    }

    // Set up real-time listener for user data
    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (docSnapshot) => {
        if (!docSnapshot.exists()) {
          navigate("/scout-questionnaire");
          return;
        }

        const data = docSnapshot.data();

        setScoutData(data.scoutData || null);
        setIcpBrief(data.icpBrief || null);
        setLeads(data.leads || []);

        // Auto-switch to leads tab when leads arrive
        if (data.leads && data.leads.length > 0 && leads.length === 0) {
          console.log("🎉 Barry found leads! Switching to leads tab...");
          setActiveTab('leads');
        }

        setLoading(false);
      },
      (err) => {
        console.error("Error loading data:", err);
        setLoading(false);
      }
    );

    // Cleanup listener on unmount
    return () => unsubscribe();
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
      console.log(`🚀 Generating leads using ${useEnhancedVersion ? 'ENHANCED V2' : 'ORIGINAL'} version...`);
      
      const endpoint = useEnhancedVersion 
        ? '/.netlify/functions/generate-leads-v2'
        : '/.netlify/functions/generate-leads';
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: auth.currentUser?.uid,
          scoutData: scoutData,
          icpBrief: icpBrief
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`✅ Generated ${data.leads?.length || 0} leads`);
      
      if (useEnhancedVersion && data.analytics) {
        console.log('📊 Barry Analytics:', data.analytics);
        
        const analyticsMessage = `🎯 Barry's Intelligence Report:

📊 Discovery Phase:
   • Analyzed ${data.analytics.totalCompaniesFound} companies
   • ${data.analytics.companiesScored} companies scored by AI
   • ${data.analytics.qualifiedCompanies} met quality threshold (60+ score)

👥 Decision-Maker Phase:
   • Found ${data.analytics.leadsFound} decision-makers
   • Delivered ${data.analytics.finalLeads} perfect-fit leads
   • Average Score: ${data.analytics.avgScore}/100

🧠 Strategy: ${data.analytics.searchStrategy}

${data.message}`;

        alert(analyticsMessage);
      }

      const user = auth.currentUser;
      if (user) {
        await updateDoc(doc(db, "users", user.uid), {
          leads: data.leads,
          leadsGeneratedAt: new Date().toISOString(),
          lastAnalytics: data.analytics || null
        });
        
        setLeads(data.leads);
        
        if (!useEnhancedVersion) {
          alert(`🎯 Mission successful! ${data.leads.length} targets acquired.`);
        }
      }

    } catch (err) {
      console.error('💥 Error generating leads:', err);
      setLeadGenError(err.message);
      alert(`Error generating leads: ${err.message}`);
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

      {/* Navigation Tabs - Simplified */}
      <section className="relative z-10 bg-black/50 backdrop-blur-sm border-b border-cyan-500/20 sticky top-[73px]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex overflow-x-auto gap-2 py-3">
            {[
              { id: 'overview', name: '🎯 YOUR ICP', icon: '🎯' },
              { id: 'companies', name: `🏢 YOUR COMPANIES (${leads.length})`, icon: '🏢' }
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
        
        {/* OVERVIEW TAB - Show ICP Summary */}
        {activeTab === 'overview' && icpBrief && (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center mb-8">
              <h2 className="text-5xl font-bold text-white mb-4 font-mono">YOUR IDEAL CLIENT PROFILE 🎯</h2>
              <p className="text-xl text-gray-300 font-mono">
                {leads.length === 0
                  ? "🐻 Barry is finding companies that match this profile"
                  : `🐻 Barry found ${leads.length} companies matching this profile!`}
              </p>
            </div>

            {/* ICP Summary */}
            <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-l-4 border-emerald-500 p-8 rounded-r-xl backdrop-blur-sm mb-8">
              <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2 font-mono">
                <span>🎯</span> Your Ideal Customer At a Glance
              </h3>
              <p className="text-gray-200 leading-relaxed text-lg">
                {icpBrief.idealCustomerGlance}
              </p>
            </div>

            {/* Perfect Fit & Anti-Profile */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-black/60 backdrop-blur-xl border-2 border-green-500/30 rounded-2xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center border border-green-500/30">
                    <span className="text-2xl">✓</span>
                  </div>
                  <h4 className="text-xl font-bold text-green-400 font-mono">Perfect Fit Indicators</h4>
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
                  <h4 className="text-xl font-bold text-red-400 font-mono">Anti-Profile (Avoid)</h4>
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

            {/* Main CTAs */}
            {leads.length > 0 && (
              <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-2 border-cyan-500/30 rounded-2xl p-8 text-center backdrop-blur-xl">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-3xl font-bold text-white mb-3 font-mono">SAMPLE LEADS READY!</h3>
                <p className="text-gray-300 mb-6 font-mono">
                  🐻 Barry found {leads.length} ideal clients matching your ICP. {excellentLeads.length} are excellent matches!
                </p>
                <button
                  onClick={() => setActiveTab('leads')}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-xl font-bold hover:from-cyan-600 hover:to-blue-700 transition-all shadow-2xl shadow-cyan-500/50 font-mono text-lg"
                >
                  🚀 VIEW YOUR SAMPLE LEADS →
                </button>
              </div>
            )}

            {leads.length === 0 && (
              <div className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 border-2 border-pink-500/30 rounded-2xl p-8 text-center backdrop-blur-xl">
                <div className="text-7xl mb-6" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
                <h3 className="text-3xl font-bold text-white mb-3 font-mono">BARRY IS SEARCHING...</h3>
                <p className="text-gray-300 mb-6 font-mono max-w-2xl mx-auto">
                  Barry is analyzing companies and finding your ideal clients based on your ICP. This usually takes a few minutes.
                </p>
                <div className="flex justify-center mb-6">
                  <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                </div>
                <p className="text-sm text-gray-400 font-mono">
                  💡 Barry will automatically pull a sample of 15-20 ideal clients for you to review
                </p>
              </div>
            )}
          </div>
        )}

        {/* COMPANIES TAB */}
        {activeTab === 'companies' && (
          <div className="animate-fadeIn">
            {leads.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-7xl mb-6" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
                <h2 className="text-4xl font-bold text-white mb-4 font-mono">BARRY IS FINDING COMPANIES...</h2>
                <p className="text-gray-400 mb-8 font-mono max-w-2xl mx-auto">
                  Barry is searching for companies that match your ICP. You'll be able to browse and select companies to launch missions.
                </p>

                <div className="flex justify-center mb-6">
                  <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
                </div>

                <p className="text-sm text-gray-400 font-mono">
                  💡 Companies will appear here automatically - then you can select which ones to engage with
                </p>
              </div>
            ) : (
              <>
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-4xl font-bold text-white mb-2 font-mono">🏢 YOUR COMPANIES</h2>
                      <p className="text-gray-400 font-mono">
                        🐻 Barry found {filteredLeads.length} companies matching your ICP - Select one to launch a mission
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