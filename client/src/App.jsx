import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SocketProvider } from './hooks/useSocket';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Residents from './pages/Residents';
import Visitors from './pages/Visitors';
import Parcels from './pages/Parcels';
import Amenities from './pages/Amenities';
import Billing from './pages/Billing';
import Vehicles from './pages/Vehicles';
import Staff from './pages/Staff';
import Maintenance from './pages/Maintenance';
import Emergency from './pages/Emergency';
import Communication from './pages/Communication';
import Analytics from './pages/Analytics';
import Advertisements from './pages/Advertisements';
import Settings from './pages/Settings';
import Subscription from './pages/Subscription';
import PlatformApp, { PlatformLogin } from './platform/PlatformApp';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="fixed inset-0 bg-surface-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-estate-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-400 text-sm">Loading...</p>
      </div>
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function ChangePassword() {
  const { changePassword, logout } = useAuth();
  const [f, setF] = useState({ cur: '', next: '' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr('');
    try { await changePassword(f.cur, f.next); } catch (x) { setErr(x.response?.data?.error || 'Could not change password'); } };
  return (
    <div className="fixed inset-0 bg-surface-900 flex items-center justify-center p-4 z-50">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">Choose a new password</h2>
        <p className="text-sm text-slate-400">Your account uses a temporary password. Set your own (10+ characters, upper-case, lower-case and a digit).</p>
        {err && <div role="alert" className="text-sm text-red-300 bg-red-900/40 rounded px-3 py-2">{err}</div>}
        <input className="input" type="password" placeholder="Temporary password" value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} autoComplete="current-password" />
        <input className="input" type="password" placeholder="New password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" />
        <button className="btn-primary w-full justify-center">Save password</button>
        <button type="button" className="btn-ghost w-full justify-center text-xs" onClick={logout}>Sign out</button>
      </form>
    </div>
  );
}

function StatusBanner() {
  const { tenant } = useAuth();
  if (!tenant) return null;
  if (tenant.status === 'SUSPENDED') return <div className="bg-amber-900/60 text-amber-100 text-sm px-4 py-2 text-center lg:ml-[var(--sidebar-width)] pt-[calc(var(--header-height)+0.5rem)]">This estate is suspended — read-only mode. Emergency alerts still work. Contact your estate administrator.</div>;
  if (tenant.status === 'TRIAL' && tenant.trialEndsAt) { const d = Math.max(0, Math.ceil((new Date(tenant.trialEndsAt) - Date.now()) / 86400000)); return <div className="bg-blue-900/50 text-blue-100 text-xs px-4 py-1.5 text-center lg:ml-[var(--sidebar-width)] pt-[calc(var(--header-height)+0.25rem)]">Free trial: {d} day{d === 1 ? '' : 's'} left</div>; }
  return null;
}

function ExpiredScreen() {
  const { tenant, logout, can } = useAuth();
  return (
    <div className="fixed inset-0 bg-surface-900 flex items-center justify-center p-4 z-50">
      <div className="card p-6 max-w-md text-center space-y-3">
        <h2 className="text-lg font-semibold text-slate-100">Subscription expired</h2>
        <p className="text-sm text-slate-400">{tenant?.name}'s Estatium subscription has expired. {can('ADMIN', 'FINANCE_ADMIN') ? 'Settle the outstanding invoice or contact your account manager to reactivate.' : 'Please ask your estate administrator to renew.'}</p>
        <button className="btn-secondary" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, tenant } = useAuth();
  if (!user) return null;
  if (user.mustChangePassword) return <ChangePassword />;
  if (tenant?.status === 'EXPIRED') return <ExpiredScreen />;

  return (
    <div className="min-h-screen">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <Header onMenuToggle={() => setSidebarOpen(v => !v)} />
      <StatusBanner />
      <main className="lg:ml-[var(--sidebar-width)] pt-[var(--header-height)]">
        <div className="p-4 lg:p-6 max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/residents" element={<Residents />} />
            <Route path="/visitors" element={<Visitors />} />
            <Route path="/parcels" element={<Parcels />} />
            <Route path="/amenities" element={<Amenities />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/vehicles" element={<Vehicles />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/maintenance" element={<Maintenance />} />
            <Route path="/emergency" element={<Emergency />} />
            <Route path="/communication" element={<Communication />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/advertisements" element={<Advertisements />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/subscription" element={<Subscription />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <Toaster position="top-right" toastOptions={{
            style: { background: '#1a2420', color: '#e2e8f0', border: '1px solid #1a3a28', borderRadius: '12px' },
            success: { iconTheme: { primary: '#22c55e', secondary: '#0a2e1a' } },
          }} />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/platform/login" element={<PlatformLogin />} />
            <Route path="/platform/*" element={<PlatformApp />} />
            <Route path="/*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
          </Routes>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
