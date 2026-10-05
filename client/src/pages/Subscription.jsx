import { useEffect, useState } from 'react';
import { CreditCard, FileText } from 'lucide-react';
import api from '../utils/api';
import { fmt } from '../utils/money';

const badge = { ACTIVE: 'badge-green', TRIAL: 'badge-blue', SUSPENDED: 'badge-yellow', EXPIRED: 'badge-red', CANCELLED: 'badge-gray', PAID: 'badge-green', OPEN: 'badge-yellow', VOID: 'badge-gray' };
const day = (d) => (d ? new Date(d).toLocaleDateString() : '—');

export default function Subscription() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/subscription').then(setS).catch(() => {}); }, []);
  if (!s) return <div className="flex justify-center h-64 items-center"><div className="w-8 h-8 border-2 border-estate-600 border-t-transparent rounded-full animate-spin" /></div>;
  const c = s.currency; const n = s.nextInvoice;
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header"><div><h1 className="page-title">Subscription</h1><p className="text-slate-400 text-sm">Your Estatium plan and invoices</p></div></div>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs text-slate-500 uppercase">Plan</p><p className="text-lg font-semibold text-slate-100">{s.plan.name}</p><span className={`${badge[s.status] || 'badge-gray'} mt-1 inline-block`}>{s.status}</span>
          {s.status === 'TRIAL' && <p className="text-xs text-slate-400 mt-2">Trial ends {day(s.trialEndsAt)}</p>}
          {s.cancelAtPeriodEnd && <p className="text-xs text-amber-300 mt-2">Cancels at period end</p>}</div>
        <div className="card p-4"><p className="text-xs text-slate-500 uppercase">Units</p><p className="text-lg font-semibold text-slate-100">{s.units ?? '—'}{s.maxUnits ? ` / ${s.maxUnits}` : ''}</p>
          <p className="text-xs text-slate-400 mt-1">{s.unitPrice ? `${fmt(s.unitPrice, c)} per unit / month` : 'Custom pricing'}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500 uppercase">Next invoice</p><p className="text-lg font-semibold text-slate-100">{n ? fmt(n.total, c) : '—'}</p><p className="text-xs text-slate-400 mt-1">on {day(s.currentPeriodEnd)}</p></div>
      </div>
      <div className="table-container">
        <table className="table">
          <thead><tr><th>Invoice</th><th>Period</th><th>Units</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {s.invoices.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">No invoices yet</td></tr> : s.invoices.map((i) => (
              <tr key={i.id}><td className="font-mono text-slate-200"><FileText size={13} className="inline mr-1" />{i.number}</td><td className="text-slate-500 text-sm">{day(i.periodStart)} – {day(i.periodEnd)}</td><td>{i.units}</td>
                <td className="font-mono">{fmt(i.total, i.currency)}</td><td className="font-mono">{fmt(i.amountPaid, i.currency)}</td><td className="text-sm">{day(i.dueDate)}</td><td><span className={badge[i.status] || 'badge-gray'}>{i.status}</span></td></tr>))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500"><CreditCard size={12} className="inline mr-1" />Online card payment for invoices is coming with the payment-gateway release. Until then, pay by bank transfer and quote the invoice number.</p>
    </div>
  );
}
