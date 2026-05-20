import { useEffect, useState, useCallback } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import axios from "axios";
import { createContext, useContext } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { getDeviceFingerprint } from "@/lib/deviceFingerprint";

// Toast & Realtime
import { ToastProvider } from "@/components/Toast";
import { ExecutorRealtimeBridge, TesterRealtimeBridge, ClientRealtimeBridge, AdminRealtimeBridge } from "@/components/RealtimeBridge";
import { ThemeProvider } from "@/contexts/ThemeContext";

// Pages
import LandingPage from "@/pages/LandingPage";
import DescribeFlow from "@/pages/DescribeFlow";
import EstimateResultPage from "@/pages/EstimateResultPage";
import ProjectBootingPage from "@/pages/ProjectBootingPage";
import ClientAuthPage from "@/pages/ClientAuthPage";
import BuilderAuthPage from "@/pages/BuilderAuthPage";
import AdminLoginPage from "@/pages/AdminLoginPage";
import TwoFactorChallengePage from "@/pages/TwoFactorChallengePage";
import TwoFactorSetupPage from "@/pages/TwoFactorSetupPage";
import TwoFactorRecoveryPage from "@/pages/TwoFactorRecoveryPage";
import ClientDashboard from "@/pages/ClientDashboard";
import DeveloperDashboard from "@/pages/DeveloperDashboard";
import TesterDashboard from "@/pages/TesterDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import AdminV2Dashboard from "@/pages/AdminV2Dashboard";
import AdminV2Workflow from "@/pages/AdminV2Workflow";
import AdminV2Finance from "@/pages/AdminV2Finance";
import AdminV2Team from "@/pages/AdminV2Team";
import AdminV2System from "@/pages/AdminV2System";
import AdminV2Profile from "@/pages/AdminV2Profile";
import NewRequest from "@/pages/NewRequest";
import ProjectDetails from "@/pages/ProjectDetails";
import ScopeBuilder from "@/pages/ScopeBuilder";
import WorkUnitDetail from "@/pages/WorkUnitDetail";
import DeliverableBuilder from "@/pages/DeliverableBuilder";
import DeveloperWorkUnit from "@/pages/DeveloperWorkUnit";
import TesterValidation from "@/pages/TesterValidation";
import AdminDeliverableBuilder from "@/pages/AdminDeliverableBuilder";
import AdminIntegrationsPage from "@/pages/AdminIntegrationsPage";
import AdminPaymentsPage from "@/pages/AdminPaymentsPage";
import AdminLeadsPage from "@/pages/AdminLeadsPage";
import ClientDeliverablePage from "@/pages/ClientDeliverablePage";
import ClientVersionsPage from "@/pages/ClientVersionsPage";

// New Developer Workspace
import DeveloperLayout from "@/layouts/DeveloperLayout";
import DeveloperHub from "@/pages/DeveloperHub";
import DeveloperAssignments from "@/pages/DeveloperAssignments";
import DeveloperWorkPage from "@/pages/DeveloperWorkPage";
import DeveloperPerformance from "@/pages/DeveloperPerformance";
import ExecutorBoard from "@/pages/ExecutorBoard";

// New Tester Workspace
import TesterLayout from "@/layouts/TesterLayout";
import TesterHub from "@/pages/TesterHub";
import TesterValidationList from "@/pages/TesterValidationList";
import TesterValidationPage from "@/pages/TesterValidationPage";
import TesterIssues from "@/pages/TesterIssues";
import TesterPerformance from "@/pages/TesterPerformance";

// Admin Control Center
import AdminProjectWarRoom from "@/pages/AdminProjectWarRoom";
import AdminDeveloperProfile from "@/pages/AdminDeveloperProfile";
import AdminGrowthPage from "@/pages/AdminGrowthPage";
import AdminContractsPage from "@/pages/AdminContractsPage";
import AdminBillingPage from "@/pages/AdminBillingPage";
import AdminWithdrawalsPage from "@/pages/AdminWithdrawalsPage";
import DeveloperMarketplace from "@/pages/DeveloperMarketplace";
import DeveloperLeaderboard from "@/pages/DeveloperLeaderboard";
import DeveloperIntelLeaderboard from "@/pages/DeveloperIntelLeaderboard";
import DeveloperIntelGrowth from "@/pages/DeveloperIntelGrowth";
import DeveloperIntelFeedback from "@/pages/DeveloperIntelFeedback";
import DeveloperProfileEnhanced from "@/pages/DeveloperProfileEnhanced";
import MasterAdminDashboard from "@/pages/MasterAdminDashboard";
import AdminLayout from "@/layouts/AdminLayout";
import AdminEarningsControl from "@/pages/AdminEarningsControl";
// ScopeBuilder already imported above

// Client Layout and Pages
import ClientLayout from "@/layouts/ClientLayout";
import ClientHub from "@/pages/ClientHub";
import ClientProjects from "@/pages/ClientProjects";
import ClientSupport from "@/pages/ClientSupport";
import ClientProjectPage from "@/pages/ClientProjectPage";
import ClientEstimatePage from "@/pages/ClientEstimatePage";

// Client OS (Operating Workspace)
import ClientDashboardOS from "@/pages/ClientDashboardOS";
import CreateModuleDominance from "@/pages/CreateModuleDominance";
import ModuleCreatedSuccess from "@/pages/ModuleCreatedSuccess";
import ClientProjectWorkspaceOS from "@/pages/ClientProjectWorkspaceOS";
import ClientBillingOS from "@/pages/ClientBillingOS";
import ClientContractPage from "@/pages/ClientContractPage";
import ContractSignEvidencePage from "@/pages/ContractSignEvidencePage";
import ClientDocumentsPage from "@/pages/ClientDocumentsPage";

// Growth / Referral
import ClientReferralPage from "@/pages/ClientReferralPage";
import DeveloperGrowthPage from "@/pages/DeveloperGrowthPage";
import ClientLeaderboardPage from "@/pages/ClientLeaderboardPage";
import ClientTransparency from "@/pages/ClientTransparency";

// Admin Financials
import AdminFinancialsPage from "@/pages/AdminFinancialsPage";

// Admin Inbox (sequence-defining messaging — Support / Project moderation)
import AdminInboxPage from "@/pages/AdminInboxPage";

// Admin Users (Phase 1 Step B — Identity Control Panel)
import AdminUsersPage from "@/pages/AdminUsersPage";

// Admin QA
import AdminQAPage from "@/pages/AdminQAPage";

// Admin Validation (Human Validation Layer — perception signal, not engineering QA)
import AdminValidationPage from "@/pages/AdminValidationPage";

// Validator Missions (shared surface — clients and developers can participate to earn credits)
import ValidatorMissionsPage from "@/pages/ValidatorMissionsPage";

// Developer Workspace & Client Cabinet (Production Operations)
import DeveloperWorkspace from "@/pages/DeveloperWorkspace";
import ClientCabinet from "@/pages/ClientCabinet";

// GPT Scope Builder
import GPTScopeBuilder from "@/pages/GPTScopeBuilder";

// Admin Templates (AI Matcher)
import AdminTemplatesPage from "@/pages/AdminTemplatesPage";

// Provider Marketplace
import ProviderInbox from "@/pages/ProviderInbox";
import ProviderAuth from "@/pages/ProviderAuth";

// Assignment Engine 2.0 + Team Panel
import AdminTeamPanel from "@/pages/AdminTeamPanel";
import DeveloperWorkspaceV2 from "@/pages/DeveloperWorkspaceV2";

// Acceptance Layer
import AcceptanceQueue from "@/pages/AcceptanceQueue";

// Time Control Panel (Step 2C)
import DeveloperTimeControl from "@/pages/DeveloperTimeControl";
import AdminTimeControl from "@/pages/AdminTimeControl";

// Earnings UI (Step 3D)
import DeveloperEarnings from "@/pages/DeveloperEarnings";

// ATLAS DevOS — Client layer pages (restored + new)
import ClientCosts from "@/pages/ClientCosts";
import ClientOperator from "@/pages/ClientOperator";
import ClientWorkspace from "@/pages/ClientWorkspace";
import DevWork from "@/pages/DevWork";

// Execution Intelligence Console — orchestration cognition surface
import AdminExecutionIntelligence from "@/pages/AdminExecutionIntelligence";
import AdminPressureTopology from "@/pages/AdminPressureTopology";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
export const API = `${BACKEND_URL}/api`;

// ─── Step 6.2 Stage 2 — Runtime boot guard ───────────────────────────────────
// Boot the runtime-client capability manifest at app start. We DON'T await
// blockingly (UI stays interactive) but we DO race against a 1.5s timeout —
// after that, capability gate falls back to "soft degraded" until manifest
// arrives. This avoids cold-start race for hard-gated actions.
import { runtime } from '@/runtime';
const _runtimeBootPromise = Promise.race([
  runtime.capabilities.refresh().catch(() => null),
  new Promise((res) => setTimeout(res, 1500)),
]);
// Expose for components that need to wait on first render of payment flows.
export const runtimeReady = _runtimeBootPromise;

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/auth/me`, {
        withCredentials: true
      });
      setUser(response.data);
    } catch (error) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    const response = await axios.post(
      `${API}/auth/login`,
      { email, password, device_fingerprint: getDeviceFingerprint() },
      { withCredentials: true }
    );
    // 2FA gate — backend returns { requires_2fa, challenge_token, method,
    // ttl_seconds } when the account has 2FA on AND the current device is
    // not in the trusted-devices list. Surface as a structured error so the
    // caller can route to /two-factor-challenge.
    if (response.data?.requires_2fa) {
      const err = new Error('TwoFactorRequired');
      err.requires_2fa = true;
      err.challenge_token = response.data.challenge_token;
      err.method = response.data.method || 'totp';
      err.ttl_seconds = response.data.ttl_seconds;
      err.email = email;
      throw err;
    }
    setUser(response.data);
    return response.data;
  };

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    } catch (error) {
      console.error("Logout error:", error);
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

// Protected Route
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-border border-t-signal rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    // Redirect to appropriate auth page based on path
    if (location.pathname.startsWith('/admin')) {
      return <Navigate to="/admin/login" state={{ from: location }} replace />;
    } else if (location.pathname.startsWith('/developer') || location.pathname.startsWith('/tester')) {
      return <Navigate to="/builder/auth" state={{ from: location }} replace />;
    } else {
      return <Navigate to="/client/auth" state={{ from: location }} replace />;
    }
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    const dashboardRoutes = {
      client: '/client/dashboard',
      developer: '/developer/dashboard',
      tester: '/tester/dashboard',
      admin: '/admin/dashboard'
    };
    return <Navigate to={dashboardRoutes[user.role] || '/client/dashboard'} replace />;
  }

  return children;
};

function AppRouter() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/describe" element={<DescribeFlow />} />
      <Route path="/estimate-result" element={<EstimateResultPage />} />
      <Route
        path="/project-booting"
        element={
          <ProtectedRoute allowedRoles={['client', 'admin']}>
            <ProjectBootingPage />
          </ProtectedRoute>
        }
      />
      
      {/* Auth Routes - New Structure */}
      <Route path="/client/auth" element={<ClientAuthPage />} />
      <Route path="/builder/auth" element={<BuilderAuthPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />

      {/* Two-factor authentication — shared across all roles */}
      <Route path="/two-factor-challenge" element={<TwoFactorChallengePage />} />
      <Route
        path="/account/2fa/setup"
        element={
          <ProtectedRoute>
            <TwoFactorSetupPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account/2fa/recovery"
        element={
          <ProtectedRoute>
            <TwoFactorRecoveryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/account/2fa"
        element={<Navigate to="/account/2fa/recovery" replace />}
      />
      
      {/* Client Routes - New Layout */}
      <Route 
        path="/client" 
        element={
          <ProtectedRoute allowedRoles={['client', 'admin']}>
            <ClientLayout />
          </ProtectedRoute>
        }
      >
        {/* CLIENT OS - New Operating Workspace */}
        <Route path="dashboard-os" element={<ClientDashboardOS />} />
        <Route path="create-module-dominance" element={<CreateModuleDominance />} />
        <Route path="project-workspace/:projectId" element={<ClientProjectWorkspaceOS />} />
        <Route path="billing-os" element={<ClientBillingOS />} />
        <Route path="contract/:projectId" element={<ClientContractPage />} />
        <Route path="sign-agreement/:contractId" element={<ContractSignEvidencePage />} />
        <Route path="documents" element={<ClientDocumentsPage />} />
        
        {/* LEGACY Client Routes */}
        <Route path="dashboard" element={<ClientHub />} />
        <Route path="projects" element={<ClientProjects />} />
        <Route path="projects/:projectId" element={<ProjectDetails />} />
        <Route path="project/:projectId" element={<ClientProjectPage />} />
        <Route path="cabinet/:projectId" element={<ClientCabinet />} />
        <Route path="deliverables" element={<ClientHub />} />
        <Route path="deliverable/:deliverableId" element={<ClientDeliverablePage />} />
        <Route path="support" element={<ClientSupport />} />
        <Route path="request/new" element={<NewRequest />} />
        <Route path="project/:projectId/versions" element={<ClientVersionsPage />} />
        <Route path="estimate" element={<ClientEstimatePage />} />
        <Route path="referrals" element={<ClientReferralPage />} />
        <Route path="leaderboard" element={<ClientLeaderboardPage />} />
        <Route path="transparency" element={<ClientTransparency />} />
        <Route path="validation" element={<ValidatorMissionsPage persona="client" />} />
        {/* ATLAS DevOS — Client layer */}
        <Route path="costs" element={<ClientCosts />} />
        <Route path="operator" element={<ClientOperator />} />
        <Route path="project/:projectId/workspace" element={<ClientWorkspace />} />
        <Route index element={<Navigate to="/client/dashboard" replace />} />
      </Route>
      
      {/* Developer Routes - New Economy System */}
      <Route 
        path="/developer" 
        element={
          <ProtectedRoute allowedRoles={['developer', 'admin']}>
            <DeveloperLayout />
          </ProtectedRoute>
        }
      >
        {/* NEW SYSTEM (Economy-first) */}
        <Route path="dashboard" element={<DeveloperDashboard />} />
        <Route path="acceptance" element={<AcceptanceQueue />} />
        <Route path="marketplace" element={<DeveloperMarketplace />} />
        <Route path="workspace" element={<DeveloperWorkspaceV2 />} />
        <Route path="earnings" element={<DeveloperEarnings />} />
        <Route path="profile" element={<DeveloperProfileEnhanced />} />
        <Route path="leaderboard" element={<DeveloperLeaderboard />} />
        <Route path="validation" element={<ValidatorMissionsPage persona="developer" />} />

        {/* Developer Intelligence — Leaderboard · Growth · Feedback (new contract) */}
        <Route path="intel/leaderboard" element={<DeveloperIntelLeaderboard />} />
        <Route path="intel/growth" element={<DeveloperIntelGrowth />} />
        <Route path="intel/feedback" element={<DeveloperIntelFeedback />} />
        
        {/* LEGACY (fallback only) */}
        <Route path="workspace-v1" element={<DeveloperWorkspace />} />
        <Route path="acceptance-queue" element={<AcceptanceQueue />} />
        <Route path="time-control" element={<DeveloperTimeControl />} />
        <Route path="board" element={<ExecutorBoard />} />
        <Route path="assignments" element={<DeveloperAssignments />} />
        <Route path="work/:unitId" element={<DeveloperWorkPage />} />
        <Route path="performance" element={<DeveloperPerformance />} />
        <Route path="network" element={<DeveloperGrowthPage />} />
        
        {/* Redirect */}
        <Route index element={<Navigate to="/developer/dashboard" replace />} />
      </Route>
      
      {/* Tester Routes - New Layout */}
      <Route 
        path="/tester" 
        element={
          <ProtectedRoute allowedRoles={['tester', 'admin']}>
            <TesterLayout />
          </ProtectedRoute>
        }
      >
        <Route path="dashboard" element={<TesterHub />} />
        <Route path="validation" element={<TesterValidationList />} />
        <Route path="validation/:validationId" element={<TesterValidationPage />} />
        <Route path="issues" element={<TesterIssues />} />
        <Route path="performance" element={<TesterPerformance />} />
        <Route index element={<Navigate to="/tester/dashboard" replace />} />
      </Route>
      
      {/* Admin Routes - v1 stable: 7 zones. Legacy paths redirect to canonical routes. */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        {/* CANONICAL 7 ZONES */}
        <Route path="dashboard" element={<AdminV2Dashboard />} />
        <Route path="workflow" element={<AdminV2Workflow />} />
        <Route path="qa" element={<AdminQAPage />} />
        <Route path="validation" element={<AdminValidationPage />} />
        <Route path="finance" element={<AdminV2Finance />} />
        <Route path="team" element={<AdminV2Team />} />
        <Route path="system" element={<AdminV2System />} />
        <Route path="payments" element={<AdminPaymentsPage />} />
        <Route path="leads" element={<AdminLeadsPage />} />
        <Route path="profile" element={<AdminV2Profile />} />

        {/* Execution Intelligence Console — orchestration cognition surface */}
        <Route path="execution-intelligence" element={<AdminExecutionIntelligence />} />
        <Route path="pressure-topology"      element={<AdminPressureTopology />} />

        {/* LEGACY REDIRECTS → canonical zones (no 404, keeps deep-links alive) */}
        <Route path="cockpit" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="control-center" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="control-center-legacy" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="master" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="profit-control" element={<Navigate to="/admin/finance" replace />} />
        <Route path="earnings-control" element={<Navigate to="/admin/finance" replace />} />
        <Route path="withdrawals" element={<Navigate to="/admin/finance" replace />} />
        <Route path="billing" element={<Navigate to="/admin/finance" replace />} />
        <Route path="margin" element={<Navigate to="/admin/finance" replace />} />
        <Route path="underpriced-control" element={<Navigate to="/admin/finance" replace />} />
        <Route path="projects" element={<Navigate to="/admin/workflow" replace />} />
        <Route path="requests" element={<Navigate to="/admin/workflow" replace />} />
        <Route path="review" element={<Navigate to="/admin/workflow" replace />} />
        <Route path="validation" element={<Navigate to="/admin/workflow" replace />} />
        <Route path="users" element={<Navigate to="/admin/team" replace />} />
        <Route path="growth" element={<Navigate to="/admin/team" replace />} />
        <Route path="time-control" element={<Navigate to="/admin/team" replace />} />
        <Route path="integrations" element={<Navigate to="/admin/system" replace />} />
        <Route path="settings" element={<Navigate to="/admin/system" replace />} />
        <Route path="templates" element={<Navigate to="/admin/system" replace />} />
        <Route path="contracts" element={<Navigate to="/admin/system" replace />} />
        <Route path="messages" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="project/:projectId/war-room" element={<Navigate to="/admin/workflow" replace />} />

        {/* Deep-detail routes preserved (still needed for specific flows linked from workflow) */}
        <Route path="dev/:developerId" element={<AdminDeveloperProfile />} />
        <Route path="project/:projectId/scope" element={<ScopeBuilder />} />
        <Route path="scope-builder/:requestId" element={<ScopeBuilder />} />
        <Route path="work-unit/:unitId" element={<WorkUnitDetail />} />
        <Route path="deliverable/:projectId" element={<DeliverableBuilder />} />
        <Route path="deliverable-builder/:projectId" element={<AdminDeliverableBuilder />} />
        <Route path="project/:projectId/financials" element={<AdminFinancialsPage />} />
        <Route path="ai-scope/:requestId" element={<GPTScopeBuilder />} />
        <Route path="ai-scope" element={<GPTScopeBuilder />} />

        <Route index element={<Navigate to="/admin/dashboard" replace />} />
      </Route>
      
      {/* Provider Marketplace Routes */}
      <Route 
        path="/provider/auth" 
        element={<ProviderAuth />} 
      />

      {/* ATLAS DevOS — Developer Work Hub (standalone) */}
      <Route
        path="/dev/work"
        element={
          <ProtectedRoute allowedRoles={['developer', 'admin']}>
            <DevWork />
          </ProtectedRoute>
        }
      />
      <Route
        path="/developer/work-hub"
        element={
          <ProtectedRoute allowedRoles={['developer', 'admin']}>
            <DevWork />
          </ProtectedRoute>
        }
      />
      <Route 
        path="/provider/inbox" 
        element={<ProviderInbox />} 
      />
      <Route 
        path="/provider/job/:bookingId" 
        element={<ProviderInbox />} 
      />
      
      {/* Legacy redirects */}
      <Route path="/dashboard" element={<Navigate to="/client/dashboard" replace />} />
      <Route path="/developer/hub" element={<Navigate to="/developer/dashboard" replace />} />
      <Route path="/tester/hub" element={<Navigate to="/tester/dashboard" replace />} />
        <Route path="marketplace" element={<DeveloperMarketplace />} />

      <Route path="/admin/work-board" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/request/new" element={<Navigate to="/client/request/new" replace />} />
      <Route path="/auth/client" element={<Navigate to="/client/auth" replace />} />
      <Route path="/auth/builder" element={<Navigate to="/builder/auth" replace />} />
      <Route path="/projects/:projectId" element={<Navigate to="/client/projects/:projectId" replace />} />
      
      {/* Catch all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  // Real Google OAuth Client ID from env. `GoogleOAuthProvider` tolerates
  // an empty string at build time (the GoogleLogin button just won't render),
  // so this is safe when the env var is missing in dev.
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID
    || "539552820560-pso3qndegrntp46oneml9nr33t7rpi9j.apps.googleusercontent.com";
  return (
    <div className="App">
      <GoogleOAuthProvider clientId={googleClientId}>
        <BrowserRouter basename={process.env.PUBLIC_URL || ""}>
          <ThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <AppRouter />
              </ToastProvider>
            </AuthProvider>
          </ThemeProvider>
        </BrowserRouter>
      </GoogleOAuthProvider>
    </div>
  );
}

export default App;
