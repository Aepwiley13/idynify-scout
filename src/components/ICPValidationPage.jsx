import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase/config";
import { doc, getDoc, updateDoc } from "firebase/firestore";

const ICPValidationPage = () => {
  const navigate = useNavigate();
  const [scoutData, setScoutData] = useState(null);
  const [icpBrief, setIcpBrief] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate("/login");
        return;
      }

      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setScoutData(data.scoutData);
        
        if (data.icpBrief) {
          setIcpBrief(data.icpBrief);
        } else {
          // Auto-generate ICP Brief if it doesn't exist
          generateICPBrief(data.scoutData);
        }
      }
    } catch (err) {
      console.error("Error loading user data:", err);
      setError("Failed to load user data");
    }
  };

  const generateICPBrief = async (dataToUse = null) => {
    setGenerating(true);
    setError(null);

    try {
      const summaryData = dataToUse || scoutData;
      if (!summaryData) throw new Error("No scout data available");

      console.log('🚀 Generating ICP brief with:', summaryData);

      const response = await fetch('/.netlify/functions/generate-icp-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scoutData: summaryData })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate ICP brief');
      }

      const data = await response.json();
      console.log('✅ Received ICP Brief:', data);

      setIcpBrief(data.icpBrief);

      const user = auth.currentUser;
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          icpBrief: data.icpBrief,
          icpBriefGeneratedAt: new Date().toISOString()
        });
      }

    } catch (err) {
      console.error("💥 Error generating ICP Brief:", err);
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const approveAndLaunch = async () => {
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
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-4">
            🎯 Your Ideal Customer Profile
          </h1>
          <p className="text-slate-400 text-lg">
            Review your ICP, then Barry will hunt down your perfect leads
          </p>
        </div>

        {/* Generating State */}
        {generating && (
          <div className="bg-indigo-900/30 border-2 border-indigo-500/50 rounded-xl p-12 text-center">
            <div className="text-8xl mb-6 animate-bounce">🐻</div>
            <h2 className="text-3xl font-bold mb-4">Barry is analyzing your perfect customer...</h2>
            <div className="flex justify-center mt-6">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-cyan-400"></div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/30 border-2 border-red-500/50 rounded-xl p-6 mb-8 text-center">
            <p className="text-red-300 text-lg mb-4">⚠️ {error}</p>
            <button
              onClick={() => generateICPBrief()}
              className="px-6 py-3 bg-red-700 hover:bg-red-600 rounded-lg transition-all"
            >
              Try Again
            </button>
          </div>
        )}

        {/* ICP Brief Display */}
        {icpBrief && !generating && (
          <div className="space-y-8">
            {/* Company Overview */}
            <div className="bg-indigo-900/20 border-2 border-indigo-500/30 rounded-xl p-8">
              <h2 className="text-2xl font-bold text-cyan-400 mb-4">
                📋 {icpBrief.companyName}
              </h2>
              <p className="text-slate-300 text-lg leading-relaxed">
                {icpBrief.idealCustomerGlance}
              </p>
            </div>

            {/* Perfect Fit Indicators */}
            <div className="bg-green-900/20 border-2 border-green-50