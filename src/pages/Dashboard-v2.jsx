import { useState, useEffect } from "react";
import { auth, db } from "../firebase/config";
import { doc, getDoc, collection, addDoc, query, where, getDocs, updateDoc } from "firebase/firestore";

export default function DashboardV2() {
  const [userData, setUserData] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Fetch user data on mount
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) {
          setError("Please log in");
          setLoading(false);
          return;
        }

        // Get user document
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserData(data);
          
          // Fetch leads for this user
          await fetchLeads(user.uid);
        } else {
          setError("User data not found");
        }
      } catch (err) {
        console.error("Error fetching user data:", err);
        setError("Failed to load user data");
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, []);

  const fetchLeads = async (userId) => {
    try {
      const leadsQuery = query(
        collection(db, "leads"),
        where("userId", "==", userId)
      );
      const leadsSnapshot = await getDocs(leadsQuery);
      const leadsData = leadsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLeads(leadsData);
    } catch (err) {
      console.error("Error fetching leads:", err);
    }
  };

  const generateLeads = async () => {
    setGenerating(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");

      // Make sure we have Scout data
      if (!userData?.scoutData) {
        throw new Error("Please complete the Scout questionnaire first");
      }

      console.log('📤 Sending Scout data to generate-leads:', userData.scoutData);

      // Call the generate-leads function with Scout data
      const response = await fetch("/.netlify/functions/generate-leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scoutData: userData.scoutData // Send Scout data!
        }),
      });

      console.log('📡 Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error:', errorText);
        throw new Error(`Failed to generate leads: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Received leads:', data);

      if (!data.leads || data.leads.length === 0) {
        throw new Error("No leads found matching your criteria");
      }

      // Save leads to Firestore
      const savedLeads = [];
      for (const lead of data.leads) {
        const leadData = {
          userId: user.uid,
          ...lead,
          status: "new",
          createdAt: new Date().toISOString(),
        };
        
        const leadDoc = await addDoc(collection(db, "leads"), leadData);
        savedLeads.push({
          id: leadDoc.id,
          ...leadData
        });
      }

      setLeads(savedLeads);

      // Update user's lead count
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        leadsCount: (userData.leadsCount || 0) + savedLeads.length,
        lastLeadGeneration: new Date().toISOString()
      });

      alert(`✅ Generated ${savedLeads.length} leads!`);

    } catch (err) {
      console.error("Error generating leads:", err);
      setError(err.message);
      alert(`❌ Error: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black flex items-center justify-center">
        <div className="text-white text-2xl">Loading...</div>
      </div>
    );
  }

  if (error && !userData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black flex items-center justify-center">
        <div className="text-red-400 text-xl">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black text-white p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Mission Control 🚀</h1>
            <p className="text-purple-300">
              Tier: <span className="font-bold text-pink-400">{userData?.tier || "Scout"}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-400">Total Leads Generated</p>
            <p className="text-3xl font-bold text-cyan-400">{userData?.leadsCount || 0}</p>
          </div>
        </div>

        {/* Executive Summary */}
        {userData?.executiveSummary && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-8 border border-purple-500/30">
            <h2 className="text-2xl font-bold mb-4 text-pink-400">Your ICP Executive Summary</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-cyan-400 mb-2">At a Glance</h3>
                <p className="text-gray-300">{userData.executiveSummary.idealCustomerGlance}</p>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-cyan-400 mb-2">Perfect Fit Indicators</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-300">
                  {userData.executiveSummary.perfectFitIndicators?.map((indicator, i) => (
                    <li key={i}>{indicator}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-cyan-400 mb-2">Anti-Profile (Avoid)</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-300">
                  {userData.executiveSummary.antiProfile?.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-cyan-400 mb-2">Key Insight</h3>
                <p className="text-gray-300 italic">{userData.executiveSummary.keyInsight}</p>
              </div>
            </div>
          </div>
        )}

        {/* Generate Leads Button */}
        <div className="mb-8 text-center">
          <button
            onClick={generateLeads}
            disabled={generating || !userData?.scoutData}
            className="bg-gradient-to-r from-pink-500 to-purple-600 text-white px-8 py-4 rounded-full text-xl font-bold hover:from-pink-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-pink-500/50"
          >
            {generating ? "🚀 Generating Leads..." : "🎯 Generate New Leads"}
          </button>
          {!userData?.scoutData && (
            <p className="text-red-400 mt-2 text-sm">Complete Scout questionnaire first</p>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 mb-8">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {/* Leads List */}
        <div>
          <h2 className="text-2xl font-bold mb-4">Your Leads ({leads.length})</h2>
          
          {leads.length === 0 ? (
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 text-center border border-purple-500/30">
              <p className="text-gray-400 text-lg">No leads yet. Click "Generate New Leads" to get started!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-purple-500/30 hover:border-pink-500/50 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        {lead.photoUrl && (
                          <img
                            src={lead.photoUrl}
                            alt={lead.name}
                            className="w-12 h-12 rounded-full"
                          />
                        )}
                        <div>
                          <h3 className="text-xl font-bold text-white">{lead.name}</h3>
                          <p className="text-purple-300">{lead.title}</p>
                        </div>
                      </div>
                      <p className="text-gray-300 mb-1">🏢 {lead.company}</p>
                      <p className="text-gray-400 text-sm">📧 {lead.email}</p>
                      {lead.linkedinUrl && (
                        <a
                          href={lead.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 text-sm mt-2 inline-block"
                        >
                          🔗 LinkedIn Profile →
                        </a>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-sm">
                        {lead.status || "New"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
