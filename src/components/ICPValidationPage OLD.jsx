import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";

export default function ICPValidationPage() {
  const navigate = useNavigate();
  const [scoutData, setScoutData] = useState(null);
  const [executiveSummary, setExecutiveSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchScoutData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          navigate("/login");
          return;
        }

        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          console.log("📦 User data loaded:", data);
          
          if (!data.scoutData) {
            console.log("❌ No scout data, redirecting to questionnaire");
            navigate("/scout-questionnaire");
            return;
          }

          setScoutData(data.scoutData);

          // Check if executive summary already exists
          if (data.executiveSummary) {
            console.log("✅ Executive summary already exists");
            setExecutiveSummary(data.executiveSummary);
          } else {
            console.log("⚡ No executive summary yet, will generate");
            // Auto-generate on mount if not exists
            generateExecutiveSummary(data.scoutData, user.uid);
          }
        }
      } catch (err) {
        console.error("Error fetching scout data:", err);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchScoutData();
  }, [navigate]);

  const generateExecutiveSummary = async (dataToUse = null, userId = null) => {
    setGenerating(true);
    setError(null);

    try {
      const user = userId || auth.currentUser?.uid;
      if (!user) throw new Error("Not authenticated");

      const summaryData = dataToUse || scoutData;
      if (!summaryData) throw new Error("No scout data available");

      console.log("🚀 Calling generate-executive-summary with:", summaryData);

      const response = await fetch("/.netlify/functions/generate-executive-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scoutData: summaryData,
        }),
      });

      console.log("📡 Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Response error:", errorText);
        throw new Error(`Failed to generate summary: ${response.status}`);
      }

      const data = await response.json();
      console.log("✅ Received response:", data);

      if (!data.executiveSummary) {
        console.error("❌ No executiveSummary in response:", data);
        throw new Error("Invalid response format - no executiveSummary field");
      }

      const summary = data.executiveSummary;
      console.log("✅ Executive summary parsed:", summary);

      // Validate required fields
      const requiredFields = ['idealCustomerGlance', 'perfectFitIndicators', 'antiProfile', 'keyInsight'];
      for (const field of requiredFields) {
        if (!summary[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      setExecutiveSummary(summary);

      // Save to Firebase
      console.log("💾 Saving to Firebase for user:", user);
      const userRef = doc(db, "users", user);
      await updateDoc(userRef, {
        executiveSummary: summary,
        executiveSummaryGeneratedAt: new Date().toISOString()
      });

      console.log("✅ Successfully saved to Firebase!");

    } catch (err) {
      console.error("💥 Error generating Executive Summary:", err);
      setError(err.message);
      alert(`❌ Error: ${err.message}\n\nCheck the console for details.`);
    } finally {
      setGenerating(false);
    }
  };

  const handleContinue = () => {
    navigate("/launch-sequence");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black flex items-center justify-center">
        <div className="text-white text-2xl animate-pulse">Loading your data...</div>
      </div>
    );
  }

  if (error && !scoutData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black flex items-center justify-center">
        <div className="text-red-400 text-xl">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="text-6xl mb-4">🎯</div>
          <h1 className="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-pink-400 to-cyan-400">
            Your ICP Executive Summary
          </h1>
          <p className="text-purple-300 text-lg">
            Barry AI has analyzed your responses
          </p>
        </div>

        {/* Generating State */}
        {generating && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 mb-8 border border-purple-500/30 text-center">
            <div className="animate-spin text-6xl mb-4">🚀</div>
            <p className="text-xl text-purple-300">Generating your executive summary...</p>
            <p className="text-gray-400 mt-2">This takes about 10-15 seconds</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 mb-8">
            <p className="text-red-300">{error}</p>
            <button
              onClick={() => generateExecutiveSummary()}
              className="mt-4 bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Executive Summary Display */}
        {executiveSummary && (
          <div className="space-y-6 mb-8">
            {/* Ideal Customer Glance */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-purple-500/30">
              <h2 className="text-2xl font-bold mb-4 text-pink-400">At a Glance</h2>
              <p className="text-gray-300 text-lg leading-relaxed">
                {executiveSummary.idealCustomerGlance}
              </p>
            </div>

            {/* Perfect Fit Indicators */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-purple-500/30">
              <h2 className="text-2xl font-bold mb-4 text-cyan-400">Perfect Fit Indicators</h2>
              <ul className="space-y-3">
                {executiveSummary.perfectFitIndicators?.map((indicator, i) => (
                  <li key={i} className="flex items-start">
                    <span className="text-green-400 mr-3 text-xl">✓</span>
                    <span className="text-gray-300">{indicator}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Anti-Profile */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-purple-500/30">
              <h2 className="text-2xl font-bold mb-4 text-red-400">Anti-Profile (Avoid)</h2>
              <ul className="space-y-3">
                {executiveSummary.antiProfile?.map((item, i) => (
                  <li key={i} className="flex items-start">
                    <span className="text-red-400 mr-3 text-xl">✗</span>
                    <span className="text-gray-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Key Insight */}
            <div className="bg-gradient-to-r from-pink-500/20 to-purple-500/20 backdrop-blur-lg rounded-2xl p-6 border border-pink-500/30">
              <h2 className="text-2xl font-bold mb-4 text-yellow-400">💡 Key Insight</h2>
              <p className="text-gray-300 text-lg italic leading-relaxed">
                "{executiveSummary.keyInsight}"
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-center gap-4">
          {!executiveSummary && !generating && (
            <button
              onClick={() => generateExecutiveSummary()}
              className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-8 py-4 rounded-full text-xl font-bold hover:from-pink-600 hover:to-purple-700 transition-all shadow-lg hover:shadow-pink-500/50"
            >
              Generate Executive Summary
            </button>
          )}

          {executiveSummary && !generating && (
            <button
              onClick={handleContinue}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-4 rounded-full text-xl font-bold hover:from-cyan-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-cyan-500/50"
            >
              Continue to Launch Sequence →
            </button>
          )}
        </div>

        {/* Scout Data Preview (Debug) */}
        {scoutData && (
          <details className="mt-8 text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-400">
              Debug: View Scout Data
            </summary>
            <pre className="mt-2 bg-black/50 p-4 rounded overflow-auto text-gray-400">
              {JSON.stringify(scoutData, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}