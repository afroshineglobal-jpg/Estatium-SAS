import { useState, useEffect } from 'react';
import { Plus, Wrench, Clock, CheckCircle, Download, Check } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { fmt, symbol } from '../utils/money';
import { downloadInvoice } from '../utils/invoice';

const STAGES = [
  ['OPEN', 'Request received'], ['ACCEPTED', 'Accepted'], ['ASSIGNED', 'Person allocated for inspection'], ['IN_PROGRESS', 'Work in progress'],
  ['AWAITING_PARTS', 'Awaiting parts'], ['FIXED', 'Fixed'], ['COMPLETED', 'Completed'], ['CLOSED', 'Closed'], ['REJECTED', 'Declined'],
];
const stageLabel = (k) => (STAGES.find((x) => x[0] === k) || [k, k])[1];
const FLOW = STAGES.slice(0, 7).map((x) => x[0]);       // the path a request normally follows
const GROUPS = { '': null, open: ['OPEN', 'ACCEPTED', 'ASSIGNED'], progress: ['IN_PROGRESS', 'AWAITING_PARTS', 'FIXED'], done: ['COMPLETED', 'CLOSED', 'REJECTED'] };
const GROUP_LABEL = { '': 'All', open: 'New', progress: 'In progress', done: 'Finished' };

const BILLING = { PAID: ['Paid', 'badge-green'], PARTIAL: ['Part-paid', 'badge-yellow'], PENDING: ['Payment pending', 'badge-red'] };
const billingBadge = (b) => { if (!b || b.status === 'NONE') return null; const [t, c] = BILLING[b.status]; return <span className={`${c} text-[11px]`}>{t}{b.overdue && b.status !== 'PAID' ? ' · overdue' : ''}</span>; };

const priorityBadge = (p) => {
  const map = { LOW: 'badge-gray', MEDIUM: 'badge-blue', HIGH: 'badge-yellow', URGENT: 'badge-red' };
  return <span className={map[p] || 'badge-gray'}>{p}</span>;
};
const statusBadge = (s) => {
  const map = { OPEN: 'badge-yellow', ACCEPTED: 'badge-blue', ASSIGNED: 'badge-blue', IN_PROGRESS: 'badge-blue', AWAITING_PARTS: 'badge-yellow', FIXED: 'badge-green', COMPLETED: 'badge-green', CLOSED: 'badge-gray', REJECTED: 'badge-red' };
  return <span className={map[s] || 'badge-gray'}>{stageLabel(s)}</span>;
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

function UpdateModal({ request, onClose, onDone, canInvoice }) {
  const [f, setF] = useState({ status: request.status, assigneeName: request.assigneeName || '', expectedDate: request.expectedDate ? request.expectedDate.slice(0, 10) : '',
    estimatedCost: request.estimatedCost || '', actualCost: request.actualCost || '', message: '', notes: request.notes || '' });
  const suggested = request.actualCost || request.estimatedCost || '';
  const [inv, setInv] = useState({ amount: request.billing?.status === 'NONE' || !request.billing ? String(suggested) : '', description: '' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await api.put(`/maintenance/${request.id}`, { status: f.status, assigneeName: f.assigneeName, expectedDate: f.expectedDate || null,
        estimatedCost: f.estimatedCost === '' ? null : Number(f.estimatedCost), actualCost: f.actualCost === '' ? null : Number(f.actualCost), message: f.message, notes: f.notes });
      toast.success(f.status !== request.status ? 'Stage updated. The resident has been notified' : 'Request updated');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };
  const raise = async () => {
    if (!(Number(inv.amount) > 0)) return toast.error('Enter the invoice amount');
    setLoading(true);
    try { const b = await api.post(`/maintenance/${request.id}/invoice`, { amount: Number(inv.amount), description: inv.description }); toast.success(`Invoice ${b.invoiceNo} sent to the resident`); setInv({ amount: '', description: '' }); onDone(); }
    catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-1">Update request</h3>
        <p className="text-slate-400 text-sm mb-4">{request.title} · {request.user?.name}</p>
        <div className="space-y-3">
          <div><label className="label">Stage</label>
            <select className="select" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Person allocated</label><input className="input" maxLength={120} value={f.assigneeName} onChange={e => setF({ ...f, assigneeName: e.target.value })} placeholder="Name of inspector / technician" /></div>
            <div><label className="label">Expected date</label><input type="date" className="input" value={f.expectedDate} onChange={e => setF({ ...f, expectedDate: e.target.value })} /></div>
          </div>
          <div><label className="label">Message to the resident (shown in their timeline)</label><input className="input" maxLength={500} value={f.message} onChange={e => setF({ ...f, message: e.target.value })} placeholder="e.g. Electrician will visit tomorrow morning" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Estimated cost ({symbol()})</label><input type="number" min="0" className="input" value={f.estimatedCost} onChange={e => setF({ ...f, estimatedCost: e.target.value })} /></div>
            <div><label className="label">Final cost ({symbol()})</label><input type="number" min="0" className="input" value={f.actualCost} onChange={e => setF({ ...f, actualCost: e.target.value })} /></div>
          </div>
          <div><label className="label">Internal notes (residents do not see these)</label><textarea className="input resize-none h-14" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <div className="flex gap-3 mt-4">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : 'Save'}</button>
        </div>
        {canInvoice && (
          <div className="mt-5 pt-4 border-t border-slate-800 space-y-2">
            <p className="text-sm font-semibold text-slate-200">Convert to invoice {request.billing && request.billing.status !== 'NONE' && <span className="ml-2">{billingBadge(request.billing)}</span>}</p>
            <p className="text-xs text-slate-500">The cost is filled in for you. It becomes an invoice the resident can pay, and this request then shows Paid or Pending. Use it at any stage: inspection fee, parts deposit or final bill. You can raise several; repair-work tax from Settings is added.</p>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" min="0" className="input" placeholder={`Amount (${symbol()})`} value={inv.amount} onChange={e => setInv({ ...inv, amount: e.target.value })} />
              <input className="input col-span-2" maxLength={500} placeholder="What is it for? (optional)" value={inv.description} onChange={e => setInv({ ...inv, description: e.target.value })} />
            </div>
            <button className="btn-secondary w-full text-sm" onClick={raise} disabled={loading}>Convert to invoice and send to resident</button>
          </div>
        )}
      </div>
    </div>
  );
}

function TrackModal({ id, onClose }) {
  const [r, setR] = useState(null);
  useEffect(() => { api.get(`/maintenance/${id}`).then(setR).catch(onClose); }, [id]);
  if (!r) return null;
  const idx = FLOW.indexOf(r.status);
  const declined = r.status === 'REJECTED';
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1"><h3 className="text-lg font-semibold text-slate-100">{r.title}</h3>{statusBadge(r.status)}</div>
        <p className="text-slate-400 text-sm mb-2">{r.description}</p>
        {r.billing?.status !== 'NONE' && <p className="mb-4 text-sm text-slate-300">Billing: {billingBadge(r.billing)} <span className="text-xs text-slate-500 ml-1">{fmt(r.billing.paid)} of {fmt(r.billing.total)} paid</span></p>}

        {declined ? <p className="text-sm text-red-300 mb-4">This request was declined.</p> : (
          <ol className="mb-4 space-y-2">
            {FLOW.map((k, i) => { const done = i < idx || r.status === 'CLOSED'; const now = i === idx; return (
              <li key={k} className="flex items-center gap-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${done ? 'bg-estate-700 text-white' : now ? 'bg-amber-500 text-black font-bold' : 'bg-slate-800 text-slate-500'}`}>{done ? <Check size={13} /> : i + 1}</span>
                <span className={`text-sm ${now ? 'text-slate-100 font-semibold' : done ? 'text-slate-300' : 'text-slate-500'}`}>{stageLabel(k)}</span>
              </li>); })}
          </ol>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          {r.assigneeName && <div><p className="text-slate-500 text-xs">Person allocated</p><p className="text-slate-200">{r.assigneeName}</p></div>}
          {r.expectedDate && <div><p className="text-slate-500 text-xs">Expected date</p><p className="text-slate-200">{new Date(r.expectedDate).toLocaleDateString()}</p></div>}
          {r.estimatedCost && <div><p className="text-slate-500 text-xs">Estimated cost</p><p className="text-slate-200">{fmt(r.estimatedCost)}</p></div>}
          {r.actualCost && <div><p className="text-slate-500 text-xs">Final cost</p><p className="text-slate-200">{fmt(r.actualCost)}</p></div>}
        </div>

        {r.invoices?.length > 0 && (
          <div className="mb-4"><p className="text-sm font-semibold text-slate-200 mb-2">Invoices</p>
            <div className="space-y-2">{r.invoices.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-2 bg-surface-800 rounded-lg p-2.5">
                <div className="min-w-0"><p className="text-xs font-mono text-estate-400">{b.invoiceNo}</p><p className="text-sm text-slate-200">{fmt(b.amount)} <span className="text-xs text-slate-500">· {b.status}</span></p></div>
                <button className="btn-ghost text-xs" onClick={() => downloadInvoice(b)}><Download size={14} /> PDF</button>
              </div>))}</div></div>
        )}

        <p className="text-sm font-semibold text-slate-200 mb-2">Updates</p>
        <div className="space-y-2.5 mb-2">
          {[...(r.timeline || [])].reverse().map((t, i) => (
            <div key={i} className="border-l-2 border-slate-700 pl-3"><p className="text-sm text-slate-200">{stageLabel(t.status)}{t.note ? <span className="text-slate-400">: {t.note}</span> : null}</p><p className="text-xs text-slate-500">{new Date(t.at).toLocaleString()}{t.by ? ` · ${t.by}` : ''}</p></div>))}
          {!(r.timeline || []).length && <p className="text-sm text-slate-500">No updates yet.</p>}
        </div>
        <button className="btn-secondary w-full mt-3" onClick={onClose}>Close</button>
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
  const [tracking, setTracking] = useState(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    try { setRequests(await api.get('/maintenance')); } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const isManager = ['ADMIN', 'MAINTENANCE_MANAGER'].includes(user.role);
  const canInvoice = ['ADMIN', 'FINANCE_ADMIN'].includes(user.role);
  const shown = GROUPS[filter] ? requests.filter(r => GROUPS[filter].includes(r.status)) : requests;
  const openCount = requests.filter(r => !GROUPS.done.includes(r.status)).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div><h1 className="page-title">Maintenance</h1><p className="text-slate-500 text-sm">{openCount} open request{openCount === 1 ? '' : 's'}</p></div>
        {['RESIDENT', 'ADMIN'].includes(user.role) && (
          <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> New Request</button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.keys(GROUPS).map(g => (
          <button key={g} onClick={() => setFilter(g)} className={`btn-${filter === g ? 'primary' : 'secondary'} text-xs px-3`}>{GROUP_LABEL[g]}</button>
        ))}
      </div>

      {/* Phones: cards */}
      <div className="md:hidden space-y-3">
        {loading ? <p className="text-center py-10 text-slate-500">Loading...</p> : shown.length === 0 ? <p className="text-center py-10 text-slate-500">No requests found</p> : shown.map(r => (
          <div key={r.id} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-3"><p className="font-medium text-slate-200 break-words min-w-0">{r.title}</p>{statusBadge(r.status)}</div>
            <p className="text-xs text-slate-500 line-clamp-2">{r.description}</p>
            {isManager && <p className="text-xs text-slate-500">By {r.user?.name}</p>}
            <div className="flex items-center justify-between text-xs text-slate-500"><span>{priorityBadge(r.priority)} <span className="ml-1">{r.category}</span></span><span>{new Date(r.createdAt).toLocaleDateString()}</span></div>
            {(r.billing?.status !== 'NONE' || r.actualCost || r.estimatedCost) && <div className="flex items-center justify-between text-xs"><span className="font-mono text-slate-300">{r.actualCost ? fmt(r.actualCost) : r.estimatedCost ? `~${fmt(r.estimatedCost)}` : ''}</span>{billingBadge(r.billing) || <span className="text-slate-600">Not billed</span>}</div>}
            <div className="flex gap-2 pt-1">
              <button className="btn-secondary text-xs flex-1" onClick={() => setTracking(r.id)}>Track</button>
              {isManager && <button className="btn-primary text-xs flex-1" onClick={() => setUpdating(r)}>Update</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="table-container hidden md:block">
        <table className="table">
          <thead><tr>
            <th>Request</th><th>Category</th><th>Priority</th><th>Stage</th>
            <th>Cost</th><th>Date</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">Loading...</td></tr>
            : shown.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">No requests found</td></tr>
            : shown.map(r => (
              <tr key={r.id}>
                <td>
                  <p className="font-medium text-slate-200">{r.title}</p>
                  <p className="text-xs text-slate-500 truncate max-w-xs">{r.description}</p>
                  {isManager && <p className="text-xs text-slate-600">By {r.user?.name}</p>}
                </td>
                <td><span className="badge-gray text-xs">{r.category}</span></td>
                <td>{priorityBadge(r.priority)}</td>
                <td>{statusBadge(r.status)}{r.assigneeName && <p className="text-[11px] text-slate-500 mt-1">{r.assigneeName}</p>}</td>
                <td className="font-mono text-slate-400 text-sm">{r.actualCost ? `${fmt(r.actualCost)}` : r.estimatedCost ? `~${fmt(r.estimatedCost)}` : '—'}<div className="mt-1 font-sans">{billingBadge(r.billing) || (r.actualCost || r.estimatedCost ? <span className="text-[11px] text-slate-600">Not billed</span> : null)}</div></td>
                <td className="text-slate-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="whitespace-nowrap">
                  <button className="btn-ghost text-xs" onClick={() => setTracking(r.id)}>Track</button>
                  {isManager && <button className="btn-ghost text-xs" onClick={() => setUpdating(r)}>Update</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <NewRequestModal onClose={() => setModal(false)} onDone={load} />}
      {updating && <UpdateModal request={updating} canInvoice={canInvoice} onClose={() => setUpdating(null)} onDone={load} />}
      {tracking && <TrackModal id={tracking} onClose={() => setTracking(null)} />}
    </div>
  );
}
