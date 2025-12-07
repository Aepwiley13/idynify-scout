import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";

export default function ICPValidationPage() {
  const navigate = useNavigate();
  const [scoutData, setScoutData] = useState(null);
  const [icpBrief, setIcpBrief] = useState(null);
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

          // Check if ICP Brief already exists
          if (data.icpBrief) {
            console.log("✅ ICP Brief already exists");
            setIcpBrief(data.icpBrief);
          } else {
            console.log("⚡ No ICP Brief yet, will generate");
            // Auto-generate on mount if not exists
            generateICPBrief(data.scoutData, user.uid);
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

  const generateICPBrief = async (dataToUse = null, userId = null) => {
    setGenerating(true);
    setError(null);

    try {
      const user = userId || auth.currentUser?.uid;
      if (!user) throw new Error("Not authenticated");

      const summaryData = dataToUse || scoutData;
      if (!summaryData) throw new Error("No scout data available");

      console.log("🚀 Calling generate-icp-brief with:", summaryData);

      const response = await fetch("/.netlify/functions/generate-icp-brief", {
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
        throw new Error(`Failed to generate ICP Brief: ${response.status}`);
      }

      const data = await response.json();
      console.log("✅ Received response:", data);

      if (!data.icpBrief) {
        console.error("❌ No icpBrief in response:", data);
        throw new Error("Invalid response format - no icpBrief field");
      }

      const brief = data.icpBrief;
      console.log("✅ ICP Brief parsed:", brief);

      setIcpBrief(brief);

      // Save to Firebase
      console.log("💾 Saving to Firebase for user:", user);
      const userRef = doc(db, "users", user);
      await updateDoc(userRef, {
        icpBrief: brief,
        icpBriefGeneratedAt: new Date().toISOString()
      });

      console.log("✅ Successfully saved to Firebase!");

    } catch (err) {
      console.error("💥 Error generating ICP Brief:", err);
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to log out?")) {
      try {
        await signOut(auth);
        navigate("/login");
      } catch (error) {
        console.error("Error logging out:", error);
      }
    }
  };

  const handleContinue = async () => {
    try {
      const user = auth.currentUser;
      if (user) {
        await updateDoc(doc(db, "users", user.uid), {
          icpApproved: true,
          icpApprovedAt: new Date().toISOString()
        });
      }
      navigate("/launch-sequence");
    } catch (err) {
      console.error("Error approving ICP:", err);
      alert("Error saving approval. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center">
        {/* Starfield */}
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
        <div className="relative z-10 text-cyan-400 text-2xl font-mono animate-pulse">
          [LOADING MISSION DATA...]
        </div>
      </div>
    );
  }

  if (error && !scoutData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-red-400 text-xl font-mono">[ERROR: {error}]</div>
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
        {['[ICP:ANALYSIS]', '[BARRY:PROCESSING]', '[PROFILE:LOCKED]', '[LEADS:READY]', '[TARGET:ACQUIRED]', '[MISSION:GO]'].map((code, i) => (
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
          <span>ICP ANALYSIS</span>
        </div>
        <div>{generating ? 'STATUS: PROCESSING' : 'STATUS: READY'}</div>
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
      <div className="relative z-10 p-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="text-7xl mb-4" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
            <h1 className="text-5xl font-bold bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
              Barry's ICP Analysis
            </h1>
            <p className="text-gray-300 text-lg font-mono">
              [IDEAL CUSTOMER PROFILE • MISSION BRIEF]
            </p>
          </div>

          {/* Generating State */}
          {generating && (
            <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-12 mb-8 border border-cyan-500/30 text-center">
              <div className="text-8xl mb-6" style={{ animation: 'floatBear 6s ease-in-out infinite' }}>🐻</div>
              <h2 className="text-3xl font-bold text-cyan-300 mb-4 font-mono">
                [ANALYZING YOUR IDEAL CUSTOMER...]
              </h2>
              <p className="text-gray-400 mb-6 font-mono">Processing intelligence data...</p>
              <div className="flex justify-center">
                <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
              </div>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-500/10 border-2 border-red-500/50 rounded-xl p-6 mb-8">
              <p className="text-red-300 text-lg mb-4 font-mono">⚠️ [ERROR: {error}]</p>
              <button
                onClick={() => generateICPBrief()}
                className="bg-red-600 hover:bg-red-700 px-6 py-3 rounded-lg transition-all font-mono"
              >
                → RETRY GENERATION
              </button>
            </div>
          )}

          {/* ICP Brief Display */}
          {icpBrief && !generating && (
            <div className="space-y-6 mb-8">
              {/* Company Name & At a Glance */}
              <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-cyan-500/30">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-4xl">🎯</span>
                  <h2 className="text-3xl font-bold text-cyan-400 font-mono">
                    {icpBrief.companyName || "YOUR COMPANY"}
                  </h2>
                </div>
                <p className="text-gray-300 text-lg leading-relaxed">
                  {icpBrief.idealCustomerGlance}
                </p>
              </div>

              {/* Perfect Fit Indicators */}
              <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-green-500/30">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-3xl">✓</span>
                  <h2 className="text-2xl font-bold text-green-400 font-mono">
                    [PERFECT FIT INDICATORS]
                  </h2>
                </div>
                <ul className="space-y-4">
                  {icpBrief.perfectFitIndicators?.map((indicator, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="text-green-400 text-xl mt-1">▸</span>
                      <span className="text-gray-300 text-lg">{indicator}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Anti-Profile */}
              <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-red-500/30">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-3xl">✗</span>
                  <h2 className="text-2xl font-bold text-red-400 font-mono">
                    [ANTI-PROFILE • AVOID]
                  </h2>
                </div>
                <ul className="space-y-4">
                  {icpBrief.antiProfile?.map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="text-red-400 text-xl mt-1">▸</span>
                      <span className="text-gray-300 text-lg">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Key Insight */}
              {icpBrief.keyInsight && (
                <div className="bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-cyan-500/20 backdrop-blur-xl rounded-2xl p-8 border-2 border-yellow-500/30">
                  <div className="flex items-center gap-3 mb-6">
                    <span className="text-4xl">💡</span>
                    <h2 className="text-2xl font-bold text-yellow-400 font-mono">
                      [KEY INSIGHT]
                    </h2>
                  </div>
                  <p className="text-gray-300 text-xl italic leading-relaxed">
                    "{icpBrief.keyInsight}"
                  </p>
                </div>
              )}

              {/* Target Details */}
              {(icpBrief.targetIndustries || icpBrief.targetJobTitles || icpBrief.targetCompanySizes) && (
                <div className="bg-black/60 backdrop-blur-xl rounded-2xl p-8 border border-purple-500/30">
                  <div className="flex items-center gap-3 mb-6">
                    <span className="text-3xl">📊</span>
                    <h2 className="text-2xl font-bold text-purple-400 font-mono">
                      [TARGET PARAMETERS]
                    </h2>
                  </div>
                  
                  <div className="space-y-6">
                    {icpBrief.targetIndustries && (
                      <div>
                        <h3 className="text-cyan-400 font-semibold mb-2 font-mono">Industries:</h3>
                        <p className="text-gray-300">{icpBrief.targetIndustries}</p>
                      </div>
                    )}
                    
                    {icpBrief.targetJobTitles && (
                      <div>
                        <h3 className="text-cyan-400 font-semibold mb-2 font-mono">Decision Makers:</h3>
                        <p className="text-gray-300">{icpBrief.targetJobTitles}</p>
                      </div>
                    )}
                    
                    {icpBrief.targetCompanySizes && (
                      <div>
                        <h3 className="text-cyan-400 font-semibold mb-2 font-mono">Company Sizes:</h3>
                        <p className="text-gray-300">{icpBrief.targetCompanySizes}</p>
                      </div>
                    )}

                    {icpBrief.targetLocations && (
                      <div>
                        <h3 className="text-cyan-400 font-semibold mb-2 font-mono">Locations:</h3>
                        <p className="text-gray-300">{icpBrief.targetLocations}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-center gap-4">
            {!icpBrief && !generating && (
              <button
                onClick={() => generateICPBrief()}
                className="px-8 py-4 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold text-xl transition-all shadow-2xl shadow-pink-500/50 font-mono"
              >
                → GENERATE ICP BRIEF
              </button>
            )}

            {icpBrief && !generating && (
              <button
                onClick={handleContinue}
                className="px-8 py-4 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold text-xl transition-all shadow-2xl shadow-cyan-500/50 font-mono group"
              >
                <span className="inline-flex items-center gap-2">
                  🚀 CONTINUE TO LAUNCH
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </span>
              </button>
            )}
          </div>

          {/* Scout Data Preview (Debug) */}
          {scoutData && (
            <details className="mt-12 text-xs">
              <summary className="cursor-pointer text-cyan-500/50 hover:text-cyan-400 font-mono">
                [DEBUG: VIEW RAW SCOUT DATA]
              </summary>
              <pre className="mt-4 bg-black/80 p-4 rounded-lg overflow-auto text-cyan-400/70 border border-cyan-500/20 font-mono">
                {JSON.stringify(scoutData, null, 2)}
              </pre>
            </details>
          )}
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