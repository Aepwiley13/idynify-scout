import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, getDoc } from "firebase/firestore";
import { Users, Target, TrendingUp, Building2, Brain, MessageSquare, Zap, Loader, CheckCircle, XCircle, Sparkles, Filter } from "lucide-react";

export default function UnifiedDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isFirstLaunch = searchParams.get('first-launch') === 'true';
  
  const [activeTab, setActiveTab] = useState("overview");
  const [scoutData, setScoutData] = useState(null);
  const [icpBrief, setIcpBrief] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(isFirstLaunch);
  const [icpApproved, setIcpApproved] = useState(false);
  const [minScore, setMinScore] = useState(70);
  const [sortBy, setSortBy] = useState("score");
  const [error, setError] = useState(null);

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
        setIcpApproved(data.icpApproved || false);
        
        setLoading(false);
      } catch (err) {
        console.error("Error loading data:", err);
        setError("Failed to load data");
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  const handleApproveICP = async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      setIcpApproved(true);
      
      // TODO: Save approval to Firebase
      // await updateDoc(doc(db, "users", user.uid), { icpApproved: true });
      
      console.log("✅ ICP Approved!");
    } catch (err) {
      console.error("Error approving ICP:", err);
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-16 h-16 text-cyan-400 animate-spin mx-auto mb-4" />
          <div className="text-white text-2xl">Loading Mission Control...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* First Launch Celebration Modal */}
      {showCelebration && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl p-12 max-w-2xl text-center relative overflow-hidden">
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
              <div className="text-8xl mb-6 animate-bounce">🎯</div>
              <h2 className="text-5xl font-bold text-white mb-4">MISSION SUCCESS!</h2>
              <p className="text-2xl text-emerald-100 mb-6">
                Barry found {leads.length} qualified leads for you!
              </p>
              <div className="flex justify-center gap-8 mb-8 text-white">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-4xl font-bold">{excellentLeads.length}</div>
                  <div className="text-sm">🟢 Excellent</div>
                </div>
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-4xl font-bold">{goodLeads.length}</div>
                  <div className="text-sm">🟡 Good</div>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowCelebration(false);
                  setActiveTab('leads');
                }}
                className="bg-white text-emerald-600 px-10 py-4 rounded-xl font-bold text-xl hover:bg-emerald-50 transition-all shadow-lg"
              >
                View Your Leads →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-900/80 border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-4xl">🐻</div>
              <div>
                <h1 className="text-xl font-bold text-white">Mission Control</h1>
                <p className="text-xs text-slate-400">Barry AI • Scout Tier</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {leads.length > 0 && (
                <div className="hidden md:flex items-center gap-2 bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                  <span className="text-xs font-semibold text-emerald-300">
                    {leads.length} Leads
                  </span>
                </div>
              )}
            </div>
          </div>
        </div><button
  onClick={() => {
    auth.signOut();
    navigate('/login');
  }}
  className="text-sm text-slate-400 hover:text-white transition-all"
>
  Logout
</button>
      </header>

      {/* Navigation Tabs */}
      <section className="bg-slate-900/50 backdrop-blur-sm border-b border-purple-500/20 sticky top-[73px] z-40">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex overflow-x-auto gap-1 py-2">
            {[
              { id: 'overview', name: '📊 Overview' },
              { id: 'scout-answers', name: '📝 Scout Answers' },
              { id: 'icp-brief', name: '🎯 ICP Brief' },
              { id: 'leads', name: `🚀 Leads (${leads.length})` }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-pink-500 to-cyan-500 text-white'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                {tab.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="text-center mb-8">
              <h2 className="text-4xl font-bold text-white mb-4">Welcome, Agent! 🎯</h2>
              <p className="text-xl text-slate-300">
                {leads.length === 0
                  ? "Your ICP is ready. Approve it to see your leads!"
                  : `You have ${leads.length} leads ready for action!`}
              </p>
            </div>

            {/* Status Cards */}
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-green-500">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                  <h3 className="text-lg font-bold text-white">Scout Complete</h3>
                </div>
                <p className="text-green-400 text-sm">✓ Questionnaire answered</p>
              </div>

              <div className={`bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border ${
                icpApproved ? 'border-green-500' : 'border-yellow-500'
              }`}>
                <div className="flex items-center gap-3 mb-3">
                  {icpApproved ? (
                    <CheckCircle className="w-8 h-8 text-green-400" />
                  ) : (
                    <Target className="w-8 h-8 text-yellow-400" />
                  )}
                  <h3 className="text-lg font-bold text-white">ICP Brief</h3>
                </div>
                <p className={`text-sm ${icpApproved ? 'text-green-400' : 'text-yellow-400'}`}>
                  {icpApproved ? "✓ Approved" : "⚠ Needs Review"}
                </p>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-cyan-500">
                <div className="flex items-center gap-3 mb-3">
                  <Users className="w-8 h-8 text-cyan-400" />
                  <h3 className="text-lg font-bold text-white">Leads Generated</h3>
                </div>
                <p className="text-3xl font-bold text-cyan-400">{leads.length}</p>
              </div>
            </div>

            {/* Main CTA */}
            {!icpApproved && leads.length === 0 && (
              <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-2 border-yellow-500/30 rounded-2xl p-8 text-center backdrop-blur-sm">
                <div className="text-6xl mb-4">⚠️</div>
                <h3 className="text-2xl font-bold text-white mb-3">Review Your ICP Brief</h3>
                <p className="text-slate-300 mb-6 max-w-2xl mx-auto">
                  Check out your ICP Brief to see what Barry discovered about your ideal customers.
                </p>
                <button
                  onClick={() => setActiveTab('icp-brief')}
                  className="bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:from-yellow-600 hover:to-orange-700 transition-all"
                >
                  Review ICP Brief →
                </button>
              </div>
            )}

            {leads.length > 0 && (
              <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-2 border-cyan-500/30 rounded-2xl p-8 text-center backdrop-blur-sm">
                <div className="text-6xl mb-4">✅</div>
                <h3 className="text-2xl font-bold text-white mb-3">Leads Ready!</h3>
                <p className="text-slate-300 mb-6">
                  Barry found {leads.length} leads matching your ICP. {excellentLeads.length} are excellent matches!
                </p>
                <button
                  onClick={() => setActiveTab('leads')}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-3 rounded-xl font-bold hover:from-cyan-600 hover:to-blue-700 transition-all"
                >
                  View Leads →
                </button>
              </div>
            )}
          </div>
        )}

        {/* SCOUT ANSWERS TAB */}
        {activeTab === 'scout-answers' && scoutData && (
          <div className="animate-fadeIn">
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-white mb-2">Your Scout Answers</h2>
              <p className="text-slate-400">Review what you told Barry</p>
            </div>

            <div className="space-y-6">
              {Object.entries({
                "90-Day Goal": scoutData.goal,
                "Company Website": scoutData.companyWebsite,
                "LinkedIn Page": scoutData.linkedinCompanyPage,
                "Target Industries": Array.isArray(scoutData.industries) ? scoutData.industries.join(", ") : scoutData.industries,
                "Job Titles": Array.isArray(scoutData.jobTitles) ? scoutData.jobTitles.join(", ") : scoutData.jobTitles,
                "Company Sizes": Array.isArray(scoutData.companySizes) ? scoutData.companySizes.join(", ") : scoutData.companySizes,
                "Competitors": scoutData.competitors,
                "Perfect Fit Companies": scoutData.perfectFitCompanies,
                "Avoid List": scoutData.avoidList,
                "Pain Points": scoutData.painPoints,
                "Value Proposition": scoutData.valueProposition
              }).map(([key, value]) => (
                value && (
                  <div key={key} className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
                    <h3 className="text-lg font-bold text-cyan-400 mb-2">{key}</h3>
                    <p className="text-slate-300 whitespace-pre-wrap">{value}</p>
                  </div>
                )
              ))}
            </div>
          </div>
        )}

        {/* ICP BRIEF TAB */}
        {activeTab === 'icp-brief' && icpBrief && (
          <div className="animate-fadeIn">
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-white mb-2">Your ICP Brief</h2>
              <p className="text-slate-400">Review and approve your ideal customer profile</p>
            </div>

            <div className="bg-emerald-500/20 border-l-4 border-emerald-500 p-6 rounded-r-xl mb-8 backdrop-blur-sm">
              <h3 className="text-xl font-bold text-white mb-3">Your Ideal Customer At a Glance</h3>
              <p className="text-slate-200 leading-relaxed">{icpBrief.idealCustomerGlance}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-slate-800/50 backdrop-blur-sm border-2 border-green-500/30 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                  <h4 className="text-lg font-bold text-white">Perfect Fit Indicators</h4>
                </div>
                <ul className="space-y-3 text-sm text-slate-300">
                  {icpBrief.perfectFitIndicators.map((indicator, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-green-400 mt-0.5">✓</span>
                      <span>{indicator}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border-2 border-red-500/30 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <XCircle className="w-8 h-8 text-red-400" />
                  <h4 className="text-lg font-bold text-white">Anti-Profile (Avoid)</h4>
                </div>
                <ul className="space-y-3 text-sm text-slate-300">
                  {icpBrief.antiProfile.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">✗</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-purple-500/30 p-8 mb-8">
              <h4 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Brain className="w-6 h-6 text-yellow-400" />
                💡 Key Insight
              </h4>
              <p className="text-slate-300 leading-relaxed italic">"{icpBrief.keyInsight}"</p>
            </div>

            {!icpApproved && (
              <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-8 text-white text-center">
                <h3 className="text-2xl font-bold mb-3">Approve This ICP?</h3>
                <p className="text-emerald-100 mb-6">
                  This profile will guide Barry's lead generation.
                </p>
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={handleApproveICP}
                    className="bg-white text-emerald-600 px-8 py-4 rounded-xl font-bold hover:bg-emerald-50 transition-all"
                  >
                    ✅ Approve & Continue
                  </button>
                  <button
                    onClick={() => alert("Edit feature coming soon! For now, retake the Scout questionnaire.")}
                    className="bg-white/10 backdrop-blur-sm text-white px-8 py-4 rounded-xl font-bold border-2 border-white/30 hover:bg-white/20 transition-all"
                  >
                    ✏️ Edit ICP
                  </button>
                </div>
              </div>
            )}

            {icpApproved && (
              <div className="bg-green-500/20 border-2 border-green-500 rounded-xl p-6 text-center">
                <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                <p className="text-green-300 font-bold text-lg">✅ ICP Approved!</p>
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
                <h2 className="text-3xl font-bold text-white mb-4">No Leads Yet</h2>
                <p className="text-slate-400 mb-8">
                  Complete the launch sequence to generate your first batch of leads!
                </p>
              </div>
            ) : (
              <>
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-3xl font-bold text-white mb-2">Your Leads</h2>
                      <p className="text-slate-400">
                        {filteredLeads.length} of {leads.length} leads match your filters
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-400">Match Quality</div>
                      <div className="flex gap-4 mt-1">
                        <span className="text-green-400 font-bold">🟢 {excellentLeads.length}</span>
                        <span className="text-yellow-400 font-bold">🟡 {goodLeads.length}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Filters */}
                <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700 mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <Filter className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-lg font-bold text-white">Filter Leads</h3>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold mb-3 text-slate-300">Minimum Match Score:</label>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={minScore === 85}
                            onChange={() => setMinScore(85)}
                            className="w-4 h-4"
                          />
                          <span className="text-slate-300">85+ only (Excellent matches)</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={minScore === 70}
                            onChange={() => setMinScore(70)}
                            className="w-4 h-4"
                          />
                          <span className="text-slate-300">70+ (Good & Excellent) ← DEFAULT</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={minScore === 0}
                            onChange={() => setMinScore(0)}
                            className="w-4 h-4"
                          />
                          <span className="text-slate-300">Show all leads</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold mb-3 text-slate-300">Sort by:</label>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={sortBy === "score"}
                            onChange={() => setSortBy("score")}
                            className="w-4 h-4"
                          />
                          <span className="text-slate-300">Match Score (highest first)</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={sortBy === "size"}
                            onChange={() => setSortBy("size")}
                            className="w-4 h-4"
                          />
                          <span className="text-slate-300">Company Size</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                          <input
                            type="radio"
                            checked={sortBy === "alpha"}
                            onChange={() => setSortBy("alpha")}
                            className="w-4 h-4"
                          />
                          <span className="text-slate-300">Alphabetical</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Excellent Matches */}
                {excellentLeads.filter(l => l.score >= minScore).length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-2xl font-bold text-green-400 mb-4 flex items-center gap-2">
                      🟢 EXCELLENT MATCHES (85-100)
                      <span className="text-slate-400 text-base">
                        - {excellentLeads.filter(l => l.score >= minScore).length} leads
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
                    <h3 className="text-2xl font-bold text-yellow-400 mb-4 flex items-center gap-2">
                      🟡 GOOD MATCHES (70-84)
                      <span className="text-slate-400 text-base">
                        - {goodLeads.filter(l => l.score >= minScore).length} leads
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
                  <div className="text-center py-12 bg-slate-800/50 rounded-2xl border border-slate-700">
                    <p className="text-slate-400 text-lg">No leads match your current filters.</p>
                    <button
                      onClick={() => { setMinScore(0); setSortBy("score"); }}
                      className="mt-4 text-cyan-400 hover:text-cyan-300 underline"
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
    <div className="bg-slate-800/50 backdrop-blur-lg rounded-xl p-6 border border-slate-700 hover:border-cyan-500/50 transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-2xl font-bold text-white">
            {lead.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-1">{lead.name}</h3>
            <p className="text-purple-300 font-medium">{lead.title}</p>
            <p className="text-slate-400 text-sm">
              🏢 {lead.company} ({lead.industry}, {lead.employees} employees)
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${getScoreColor(lead.score)}`}>
            {getScoreBadge(lead.score)} {lead.score}/100
          </div>
          <p className="text-xs text-slate-400">MATCH SCORE</p>
        </div>
      </div>

      <div className="mb-4 space-y-1">
        {lead.matchDetails.map((detail, i) => (
          <p key={i} className="text-sm text-slate-300">{detail}</p>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        {lead.email ? (
          <a href={`mailto:${lead.email}`} className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full hover:bg-green-500/30">
            📧 {lead.email}
          </a>
        ) : (
          <span className="bg-slate-700 text-slate-400 px-3 py-1 rounded-full">
            📧 Email not available
          </span>
        )}
        {lead.linkedin && (
          <a 
            href={lead.linkedin} 
            target="_blank" 
            rel="noopener noreferrer"
            className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full hover:bg-blue-500/30"
          >
            🔗 LinkedIn
          </a>
        )}
        {lead.phone && (
          <span className="bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full">
            📞 {lead.phone}
          </span>
        )}
      </div>

      <details className="text-xs text-slate-500 mb-4">
        <summary className="cursor-pointer hover:text-slate-400">Score Breakdown</summary>
        <div className="mt-2 space-y-1 bg-slate-900/50 p-3 rounded">
          <p>Title Match: {lead.scoreBreakdown.title}/30</p>
          <p>Industry Match: {lead.scoreBreakdown.industry}/25</p>
          <p>Company Size: {lead.scoreBreakdown.size}/20</p>
          <p>Not in Avoid List: {lead.scoreBreakdown.notAvoid}/15</p>
          <p>Data Quality: {lead.scoreBreakdown.dataQuality}/10</p>
        </div>
      </details>

      <div className="flex gap-3">
        <button className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:from-cyan-600 hover:to-blue-700 transition-all">
          View Full Profile
        </button>
        <button className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:from-pink-600 hover:to-purple-700 transition-all">
          Add to Campaign
        </button>
      </div>
    </div>
  );
}