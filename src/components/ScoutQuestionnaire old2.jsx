import { useState } from "react";

export default function ImprovedScoutQuestionnaire() {
  const [currentSection, setCurrentSection] = useState(1);
  const [answers, setAnswers] = useState({
    goal: "",
    companyWebsite: "",
    linkedinCompanyPage: "",
    industries: [],
    jobTitles: "",
    companySizes: [],
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
      if (!answers.jobTitles.trim()) {
        alert("Please enter job titles you want to reach");
        return false;
      }
      if (answers.companySizes.length === 0) {
        alert("Please select at least one company size");
        return false;
      }
    } else if (currentSection === 3) {
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
    
    if (currentSection < 3) {
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

  const handleSubmit = () => {
    console.log("🚀 Launching mission with data:", answers);
    alert("Mission launched! Barry is analyzing your ICP...");
  };

  const progress = (currentSection / 3) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-900">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header Card */}
        <div className="bg-indigo-800 rounded-3xl p-8 mb-8 text-center border-2 border-indigo-600">
          <div className="text-7xl mb-4">🐻</div>
          <h1 className="text-4xl font-bold text-white mb-3">Scout Mission Briefing</h1>
          <p className="text-indigo-200 text-lg">Barry needs intel on your target customers</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-indigo-200 mb-2">
            <span>Section {currentSection} of 3</span>
            <span>{Math.round(progress)}% Complete</span>
          </div>
          <div className="w-full bg-indigo-950 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-pink-500 to-cyan-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {/* Section Indicator */}
        <div className="mb-8 flex justify-center gap-4">
          <div className={`px-4 py-2 rounded-full font-semibold ${currentSection === 1 ? 'bg-pink-500 text-white' : 'bg-indigo-800 text-indigo-300'}`}>
            Your Mission
          </div>
          <div className={`px-4 py-2 rounded-full font-semibold ${currentSection === 2 ? 'bg-pink-500 text-white' : 'bg-indigo-800 text-indigo-300'}`}>
            Target Audience
          </div>
          <div className={`px-4 py-2 rounded-full font-semibold ${currentSection === 3 ? 'bg-pink-500 text-white' : 'bg-indigo-800 text-indigo-300'}`}>
            Refine Target
          </div>
        </div>

        {/* SECTION 1: YOUR MISSION */}
        {currentSection === 1 && (
          <div className="space-y-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border-2 border-indigo-500/30">
              <h2 className="text-2xl font-bold mb-6 text-cyan-400">
                SECTION 1: YOUR MISSION
              </h2>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q1: What's your goal for the next 90 days? *
                </label>
                <p className="text-sm text-indigo-200 mb-3">
                  Example: "Sign 50 new customers" or "Book 20 demos"
                </p>
                <input
                  type="text"
                  value={answers.goal}
                  onChange={(e) => handleInputChange('goal', e.target.value)}
                  placeholder="Enter your 90-day goal"
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q2: Your company website (Barry will analyze it)
                </label>
                <p className="text-sm text-indigo-200 mb-3">Optional</p>
                <input
                  type="url"
                  value={answers.companyWebsite}
                  onChange={(e) => handleInputChange('companyWebsite', e.target.value)}
                  placeholder="https://www.yourcompany.com"
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q3: Your LinkedIn company page (Barry will check it out)
                </label>
                <p className="text-sm text-indigo-200 mb-3">Optional</p>
                <input
                  type="url"
                  value={answers.linkedinCompanyPage}
                  onChange={(e) => handleInputChange('linkedinCompanyPage', e.target.value)}
                  placeholder="https://linkedin.com/company/yourcompany"
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* SECTION 2: WHO YOU'RE TARGETING */}
        {currentSection === 2 && (
          <div className="space-y-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border-2 border-indigo-500/30">
              <h2 className="text-2xl font-bold mb-6 text-cyan-400">
                SECTION 2: WHO YOU'RE TARGETING
              </h2>

              <div className="mb-8">
                <label className="block text-lg font-semibold mb-3 text-white">
                  Q4: What industries? (Select all that apply) *
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {industryOptions.map((industry) => (
                    <label key={industry} className="flex items-center space-x-3 cursor-pointer hover:bg-white/5 p-3 rounded-lg">
                      <input
                        type="checkbox"
                        checked={answers.industries.includes(industry)}
                        onChange={() => handleCheckbox('industries', industry)}
                        className="w-5 h-5 rounded border-indigo-500"
                      />
                      <span className="text-white">{industry}</span>
                    </label>
                  ))}
                  <div className="flex items-center space-x-3 p-3">
                    <input
                      type="checkbox"
                      checked={answers.industries.includes('Other')}
                      onChange={() => handleCheckbox('industries', 'Other')}
                      className="w-5 h-5 rounded border-indigo-500"
                    />
                    <input
                      type="text"
                      value={otherIndustry}
                      onChange={(e) => setOtherIndustry(e.target.value)}
                      placeholder="Other: specify..."
                      className="flex-1 bg-indigo-950/50 border-2 border-indigo-500/50 rounded p-2 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                  </div>
                </div>
              </div>

              <div className="mb-8">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q5: Who do you need to reach? List any titles, separated by commas *
                </label>
                <p className="text-sm text-indigo-200 mb-3">
                  Examples: "Head of Engineering, VP Engineering, Director Engineering" or "CEO, Founder, President, Owner"
                </p>
                <textarea
                  value={answers.jobTitles}
                  onChange={(e) => handleInputChange('jobTitles', e.target.value)}
                  placeholder="Enter job titles separated by commas"
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-24 resize-none"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-3 text-white">
                  Q6: What company sizes? *
                </label>
                <div className="space-y-2">
                  {companySizeOptions.map((size) => (
                    <label key={size} className="flex items-center space-x-3 cursor-pointer hover:bg-white/5 p-3 rounded-lg">
                      <input
                        type="checkbox"
                        checked={answers.companySizes.includes(size)}
                        onChange={() => handleCheckbox('companySizes', size)}
                        className="w-5 h-5 rounded border-indigo-500"
                      />
                      <span className="text-white">{size}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: REFINE YOUR TARGET */}
        {currentSection === 3 && (
          <div className="space-y-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border-2 border-indigo-500/30">
              <h2 className="text-2xl font-bold mb-6 text-cyan-400">
                SECTION 3: REFINE YOUR TARGET
              </h2>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q7: Who are your competitors?
                </label>
                <p className="text-sm text-indigo-200 mb-3">
                  Helps us find similar buyers. Examples: "HubSpot, Salesforce" or "We're like Zoom but for sales"
                </p>
                <input
                  type="text"
                  value={answers.competitors}
                  onChange={(e) => handleInputChange('competitors', e.target.value)}
                  placeholder="Enter competitor names"
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q8: Name 2-3 perfect fit companies *
                </label>
                <p className="text-sm text-indigo-200 mb-3">
                  Your dream customers (names or types)
                </p>
                <textarea
                  value={answers.perfectFitCompanies}
                  onChange={(e) => handleInputChange('perfectFitCompanies', e.target.value)}
                  placeholder="e.g., Acme Corp, TechFlow Inc, or 'Fast-growing SaaS companies with 50-200 employees'"
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-24 resize-none"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q9: Who should you AVOID?
                </label>
                <p className="text-sm text-indigo-200 mb-3">
                  What types are bad fits? Example: "Large enterprises with 6-month procurement, B2C companies"
                </p>
                <textarea
                  value={answers.avoidList}
                  onChange={(e) => handleInputChange('avoidList', e.target.value)}
                  placeholder="Enter company types to avoid"
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-24 resize-none"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q10: What pain points do they have? *
                </label>
                <p className="text-sm text-indigo-200 mb-3">
                  Problems they face BEFORE buying from you
                </p>
                <textarea
                  value={answers.painPoints}
                  onChange={(e) => handleInputChange('painPoints', e.target.value)}
                  placeholder="e.g., Sales teams spend 60% of time prospecting instead of selling. They can't find qualified leads..."
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-32 resize-none"
                />
              </div>

              <div className="mb-6">
                <label className="block text-lg font-semibold mb-2 text-white">
                  Q11: How do you solve it? *
                </label>
                <p className="text-sm text-indigo-200 mb-3">
                  Your value proposition in one sentence
                </p>
                <textarea
                  value={answers.valueProposition}
                  onChange={(e) => handleInputChange('valueProposition', e.target.value)}
                  placeholder="e.g., We identify your ICP in 5 minutes and deliver 30 qualified leads daily. Save 10+ hours/week on prospecting..."
                  className="w-full bg-indigo-950/50 border-2 border-indigo-500/50 rounded-lg p-4 text-white placeholder-indigo-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-32 resize-none"
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
            className="px-6 py-3 rounded-full bg-indigo-700 hover:bg-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-white font-semibold"
          >
            ← Back
          </button>

          <button
            onClick={handleNext}
            className="px-8 py-3 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 font-bold transition-all shadow-lg hover:shadow-pink-500/50 text-white"
          >
            {currentSection === 3 ? "🚀 LAUNCH MISSION" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}