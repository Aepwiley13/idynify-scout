import { useState, useEffect } from "react";
import { Sparkles, CheckCircle, XCircle, Target, Users, TrendingUp, Building2, Brain, MessageSquare, Zap, Loader } from "lucide-react";

export default function ICPValidationPage() {
  const [scoutData, setScoutData] = useState(null);
  const [icpBrief, setIcpBrief] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    const fetchScoutData = async () => {
      try {
        // Simulating Firebase fetch - replace with your actual Firebase code
        // const user = auth.currentUser;
        // if (!user) {
        //   navigate("/login");
        //   return;
        // }

        // const userDoc = await getDoc(doc(db, "users", user.uid));
        // if (userDoc.exists()) {
        //   const data = userDoc.data();
        
        // Mock data for demonstration
        const data = {
          scoutData: {
            goal: "Sign 50 new B2B customers in Q1",
            industry: "B2B SaaS in sales intelligence",
            targetIndustry: "SaaS companies, professional services firms",
            companySize: "10-500 employees, $1M-$50M revenue"
          },
          icpBrief: null // Will trigger generation
        };

        if (!data.scoutData) {
          console.log("❌ No scout data");
          // navigate("/scout-questionnaire");
          return;
        }

        setScoutData(data.scoutData);

        // Check if ICP brief already exists
        if (data.icpBrief) {
          console.log("✅ ICP brief already exists");
          setIcpBrief(data.icpBrief);
        } else {
          console.log("⚡ No ICP brief yet, will generate");
          generateICPBrief(data.scoutData);
        }
      } catch (err) {
        console.error("Error fetching scout data:", err);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchScoutData();
  }, []);

  const generateICPBrief = async (dataToUse = null) => {
    setGenerating(true);
    setError(null);

    try {
      const summaryData = dataToUse || scoutData;
      if (!summaryData) throw new Error("No scout data available");

      console.log("🚀 Calling generate-icp-brief with:", summaryData);

      // Replace with your actual API endpoint
      // const response = await fetch("/.netlify/functions/generate-icp-brief", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ scoutData: summaryData }),
      // });

      // Mock API response - simulate delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock ICP Brief data
      const mockBrief = {
        companyName: "Your Company",
        idealCustomerGlance: "Your ideal clients are growth-stage SaaS companies (50-200 employees) led by ambitious founders who see sales intelligence as a strategic advantage, not just a tool. These organizations are scaling rapidly and need efficient ways to identify and reach their target customers without wasting time on unqualified prospects.",
        perfectFitIndicators: [
          "Founder-led or VP of Sales with budget authority",
          "Growing sales team (3-15 reps) struggling with prospecting",
          "High-velocity sales motion (short sales cycles)",
          "Willing to invest $500-2K/month in lead gen tools",
          "Active on LinkedIn, values modern sales tech"
        ],
        antiProfile: [
          "Enterprise companies with 6-month procurement cycles",
          "B2C companies with no B2B sales motion",
          "Startups pre-product market fit (no sales team yet)",
          "Companies satisfied with their current process",
          "Agencies that bill clients for tools (different buying motion)"
        ],
        keyInsight: "After analyzing your questionnaire responses, the companies most likely to buy from you are those experiencing 'prospecting pain'—where their sales team spends 60%+ of time researching leads instead of actually selling. They know this is inefficient but don't have a systematic solution yet.",
        firmographics: {
          companySize: "50-200 employees",
          stage: "Series A-B",
          budget: "$500-2K/month",
          decisionSpeed: "2-4 weeks",
          industries: [
            { name: "SaaS & Technology", fit: "High" },
            { name: "Professional Services", fit: "High" },
            { name: "Marketing Agencies", fit: "Medium" },
            { name: "Financial Services", fit: "Medium" }
          ],
          decisionMakers: [
            { title: "CEO/Founder", role: "Final decision maker", level: "Primary" },
            { title: "VP Sales", role: "Primary champion", level: "Primary" },
            { title: "Head of Revenue", role: "Budget owner", level: "Secondary" }
          ]
        },
        psychographics: {
          painPoints: [
            { pain: "Wasted Time on Prospecting", description: "Sales reps spend 60%+ time finding leads instead of selling", impact: "Critical" },
            { pain: "Low Quality Lead Sources", description: "Current sources yield unqualified leads, low conversion", impact: "High" },
            { pain: "Lack of ICP Clarity", description: "Don't have a clear definition of who to target", impact: "High" },
            { pain: "Slow Pipeline Growth", description: "Can't hit revenue targets with current lead flow", impact: "High" }
          ],
          values: [
            "Efficiency & ROI-focused mindset",
            "Willing to invest in tools that save time",
            "Data-driven decision making",
            "Modern, tech-forward sales approach"
          ]
        },
        behavioralTriggers: [
          { trigger: "Recent Funding Round", timing: "Within 90 days", action: "Reach out about scaling sales operations" },
          { trigger: "Hiring Sales Reps", timing: "Active job posts", action: "Angle: 'Help new reps ramp faster with quality leads'" },
          { trigger: "Posted About Sales Challenges", timing: "Recent LinkedIn activity", action: "Comment + DM with solution" },
          { trigger: "Switched from Competitor", timing: "Last 6 months", action: "Highlight what you do better" }
        ]
      };

      setIcpBrief(mockBrief);

      // Save to Firebase
      console.log("💾 Saving to Firebase");
      // const userRef = doc(db, "users", user.uid);
      // await updateDoc(userRef, {
      //   icpBrief: mockBrief,
      //   icpBriefGeneratedAt: new Date().toISOString()
      // });

      console.log("✅ Successfully saved to Firebase!");

    } catch (err) {
      console.error("💥 Error generating ICP Brief:", err);
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleLaunchSearch = () => {
    console.log("🚀 Launching lead search...");
    // navigate("/lead-results"); or wherever you want to go next
    alert("Lead search launched! Redirecting to results...");
  };

  const showSection = (sectionId) => {
    setActiveSection(sectionId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-16 h-16 text-cyan-400 animate-spin mx-auto mb-4" />
          <div className="text-white text-2xl">Loading your data...</div>
        </div>
      </div>
    );
  }

  if (error && !scoutData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-xl mb-4">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold"
          >
            Try Again
          </button>
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
                <h1 className="text-xl font-bold text-white">Your ICP Brief</h1>
                <p className="text-xs text-slate-400">Generated by Barry AI • Scout Tier</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-2 bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/30">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
                <span className="text-xs font-semibold text-emerald-300">Ready to Launch</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Generating State */}
      {generating && (
        <div className="max-w-4xl mx-auto px-6 py-24">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-12 border border-purple-500/30 text-center">
            <div className="text-7xl mb-6 animate-bounce">🚀</div>
            <h2 className="text-3xl font-bold text-white mb-3">Generating Your ICP Brief...</h2>
            <p className="text-xl text-purple-300 mb-2">Barry AI is analyzing your responses</p>
            <p className="text-slate-400">This takes about 10-15 seconds</p>
            <div className="mt-8 flex justify-center">
              <Loader className="w-12 h-12 text-cyan-400 animate-spin" />
            </div>
          </div>
        </div>
      )}

      {/* ICP Brief Content */}
      {!generating && icpBrief && (
        <>
          {/* Hero */}
          <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white py-12">
            <div className="max-w-7xl mx-auto px-6">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full mb-6">
                  <Sparkles className="w-4 h-4" />
                  <span className="text-sm font-medium">Powered by Barry AI</span>
                </div>
                <h1 className="text-5xl font-bold mb-4">{icpBrief.companyName}</h1>
                <p className="text-xl text-slate-300 mb-6">Ideal Customer Profile Brief</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>Scout Analysis Complete</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>Ready for Lead Search</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Navigation Tabs */}
          <section className="bg-slate-900/50 backdrop-blur-sm border-b border-purple-500/20 sticky top-[73px] z-40">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex overflow-x-auto gap-1 py-2">
                {[
                  { id: 'overview', name: 'Executive Summary' },
                  { id: 'firmographic', name: 'Firmographics' },
                  { id: 'psychographic', name: 'Psychographics' },
                  { id: 'behavioral', name: 'Behavioral Signals' }
                ].map((section) => (
                  <button
                    key={section.id}
                    onClick={() => showSection(section.id)}
                    className={`px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${
                      activeSection === section.id
                        ? 'bg-gradient-to-r from-pink-500 to-cyan-500 text-white'
                        : 'text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {section.name}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Content */}
          <main className="max-w-7xl mx-auto px-6 py-12">
            
            {/* Upgrade Notice */}
            <div className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-white rounded-2xl p-6 mb-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-cyan-500/20 backdrop-blur-sm rounded-xl flex items-center justify-center flex-shrink-0">
                  <Zap className="w-6 h-6 text-cyan-400" />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-lg mb-1">🎯 Scout Tier Analysis Complete!</p>
                  <p className="text-cyan-50 mb-3">This is your foundational ICP brief. Want deeper insights including competitor analysis, messaging frameworks, and channel strategy?</p>
                  <button className="bg-cyan-500 hover:bg-cyan-600 text-white px-6 py-2 rounded-lg font-semibold transition-all">
                    Upgrade to Recon ($25) →
                  </button>
                </div>
              </div>
            </div>

            {/* Executive Summary */}
            {activeSection === 'overview' && (
              <div className="animate-fadeIn">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-white mb-2">Executive Summary</h2>
                  <p className="text-slate-400">Your ideal customer at a glance</p>
                </div>

                <div className="bg-emerald-500/20 border-l-4 border-emerald-500 p-6 rounded-r-xl mb-8 backdrop-blur-sm">
                  <h3 className="text-xl font-bold text-white mb-3">Your Ideal Customer At a Glance</h3>
                  <p className="text-slate-200 leading-relaxed">
                    {icpBrief.idealCustomerGlance}
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-slate-800/50 backdrop-blur-sm border-2 border-green-500/30 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-green-500/20 rounded-xl flex items-center justify-center border border-green-500/30">
                        <CheckCircle className="w-6 h-6 text-green-400" />
                      </div>
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
                      <div className="w-12 h-12 bg-red-500/20 rounded-xl flex items-center justify-center border border-red-500/30">
                        <XCircle className="w-6 h-6 text-red-400" />
                      </div>
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

                <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-purple-500/30 p-8">
                  <h4 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Target className="w-6 h-6 text-yellow-400" />
                    💡 Key Insight
                  </h4>
                  <p className="text-slate-300 leading-relaxed italic">
                    "{icpBrief.keyInsight}"
                  </p>
                </div>
              </div>
            )}

            {/* Firmographic Profile */}
            {activeSection === 'firmographic' && (
              <div className="animate-fadeIn">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-white mb-2">Firmographic Profile</h2>
                  <p className="text-slate-400">Company characteristics and decision-maker intelligence</p>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-6 rounded-2xl shadow-lg">
                    <Users className="w-8 h-8 mb-3 opacity-90" />
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1">Company Size</p>
                    <p className="text-3xl font-bold">{icpBrief.firmographics.companySize.split(' ')[0]}</p>
                    <p className="text-xs opacity-90 mt-1">employees</p>
                  </div>
                  <div className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white p-6 rounded-2xl shadow-lg">
                    <TrendingUp className="w-8 h-8 mb-3 opacity-90" />
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1">Stage</p>
                    <p className="text-2xl font-bold">{icpBrief.firmographics.stage}</p>
                    <p className="text-xs opacity-90 mt-1">funding stage</p>
                  </div>
                  <div className="bg-gradient-to-br from-purple-500 to-pink-600 text-white p-6 rounded-2xl shadow-lg">
                    <Target className="w-8 h-8 mb-3 opacity-90" />
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1">Budget</p>
                    <p className="text-2xl font-bold">{icpBrief.firmographics.budget}</p>
                    <p className="text-xs opacity-90 mt-1">monthly</p>
                  </div>
                  <div className="bg-gradient-to-br from-orange-500 to-red-600 text-white p-6 rounded-2xl shadow-lg">
                    <Zap className="w-8 h-8 mb-3 opacity-90" />
                    <p className="text-xs uppercase tracking-wide opacity-90 mb-1">Decision Speed</p>
                    <p className="text-3xl font-bold">{icpBrief.firmographics.decisionSpeed.split(' ')[0]}</p>
                    <p className="text-xs opacity-90 mt-1">to close</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700 p-6">
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                      <Building2 className="w-6 h-6 text-blue-400" />
                      Primary Industries
                    </h3>
                    <div className="space-y-3">
                      {icpBrief.firmographics.industries.map((industry, i) => (
                        <div key={i} className="flex items-center justify-between py-2 border-b border-slate-700">
                          <span className="text-slate-300">{industry.name}</span>
                          <span className={`text-sm font-semibold ${
                            industry.fit === 'High' ? 'text-blue-400' :
                            industry.fit === 'Medium' ? 'text-green-400' :
                            'text-yellow-400'
                          }`}>{industry.fit} Fit</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700 p-6">
                    <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                      <Users className="w-6 h-6 text-purple-400" />
                      Decision Makers
                    </h3>
                    <div className="space-y-4">
                      {icpBrief.firmographics.decisionMakers.map((dm, i) => (
                        <div key={i} className={`p-4 rounded-lg border ${
                          dm.level === 'Primary' ? 'bg-purple-500/20 border-purple-500/30' : 'bg-blue-500/20 border-blue-500/30'
                        }`}>
                          <p className="font-bold text-white mb-1">{dm.level}: {dm.title}</p>
                          <p className="text-sm text-slate-300">{dm.role}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Psychographic Profile */}
            {activeSection === 'psychographic' && (
              <div className="animate-fadeIn">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-white mb-2">Psychographic Profile</h2>
                  <p className="text-slate-400">Mindset, values, and pain points</p>
                </div>

                <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border-2 border-purple-500/30 rounded-2xl p-8 mb-8 backdrop-blur-sm">
                  <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                    <Brain className="w-8 h-8 text-purple-400" />
                    Top Pain Points
                  </h3>
                  <div className="space-y-4">
                    {icpBrief.psychographics.painPoints.map((item, i) => (
                      <div key={i} className="bg-slate-900/50 rounded-xl p-5 border border-slate-700">
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-2xl flex-shrink-0 ${
                            item.impact === 'Critical' ? 'bg-red-500/20 text-red-400' :
                            'bg-orange-500/20 text-orange-400'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-lg font-bold text-white">{item.pain}</h4>
                              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                                item.impact === 'Critical' ? 'bg-red-500/20 text-red-400' :
                                'bg-orange-500/20 text-orange-400'
                              }`}>
                                {item.impact}
                              </span>
                            </div>
                            <p className="text-slate-300 text-sm">{item.description}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700 p-6">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <MessageSquare className="w-6 h-6 text-pink-400" />
                    Core Values & Beliefs
                  </h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {icpBrief.psychographics.values.map((value, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-pink-500/10 rounded-lg border border-pink-500/20">
                        <CheckCircle className="w-5 h-5 text-pink-400 mt-0.5 flex-shrink-0" />
                        <span className="text-slate-300">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Behavioral Indicators */}
            {activeSection === 'behavioral' && (
              <div className="animate-fadeIn">
                <div className="mb-8">
                  <h2 className="text-3xl font-bold text-white mb-2">Behavioral Indicators</h2>
                  <p className="text-slate-400">Hot buying triggers and timing signals</p>
                </div>

                <div className="bg-gradient-to-r from-red-500/20 to-orange-500/20 border-2 border-red-500/30 rounded-2xl p-8 backdrop-blur-sm">
                  <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                    <Zap className="w-8 h-8 text-red-400" />
                    🔥 Hot Buying Triggers
                  </h3>
                  <div className="grid md:grid-cols-2 gap-6">
                    {icpBrief.behavioralTriggers.map((item, i) => (
                      <div key={i} className="bg-slate-900/50 rounded-xl p-5 border border-red-500/30">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Zap className="w-6 h-6 text-red-400" />
                          </div>
                          <div>
                            <h4 className="font-bold text-white text-lg">{item.trigger}</h4>
                            <p className="text-sm text-red-400 font-semibold">{item.timing}</p>
                          </div>
                        </div>
                        <div className="text-sm">
                          <p className="text-slate-300 bg-red-500/10 p-3 rounded border border-red-500/20">
                            <strong className="text-white">Action:</strong> {item.action}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* CTA Section */}
            <div className="mt-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-10 text-white text-center shadow-2xl">
              <div className="text-6xl mb-6">🚀</div>
              <h3 className="text-3xl font-bold mb-3">Ready to Find Your Leads?</h3>
              <p className="text-emerald-100 mb-8 text-lg max-w-2xl mx-auto">
                Your ICP is ready. Now let Barry search for companies that match this profile and deliver qualified leads to your inbox.
              </p>
              
              <div className="space-y-4 max-w-xl mx-auto">
                <button 
                  onClick={handleLaunchSearch}
                  className="w-full bg-white hover:bg-slate-50 text-slate-900 font-bold py-4 px-8 rounded-xl transition-all shadow-lg hover:shadow-xl text-lg">
                  Launch Lead Search →
                </button>
                <button className="w-full bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white font-semibold py-3 px-8 rounded-xl border-2 border-white/30 transition-all">
                  Upgrade to Recon for Full ICP ($25)
                </button>
              </div>

              <p className="text-sm text-emerald-100 mt-8">
                First batch of leads delivered within 48 hours
              </p>
            </div>

          </main>
        </>
      )}

      {/* Error State with Retry */}
      {error && !generating && (
        <div className="max-w-4xl mx-auto px-6 py-24">
          <div className="bg-red-500/20 border-2 border-red-500 rounded-2xl p-8 text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-white mb-3">Oops! Something went wrong</h2>
            <p className="text-red-300 mb-6">{error}</p>
            <button
              onClick={() => generateICPBrief()}
              className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-lg font-semibold transition-all"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Debug Panel */}
      {scoutData && (
        <div className="max-w-7xl mx-auto px-6 pb-8">
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-400 font-mono">
              Debug: View Scout Data
            </summary>
            <pre className="mt-2 bg-slate-950/50 p-4 rounded overflow-auto text-slate-400 border border-slate-800">
              {JSON.stringify(scoutData, null, 2)}
            </pre>
          </details>
        </div>
      )}

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