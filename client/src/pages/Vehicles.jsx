// Vehicles.jsx
import { useState, useEffect } from 'react';
import { Plus, Car, LogIn, LogOut } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';

function AddVehicleModal({ onClose, onDone, residents }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ plateNumber: '', make: '', model: '', color: '', type: 'CAR', residentId: '' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.plateNumber) return toast.error('Plate number required');
    setLoading(true);
    try {
      await api.post('/vehicles', form);
      toast.success(user.role === 'RESIDENT' ? 'Request sent — waiting for estate admin approval' : 'Vehicle registered');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-1">{user.role === 'RESIDENT' ? 'Request Vehicle Registration' : 'Register Vehicle'}</h3>
        {user.role === 'RESIDENT' && <p className="text-xs text-slate-500 mb-4">Your estate administrator must approve the vehicle before the gate accepts it.</p>}
        <div className="space-y-3">
          <div><label className="label">Plate Number *</label><input className="input uppercase" value={form.plateNumber} onChange={e => setForm({...form, plateNumber: e.target.value.toUpperCase()})} placeholder="e.g. LAG-456-XY" /></div>
          {['ADMIN', 'SECURITY_ADMIN'].includes(user.role) && (
            <div>
              <label className="label">Resident</label>
              <select className="select" value={form.residentId} onChange={e => setForm({...form, residentId: e.target.value})}>
                <option value="">Select...</option>
                {residents.map(r => <option key={r.id} value={r.id}>{r.user?.name} — {r.unit?.block?.name}-{r.unit?.unitNumber}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div><label className="label">Make</label><input className="input" value={form.make} onChange={e => setForm({...form, make: e.target.value})} placeholder="Toyota" /></div>
            <div><label className="label">Model</label><input className="input" value={form.model} onChange={e => setForm({...form, model: e.target.value})} placeholder="Camry" /></div>
            <div><label className="label">Color</label><input className="input" value={form.color} onChange={e => setForm({...form, color: e.target.value})} placeholder="Black" /></div>
          </div>
          <div><label className="label">Type</label>
            <select className="select" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
              {['CAR', 'BIKE', 'TRUCK', 'OTHER'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : user.role === 'RESIDENT' ? 'Send request' : 'Register'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Vehicles() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [residents, setResidents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [qrVehicle, setQrVehicle] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const isAdmin = user.role === 'ADMIN';
  const pending = vehicles.filter(v => v.status === 'PENDING').length;
  const shown = vehicles.filter(v => filter === 'ALL' || v.status === filter);

  const load = async () => {
    try {
      const canList = ['ADMIN', 'SECURITY_ADMIN'].includes(user.role);            // only roles the server allows, so residents never trigger "Access denied"
      const canLogs = ['GUARD', 'SECURITY_ADMIN', 'ADMIN'].includes(user.role);
      const [v, r, l] = await Promise.all([
        api.get('/vehicles'),
        canList ? api.get('/residents').catch(() => []) : [],
        canLogs ? api.get('/vehicles/logs').catch(() => []) : []
      ]);
      setVehicles(v); setResidents(r); setLogs(l);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const logVehicle = async (vehicleId, action) => {
    try {
      await api.post(`/vehicles/${vehicleId}/log`, { action });
      toast.success(`Vehicle ${action} logged`);
      load();
    } catch {}
  };

  const decide = async (id, kind) => {
    let body = {};
    if (kind === 'reject') { const reason = window.prompt('Reason (the resident will see this):'); if (!reason) return; body = { reason }; }
    try { await api.post(`/vehicles/${id}/${kind}`, body); toast.success(kind === 'approve' ? 'Vehicle approved' : 'Request rejected'); load(); } catch {}
  };
  const cancelReq = async (id) => { if (!window.confirm('Withdraw this request?')) return; try { await api.post(`/vehicles/${id}/cancel`); toast.success('Request withdrawn'); load(); } catch {} };
  const badge = { PENDING: 'badge-yellow', APPROVED: 'badge-green', REJECTED: 'badge-red' };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div><h1 className="page-title">Vehicle Management</h1><p className="text-slate-500 text-sm">{vehicles.length} vehicles{isAdmin && pending ? ` · ${pending} waiting for approval` : ''}</p></div>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> {user.role === 'RESIDENT' ? 'Request Registration' : 'Register Vehicle'}</button>
      </div>

      {(isAdmin || user.role === 'RESIDENT') && (
        <div className="flex gap-2 flex-wrap">{['ALL', 'PENDING', 'APPROVED', 'REJECTED'].map(s => <button key={s} onClick={() => setFilter(s)} className={filter === s ? 'btn-primary' : 'btn-secondary'}>{s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}</button>)}</div>
      )}

      <div className="table-container">
        <table className="table">
          <thead><tr><th>Plate</th><th>Vehicle</th><th>Owner</th><th>Unit</th><th>Status</th><th>QR</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">Loading...</td></tr>
            : shown.map(v => (
              <tr key={v.id}>
                <td><span className="font-mono font-bold text-estate-300">{v.plateNumber}</span></td>
                <td className="text-slate-300">{v.make} {v.model} <span className="text-slate-500">· {v.color}</span></td>
                <td className="text-slate-400">{v.resident?.user?.name}</td>
                <td className="text-slate-400">{v.resident?.unit?.block?.name}-{v.resident?.unit?.unitNumber}</td>
                <td>
                  <span className={`badge ${badge[v.status] || 'badge-yellow'}`}>{v.status}</span>
                  {v.status === 'REJECTED' && v.reviewNote && <p className="text-xs text-red-300 mt-1 max-w-[220px]">Reason: {v.reviewNote}</p>}
                </td>
                <td>
                  {v.status === 'APPROVED' && <button className="btn-ghost text-xs text-estate-400" onClick={() => setQrVehicle(v)}>QR</button>}
                </td>
                <td>
                  {isAdmin && v.status === 'PENDING' && (
                    <div className="flex gap-1 mb-1">
                      <button className="btn-primary text-xs px-2 py-1" onClick={() => decide(v.id, 'approve')}>Approve</button>
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => decide(v.id, 'reject')}>Reject</button>
                    </div>
                  )}
                  {user.role === 'RESIDENT' && v.status === 'PENDING' && <button className="btn-ghost text-xs text-amber-400" onClick={() => cancelReq(v.id)}>Withdraw</button>}
                  {v.status === 'APPROVED' && ['GUARD', 'SECURITY_ADMIN', 'ADMIN'].includes(user.role) && (
                    <div className="flex gap-1">
                      <button className="btn-ghost text-xs text-estate-400" onClick={() => logVehicle(v.id, 'ENTRY')} title="Log Entry"><LogIn size={14} /></button>
                      <button className="btn-ghost text-xs text-amber-400" onClick={() => logVehicle(v.id, 'EXIT')} title="Log Exit"><LogOut size={14} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Today's Logs */}
      {logs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Today's Vehicle Movements</h2>
          <div className="grid gap-2">
            {logs.slice(0, 10).map(l => (
              <div key={l.id} className="card p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`badge ${l.action === 'ENTRY' ? 'badge-green' : 'badge-yellow'}`}>{l.action}</span>
                  <span className="font-mono text-slate-200">{l.vehicle?.plateNumber}</span>
                  <span className="text-slate-400 text-sm">{l.vehicle?.resident?.user?.name}</span>
                </div>
                <span className="text-xs text-slate-500">{new Date(l.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal && <AddVehicleModal onClose={() => setModal(false)} onDone={load} residents={residents} />}
      {qrVehicle && (
        <div className="modal-overlay" onClick={() => setQrVehicle(null)}>
          <div className="modal p-6 text-center" onClick={e => e.stopPropagation()}>
            <p className="text-lg font-semibold text-slate-100 mb-4">{qrVehicle.plateNumber}</p>
            <div className="bg-white p-4 rounded-xl inline-block mb-4">
              <QRCodeSVG value={JSON.stringify({ plate: qrVehicle.plateNumber, type: 'VEHICLE' })} size={180} />
            </div>
            <p className="text-slate-400 text-sm">Scan at the gate for quick entry/exit logging</p>
            <button className="btn-secondary mt-4" onClick={() => setQrVehicle(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
