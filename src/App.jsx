import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase/config';
import { doc, getDoc } from 'firebase/firestore';

// Pages
import Login from './pages/Login';
import Signup from './pages/Signup';
import MissionControlDashboard from './pages/MissionControlDashboard';
import Prospects from './pages/Prospects';
import Questionnaire from './pages/Questionnaire';
import UnifiedDashboard from './pages/UnifiedDashboard';
import ICPValidationPage from './pages/ICPValidationPage';
import MissionPhase1Page from './pages/MissionPhase1Page';
import MissionPhase2Page from './pages/MissionPhase2Page';
import MissionPhase3Page from './pages/MissionPhase3Page';
import MissionPhase4Page from './pages/MissionPhase4Page';
import MissionPhase5Page from './pages/MissionPhase5Page';

// Components
import ImprovedScoutQuestionnaire from './components/ImprovedScoutQuestionnaire';
import LaunchSequence from './components/LaunchSequence';
import Phase1Discovery from './components/Phase1Discovery';
import ICPBuilder from './components/ICPBuilder';
import ICPBriefView from './components/ICPBriefView';
import CompanyList from './components/CompanyList';
import AddCompanyForm from './components/AddCompanyForm';
import ContactSuggestions from './components/ContactSuggestions';
import LeadList from './components/LeadList';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Fetch user data from Firestore
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            setUserData(data);
            setUser({
              id: currentUser.uid,
              email: currentUser.email,
              ...data
            });
          } else {
            setUser({
              id: currentUser.uid,
              email: currentUser.email
            });
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setUser({
            id: currentUser.uid,
            email: currentUser.email
          });
        }
      } else {
        setUser(null);
        setUserData(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Protected Route Component
  const ProtectedRoute = ({ children }) => {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-black">
          <p className="text-cyan-400 text-xl font-mono">Loading...</p>
        </div>
      );
    }

    if (!user) {
      return <Navigate to="/login" />;
    }

    return children;
  };

  // Smart redirect after login
  const SmartRedirect = () => {
    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-black">
          <p className="text-cyan-400 text-xl font-mono">Loading...</p>
        </div>
      );
    }

    if (!user) {
      return <Navigate to="/login" />;
    }

    // If user has leads, go to mission control dashboard
    if (userData?.leads && userData.leads.length > 0) {
      return <Navigate to="/mission-control" />;
    }

    // If user has completed Scout questionnaire and has ICP brief, go to mission control
    if (userData?.scoutCompleted && userData?.icpBrief) {
      return <Navigate to="/mission-control" />;
    }

    // If user has ICP brief but hasn't approved it, go to ICP validation
    if (userData?.icpBrief && !userData?.icpApproved) {
      return <Navigate to="/icp-validation" />;
    }

    // If user has scoutData but no ICP brief, go to ICP validation
    if (userData?.scoutData && !userData?.icpBrief) {
      return <Navigate to="/icp-validation" />;
    }

    // If user has partial scoutData, go back to scout questionnaire
    if (userData?.scoutData) {
      return <Navigate to="/scout-questionnaire" />;
    }

    // New users go to Scout questionnaire
    return <Navigate to="/scout-questionnaire" />;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <p className="text-cyan-400 text-xl font-mono">Loading...</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
        <Route path="/signup" element={!user ? <Signup /> : <Navigate to="/" />} />

        {/* Protected Routes - New Scout Flow */}
        <Route
          path="/scout-questionnaire"
          element={
            <ProtectedRoute>
              <ImprovedScoutQuestionnaire />
            </ProtectedRoute>
          }
        />
        <Route
          path="/icp-validation"
          element={
            <ProtectedRoute>
              <ICPValidationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/launch-sequence"
          element={
            <ProtectedRoute>
              <MissionPhase1Page />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mission-phase1"
          element={
            <ProtectedRoute>
              <MissionPhase1Page />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mission-phase2"
          element={
            <ProtectedRoute>
              <MissionPhase2Page />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mission-phase3"
          element={
            <ProtectedRoute>
              <MissionPhase3Page />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mission-phase4"
          element={
            <ProtectedRoute>
              <MissionPhase4Page />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mission-phase5"
          element={
            <ProtectedRoute>
              <MissionPhase5Page />
            </ProtectedRoute>
          }
        />

        {/* Protected Routes - Mission Control Dashboard (NEW!) */}
        <Route
          path="/mission-control"
          element={
            <ProtectedRoute>
              <MissionControlDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <MissionControlDashboard />
            </ProtectedRoute>
          }
        />

        {/* Protected Routes - MVP Routes (Module 1) */}
        <Route
          path="/icp"
          element={
            <ProtectedRoute>
              <ICPBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/icp-brief"
          element={
            <ProtectedRoute>
              <ICPBriefView />
            </ProtectedRoute>
          }
        />
        <Route
          path="/companies"
          element={
            <ProtectedRoute>
              <CompanyList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scout"
          element={
            <ProtectedRoute>
              <ContactSuggestions />
            </ProtectedRoute>
          }
        />
        <Route
          path="/add-company"
          element={
            <ProtectedRoute>
              <AddCompanyForm />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lead-review"
          element={
            <ProtectedRoute>
              <LeadList />
            </ProtectedRoute>
          }
        />

        {/* Protected Routes - Old Flow (keep for backwards compatibility) */}
        <Route
          path="/old-dashboard"
          element={
            <ProtectedRoute>
              <UnifiedDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/questionnaire"
          element={
            <ProtectedRoute>
              <Questionnaire />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prospects"
          element={
            <ProtectedRoute>
              <Prospects />
            </ProtectedRoute>
          }
        />

        {/* Default Route - Smart Redirect */}
        <Route path="/" element={<SmartRedirect />} />

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;