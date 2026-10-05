import { useState, useEffect } from 'react';
import { Users, UserCheck, Package, AlertTriangle, CreditCard, Car, Wrench, Home } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import { fmt, symbol } from '../utils/money';

function StatCard({ icon: Icon, label, value, sub, color = 'estate', trend }) {
  const colors = {
    estate: 'text-estate-400 bg-estate-900/40 border-estate-800/40',
    blue: 'text-blue-400 bg-blue-900/40 border-blue-800/40',
    amber: 'text-amber-400 bg-amber-900/40 border-amber-800/40',
    red: 'text-red-400 bg-red-900/40 border-red-800/40',
    purple: 'text-purple-400 bg-purple-900/40 border-purple-800/40',
  };
  return (
    <div className="card p-5 animate-fade-in">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${colors[color]}`}>
          <Icon size={20} />
        </div>
        {trend !== undefined && (
          <span className={`text-xs font-medium ${trend >= 0 ? 'text-estate-400' : 'text-red-400'}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-100">{value ?? '—'}</p>
      <p className="text-sm text-slate-400 mt-1">{label}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const isAnalyticsRole = ['ADMIN', 'FINANCE_ADMIN', 'SECURITY_ADMIN', 'MAINTENANCE_MANAGER'].includes(user.role);
    if (!isAnalyticsRole) { setLoading(false); return; }
    Promise.all([
      api.get('/analytics/dashboard').catch(() => null),
      api.get('/analytics/visitor-trends').catch(() => [])
    ]).then(([s, t]) => {
      setStats(s);
      setTrends(t.map(d => ({ ...d, date: d.date.slice(5) })));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-estate-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (user.role === 'RESIDENT') return <ResidentDashboard />;
  if (user.role === 'GUARD') return <GuardDashboard />;
  if (user.role === 'MAINTENANCE_MANAGER') return <MaintenanceDashboard stats={stats} />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">{new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Home} label="Occupancy Rate" value={`${stats?.occupancy?.rate ?? 0}%`} sub={`${stats?.occupancy?.occupied} / ${stats?.occupancy?.total} units`} color="estate" />
        <StatCard icon={Users} label="Residents" value={stats?.residents?.total} sub={`+${stats?.residents?.new} this month`} color="blue" />
        <StatCard icon={UserCheck} label="Visitors Today" value={stats?.visitors?.today} sub={`${stats?.visitors?.inside} inside now`} color="purple" />
        <StatCard icon={AlertTriangle} label="Active Emergencies" value={stats?.emergency?.active ?? 0} color="red" />
        <StatCard icon={CreditCard} label="Collected" value={`${fmt((stats?.billing?.collected || 0))}`} sub={`${fmt((stats?.billing?.outstanding || 0))} outstanding`} color="estate" />
        <StatCard icon={Package} label="Pending Parcels" value={stats?.parcels?.pending ?? 0} color="amber" />
        <StatCard icon={Wrench} label="Maintenance Open" value={stats?.maintenance?.pending ?? 0} color="amber" />
        <StatCard icon={Car} label="This Month Revenue" value={`${fmt((stats?.billing?.thisMonth || 0))}`} color="blue" />
      </div>

      {/* Visitor Trend Chart */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Visitor Trends — Last 7 Days</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={trends} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a2420" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} />
            <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
            <Tooltip contentStyle={{ background: '#141c18', border: '1px solid #1a3a28', borderRadius: 8, color: '#e2e8f0' }} />
            <Bar dataKey="count" name="Visitors" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MaintenanceDashboard({ stats }) {
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    api.get('/maintenance?status=OPEN').then(setRequests).catch(() => {});
  }, []);
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Maintenance Dashboard</h1>
          <p className="text-slate-500 text-sm">{new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={Wrench} label="Open Requests" value={stats?.maintenance?.pending ?? requests.length} color="amber" />
        <StatCard icon={Users} label="Total Residents" value={stats?.residents?.total} color="blue" />
        <StatCard icon={Home} label="Occupied Units" value={stats?.occupancy?.occupied} sub={`of ${stats?.occupancy?.total}`} color="estate" />
      </div>
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">Open Maintenance Requests</h2>
        <div className="space-y-2">
          {requests.length === 0 ? <p className="text-slate-500 text-sm">No open requests 🎉</p>
          : requests.slice(0, 8).map(r => (
            <div key={r.id} className="flex items-center justify-between p-3 rounded-xl bg-surface-900">
              <div>
                <p className="text-sm font-medium text-slate-200">{r.title}</p>
                <p className="text-xs text-slate-500">{r.category} · by {r.user?.name}</p>
              </div>
              <span className={`badge text-xs ${r.priority === 'URGENT' ? 'badge-red' : r.priority === 'HIGH' ? 'badge-yellow' : 'badge-gray'}`}>{r.priority}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResidentDashboard() {
  const { user } = useAuth();
  const [bills, setBills] = useState([]);
  const [visitors, setVisitors] = useState([]);

  useEffect(() => {
    api.get('/billing').then(setBills).catch(() => {});
    api.get('/visitors').then(setVisitors).catch(() => {});
  }, []);

  const unpaidBills = bills.filter(b => b.status === 'UNPAID');
  const recentVisitors = visitors.slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome, {user.name}!</h1>
          <p className="text-slate-500 text-sm mt-0.5">Your estate dashboard</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={CreditCard} label="Unpaid Bills" value={unpaidBills.length} color={unpaidBills.length > 0 ? 'red' : 'estate'} />
        <StatCard icon={UserCheck} label="Recent Visitors" value={recentVisitors.length} color="blue" />
      </div>
      {unpaidBills.length > 0 && (
        <div className="card p-4 border-amber-800/40">
          <p className="text-sm font-semibold text-amber-300 mb-3">⚠️ Outstanding Bills</p>
          {unpaidBills.slice(0, 3).map(b => (
            <div key={b.id} className="flex items-center justify-between py-2 border-b border-slate-800/50 last:border-0">
              <span className="text-sm text-slate-300">{b.title}</span>
              <span className="text-sm font-mono text-amber-300">{fmt(b.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GuardDashboard() {
  const [vStats, setVStats] = useState({});

  useEffect(() => {
    api.get('/visitors/today/stats').then(setVStats).catch(() => {});
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="page-title">Guard Dashboard</h1>
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={UserCheck} label="Today's Visitors" value={vStats.total ?? 0} color="blue" />
        <StatCard icon={Users} label="Currently Inside" value={vStats.inside ?? 0} color="estate" />
        <StatCard icon={AlertTriangle} label="Pending Approval" value={vStats.pending ?? 0} color="amber" />
      </div>
    </div>
  );
}
