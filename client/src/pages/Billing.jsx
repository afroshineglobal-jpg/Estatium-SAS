import { useState, useEffect } from 'react';
import { Plus, CreditCard, CheckCircle, Clock, AlertCircle, TrendingUp } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { fmt, symbol } from '../utils/money';

const statusBadge = (s) => {
  const map = { PAID: 'badge-green', UNPAID: 'badge-yellow', OVERDUE: 'badge-red', WAIVED: 'badge-gray' };
  return <span className={map[s] || 'badge-gray'}>{s}</span>;
};

function AddBillModal({ onClose, onDone, residents }) {
  const [form, setForm] = useState({ residentId: '', title: '', amount: '', dueDate: '', type: 'MAINTENANCE', description: '' });
  const [isBulk, setIsBulk] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.title || !form.amount || !form.dueDate) return toast.error('Title, amount and due date required');
    if (!isBulk && !form.residentId) return toast.error('Select a resident');
    setLoading(true);
    try {
      if (isBulk) {
        const r = await api.post('/billing/bulk', form);
        toast.success(`Created ${r.created} bills for all residents`);
      } else {
        await api.post('/billing', form);
        toast.success('Bill created');
      }
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Create Bill</h3>
        <div className="flex gap-3 mb-4">
          <button className={`btn-${!isBulk ? 'primary' : 'secondary'} text-xs`} onClick={() => setIsBulk(false)}>Single Resident</button>
          <button className={`btn-${isBulk ? 'primary' : 'secondary'} text-xs`} onClick={() => setIsBulk(true)}>All Residents (Bulk)</button>
        </div>
        <div className="space-y-3">
          {!isBulk && (
            <div>
              <label className="label">Resident *</label>
              <select className="select" value={form.residentId} onChange={e => setForm({...form, residentId: e.target.value})}>
                <option value="">Select resident...</option>
                {residents.map(r => (
                  <option key={r.id} value={r.id}>{r.user?.name} — {r.unit?.block?.name}-{r.unit?.unitNumber}</option>
                ))}
              </select>
            </div>
          )}
          <div><label className="label">Bill Title *</label><input className="input" value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="e.g. Monthly Maintenance Levy" /></div>
          <div><label className="label">Amount ({symbol()}) *</label><input type="number" className="input" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} placeholder="15000" /></div>
          <div><label className="label">Due Date *</label><input type="date" className="input" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} /></div>
          <div>
            <label className="label">Type</label>
            <select className="select" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
              {['MAINTENANCE', 'UTILITY', 'PENALTY', 'AMENITY', 'ONE_TIME'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><label className="label">Description</label><textarea className="input resize-none h-16" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? 'Creating...' : isBulk ? 'Create for All' : 'Create Bill'}</button>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({ bill, onClose, onDone }) {
  const [form, setForm] = useState({ amount: bill.amount, method: 'CASH', reference: '', notes: '' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await api.post(`/billing/${bill.id}/pay`, form);
      toast.success('Payment recorded');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-1">Record Payment</h3>
        <p className="text-slate-400 text-sm mb-4">{bill.title} — {fmt(bill.amount)}</p>
        <div className="space-y-3">
          <div><label className="label">Amount Paid</label><input type="number" className="input" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} /></div>
          <div>
            <label className="label">Payment Method</label>
            <select className="select" value={form.method} onChange={e => setForm({...form, method: e.target.value})}>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="ONLINE">Online Payment</option>
            </select>
          </div>
          <div><label className="label">Reference / Transaction ID</label><input className="input" value={form.reference} onChange={e => setForm({...form, reference: e.target.value})} placeholder="Optional" /></div>
          <div><label className="label">Notes</label><input className="input" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? '...' : 'Record Payment'}</button>
        </div>
      </div>
    </div>
  );
}

export default function Billing() {
  const { user } = useAuth();
  const [bills, setBills] = useState([]);
  const [residents, setResidents] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [paying, setPaying] = useState(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    try {
      const params = filter ? `?status=${filter}` : '';
      const [b, r, s] = await Promise.all([
        api.get(`/billing${params}`),
        ['ADMIN', 'FINANCE_ADMIN'].includes(user.role) ? api.get('/residents') : Promise.resolve([]),
        ['ADMIN', 'FINANCE_ADMIN'].includes(user.role) ? api.get('/billing/summary') : Promise.resolve({})
      ]);
      setBills(b); setResidents(r); setSummary(s);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filter]);

  const isAdmin = ['ADMIN', 'FINANCE_ADMIN'].includes(user.role);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing & Payments</h1>
          <p className="text-slate-500 text-sm">{isAdmin ? 'Manage all estate bills' : 'Your bills and payment history'}</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => setModal('add')}><Plus size={16} /> Create Bill</button>}
      </div>

      {isAdmin && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-xs text-slate-500 mb-1">Total Billed</p>
            <p className="text-xl font-bold text-slate-100">{fmt((summary.total || 0))}</p>
          </div>
          <div className="card p-4 border-estate-800/40">
            <p className="text-xs text-slate-500 mb-1">Collected</p>
            <p className="text-xl font-bold text-estate-300">{fmt((summary.paid || 0))}</p>
          </div>
          <div className="card p-4 border-amber-900/40">
            <p className="text-xs text-slate-500 mb-1">Outstanding</p>
            <p className="text-xl font-bold text-amber-300">{fmt((summary.unpaid || 0))}</p>
          </div>
          <div className="card p-4 border-red-900/40">
            <p className="text-xs text-slate-500 mb-1">Overdue</p>
            <p className="text-xl font-bold text-red-300">{fmt((summary.overdue || 0))}</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {['', 'UNPAID', 'PAID', 'OVERDUE', 'WAIVED'].map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`btn-${filter === s ? 'primary' : 'secondary'} text-xs px-3`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr>
            {isAdmin && <th>Resident</th>}
            <th>Bill</th><th>Type</th><th>Amount</th><th>Due Date</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={isAdmin ? 7 : 6} className="text-center py-12 text-slate-500">Loading...</td></tr>
            ) : bills.length === 0 ? (
              <tr><td colSpan={isAdmin ? 7 : 6} className="text-center py-12 text-slate-500">No bills found</td></tr>
            ) : bills.map(b => (
              <tr key={b.id}>
                {isAdmin && (
                  <td>
                    <p className="font-medium text-slate-200">{b.resident?.user?.name}</p>
                    <p className="text-xs text-slate-500">{b.resident?.unit?.block?.name}-{b.resident?.unit?.unitNumber}</p>
                  </td>
                )}
                <td>
                  <p className="font-medium text-slate-200">{b.title}</p>
                  {b.description && <p className="text-xs text-slate-500">{b.description}</p>}
                </td>
                <td><span className="badge-gray text-xs">{b.type}</span></td>
                <td className="font-mono text-slate-200">{fmt(b.amount)}</td>
                <td className="text-slate-500 text-sm">{new Date(b.dueDate).toLocaleDateString()}</td>
                <td>{statusBadge(b.status)}</td>
                <td>
                  {b.status === 'UNPAID' && isAdmin && (
                    <button className="btn-ghost text-xs text-estate-400" onClick={() => setPaying(b)}>
                      <CheckCircle size={14} /> Pay
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === 'add' && <AddBillModal onClose={() => setModal(null)} onDone={load} residents={residents} />}
      {paying && <PaymentModal bill={paying} onClose={() => setPaying(null)} onDone={load} />}
    </div>
  );
}
