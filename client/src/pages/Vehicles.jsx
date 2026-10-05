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
      toast.success('Vehicle registered');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Register Vehicle</h3>
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
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : 'Register'}</button>
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

  const load = async () => {
    try {
      const [v, r, l] = await Promise.all([
        api.get('/vehicles'),
        api.get('/residents').catch(() => []),
        api.get('/vehicles/logs').catch(() => [])
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

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div><h1 className="page-title">Vehicle Management</h1><p className="text-slate-500 text-sm">{vehicles.length} registered vehicles</p></div>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> Register Vehicle</button>
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr><th>Plate</th><th>Vehicle</th><th>Owner</th><th>Unit</th><th>QR</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-10 text-slate-500">Loading...</td></tr>
            : vehicles.map(v => (
              <tr key={v.id}>
                <td><span className="font-mono font-bold text-estate-300">{v.plateNumber}</span></td>
                <td className="text-slate-300">{v.make} {v.model} <span className="text-slate-500">· {v.color}</span></td>
                <td className="text-slate-400">{v.resident?.user?.name}</td>
                <td className="text-slate-400">{v.resident?.unit?.block?.name}-{v.resident?.unit?.unitNumber}</td>
                <td>
                  <button className="btn-ghost text-xs text-estate-400" onClick={() => setQrVehicle(v)}>QR</button>
                </td>
                <td>
                  {['GUARD', 'SECURITY_ADMIN', 'ADMIN'].includes(user.role) && (
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
