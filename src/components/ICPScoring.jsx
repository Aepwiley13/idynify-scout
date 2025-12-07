import { useState } from "react";

export default function LeadResultsPage() {
  const [minScore, setMinScore] = useState(70);
  const [sortBy, setSortBy] = useState("score");
  const [showModerate, setShowModerate] = useState(true);

  // Mock lead data with scoring
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
      score: 92,
      scoreBreakdown: {
        title: 30,
        industry: 25,
        size: 20,
        notAvoid: 15,
        dataQuality: 8
      },
      matchDetails: [
        "✓ Exact title match (VP Sales)",
        "✓ Perfect industry (SaaS)",
        "✓ Ideal company size (125 employees)",
        "✓ Not in avoid list"
      ]
    },
    {
      id: 2,
      name: "Kevin Doherty",
      title: "Vice President of Sales",
      company: "Park Lawn Corporation",
      industry: "Professional Services",
      employees: 89,
      email: null,
      linkedin: "https://linkedin.com/in/kevindoherty",
      phone: null,
      score: 78,
      scoreBreakdown: {
        title: 30,
        industry: 15,
        size: 20,
        notAvoid: 15,
        dataQuality: 3
      },
      matchDetails: [
        "✓ Close title match (VP Sales)",
        "⚠ Different industry (Professional Services vs SaaS selected)",
        "✓ Good company size (89 employees)",
        "✓ Not in avoid list"
      ]
    },
    {
      id: 3,
      name: "Michael Chen",
      title: "Director of Sales",
      company: "CloudScale Inc",
      industry: "SaaS",
      employees: 180,
      email: "m.chen@cloudscale.io",
      linkedin: "https://linkedin.com/in/michaelchen",
      phone: "+1-555-0456",
      score: 88,
      scoreBreakdown: {
        title: 20,
        industry: 25,
        size: 20,
        notAvoid: 15,
        dataQuality: 8
      },
      matchDetails: [
        "✓ Close title match (Director of Sales)",
        "✓ Perfect industry (SaaS)",
        "✓ Ideal company size (180 employees)",
        "✓ Not in avoid list"
      ]
    },
    {
      id: 4,
      name: "Lisa Martinez",
      title: "Head of Revenue",
      company: "DataStream Analytics",
      industry: "Technology",
      employees: 95,
      email: "lisa.m@datastream.com",
      linkedin: "https://linkedin.com/in/lisamartinez",
      phone: null,
      score: 82,
      scoreBreakdown: {
        title: 20,
        industry: 25,
        size: 20,
        notAvoid: 15,
        dataQuality: 5
      },
      matchDetails: [
        "✓ Related title match (Head of Revenue)",
        "✓ Perfect industry (Technology/SaaS)",
        "✓ Good company size (95 employees)",
        "✓ Not in avoid list"
      ]
    },
    {
      id: 5,
      name: "Robert Kim",
      title: "VP Sales",
      company: "Marketing Pro Agency",
      industry: "Marketing",
      employees: 45,
      email: null,
      linkedin: "https://linkedin.com/in/robertkim",
      phone: null,
      score: 65,
      scoreBreakdown: {
        title: 30,
        industry: 10,
        size: 10,
        notAvoid: 15,
        dataQuality: 3
      },
      matchDetails: [
        "✓ Exact title match (VP Sales)",
        "⚠ Different industry (Marketing vs SaaS selected)",
        "⚠ Smaller than target (45 employees vs 51-200)",
        "✓ Not in avoid list"
      ]
    }
  ];

  const filteredLeads = mockLeads
    .filter(lead => lead.score >= minScore)
    .sort((a, b) => {
      if (sortBy === "score") return b.score - a.score;
      if (sortBy === "size") return b.employees - a.employees;
      if (sortBy === "alpha") return a.name.localeCompare(b.name);
      return 0;
    });

  const excellentLeads = filteredLeads.filter(l => l.score >= 85);
  const goodLeads = filteredLeads.filter(l => l.score >= 70 && l.score < 85);
  const moderateLeads = filteredLeads.filter(l => l.score >= 50 && l.score < 70);

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

  const LeadCard = ({ lead }) => (
    <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-purple-500/30 hover:border-cyan-500/50 transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-2xl font-bold">
            {lead.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-1">{lead.name}</h3>
            <p className="text-purple-300 font-medium">{lead.title}</p>
            <p className="text-gray-400 text-sm">
              🏢 {lead.company} ({lead.industry}, {lead.employees} employees)
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${getScoreColor(lead.score)}`}>
            {getScoreBadge(lead.score)} {lead.score}/100
          </div>
          <p className="text-xs text-gray-400">MATCH SCORE</p>
        </div>
      </div>

      <div className="mb-4 space-y-1">
        {lead.matchDetails.map((detail, i) => (
          <p key={i} className="text-sm text-gray-300">{detail}</p>
        ))}
      </div>

      <div className="flex gap-2 mb-4 text-sm">
        {lead.email && (
          <span className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full">
            📧 {lead.email}
          </span>
        )}
        {!lead.email && (
          <span className="bg-gray-700 text-gray-400 px-3 py-1 rounded-full">
            📧 Email not unlocked
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

      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer hover:text-gray-400">Score Breakdown</summary>
        <div className="mt-2 space-y-1">
          <p>Title Match: {lead.scoreBreakdown.title}/30</p>
          <p>Industry Match: {lead.scoreBreakdown.industry}/25</p>
          <p>Company Size: {lead.scoreBreakdown.size}/20</p>
          <p>Not in Avoid List: {lead.scoreBreakdown.notAvoid}/15</p>
          <p>Data Quality: {lead.scoreBreakdown.dataQuality}/10</p>
        </div>
      </details>

      <div className="flex gap-3 mt-4">
        <button className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:from-cyan-600 hover:to-blue-700 transition-all">
          View Full Profile
        </button>
        <button className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:from-pink-600 hover:to-purple-700 transition-all">
          Add to Campaign
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🎯</div>
          <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-cyan-400">
            BARRY AI FOUND YOUR LEADS!
          </h1>
          <p className="text-purple-300 text-xl mb-4">{mockLeads.length} LEADS DETECTED</p>
          
          <div className="flex justify-center gap-6 text-lg">
            <span className="text-green-400">✓ {excellentLeads.length} Excellent matches</span>
            <span className="text-yellow-400">✓ {goodLeads.length} Good matches</span>
            <span className="text-orange-400">✓ {moderateLeads.length} Moderate matches</span>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-purple-500/30 mb-8">
          <h2 className="text-xl font-bold mb-4 text-cyan-400">LEAD FILTERING SETTINGS</h2>
          
          <div className="grid md:grid-cols-2 gap-6">
            {/* Minimum Score */}
            <div>
              <label className="block text-sm font-semibold mb-2">Minimum Match Score:</label>
              <div className="space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="minScore"
                    checked={minScore === 85}
                    onChange={() => setMinScore(85)}
                    className="w-4 h-4"
                  />
                  <span>85+ only (Excellent matches)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="minScore"
                    checked={minScore === 70}
                    onChange={() => setMinScore(70)}
                    className="w-4 h-4"
                  />
                  <span>70+ (Good and Excellent) ← DEFAULT</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="minScore"
                    checked={minScore === 50}
                    onChange={() => setMinScore(50)}
                    className="w-4 h-4"
                  />
                  <span>50+ (Include moderate matches)</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="minScore"
                    checked={minScore === 0}
                    onChange={() => setMinScore(0)}
                    className="w-4 h-4"
                  />
                  <span>Show all leads (no filter)</span>
                </label>
              </div>
            </div>

            {/* Sort By */}
            <div>
              <label className="block text-sm font-semibold mb-2">Sort by:</label>
              <div className="space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="sortBy"
                    checked={sortBy === "score"}
                    onChange={() => setSortBy("score")}
                    className="w-4 h-4"
                  />
                  <span>Match Score (highest first) ← DEFAULT</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="sortBy"
                    checked={sortBy === "size"}
                    onChange={() => setSortBy("size")}
                    className="w-4 h-4"
                  />
                  <span>Company Size</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer hover:bg-white/5 p-2 rounded">
                  <input
                    type="radio"
                    name="sortBy"
                    checked={sortBy === "alpha"}
                    onChange={() => setSortBy("alpha")}
                    className="w-4 h-4"
                  />
                  <span>Alphabetical</span>
                </label>
              </div>
            </div>
          </div>

          <div className="mt-4 text-sm text-gray-400">
            Showing {filteredLeads.length} of {mockLeads.length} total leads
          </div>
        </div>

        {/* Excellent Matches */}
        {excellentLeads.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-2xl font-bold text-green-400">🟢 EXCELLENT MATCHES (85-100)</h2>
              <span className="text-gray-400">- {excellentLeads.length} leads</span>
            </div>
            <div className="space-y-4">
              {excellentLeads.map(lead => <LeadCard key={lead.id} lead={lead} />)}
            </div>
          </div>
        )}

        {/* Good Matches */}
        {goodLeads.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-2xl font-bold text-yellow-400">🟡 GOOD MATCHES (70-84)</h2>
              <span className="text-gray-400">- {goodLeads.length} leads</span>
            </div>
            <div className="space-y-4">
              {goodLeads.map(lead => <LeadCard key={lead.id} lead={lead} />)}
            </div>
          </div>
        )}

        {/* Moderate Matches */}
        {moderateLeads.length > 0 && minScore <= 50 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-2xl font-bold text-orange-400">🟠 MODERATE MATCHES (50-69)</h2>
              <span className="text-gray-400">- {moderateLeads.length} leads</span>
              <button
                onClick={() => setShowModerate(!showModerate)}
                className="text-sm text-cyan-400 hover:text-cyan-300 underline"
              >
                {showModerate ? "Hide" : "Show"} these matches
              </button>
            </div>
            {showModerate && (
              <div className="space-y-4">
                {moderateLeads.map(lead => <LeadCard key={lead.id} lead={lead} />)}
              </div>
            )}
          </div>
        )}

        {/* Upgrade CTA */}
        <div className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 backdrop-blur-lg rounded-2xl p-8 border border-pink-500/30 text-center">
          <h3 className="text-2xl font-bold mb-4">Want More Advanced Filters?</h3>
          <p className="text-gray-300 mb-6">
            Upgrade to Hunter tier for tech stack filters, funding data, growth signals, and 100-200 leads
          </p>
          <button className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-8 py-3 rounded-full font-bold hover:from-pink-600 hover:to-purple-700 transition-all shadow-lg">
            Upgrade to Hunter ($50)
          </button>
        </div>
      </div>
    </div>
  );
}