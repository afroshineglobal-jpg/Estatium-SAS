// Staff.jsx
import { useState, useEffect } from 'react';
import { Plus, Briefcase } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import TempPasswordModal from '../components/TempPasswordModal';
import StaffDetail, { STATUS_LABEL, STATUS_BADGE } from '../components/StaffDetail';
import { downloadCsv } from '../utils/download';

export function Staff() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [qrStaff, setQrStaff] = useState(null);
  const [shown, setShown] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [filter, setFilter] = useState('WORKING');
  const [form, setForm] = useState({ name: '', email: '', phone: '', staffType: 'GUARD', accessStart: '07:00', accessEnd: '18:00' });

  const load = async () => {
    try { setStaff(await api.get('/staff')); }
    catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const addStaff = async () => {
    if (!form.name || !form.email) return toast.error('Name and email required');
    try {
      const r = await api.post('/staff', { ...form, password: form.password || undefined });
      toast.success('Staff member added');
      if (r.temporaryPassword) setShown({ email: form.email, password: r.temporaryPassword });
      setModal(false);
      setForm({ name: '', email: '', phone: '', staffType: 'GUARD', accessStart: '07:00', accessEnd: '18:00' });
      load();
    } catch {}
  };

  const resetPw = async (s) => {
    if (!window.confirm(`Reset the password for ${s.user?.name}? They will be signed out everywhere.`)) return;
    try { const r = await api.post(`/staff/${s.id}/reset-password`); setShown({ email: r.email, password: r.temporaryPassword }); } catch {}
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {shown && <TempPasswordModal {...shown} onClose={() => setShown(null)} />}
      {detailId && <StaffDetail id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
      <div className="page-header">
        <div><h1 className="page-title">Staff Management</h1><p className="text-slate-500 text-sm">{staff.filter(s => s.status === 'ACTIVE').length} working · {staff.length} on record</p></div>
        <div className="flex gap-2"><button className="btn-secondary" onClick={() => downloadCsv('/exports/staff.csv', {}, 'staff')}>Export staff</button>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> Add Staff</button></div>
      </div>
      <div className="flex gap-2 flex-wrap">{[['WORKING', 'Working'], ['SUSPENDED', 'Suspended'], ['DEACTIVATED', 'Deactivated'], ['LEFT', 'Left'], ['ALL', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter(k)}>{l}</button>)}</div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? <p className="text-slate-500 text-sm">Loading...</p>
        : staff.filter(s => filter === 'ALL' || (filter === 'WORKING' ? s.status === 'ACTIVE' : s.status === filter)).map(s => (
          <div key={s.id} className="card p-4 flex items-center gap-4 cursor-pointer" onClick={() => setDetailId(s.id)}>
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-lg font-bold text-slate-300 flex-shrink-0">
              {s.user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-100">{s.user?.name}</p>
              <p className="text-xs text-slate-500">{s.staffType} · {s.employedBy}</p>
              <p className="text-xs text-slate-600">{s.accessStart} – {s.accessEnd}</p>
              <p className="text-xs text-slate-500 truncate">{s.user?.email}{s.user?.phone ? ` · ${s.user.phone}` : ''}</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className={`badge text-xs ${STATUS_BADGE[s.status] || 'badge-gray'}`}>{STATUS_LABEL[s.status] || s.status}</span>
              <button className="btn-ghost text-xs text-estate-400" onClick={(e) => { e.stopPropagation(); setQrStaff(s); }}>QR</button>
              <button className="btn-ghost text-xs text-amber-400" onClick={(e) => { e.stopPropagation(); resetPw(s); }}>Reset password</button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-100 mb-4">Add Staff Member</h3>
            <div className="space-y-3">
              <div><label className="label">Full Name *</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              <div><label className="label">Email *</label><input className="input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} /></div>
              <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
              <div><label className="label">Password (optional)</label><input className="input" type="text" value={form.password || ''} onChange={e => setForm({...form, password: e.target.value})} placeholder="Leave blank to generate a temporary one" /></div>
              <div><label className="label">Staff Type</label>
                <select className="select" value={form.staffType} onChange={e => setForm({...form, staffType: e.target.value})}>
                  {['GUARD', 'CLEANER', 'ELECTRICIAN', 'PLUMBER', 'GARDENER', 'OTHER'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Access From</label><input type="time" className="input" value={form.accessStart} onChange={e => setForm({...form, accessStart: e.target.value})} /></div>
                <div><label className="label">Access Until</label><input type="time" className="input" value={form.accessEnd} onChange={e => setForm({...form, accessEnd: e.target.value})} /></div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={addStaff}>Add Staff</button>
            </div>
          </div>
        </div>
      )}
      {qrStaff && (
        <div className="modal-overlay" onClick={() => setQrStaff(null)}>
          <div className="modal p-6 text-center" onClick={e => e.stopPropagation()}>
            <p className="text-lg font-semibold text-slate-100 mb-1">{qrStaff.user?.name}</p>
            <p className="text-sm text-slate-400 mb-4">{qrStaff.staffType} Access Badge</p>
            <div className="bg-white p-4 rounded-xl inline-block mb-4">
              <QRCodeSVG value={JSON.stringify({ staffId: qrStaff.id, type: 'STAFF' })} size={180} />
            </div>
            <p className="text-xs text-slate-500">Valid: {qrStaff.accessStart} – {qrStaff.accessEnd}</p>
            <button className="btn-secondary mt-4" onClick={() => setQrStaff(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Staff;
