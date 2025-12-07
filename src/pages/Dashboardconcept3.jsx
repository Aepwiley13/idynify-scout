import { useState, useEffect } from "react";
import { Users, Target, TrendingUp, Building2, Brain, MessageSquare, Zap, Loader, CheckCircle, XCircle, Sparkles, Filter } from "lucide-react";

export default function UnifiedDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [scoutData, setScoutData] = useState(null);
  const [icpBrief, setIcpBrief] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingLeads, setGeneratingLeads] = useState(false);
  const [icpApproved, setIcpApproved] = useState(false);
  const [minScore, setMinScore] = useState(70);
  const [sortBy, setSortBy] = useState("score");
  const [error, setError] = useState(null);

  // Mock data - Replace with Firebase fetch
  useEffect(() => {
    const loadData = async () => {
      try {
        // TODO: Replace with actual Firebase fetch
        // const user = auth.currentUser;
        // const userDoc = await getDoc(doc(db, "users", user.uid));
        
        // Mock Scout Data
        const mockScoutData = {
          goal: "Sign 50 new B2B customers in Q1",
          companyWebsite: "https://yourcompany.com",
          linkedinCompanyPage: "https://linkedin.com/company/yourcompany",
          industries: ["Technology / Software / SaaS", "Professional Services / Consulting"],
          jobTitles: "VP Sales, Head of Sales, Director of Sales, Sales Manager",
          companySizes: ["51-200 employees (Mid-size)", "201-500 employees (Growth)"],
          competitors: "HubSpot, Salesforce",
          perfectFitCompanies: "Fast-growing SaaS companies with 50-200 employees",
          avoidList: "Large enterprises with 6-month procurement, B2C companies",
          painPoints: "Sales teams spend 60% of time prospecting instead of selling. They can't find qualified leads.",
          valueProposition: "We identify your ICP in 5 minutes and deliver 30 qualified leads daily. Save 10+ hours/week on prospecting."
        };

        // Mock ICP Brief
        const mockIcpBrief = {
          companyName: "Your Company",
          idealCustomerGlance: "Your ideal clients are growth-stage SaaS companies (50-200 employees) led by ambitious founders who see sales intelligence as a strategic advantage.",
          perfectFitIndicators: [
            "Founder-led or VP of Sales with budget authority",
            "Growing sales team (3-15 reps) struggling with prospecting",
            "High-velocity sales motion (short sales cycles)",
            "Willing to invest $500-2K/month in lead gen tools"
          ],
          antiProfile: [
            "Enterprise companies with 6-month procurement cycles",
            "B2C companies with no B2B sales motion",
            "Startups pre-product market fit"
          ],
          keyInsight: "Companies most likely to buy are those experiencing 'prospecting pain' where their sales team spends 60%+ of time researching leads."
        };

        setScoutData(mockScoutData);
        setIcpBrief(mockIcpBrief);
        setLoading(false);
      } catch (err) {
        console.error("Error loading data:", err);
        setError("Failed to load data");
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleApproveICP = async () => {
    setIcpApproved(true);
    // TODO: Save approval to Firebase
    // await updateDoc(doc(db, "users", user.uid), { icpApproved: true });
  };

  const handleLaunchLeadSearch = async () => {
    if (!icpApproved) {
      alert("Please approve your ICP Brief first!");
      setActiveTab("icp-brief");
      return;
    }

    setGeneratingLeads(true);
    setError(null);

    try {
      // TODO: Replace with actual API call
      // const response = await fetch("/.netlify/functions/generate-leads", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ scoutData })
      // });

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Mock leads with scoring
      const mockLeads = [
        {
          id: 1,
          name: "Sarah Johnson",
          title: "VP of Sales",
          company: "TechFlow Solutions",
          industry: "SaaS",
          employees: 125,
          email: "sarah.j@techflow.com",
          linkedin: "https://linkedin.com/in/sarahjohnson",
          phone: "+1-555-0123",
          photoUrl: null,
          score: 92,
          scoreBreakdown: { title: 30, industry: 25, size: 20, notAvoid: 15, dataQuality: 8 },
          matchDetails: [
            "✓ Exact title match (VP Sales)",
            "✓ Perfect industry (SaaS)",
            "✓ Ideal company size (125 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 2,
          name: "Michael Chen",
          title: "Director of Sales",
          company: "CloudScale Inc",
          industry: "SaaS",
          employees: 180,
          email: "m.chen@cloudscale.io",
          linkedin: "https://linkedin.com/in/michaelchen",
          phone: "+1-555-0456",
          photoUrl: null,
          score: 88,
          scoreBreakdown: { title: 20, industry: 25, size: 20, notAvoid: 15, dataQuality: 8 },
          matchDetails: [
            "✓ Close title match (Director of Sales)",
            "✓ Perfect industry (SaaS)",
            "✓ Ideal company size (180 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 3,
          name: "Lisa Martinez",
          title: "Head of Revenue",
          company: "DataStream Analytics",
          industry: "Technology",
          employees: 95,
          email: "lisa.m@datastream.com",
          linkedin: "https://linkedin.com/in/lisamartinez",
          phone: null,
          photoUrl: null,
          score: 82,
          scoreBreakdown: { title: 20, industry: 25, size: 20, notAvoid: 15, dataQuality: 5 },
          matchDetails: [
            "✓ Related title match (Head of Revenue)",
            "✓ Perfect industry (Technology/SaaS)",
            "✓ Good company size (95 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 4,
          name: "Kevin Doherty",
          title: "Vice President of Sales",
          company: "Park Lawn Corporation",
          industry: "Professional Services",
          employees: 89,
          email: null,
          linkedin: "https://linkedin.com/in/kevindoherty",
          phone: null,
          photoUrl: null,
          score: 78,
          scoreBreakdown: { title: 30, industry: 15, size: 20, notAvoid: 15, dataQuality: 3 },
          matchDetails: [
            "✓ Close title match (VP Sales)",
            "⚠ Different industry (Professional Services vs SaaS selected)",
            "✓ Good company size (89 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 5,
          name: "David Park",
          title: "VP Sales",
          company: "InnovateTech",
          industry: "SaaS",
          employees: 145,
          email: "d.park@innovatetech.io",
          linkedin: "https://linkedin.com/in/davidpark",
          phone: "+1-555-0789",
          photoUrl: null,
          score: 90,
          scoreBreakdown: { title: 30, industry: 25, size: 20, notAvoid: 15, dataQuality: 8 },
          matchDetails: [
            "✓ Exact title match (VP Sales)",
            "✓ Perfect industry (SaaS)",
            "✓ Ideal company size (145 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 6,
          name: "Emily Watson",
          title: "Sales Director",
          company: "ProServices Group",
          industry: "Professional Services",
          employees: 220,
          email: "e.watson@proservices.com",
          linkedin: "https://linkedin.com/in/emilywatson",
          phone: null,
          photoUrl: null,
          score: 75,
          scoreBreakdown: { title: 20, industry: 15, size: 20, notAvoid: 15, dataQuality: 5 },
          matchDetails: [
            "✓ Close title match (Sales Director)",
            "⚠ Different industry (Professional Services)",
            "✓ Good company size (220 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 7,
          name: "Robert Kim",
          title: "Head of Sales",
          company: "TechVentures Inc",
          industry: "SaaS",
          employees: 165,
          email: "r.kim@techventures.io",
          linkedin: "https://linkedin.com/in/robertkim",
          phone: "+1-555-0234",
          photoUrl: null,
          score: 86,
          scoreBreakdown: { title: 25, industry: 25, size: 20, notAvoid: 15, dataQuality: 8 },
          matchDetails: [
            "✓ Exact title match (Head of Sales)",
            "✓ Perfect industry (SaaS)",
            "✓ Ideal company size (165 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 8,
          name: "Amanda Foster",
          title: "VP of Business Development",
          company: "GrowthLabs",
          industry: "Technology",
          employees: 110,
          email: "a.foster@growthlabs.com",
          linkedin: "https://linkedin.com/in/amandafoster",
          phone: null,
          photoUrl: null,
          score: 80,
          scoreBreakdown: { title: 20, industry: 25, size: 20, notAvoid: 15, dataQuality: 5 },
          matchDetails: [
            "✓ Related title match (VP Business Development)",
            "✓ Perfect industry (Technology)",
            "✓ Ideal company size (110 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 9,
          name: "James Rodriguez",
          title: "Director of Sales Operations",
          company: "ScaleUp Software",
          industry: "SaaS",
          employees: 190,
          email: "j.rodriguez@scaleup.io",
          linkedin: "https://linkedin.com/in/jamesrodriguez",
          phone: "+1-555-0567",
          photoUrl: null,
          score: 84,
          scoreBreakdown: { title: 20, industry: 25, size: 20, notAvoid: 15, dataQuality: 8 },
          matchDetails: [
            "✓ Related title match (Director Sales Ops)",
            "✓ Perfect industry (SaaS)",
            "✓ Ideal company size (190 employees)",
            "✓ Not in avoid list"
          ]
        },
        {
          id: 10,
          name: "Nicole Chang",
          title: "VP Sales & Marketing",
          company: "CloudFirst Solutions",
          industry: "SaaS",
          employees: 155,
          email: "n.chang@cloudfirst.com",
          linkedin: "https://linkedin.com/in/nicolechang",
          phone: "+1-555-0890",
          photoUrl: null,
          score: 87,
          scoreBreakdown: { title: 25, industry: 25, size: 20, notAvoid: 15, dataQuality: 8 },
          matchDetails: [
            "✓ Close title match (VP Sales & Marketing)",
            "✓ Perfect industry (SaaS)",
            "✓ Ideal company size (155 employees)",
            "✓ Not in avoid list"
          ]
        }
      ];

      setLeads(mockLeads);
      setActiveTab("leads");

      // TODO: Save leads to Firebase
      // for (const lead of mockLeads) {
      //   await addDoc(collection(db, "leads"), { userId: user.uid, ...lead });
      // }

    } catch (err) {
      console.error("Error generating leads:", err);
      setError(err.message);
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
              <div className="hidden md:flex items-center gap-2 bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                <span className="text-xs font-semibold text-emerald-300">
                  {leads.length} Leads
                </span>
              </div>
            </div>
          </div>
        </div>
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
                  ? "Your ICP is ready. Approve it and launch your lead search!"
                  : `You have ${leads.length} leads ready for action!`}
              </p>
            </div>

            {/* Status Cards */}
            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
                <div className="flex items-center gap-3 mb-3">
                  <CheckCircle className="w-8 h-8 text-green-400" />
                  <h3 className="text-lg font-bold text-white">Scout Complete</h3>
                </div>
                <p className="text-slate-400 text-sm">Questionnaire answered</p>
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
                  {icpApproved ? "✓ Approved" : "⚠ Needs Approval"}
                </p>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
                <div className="flex items-center gap-3 mb-3">
                  <Users className="w-8 h-8 text-cyan-400" />
                  <h3 className="text-lg font-bold text-white">Leads Generated</h3>
                </div>
                <p className="text-3xl font-bold text-cyan-400">{leads.length}</p>
              </div>
            </div>

            {/* Main CTA */}
            {!icpApproved && (
              <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-2 border-yellow-500/30 rounded-2xl p-8 text-center backdrop-blur-sm">
                <div className="text-6xl mb-4">⚠️</div>
                <h3 className="text-2xl font-bold text-white mb-3">Review Your ICP Brief</h3>
                <p className="text-slate-300 mb-6 max-w-2xl mx-auto">
                  Before we generate leads, please review and approve your ICP Brief to ensure we target the right prospects.
                </p>
                <button
                  onClick={() => setActiveTab('icp-brief')}
                  className="bg-gradient-to-r from-yellow-500 to-orange-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:from-yellow-600 hover:to-orange-700 transition-all"
                >
                  Review ICP Brief →
                </button>
              </div>
            )}

            {icpApproved && leads.length === 0 && (
              <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border-2 border-emerald-500/30 rounded-2xl p-10 text-center backdrop-blur-sm">
                <div className="text-7xl mb-6">🚀</div>
                <h3 className="text-3xl font-bold text-white mb-3">Ready to Launch!</h3>
                <p className="text-slate-300 mb-8 text-lg max-w-2xl mx-auto">
                  Your ICP is approved. Barry will now search for companies matching your profile and deliver qualified leads.
                </p>
                <button
                  onClick={handleLaunchLeadSearch}
                  disabled={generatingLeads}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-12 py-5 rounded-xl font-bold text-xl hover:from-emerald-600 hover:to-teal-700 transition-all shadow-lg disabled:opacity-50"
                >
                  {generatingLeads ? "🔄 Generating..." : "🚀 Launch Lead Search"}
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
                "Job Titles": scoutData.jobTitles,
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
              <p className="text-slate-400">Review and approve to launch lead search</p>
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
                  Once approved, Barry will generate leads matching this profile.
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
                <p className="text-slate-300 text-sm mt-2">Ready to launch lead search</p>
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
                  {!icpApproved 
                    ? "Approve your ICP Brief first, then launch the lead search!"
                    : "Click the button below to generate your first batch of leads!"}
                </p>
                {icpApproved && (
                  <button
                    onClick={handleLaunchLeadSearch}
                    disabled={generatingLeads}
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-8 py-4 rounded-xl font-bold hover:from-emerald-600 hover:to-teal-700 transition-all disabled:opacity-50"
                  >
                    {generatingLeads ? "🔄 Generating..." : "🚀 Launch Lead Search"}
                  </button>
                )}
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

        {/* Generating Leads Overlay */}
        {generatingLeads && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="bg-slate-900 border-2 border-purple-500 rounded-2xl p-12 text-center max-w-lg">
              <div className="text-7xl mb-6 animate-bounce">🚀</div>
              <h2 className="text-3xl font-bold text-white mb-3">Launching Lead Search...</h2>
              <p className="text-xl text-purple-300 mb-2">Barry is analyzing your ICP</p>
              <p className="text-slate-400">This takes about 10-15 seconds</p>
              <div className="mt-8 flex justify-center">
                <Loader className="w-12 h-12 text-cyan-400 animate-spin" />
              </div>
            </div>
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