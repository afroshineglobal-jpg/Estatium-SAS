import { useState, useEffect } from 'react';
import { Plus, Wrench, Clock, CheckCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { fmt, symbol } from '../utils/money';

const priorityBadge = (p) => {
  const map = { LOW: 'badge-gray', MEDIUM: 'badge-blue', HIGH: 'badge-yellow', URGENT: 'badge-red' };
  return <span className={map[p] || 'badge-gray'}>{p}</span>;
};
const statusBadge = (s) => {
  const map = { OPEN: 'badge-yellow', ASSIGNED: 'badge-blue', IN_PROGRESS: 'badge-blue', COMPLETED: 'badge-green', CLOSED: 'badge-gray' };
  return <span className={map[s] || 'badge-gray'}>{s}</span>;
};

function NewRequestModal({ onClose, onDone }) {
  const [form, setForm] = useState({ title: '', description: '', category: 'PLUMBING', priority: 'MEDIUM' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.title || !form.description) return toast.error('Title and description required');
    setLoading(true);
    try {
      await api.post('/maintenance', form);
      toast.success('Request submitted — maintenance team notified');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">New Maintenance Request</h3>
        <div className="space-y-3">
          <div><label className="label">Issue Title *</label><input className="input" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Leaking pipe in bathroom" /></div>
          <div><label className="label">Description *</label><textarea className="input resize-none h-20" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Describe the issue in detail..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Category</label>
              <select className="select" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                {['PLUMBING', 'ELECTRICAL', 'CARPENTRY', 'CLEANING', 'OTHER'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label className="label">Priority</label>
              <select className="select" value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : 'Submit Request'}</button>
        </div>
      </div>
    </div>
  );
}

function UpdateModal({ request, onClose, onDone }) {
  const [status, setStatus] = useState(request.status);
  const [actualCost, setActualCost] = useState(request.actualCost || '');
  const [notes, setNotes] = useState(request.notes || '');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await api.put(`/maintenance/${request.id}`, { status, actualCost: actualCost ? parseFloat(actualCost) : null, notes });
      toast.success('Request updated');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-1">Update Request</h3>
        <p className="text-slate-400 text-sm mb-4">{request.title}</p>
        <div className="space-y-3">
          <div><label className="label">Status</label>
            <select className="select" value={status} onChange={e => setStatus(e.target.value)}>
              {['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div><label className="label">Actual Cost ({symbol()})</label><input type="number" className="input" value={actualCost} onChange={e => setActualCost(e.target.value)} placeholder="0" /></div>
          <div><label className="label">Notes</label><textarea className="input resize-none h-16" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : 'Update'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Maintenance() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    try {
      const params = filter ? `?status=${filter}` : '';
      setRequests(await api.get(`/maintenance${params}`));
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const isManager = ['ADMIN', 'MAINTENANCE_MANAGER'].includes(user.role);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div><h1 className="page-title">Maintenance</h1><p className="text-slate-500 text-sm">{requests.filter(r => ['OPEN', 'ASSIGNED'].includes(r.status)).length} open requests</p></div>
        {['RESIDENT', 'ADMIN'].includes(user.role) && (
          <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> New Request</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {['', 'OPEN', 'IN_PROGRESS', 'COMPLETED'].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`btn-${filter === s ? 'primary' : 'secondary'} text-xs px-3`}>{s || 'All'}</button>
        ))}
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr>
            <th>Request</th><th>Category</th><th>Priority</th><th>Status</th>
            <th>Cost</th><th>Date</th>{isManager && <th>Actions</th>}
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">Loading...</td></tr>
            : requests.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">No requests found</td></tr>
            : requests.map(r => (
              <tr key={r.id}>
                <td>
                  <p className="font-medium text-slate-200">{r.title}</p>
                  <p className="text-xs text-slate-500 truncate max-w-xs">{r.description}</p>
                  {!isManager && <p className="text-xs text-slate-600">By {r.user?.name}</p>}
                </td>
                <td><span className="badge-gray text-xs">{r.category}</span></td>
                <td>{priorityBadge(r.priority)}</td>
                <td>{statusBadge(r.status)}</td>
                <td className="font-mono text-slate-400 text-sm">{r.actualCost ? `${fmt(r.actualCost)}` : '—'}</td>
                <td className="text-slate-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                {isManager && (
                  <td>
                    <button className="btn-ghost text-xs" onClick={() => setUpdating(r)}>Update</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <NewRequestModal onClose={() => setModal(false)} onDone={load} />}
      {updating && <UpdateModal request={updating} onClose={() => setUpdating(null)} onDone={load} />}
    </div>
  );
}
