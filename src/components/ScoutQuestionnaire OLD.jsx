import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, setDoc, getDoc } from "firebase/firestore";

export default function ScoutQuestionnaire() {
  const navigate = useNavigate();
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState({
    primaryGoal: "",
    companyName: "",
    companyWebsite: "",
    industry: "",
    targetIndustry: "",
    companySize: "",
    painPoints: "",
    valueProposition: "",
    linkedinProfile: ""
  });

  const questions = [
    {
      id: "primaryGoal",
      question: "What's your primary goal right now?",
      placeholder: "Example: Sign 50 new B2B customers in Q1, validate our ICP for Series A, hit $1M ARR...",
      type: "textarea"
    },
    {
      id: "companyName",
      question: "What's your company name?",
      placeholder: "Acme Corp",
      type: "text"
    },
    {
      id: "companyWebsite",
      question: "What's your company website?",
      placeholder: "https://www.acmecorp.com",
      type: "text"
    },
    {
      id: "industry",
      question: "What industry are YOU in?",
      placeholder: "Example: B2B SaaS in sales intelligence, Healthcare IT consulting, Real estate technology...",
      type: "textarea"
    },
    {
      id: "targetIndustry",
      question: "What industries do you TARGET?",
      placeholder: "Example: We sell to SaaS companies, professional services firms, and agencies. Anyone doing B2B sales...",
      type: "textarea"
    },
    {
      id: "companySize",
      question: "What size companies do you target?",
      placeholder: "Example: 10-500 employees, $1M-$50M revenue, post-seed startups scaling sales...",
      type: "textarea"
    },
    {
      id: "painPoints",
      question: "What pain points do your customers have?",
      placeholder: "Example: Sales teams spend 60% of time prospecting instead of selling. They can't find qualified leads...",
      type: "textarea"
    },
    {
      id: "valueProposition",
      question: "How do you solve their problems? (Your value prop)",
      placeholder: "Example: We identify your ICP in 5 minutes and deliver 30 qualified leads daily. Save 10+ hours/week on prospecting...",
      type: "textarea"
    },
    {
      id: "linkedinProfile",
      question: "Your LinkedIn profile (optional)",
      placeholder: "https://linkedin.com/in/yourprofile",
      type: "text"
    }
  ];

  // Load existing answers on mount
  useEffect(() => {
    const loadExistingAnswers = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists() && userDoc.data().scoutData) {
          const existingData = userDoc.data().scoutData;
          setAnswers({
            primaryGoal: existingData.goal || "",
            companyName: existingData.company || "",
            companyWebsite: existingData.website || "",
            industry: existingData.industry || "",
            targetIndustry: existingData.targetIndustry || "",
            companySize: existingData.companySize || "",
            painPoints: existingData.painPoints || "",
            valueProposition: existingData.valueProposition || "",
            linkedinProfile: existingData.linkedinUrl || ""
          });
        }
      } catch (err) {
        console.error("Error loading existing answers:", err);
      }
    };

    loadExistingAnswers();
  }, []);

  const handleInputChange = (field, value) => {
    setAnswers(prev => ({ ...prev, [field]: value }));
  };

  const handleNext = () => {
    // Check if current question is answered
    const currentField = questions[currentQuestion].id;
    if (!answers[currentField] || answers[currentField].trim() === "") {
      alert("Please answer this question before continuing");
      return;
    }

    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleSubmit = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        alert("Please log in");
        navigate("/login");
        return;
      }

      // Save to Firebase
      const userRef = doc(db, "users", user.uid);
      const scoutData = {
        goal: answers.primaryGoal,
        company: answers.companyName,
        website: answers.companyWebsite,
        industry: answers.industry,
        targetIndustry: answers.targetIndustry,
        companySize: answers.companySize,
        painPoints: answers.painPoints,
        valueProposition: answers.valueProposition,
        linkedinUrl: answers.linkedinProfile
      };

      await setDoc(userRef, {
        scoutData: scoutData,
        scoutCompleted: true,
        scoutCompletedAt: new Date().toISOString(),
        tier: "scout"
      }, { merge: true });

      console.log("✅ Scout data saved!");

      // Navigate to ICP Validation page
      navigate("/icp-validation");
    } catch (err) {
      console.error("Error saving scout data:", err);
      alert("Failed to save. Please try again.");
    }
  };

  const progress = ((currentQuestion + 1) / questions.length) * 100;
  const currentQ = questions[currentQuestion];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black text-white p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🐻</div>
          <h1 className="text-4xl font-bold mb-2">Scout Mission Briefing</h1>
          <p className="text-purple-300">Barry needs intel on your target customers</p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>Question {currentQuestion + 1} of {questions.length}</span>
            <span>{Math.round(progress)}% Complete</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-pink-500 to-cyan-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {/* Question Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 mb-8 border border-purple-500/30">
          <h2 className="text-2xl font-bold mb-6 text-cyan-400">
            {currentQ.question}
          </h2>

          {currentQ.type === "textarea" ? (
            <textarea
              value={answers[currentQ.id]}
              onChange={(e) => handleInputChange(currentQ.id, e.target.value)}
              placeholder={currentQ.placeholder}
              className="w-full bg-black/30 border border-purple-500/50 rounded-lg p-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 h-32 resize-none"
            />
          ) : (
            <input
              type="text"
              value={answers[currentQ.id]}
              onChange={(e) => handleInputChange(currentQ.id, e.target.value)}
              placeholder={currentQ.placeholder}
              className="w-full bg-black/30 border border-purple-500/50 rounded-lg p-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          )}

          <p className="text-gray-400 text-sm mt-2">
            💡 Tip: Be specific! Better answers = better leads
          </p>
        </div>

        {/* Navigation Buttons */}
        <div className="flex justify-between">
          <button
            onClick={handleBack}
            disabled={currentQuestion === 0}
            className="px-6 py-3 rounded-full bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            ← Back
          </button>

          <button
            onClick={handleNext}
            className="px-8 py-3 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 font-bold transition-all shadow-lg hover:shadow-pink-500/50"
          >
            {currentQuestion === questions.length - 1 ? "Launch Mission 🚀" : "Next →"}
          </button>
        </div>

        {/* Skip to Dashboard (for testing) */}
        <div className="text-center mt-8">
          <button
            onClick={() => navigate("/dashboard-v2")}
            className="text-gray-500 hover:text-gray-400 text-sm underline"
          >
            Skip to Dashboard (for testing)
          </button>
        </div>
      </div>
    </div>
  );
}