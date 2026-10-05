import { useState, useEffect } from 'react';
import { Plus, Package, CheckCircle, Clock, Search } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

function LogParcelModal({ onClose, onDone, units }) {
  const [form, setForm] = useState({ unitId: '', senderName: '', carrier: '', description: '' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.unitId) return toast.error('Unit required');
    setLoading(true);
    try {
      const p = await api.post('/parcels', form);
      toast.success(`Parcel logged. OTP: ${p.otp}`);
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Log New Parcel</h3>
        <div className="space-y-3">
          <div>
            <label className="label">Recipient Unit *</label>
            <select className="select" value={form.unitId} onChange={e => setForm({...form, unitId: e.target.value})}>
              <option value="">Select unit...</option>
              {units.filter(u => u.isOccupied).map(u => (
                <option key={u.id} value={u.id}>{u.block?.name}-{u.unitNumber} ({u.residents?.[0]?.user?.name || 'Resident'})</option>
              ))}
            </select>
          </div>
          <div><label className="label">Sender Name</label><input className="input" value={form.senderName} onChange={e => setForm({...form, senderName: e.target.value})} placeholder="e.g. Amazon, DHL" /></div>
          <div><label className="label">Carrier / Courier</label><input className="input" value={form.carrier} onChange={e => setForm({...form, carrier: e.target.value})} placeholder="e.g. GIG Logistics" /></div>
          <div><label className="label">Description</label><input className="input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Brief description" /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? 'Logging...' : 'Log Parcel & Notify'}</button>
        </div>
      </div>
    </div>
  );
}

function CollectModal({ parcel, onClose, onDone }) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await api.put(`/parcels/${parcel.id}/collect`, { otp });
      toast.success('Parcel collected!');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-2">Collect Parcel</h3>
        <p className="text-slate-400 text-sm mb-4">{parcel.senderName ? `From: ${parcel.senderName}` : 'Enter OTP to confirm collection'}</p>
        <div>
          <label className="label">OTP (sent to resident)</label>
          <input className="input text-center text-2xl font-mono tracking-widest" value={otp} onChange={e => setOtp(e.target.value)} placeholder="••••••" maxLength={6} />
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : 'Confirm Collected'}</button>
        </div>
      </div>
    </div>
  );
}

export function Parcels() {
  const { user } = useAuth();
  const [parcels, setParcels] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [collecting, setCollecting] = useState(null);

  const load = async () => {
    try {
      const [p, u] = await Promise.all([api.get('/parcels'), api.get('/residents/units')]);
      setParcels(p); setUnits(u);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const pending = parcels.filter(p => p.status === 'PENDING');
  const collected = parcels.filter(p => p.status === 'COLLECTED');

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Parcel Management</h1>
          <p className="text-slate-500 text-sm">{pending.length} awaiting collection</p>
        </div>
        {['GUARD', 'SECURITY_ADMIN', 'ADMIN'].includes(user.role) && (
          <button className="btn-primary" onClick={() => setModal('log')}><Plus size={16} /> Log Parcel</button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5 border-amber-800/30">
          <div className="flex items-center gap-3 mb-1">
            <Clock size={18} className="text-amber-400" />
            <span className="text-sm text-slate-400">Pending</span>
          </div>
          <p className="text-3xl font-bold text-amber-300">{pending.length}</p>
        </div>
        <div className="card p-5 border-estate-800/30">
          <div className="flex items-center gap-3 mb-1">
            <CheckCircle size={18} className="text-estate-400" />
            <span className="text-sm text-slate-400">Collected Today</span>
          </div>
          <p className="text-3xl font-bold text-estate-300">{collected.filter(p => new Date(p.collectedAt).toDateString() === new Date().toDateString()).length}</p>
        </div>
      </div>

      {/* Pending Parcels */}
      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-amber-300 mb-3">⏳ Awaiting Collection</h2>
          <div className="grid gap-3">
            {pending.map(p => (
              <div key={p.id} className="card p-4 border-amber-900/30 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-900/40 flex items-center justify-center">
                    <Package size={18} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-200">{p.senderName || 'Unknown Sender'}</p>
                    <p className="text-xs text-slate-500">Unit {p.unitId.slice(-8)} · {p.carrier || 'Unknown carrier'}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{new Date(p.loggedAt).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-slate-500">OTP</p>
                    <p className="font-mono text-estate-300 font-bold">{p.otp}</p>
                  </div>
                  {['GUARD', 'SECURITY_ADMIN', 'ADMIN'].includes(user.role) && (
                    <button className="btn-primary text-xs" onClick={() => setCollecting(p)}>
                      <CheckCircle size={14} /> Collect
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History Table */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">Collection History</h2>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Sender</th><th>Carrier</th><th>Logged</th><th>Collected</th><th>Status</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500">Loading...</td></tr>
              ) : parcels.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500">No parcels yet</td></tr>
              ) : parcels.slice(0, 30).map(p => (
                <tr key={p.id}>
                  <td className="font-medium text-slate-200">{p.senderName || '—'}</td>
                  <td className="text-slate-400">{p.carrier || '—'}</td>
                  <td className="text-slate-500 text-xs">{new Date(p.loggedAt).toLocaleString()}</td>
                  <td className="text-slate-500 text-xs">{p.collectedAt ? new Date(p.collectedAt).toLocaleString() : '—'}</td>
                  <td><span className={p.status === 'COLLECTED' ? 'badge-green' : 'badge-yellow'}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'log' && <LogParcelModal onClose={() => setModal(null)} onDone={load} units={units} />}
      {collecting && <CollectModal parcel={collecting} onClose={() => setCollecting(null)} onDone={load} />}
    </div>
  );
}

export default Parcels;
