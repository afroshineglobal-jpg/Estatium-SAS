// Analytics.jsx
import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';
import api from '../utils/api';
import { fmt, symbol } from '../utils/money';

const COLORS = ['#16a34a', '#2563eb', '#d97706', '#dc2626', '#7c3aed'];

export function Analytics() {
  const [dash, setDash] = useState(null);
  const [trends, setTrends] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/analytics/dashboard'),
      api.get('/analytics/visitor-trends'),
      api.get('/analytics/billing-breakdown')
    ]).then(([d, t, b]) => {
      setDash(d);
      setTrends(t.map(x => ({ ...x, date: x.date.slice(5) })));
      setBreakdown(b.map(x => ({ name: x.type, value: x._sum.amount || 0, count: x._count })));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-estate-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header"><h1 className="page-title">Analytics & Reports</h1></div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Occupancy', value: `${dash?.occupancy?.rate ?? 0}%`, sub: `${dash?.occupancy?.occupied}/${dash?.occupancy?.total} units` },
          { label: 'Revenue Collected', value: `${fmt((dash?.billing?.collected || 0))}` },
          { label: 'Outstanding', value: `${fmt((dash?.billing?.outstanding || 0))}` },
          { label: 'This Month', value: `${fmt((dash?.billing?.thisMonth || 0))}` },
        ].map((s, i) => (
          <div key={i} className="card p-4">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className="text-xl font-bold text-slate-100">{s.value}</p>
            {s.sub && <p className="text-xs text-slate-500 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Visitor Trends — 7 Days</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2420" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#141c18', border: '1px solid #1a3a28', borderRadius: 8, color: '#e2e8f0' }} />
              <Bar dataKey="count" name="Visitors" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-4">Billing by Category</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={breakdown} cx="50%" cy="50%" outerRadius={70} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                {breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: '#141c18', border: '1px solid #1a3a28', borderRadius: 8, color: '#e2e8f0' }} formatter={(v) => `${fmt(v)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: 'Active Residents', value: dash?.residents?.total },
          { label: 'Visitors Inside Now', value: dash?.visitors?.inside },
          { label: 'Visitors Today', value: dash?.visitors?.today },
          { label: 'Pending Maintenance', value: dash?.maintenance?.pending },
          { label: 'Pending Parcels', value: dash?.parcels?.pending },
          { label: 'Active Emergencies', value: dash?.emergency?.active, alert: dash?.emergency?.active > 0 },
        ].map((s, i) => (
          <div key={i} className={`card p-4 ${s.alert ? 'border-red-800/50' : ''}`}>
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.alert ? 'text-red-400' : 'text-slate-100'}`}>{s.value ?? '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Analytics;
