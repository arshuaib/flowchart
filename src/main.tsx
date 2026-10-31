import { lazy, Suspense, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppProvider';
import { AppLayout } from './components/AppLayout';
const Onboarding = lazy(() => import('./pages/Onboarding').then((module) => ({ default: module.Onboarding })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const MoneyAudit = lazy(() => import('./pages/MoneyAudit').then((module) => ({ default: module.MoneyAudit })));
const BudgetBuilder = lazy(() => import('./pages/BudgetBuilder').then((module) => ({ default: module.BudgetBuilder })));
const SavingsPlan = lazy(() => import('./pages/SavingsPlan').then((module) => ({ default: module.SavingsPlan })));
const DebtPlanner = lazy(() => import('./pages/DebtPlanner').then((module) => ({ default: module.DebtPlanner })));
const ResetPlan = lazy(() => import('./pages/ResetPlan').then((module) => ({ default: module.ResetPlan })));
const MonthlyReview = lazy(() => import('./pages/MonthlyReview').then((module) => ({ default: module.MonthlyReview })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
import { profileOf } from './lib/selectors';
import './index.css';

function LoadingScreen() { return <div className="loading-screen" role="status"><span className="loading-mark">S</span><p>Opening your private money plan…</p></div>; }

function AppRoutes() {
  const { records, loading } = useApp();
  if (loading) return <LoadingScreen />;
  return <Suspense fallback={<LoadingScreen />}>
    {!profileOf(records).onboarded ? <Routes><Route path="/onboarding" element={<Onboarding />} /><Route path="*" element={<Navigate to="/onboarding" replace />} /></Routes> : <Routes>
      <Route path="/onboarding" element={<Onboarding />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/audit" element={<MoneyAudit />} />
        <Route path="/budget" element={<BudgetBuilder />} />
        <Route path="/savings" element={<SavingsPlan />} />
        <Route path="/debt" element={<DebtPlanner />} />
        <Route path="/reset" element={<ResetPlan />} />
        <Route path="/review" element={<MonthlyReview />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>}
  </Suspense>;
}

// file:// pages have no reliable History API origin. Hash routing keeps the
// portable built app usable when opened directly, while hosted builds keep clean URLs.
const useHashRoutes = window.location.protocol === 'file:' || import.meta.env.VITE_ROUTER_MODE === 'hash';
const Router = useHashRoutes ? HashRouter : BrowserRouter;
createRoot(document.getElementById('root')!).render(<StrictMode><Router><AppProvider><AppRoutes /></AppProvider></Router></StrictMode>);
