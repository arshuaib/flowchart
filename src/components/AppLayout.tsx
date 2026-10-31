import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, ArrowDownUp, BadgeCheck, BookOpen, Cloud, CreditCard, Gauge, HeartHandshake, Landmark, Settings, ShieldCheck, WalletCards } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../context/AppProvider';
import { recordsOf } from '../lib/selectors';
import type { ConflictLogEntry } from '../types';
import { Button, Notice } from './Shared';

const navigation = [
  { to: '/', label: 'Overview', icon: Gauge }, { to: '/audit', label: 'Money audit', icon: Activity },
  { to: '/budget', label: 'Budget builder', icon: WalletCards }, { to: '/savings', label: 'Savings plan', icon: Landmark },
  { to: '/debt', label: 'Debt planner', icon: CreditCard }, { to: '/reset', label: '90-day reset', icon: ArrowDownUp },
  { to: '/review', label: 'Monthly review', icon: BadgeCheck }, { to: '/settings', label: 'Settings & sync', icon: Settings },
];
const names = { '/': 'Overview', '/audit': 'Money audit', '/budget': 'Budget builder', '/savings': 'Savings plan', '/debt': 'Debt planner', '/reset': '90-day reset', '/review': 'Monthly review', '/settings': 'Settings & sync', '/onboarding': 'Your starting point' } as Record<string, string>;

function relativeTime(value?: string) {
  if (!value) return 'Not synced yet';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `Synced ${seconds}s ago`;
  if (seconds < 3600) return `Synced ${Math.floor(seconds / 60)}m ago`;
  return `Synced ${Math.floor(seconds / 3600)}h ago`;
}

export function AppLayout() {
  const { auth, connect, disconnect, syncNow, syncStatus, pendingCount, lastSyncAt, lastError, online, records } = useApp();
  const location = useLocation();
  const [bannerDismissed, setBannerDismissed] = useState(localStorage.getItem('sr-sync-banner-dismissed') === '1');
  const [busy, setBusy] = useState(false);
  const title = names[location.pathname] ?? 'Salary Reset';
  const conflictCount = recordsOf<ConflictLogEntry>(records, 'conflictLog').length;
  const visibleError = auth.status === 'error' ? auth.error : lastError;
  const doSync = async () => { setBusy(true); await syncNow(); setBusy(false); };
  const doConnect = async () => { setBusy(true); await connect(); setBusy(false); };
  const statusCopy = syncStatus === 'signing-in' ? 'Signing in' : syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'offline' || !online ? `Offline · ${pendingCount} queued` : syncStatus === 'error' ? 'Sync needs attention' : auth.status === 'signed-in' ? relativeTime(lastSyncAt) : 'Signed out · saved on this device';
  const statusTone = syncStatus === 'error' ? 'coral' : syncStatus === 'synced' ? 'green' : syncStatus === 'offline' || !online ? 'sand' : 'neutral';

  useEffect(() => { setBusy(false); }, [auth.status]);
  return <div className="app-shell">
    <aside className="sidebar">
      <NavLink to="/" className="brand"><span className="brand-mark">S</span><span><strong>Salary Reset</strong><small>steady steps, real life</small></span></NavLink>
      <p className="nav-label">YOUR PLAN</p>
      <nav aria-label="Main navigation" className="side-nav">{navigation.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></NavLink>)}</nav>
      <div className="side-note"><ShieldCheck size={17} /><p>Your numbers stay on this device unless you choose to sync.</p></div>
      <div className="side-disclaimer">Personal planning, not regulated financial advice.</div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="topbar-title"><span className="mobile-brand-mark">S</span><div><p className="eyebrow">SALARY RESET</p><p className="topbar-page">{title}</p></div></div>
        <div className="topbar-actions"><div className={`sync-pill sync-${statusTone}`} aria-live="polite"><span className="status-dot" />{statusCopy}{pendingCount > 0 && <span className="pending-label">Pending changes: {pendingCount}</span>}</div>
          {conflictCount > 0 && <NavLink to="/settings#conflicts" className="conflict-badge">Conflict review ({conflictCount})</NavLink>}
          {auth.status === 'signed-in' ? <><Button onClick={doSync} disabled={busy || syncStatus === 'syncing'}>{busy || syncStatus === 'syncing' ? 'Syncing…' : 'Sync now'}</Button><Button variant="quiet" onClick={disconnect}>Sign out</Button></> : <Button variant="primary" onClick={doConnect} disabled={busy || syncStatus === 'signing-in'}><Cloud size={15} /> Sign in with Google</Button>}
        </div>
      </header>
      <main id="main-content" className="main-content">
        {!bannerDismissed && auth.status !== 'signed-in' && location.pathname !== '/onboarding' && <div className="first-run-banner"><div><HeartHandshake size={18} /><p><strong>One device is a good start.</strong> Connect Google Drive when you want to carry this plan across devices. Your data stays usable offline either way.</p></div><NavLink to="/settings#sync" className="banner-link">How sync works <BookOpen size={14} /></NavLink><button aria-label="Dismiss sync introduction" className="banner-close" onClick={() => { localStorage.setItem('sr-sync-banner-dismissed', '1'); setBannerDismissed(true); }}>×</button></div>}
        {visibleError && <div className="sync-error"><Notice tone="warning">{visibleError}</Notice></div>}
        <Outlet />
        <footer className="mobile-disclaimer">This app is for personal planning, not regulated financial advice.</footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{navigation.slice(0, 5).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : ''} aria-label={label}><Icon size={18} /><span>{label}</span></NavLink>)}</nav>
  </div>;
}
