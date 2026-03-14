import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { ImpersonationProvider } from './context/ImpersonationContext';
import { useVersionCheck } from './hooks/useVersionCheck';

// Pages
import Homepage from './pages/Homepage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import GettingStarted from './pages/GettingStarted';
import CheckoutPage from './pages/CheckoutPage';
import CheckoutSuccessPage from './pages/CheckoutSuccessPage';
import CheckoutCancelPage from './pages/CheckoutCancelPage';
import MissionControlDashboardV2 from './pages/MissionControlDashboardV2';
// MissionControlDashboard (legacy) archived as MissionControlDashboard.archived.jsx
import RECONModulePage from './pages/RECONModulePage';
import RECONSectionPage from './pages/RECONSectionPage';

// New RECON Platform Pages
import ReconMain from './pages/Recon/ReconMain';
import ReconOverview from './pages/Recon/ReconOverview';
import ReconModulePage from './pages/Recon/ReconModulePage';
import ReconSectionEditor from './pages/Recon/ReconSectionEditor';
import ReconSection0 from './pages/Recon/ReconSection0';
import BarryTraining from './pages/Recon/BarryTraining';
import ReconErrorBoundary from './components/recon/ReconErrorBoundary';
import Prospects from './pages/Prospects';
import Questionnaire from './pages/Questionnaire';
import UnifiedDashboard from './pages/UnifiedDashboard';
import ICPValidationPage from './pages/ICPValidationPage';
import MissionPhase1Page from './pages/MissionPhase1Page';
import MissionPhase2Page from './pages/MissionPhase2Page';
import MissionPhase3Page from './pages/MissionPhase3Page';
import MissionPhase4Page from './pages/MissionPhase4Page';
import MissionPhase5Page from './pages/MissionPhase5Page';
import ScoutDashboardPage from './pages/ScoutDashboardPage';
import ScoutMain from './pages/Scout/ScoutMain';
import PeopleMain from './pages/Scout/PeopleMain';
import AllLeads from './pages/Scout/AllLeads';
import CompanyDetail from './pages/Scout/CompanyDetail';
import CompanyLeads from './pages/Scout/CompanyLeads';
import ContactProfile from './pages/Scout/ContactProfile';
import ScoutGame from './pages/Scout/ScoutGame';
import AdminDashboard from './pages/Admin/AdminDashboard';
import UserDetail from './pages/Admin/UserDetail';
import AdminPingTest from './pages/Admin/AdminPingTest';
import ApiActivity from './pages/Admin/ApiActivity';
import AuditLogs from './pages/Admin/AuditLogs';
import EmailInsights from './pages/Admin/EmailInsights';
import SuperAdminDashboard from './pages/Admin/SuperAdminDashboard';
import TenantHealth from './pages/Admin/TenantHealth';
import RepairTools from './pages/Admin/RepairTools';
import SuperAdminAuditLogs from './pages/Admin/SuperAdminAuditLogs';
import DiagnosticDashboardInit from './pages/DiagnosticDashboardInit';

// Components
import CrispChat from './components/CrispChat';
import UpdateBanner from './components/UpdateBanner';
import ProtectedAdminRoute from './components/ProtectedAdminRoute';
import ProtectedSuperAdminRoute from './components/ProtectedSuperAdminRoute';
import ImprovedScoutQuestionnaire from './components/ImprovedScoutQuestionnaire';
import LaunchSequence from './components/LaunchSequence';
import Phase1Discovery from './components/Phase1Discovery';
import ICPBuilder from './components/ICPBuilder';
import ICPBriefView from './components/ICPBriefView';
import CompanyList from './components/CompanyList';
import AddCompanyForm from './components/AddCompanyForm';
import ContactSuggestions from './components/ContactSuggestions';
import LeadList from './components/LeadList';
import CompanyQuestionnaire from './components/scout/CompanyQuestionnaire';
import ImpersonationBanner from './components/ImpersonationBanner';
import MainLayout from './components/layout/MainLayout';

// Hunter Pages
import HunterMain from './pages/Hunter/HunterMain';

// Basecamp Pages
import BasecampMain from './pages/Basecamp/BasecampMain';

// Reinforcements Pages
import ReinforcementsMain from './pages/Reinforcements/ReinforcementsMain';

// Sniper Pages
import SniperMain from './pages/Sniper/SniperMain';
import HunterWeaponRoom from './pages/Hunter/HunterWeaponRoom';
import CreateCampaign from './pages/Hunter/CreateCampaign';
import CampaignDetail from './pages/Hunter/CampaignDetail';
import CreateMission from './pages/Hunter/CreateMission';
import MissionDetail from './pages/Hunter/MissionDetail';

// Barry Onboarding
import BarryOnboarding from './pages/Onboarding/BarryOnboarding';

// User Settings
import UserSettings from './pages/UserSettings';

// Theme
import WithTheForce from './components/WithTheForce';

// Barry unified trigger
import BarryTrigger from './components/barry/BarryTrigger';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [impersonationSession, setImpersonationSession] = useState(null);
  const updateAvailable = useVersionCheck();

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

  // Check for active impersonation session
  useEffect(() => {
    const checkImpersonation = async () => {
      if (!user || !userData?.role || (userData.role !== 'admin' && userData.role !== 'super_admin')) {
        setImpersonationSession(null);
        return;
      }

      try {
        const authToken = await auth.currentUser.getIdToken();

        const response = await fetch('/.netlify/functions/adminGetImpersonationSession', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({})
        });

        if (response.ok) {
          const data = await response.json();
          if (data.hasActiveSession) {
            setImpersonationSession(data.session);
            // Add class to body for padding adjustment
            document.body.classList.add('impersonating');
          } else {
            setImpersonationSession(null);
            document.body.classList.remove('impersonating');
          }
        }
      } catch (error) {
        console.error('Error checking impersonation session:', error);
      }
    };

    checkImpersonation();

    // Check every 30 seconds for session updates
    const interval = setInterval(checkImpersonation, 30000);

    return () => {
      clearInterval(interval);
      document.body.classList.remove('impersonating');
    };
  }, [user, userData]);

  const handleEndImpersonation = () => {
    setImpersonationSession(null);
    document.body.classList.remove('impersonating');
    // Redirect back to admin dashboard and reload so all components re-fetch admin's own data
    window.location.href = '/admin';
  };

  // Protected Route Component - Requires both auth AND payment
  const ProtectedRoute = ({ children, requirePayment = true, withLayout = false }) => {
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

    // Check if user has completed payment (unless explicitly disabled)
    if (requirePayment && !userData?.hasCompletedPayment) {
      return <Navigate to="/checkout" />;
    }

    // Wrap with MainLayout if requested
    if (withLayout) {
      return <MainLayout user={user}>{children}</MainLayout>;
    }

    return children;
  };

  // Smart redirect after login - NEW FLOW
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

    // ✅ NEW FLOW: Check payment status first
    if (!userData?.hasCompletedPayment) {
      // User hasn't paid yet - send to checkout
      return <Navigate to="/checkout" />;
    }

    // ✅ If user has paid, always go to Mission Control V2
    return <Navigate to="/mission-control-v2" />;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <p className="text-cyan-400 text-xl font-mono">Loading...</p>
      </div>
    );
  }

  return (
    <ImpersonationProvider session={impersonationSession}>
    <BrowserRouter>
      {updateAvailable && <UpdateBanner />}
      {impersonationSession && (
        <ImpersonationBanner
          session={impersonationSession}
          onEndSession={handleEndImpersonation}
        />
      )}
      {user && <CrispChat user={user} />}
      {user && <MissionControlForce />}
      {user && <BarryTrigger />}
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={!user ? <Homepage /> : <SmartRedirect />} />
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/mission-control-v2" />} />
        <Route path="/signup" element={!user ? <Signup /> : <Navigate to="/checkout" />} />
        <Route path="/forgot-password" element={!user ? <ForgotPassword /> : <Navigate to="/mission-control-v2" />} />

        {/* Getting Started (Auth Required) */}
        <Route path="/getting-started" element={<ProtectedRoute><GettingStarted /></ProtectedRoute>} />

        {/* Payment Routes - Auth required but payment NOT required (to avoid redirect loop) */}
        <Route path="/checkout" element={<ProtectedRoute requirePayment={false}><CheckoutPage /></ProtectedRoute>} />
        <Route path="/checkout/success" element={<ProtectedRoute requirePayment={false}><CheckoutSuccessPage /></ProtectedRoute>} />
        <Route path="/checkout/cancel" element={<ProtectedRoute requirePayment={false}><CheckoutCancelPage /></ProtectedRoute>} />

        {/* Barry ICP Onboarding - First touchpoint after payment */}
        <Route path="/onboarding/barry" element={<ProtectedRoute withLayout={true}><BarryOnboarding /></ProtectedRoute>} />

        {/* Protected Routes - OLD FLOW REDIRECTS (Disable old questionnaire flow) */}
        <Route path="/scout-questionnaire" element={<Navigate to="/mission-control-v2" />} />
        <Route path="/icp-validation" element={<Navigate to="/mission-control-v2" />} />
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

        {/* Protected Routes - Mission Control Dashboard V2 (MODULAR SYSTEM) */}
        <Route
          path="/mission-control-v2"
          element={
            <ProtectedRoute>
              <MissionControlDashboardV2 />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mission-control-v2/recon"
          element={
            <ProtectedRoute withLayout={true}>
              <RECONModulePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mission-control-v2/recon/section/:sectionId"
          element={
            <ProtectedRoute withLayout={true}>
              <RECONSectionPage />
            </ProtectedRoute>
          }
        />

        {/* RECON Platform — self-contained shell (no MainLayout) */}
        <Route
          path="/recon"
          element={
            <ProtectedRoute>
              <ReconMain />
            </ProtectedRoute>
          }
        >
          <Route index element={<ReconErrorBoundary><ReconOverview /></ReconErrorBoundary>} />
          <Route path="user-profile" element={<ReconErrorBoundary><ReconSection0 /></ReconErrorBoundary>} />
          <Route path="barry-training" element={<ReconErrorBoundary><BarryTraining /></ReconErrorBoundary>} />
          <Route path="section/:sectionId" element={<ReconErrorBoundary><ReconSectionEditor /></ReconErrorBoundary>} />
          <Route path=":moduleId" element={<ReconErrorBoundary><ReconModulePage /></ReconErrorBoundary>} />
        </Route>

        {/* People — top-level canonical hub, self-contained shell (no MainLayout) */}
        <Route
          path="/people"
          element={
            <ProtectedRoute>
              <PeopleMain />
            </ProtectedRoute>
          }
        />

        {/* Scout Module — self-contained two-column shell (no MainLayout) */}
        <Route
          path="/scout"
          element={
            <ProtectedRoute>
              <ScoutMain />
            </ProtectedRoute>
          }
        />

        {/* Scout+ is merged into /scout - redirect legacy URL */}
        <Route
          path="/scout-plus"
          element={<Navigate to="/scout?tab=scout-plus" replace />}
        />

        {/* Scout Game Mode */}
        <Route
          path="/scout/game"
          element={
            <ProtectedRoute withLayout={true}>
              <ScoutGame />
            </ProtectedRoute>
          }
        />

        {/* Redirect /scout/daily-leads → /scout with correct tab state */}
        <Route
          path="/scout/daily-leads"
          element={<Navigate to="/scout" state={{ activeTab: 'daily-leads' }} replace />}
        />

        {/* Redirect removed Contact Search URL to Company Search */}
        <Route
          path="/scout/contact-search"
          element={<Navigate to="/scout" state={{ activeTab: 'company-search' }} replace />}
        />

        {/* Scout Sub-Routes */}
        <Route
          path="/scout/company/:companyId"
          element={
            <ProtectedRoute withLayout={true}>
              <CompanyDetail />
            </ProtectedRoute>
          }
        />

        <Route
          path="/scout/company/:companyId/leads"
          element={
            <ProtectedRoute withLayout={true}>
              <CompanyLeads />
            </ProtectedRoute>
          }
        />

        <Route
          path="/scout/contact/:contactId"
          element={
            <ProtectedRoute withLayout={true}>
              <ContactProfile />
            </ProtectedRoute>
          }
        />

        {/* Basecamp Module — self-contained two-column shell (no MainLayout) */}
        <Route
          path="/basecamp"
          element={
            <ProtectedRoute>
              <BasecampMain />
            </ProtectedRoute>
          }
        />

        {/* Reinforcements Module — referral intelligence hub (no MainLayout) */}
        <Route
          path="/reinforcements"
          element={
            <ProtectedRoute>
              <ReinforcementsMain />
            </ProtectedRoute>
          }
        />

        {/* Hunter Module — self-contained two-column shell (no MainLayout) */}
        <Route
          path="/hunter"
          element={
            <ProtectedRoute>
              <HunterMain />
            </ProtectedRoute>
          }
        />

        {/* Sniper Module — self-contained two-column shell (no MainLayout) */}
        <Route
          path="/sniper"
          element={
            <ProtectedRoute>
              <SniperMain />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hunter/create-mission"
          element={
            <ProtectedRoute withLayout={true}>
              <CreateMission />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hunter/mission/:missionId"
          element={
            <ProtectedRoute withLayout={true}>
              <MissionDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hunter/campaign/new"
          element={
            <ProtectedRoute withLayout={true}>
              <CreateCampaign />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hunter/campaign/:campaignId"
          element={
            <ProtectedRoute withLayout={true}>
              <CampaignDetail />
            </ProtectedRoute>
          }
        />

        {/* User Settings — self-contained shell (no MainLayout) */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <UserSettings />
            </ProtectedRoute>
          }
        />

        {/* Diagnostic Tools */}
        <Route
          path="/diagnostic/dashboard-init"
          element={
            <ProtectedRoute requirePayment={false}>
              <DiagnosticDashboardInit />
            </ProtectedRoute>
          }
        />

        {/* Admin Routes */}
        <Route
          path="/admin-ping-test"
          element={
            <ProtectedAdminRoute>
              <AdminPingTest />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedAdminRoute>
              <AdminDashboard />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/admin/api-activity"
          element={
            <ProtectedAdminRoute>
              <ApiActivity />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/admin/user/:uid"
          element={
            <ProtectedAdminRoute>
              <UserDetail />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedAdminRoute>
              <AuditLogs />
            </ProtectedAdminRoute>
          }
        />
        <Route
          path="/admin/email-insights"
          element={
            <ProtectedAdminRoute>
              <EmailInsights />
            </ProtectedAdminRoute>
          }
        />

        {/* Super Admin Routes */}
        <Route
          path="/super-admin"
          element={
            <ProtectedSuperAdminRoute>
              <SuperAdminDashboard />
            </ProtectedSuperAdminRoute>
          }
        />
        <Route
          path="/super-admin/tenant/:tenantUserId"
          element={
            <ProtectedSuperAdminRoute>
              <TenantHealth />
            </ProtectedSuperAdminRoute>
          }
        />
        <Route
          path="/super-admin/repair/:tenantUserId"
          element={
            <ProtectedSuperAdminRoute>
              <RepairTools />
            </ProtectedSuperAdminRoute>
          }
        />
        <Route
          path="/super-admin/audit-logs"
          element={
            <ProtectedSuperAdminRoute>
              <SuperAdminAuditLogs />
            </ProtectedSuperAdminRoute>
          }
        />

        {/* Redirect old Scout route to new Scout */}
        <Route
          path="/mission-control-v2/scout"
          element={<Navigate to="/scout" />}
        />

        {/* Convenience redirects for email links - now /recon is a real route, no redirect needed */}

        {/* Protected Routes - OLD DASHBOARD REDIRECTS (Use V2 by default) */}
        <Route path="/mission-control" element={<Navigate to="/mission-control-v2" />} />
        <Route path="/dashboard" element={<Navigate to="/mission-control-v2" />} />

        {/* NEW: Company Profile Questionnaire (4 Questions) */}
        <Route
          path="/onboarding/company-profile"
          element={
            <ProtectedRoute>
              <CompanyQuestionnaire />
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
        {/* OLD Scout route - now replaced by new Scout at /scout */}
        <Route
          path="/old-scout"
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

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
    </ImpersonationProvider>
  );
}

// Only show the floating WithTheForce button on Mission Control
function MissionControlForce() {
  const { pathname } = window.location;
  // Re-render on navigation by using useLocation inside BrowserRouter context
  const [path, setPath] = React.useState(window.location.pathname);
  React.useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onNav);
    // Also listen to React Router history changes via a patched pushState
    const origPush = history.pushState.bind(history);
    history.pushState = (...args) => { origPush(...args); onNav(); };
    const origReplace = history.replaceState.bind(history);
    history.replaceState = (...args) => { origReplace(...args); onNav(); };
    return () => {
      window.removeEventListener('popstate', onNav);
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, []);
  if (path !== '/mission-control-v2') return null;
  return <WithTheForce />;
}

export default App;
