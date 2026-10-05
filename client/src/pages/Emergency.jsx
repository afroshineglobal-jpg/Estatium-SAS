import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, Zap } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

const typeMeta = {
  FIRE: { label: '🔥 Fire', color: 'text-red-400 bg-red-900/40 border-red-800/40' },
  MEDICAL: { label: '🏥 Medical', color: 'text-pink-400 bg-pink-900/40 border-pink-800/40' },
  SECURITY: { label: '🔒 Security', color: 'text-amber-400 bg-amber-900/40 border-amber-800/40' },
  UTILITY: { label: '⚡ Utility', color: 'text-blue-400 bg-blue-900/40 border-blue-800/40' },
  CUSTOM: { label: '📢 Custom', color: 'text-slate-400 bg-slate-800/40 border-slate-700/40' },
};

function SOSModal({ onClose, onDone }) {
  const [form, setForm] = useState({ type: 'SECURITY', description: '', location: '', severity: 'HIGH' });
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const submit = async () => {
    if (!confirm) { setConfirm(true); return; }
    setLoading(true);
    try {
      await api.post('/emergency', form);
      toast.error('🚨 Emergency reported! Guards and admin have been alerted.', { duration: 8000 });
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6 border-red-800/60" onClick={e => e.stopPropagation()}>
        <div className="text-center mb-5">
          <div className="w-16 h-16 rounded-full bg-red-900/60 border-2 border-red-700 flex items-center justify-center mx-auto mb-3 emergency-pulse">
            <AlertTriangle size={28} className="text-red-400" />
          </div>
          <h3 className="text-xl font-bold text-red-400">Report Emergency</h3>
          <p className="text-slate-400 text-sm mt-1">This will immediately alert all guards and administrators</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">Emergency Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(typeMeta).map(([k, v]) => (
                <button key={k} onClick={() => setForm({...form, type: k})}
                  className={`p-2 rounded-xl border text-xs font-medium transition-all ${form.type === k ? 'border-red-600 bg-red-900/40 text-red-300' : 'border-slate-700 text-slate-400'}`}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div><label className="label">Location / Details</label><input className="input border-red-900/60" value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="e.g. Block A, Ground Floor" /></div>
          <div><label className="label">Description</label><textarea className="input resize-none h-16 border-red-900/60" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Brief description of the emergency..." /></div>
          <div>
            <label className="label">Severity</label>
            <select className="select border-red-900/60" value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">🚨 Critical</option>
            </select>
          </div>
        </div>
        {confirm && (
          <div className="mt-3 p-3 bg-red-900/30 rounded-xl border border-red-800/40">
            <p className="text-red-300 text-sm text-center font-semibold">⚠️ Confirm — this will alert ALL guards and admins immediately</p>
          </div>
        )}
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-danger flex-1 justify-center" onClick={submit} disabled={loading}>
            {loading ? '🚨 Alerting...' : confirm ? '✅ Confirm Emergency!' : '🚨 Report Emergency'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Emergency() {
  const { user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  const load = async () => {
    try { setReports(await api.get('/emergency')); }
    catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const updateStatus = async (id, status, resolution) => {
    try {
      await api.put(`/emergency/${id}`, { status, resolution });
      toast.success('Status updated');
      load();
    } catch {}
  };

  const active = reports.filter(r => r.status === 'ACTIVE');
  const resolved = reports.filter(r => r.status === 'RESOLVED');

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Emergency Response</h1>
          <p className="text-slate-500 text-sm">{active.length} active · {resolved.length} resolved</p>
        </div>
        <button className="btn-danger" onClick={() => setModal(true)}>
          <AlertTriangle size={16} /> Report Emergency
        </button>
      </div>

      {/* SOS Button - Prominent for residents */}
      {user.role === 'RESIDENT' && (
        <div className="card p-6 text-center border-red-900/40">
          <p className="text-slate-400 text-sm mb-4">Press in case of emergency. Guards will be immediately notified.</p>
          <button onClick={() => setModal(true)}
            className="w-32 h-32 rounded-full bg-red-800 hover:bg-red-700 border-4 border-red-600 text-white font-bold text-lg transition-all active:scale-95 mx-auto flex flex-col items-center justify-center emergency-pulse">
            <AlertTriangle size={32} className="mb-1" />
            SOS
          </button>
        </div>
      )}

      {/* Active Emergencies */}
      {active.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /> Active Emergencies
          </h2>
          <div className="space-y-3">
            {active.map(r => {
              const meta = typeMeta[r.type] || typeMeta.CUSTOM;
              return (
                <div key={r.id} className="card p-4 border-red-800/40">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`px-3 py-1.5 rounded-xl border text-xs font-medium ${meta.color}`}>{meta.label}</div>
                      <div>
                        <p className="font-semibold text-slate-100">{r.type} Emergency</p>
                        <p className="text-sm text-slate-400">{r.description}</p>
                        {r.location && <p className="text-xs text-slate-500 mt-1">📍 {r.location}</p>}
                        <p className="text-xs text-slate-600 mt-1">Reported by {r.user?.name} · {new Date(r.createdAt).toLocaleTimeString()}</p>
                      </div>
                    </div>
                    <span className={`badge ${r.severity === 'CRITICAL' ? 'badge-red' : r.severity === 'HIGH' ? 'badge-red' : 'badge-yellow'}`}>{r.severity}</span>
                  </div>
                  {['ADMIN', 'SECURITY_ADMIN', 'GUARD'].includes(user.role) && (
                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-800/50">
                      {r.status === 'ACTIVE' && (
                        <button className="btn-secondary text-xs" onClick={() => updateStatus(r.id, 'ACKNOWLEDGED')}>
                          <CheckCircle size={14} /> Acknowledge
                        </button>
                      )}
                      <button className="btn-ghost text-xs text-estate-400" onClick={() => {
                        const res = prompt('Resolution note:');
                        if (res) updateStatus(r.id, 'RESOLVED', res);
                      }}>
                        ✅ Mark Resolved
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Incident History</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Type</th><th>Reported By</th><th>Location</th><th>Severity</th><th>Status</th><th>Time</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="text-center py-10 text-slate-500">Loading...</td></tr>
              : reports.length === 0 ? <tr><td colSpan={6} className="text-center py-10 text-slate-500">No incidents recorded</td></tr>
              : reports.map(r => (
                <tr key={r.id}>
                  <td><span className="text-sm">{typeMeta[r.type]?.label || r.type}</span></td>
                  <td className="text-slate-400">{r.user?.name}</td>
                  <td className="text-slate-500 text-sm">{r.location || '—'}</td>
                  <td><span className={`badge text-xs ${r.severity === 'CRITICAL' || r.severity === 'HIGH' ? 'badge-red' : 'badge-yellow'}`}>{r.severity}</span></td>
                  <td><span className={r.status === 'RESOLVED' ? 'badge-green' : r.status === 'ACKNOWLEDGED' ? 'badge-blue' : 'badge-red'}>{r.status}</span></td>
                  <td className="text-slate-500 text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && <SOSModal onClose={() => setModal(false)} onDone={load} />}
    </div>
  );
}
