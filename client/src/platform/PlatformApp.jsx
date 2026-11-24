import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useParams } from 'react-router-dom';
import { Shield, Building2, Receipt, Layers, Activity, LogOut, Megaphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { platformApi as api, PLATFORM_TOKEN_KEY } from '../utils/api';
import { fmt } from '../utils/money';

const day = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const stBadge = { ACTIVE: 'badge-green', TRIAL: 'badge-blue', SUSPENDED: 'badge-yellow', EXPIRED: 'badge-red', DELETED: 'badge-gray', PAID: 'badge-green', OPEN: 'badge-yellow', VOID: 'badge-gray' };
const Spin = () => <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-estate-600 border-t-transparent rounded-full animate-spin" /></div>;
const can = (me, perm) => !!me && (me.permissions.includes('*') || me.permissions.includes(perm) || me.permissions.includes(perm.split(':')[0] + ':*'));

function useMe() {
  const [me, setMe] = useState(null);
  useEffect(() => { if (localStorage.getItem(PLATFORM_TOKEN_KEY)) api.get('/auth/me').then(setMe).catch(() => {}); }, []);
  return me;
}

export function PlatformLogin() {
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' }); const [err, setErr] = useState('');
  const submit = async (e) => { e.preventDefault(); setErr('');
    try { const r = await api.post('/auth/login', f); localStorage.setItem(PLATFORM_TOKEN_KEY, r.token); nav('/platform'); }
    catch (x) { setErr(x.response?.data?.error || 'Sign-in failed'); } };
  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
      <form onSubmit={submit} className="card p-6 space-y-4 w-full max-w-sm">
        <div className="text-center"><Shield className="mx-auto text-estate-400 mb-2" /><h1 className="text-xl font-display font-bold text-slate-100">Estatium Platform</h1><p className="text-xs text-slate-500">Super Owner sign-in</p></div>
        {err && <div role="alert" className="text-sm text-red-300 bg-red-900/40 rounded px-3 py-2">{err}</div>}
        <input className="input" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" />
        <input className="input" type="password" placeholder="Password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" />
        <button className="btn-primary w-full justify-center">Sign in</button>
      </form>
    </div>
  );
}

function Shell({ me, children }) {
  const nav = useNavigate();
  const links = [['/platform', Activity, 'Overview'], ['/platform/tenants', Building2, 'Estates'], ['/platform/invoices', Receipt, 'Invoices'], ['/platform/plans', Layers, 'Plans & pricing'], ['/platform/ads', Megaphone, 'Ads & banners'], ['/platform/audit', Shield, 'Audit log']];
  return (
    <div className="min-h-screen bg-surface-900 text-slate-200">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center gap-6 flex-wrap">
        <span className="font-display font-bold text-slate-100">Estatium Platform</span>
        <nav className="flex gap-4 text-sm flex-wrap">{links.map(([to, Icon, label]) => <Link key={to} to={to} className="text-slate-400 hover:text-estate-300 flex items-center gap-1"><Icon size={14} />{label}</Link>)}</nav>
        <div className="ml-auto text-xs text-slate-500 flex items-center gap-3">{me?.user?.email} · {me?.user?.role}
          <button className="btn-ghost text-xs" onClick={() => { localStorage.removeItem(PLATFORM_TOKEN_KEY); nav('/platform/login'); }}><LogOut size={13} /> Sign out</button></div>
      </header>
      <main className="p-4 lg:p-6 max-w-7xl mx-auto">{children}</main>
    </div>
  );
}

function Overview() {
  const [r, setR] = useState(null);
  useEffect(() => { api.get('/revenue?currency=USD').then(setR).catch(() => {}); }, []);
  if (!r) return <Spin />;
  const cards = [['MRR (USD)', fmt(r.mrr.total, 'USD')], ['ARR (USD)', fmt(r.mrr.arr, 'USD')], ['Billable units', r.billableUnits], ['Trials ending ≤7d', r.trialsEndingIn7Days]];
  return (
    <div className="space-y-5">
      <h1 className="page-title">Overview</h1>
      <div className="grid sm:grid-cols-4 gap-4">{cards.map(([k, v]) => <div key={k} className="card p-4"><p className="text-xs text-slate-500 uppercase">{k}</p><p className="text-xl font-semibold text-slate-100">{v}</p></div>)}</div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4"><h3 className="font-semibold mb-2">Estates by status</h3>{Object.entries(r.tenantsByStatus).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-1"><span className={stBadge[k]}>{k}</span><span>{v}</span></div>)}</div>
        <div className="card p-4"><h3 className="font-semibold mb-2">MRR by currency</h3>{Object.entries(r.mrr.byCurrency).map(([c, v]) => <div key={c} className="flex justify-between text-sm py-1"><span>{c}</span><span className="font-mono">{fmt(v, c)}</span></div>)}
          <h3 className="font-semibold mt-4 mb-2">Outstanding invoices</h3>{r.outstanding.map((o) => <div key={o.currency} className="flex justify-between text-sm py-1"><span>{o.currency} ({o.invoices})</span><span className="font-mono">{fmt(o.amount, o.currency)}</span></div>)}</div>
      </div>
      <p className="text-xs text-slate-500">{r.ratesNote}</p>
    </div>
  );
}

function NewTenant({ onDone, onClose }) {
  const [plans, setPlans] = useState([]); const [currencies, setCurrencies] = useState([]);
  const [f, setF] = useState({ name: '', slug: '', adminEmail: '', adminName: '', planCode: 'standard', currency: 'USD', startAsActive: false });
  const [out, setOut] = useState(null);
  useEffect(() => { api.get('/plans').then(setPlans); api.get('/currencies').then((c) => setCurrencies(c.filter((x) => x.isActive))); }, []);
  const submit = async () => { try { setOut(await api.post('/tenants', f)); onDone(); } catch { /* toast shown */ } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className="modal-overlay" onClick={onClose}><div className="modal p-6" onClick={(e) => e.stopPropagation()}>
      {out ? (<div className="space-y-3"><h3 className="text-lg font-semibold">Estate created</h3>
        <p className="text-sm">Login estate: <b>{out.tenant.slug}</b><br />Admin: <b>{out.admin.email}</b></p>
        {out.temporaryPassword && <p className="text-sm bg-amber-900/30 border border-amber-800/50 rounded p-3">Temporary password (shown once):<br /><code className="text-amber-200 select-all">{out.temporaryPassword}</code></p>}
        <button className="btn-primary w-full" onClick={onClose}>Done</button></div>) : (<>
        <h3 className="text-lg font-semibold mb-3">New estate</h3>
        <div className="space-y-3">
          <div><label className="label">Estate name</label><input className="input" value={f.name} onChange={set('name')} /></div>
          <div><label className="label">Slug (login code)</label><input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="greenville" /></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="label">Admin name</label><input className="input" value={f.adminName} onChange={set('adminName')} /></div><div><label className="label">Admin email</label><input className="input" type="email" value={f.adminEmail} onChange={set('adminEmail')} /></div></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Plan</label><select className="select" value={f.planCode} onChange={set('planCode')}>{plans.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}</select></div>
            <div><label className="label">Currency</label><select className="select" value={f.currency} onChange={set('currency')}>{currencies.map((c) => <option key={c.code}>{c.code}</option>)}</select></div></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.startAsActive} onChange={set('startAsActive')} /> Skip trial — start as Active and invoice now</label>
        </div>
        <div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={onClose}>Cancel</button><button className="btn-primary flex-1" onClick={submit}>Create</button></div></>)}
    </div></div>
  );
}

function Tenants({ me }) {
  const [d, setD] = useState(null); const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [open, setOpen] = useState(false);
  const load = useCallback(() => api.get(`/tenants?q=${encodeURIComponent(q)}&status=${status}`).then(setD).catch(() => {}), [q, status]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap"><h1 className="page-title mr-auto">Estates</h1>
        <input className="input w-56" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'DELETED'].map((s) => <option key={s}>{s}</option>)}</select>
        {can(me, 'tenants:create') && <button className="btn-primary" onClick={() => setOpen(true)}>+ New estate</button>}</div>
      {!d ? <Spin /> : <div className="table-container"><table className="table"><thead><tr><th>Estate</th><th>Status</th><th>Plan</th><th>Currency</th><th>Units</th><th>Users</th><th>Created</th></tr></thead><tbody>
        {d.items.map((t) => <tr key={t.id}><td><Link className="text-estate-300 font-medium" to={`/platform/tenants/${t.id}`}>{t.name}</Link><p className="text-xs text-slate-500">{t.slug}</p></td><td><span className={stBadge[t.status]}>{t.status}</span></td>
          <td>{t.subscription?.plan?.name || '—'}</td><td>{t.currency}</td><td>{t.usage.units}</td><td>{t.usage.users}</td><td className="text-sm text-slate-500">{day(t.createdAt)}</td></tr>)}</tbody></table></div>}
      {open && <NewTenant onDone={load} onClose={() => setOpen(false)} />}
    </div>
  );
}


const PP_BADGE = { UNPAID: 'badge-gray', ACTIVE: 'badge-green', APPROACHING: 'badge-blue', DUE_SOON: 'badge-yellow', URGENT: 'badge-yellow', GRACE: 'badge-red', READ_ONLY: 'badge-red' };
const PP_LABEL = { UNPAID: 'No payment / trial date', ACTIVE: 'Active', APPROACHING: 'Approaching (≤90 days)', DUE_SOON: 'Due soon (≤60 days)', URGENT: 'Urgent (≤30 days)', GRACE: 'Overdue - grace period', READ_ONLY: 'Read-only' };
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const lastDay = (expiresAt) => iso(new Date(new Date(expiresAt).getTime() - 86400000));
// last day of an n-month period that starts on `from` (YYYY-MM-DD): 2026-12-01 + 3 months -> 2027-02-28
const periodEnd = (from, n) => { const [y, m, d] = from.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate(); dt.setUTCDate(Math.min(d, last)); dt.setUTCDate(dt.getUTCDate() - 1); return dt.toISOString().slice(0, 10); };

function PrepaidPanel({ id, t, me, reload }) {
  const p = t.prepaid;
  const next = p?.paidThrough ? iso(new Date(new Date(p.paidThrough).getTime() + 86400000)) : iso(new Date());
  const [f, setF] = useState({ amount: '', periodFrom: next, periodTo: '', method: 'BANK_TRANSFER', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF((x) => ({ ...x, periodFrom: next })); }, [next]);
  if (!p || p.billingMode !== 'MANUAL_PREPAID') return null;
  const canEdit = can(me, 'subscriptions:update');
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/tenants/${id}/prepaid/payments`, { ...f, amount: String(f.amount) });
      toast.success(`Payment recorded. Paid through ${iso(r.paidThrough)}`);
      (r.warnings || []).forEach((w) => toast(w, { icon: '⚠️', duration: 8000 }));
      setF({ amount: '', periodFrom: iso(new Date(new Date(r.paidThrough).getTime() + 86400000)), periodTo: '', method: 'BANK_TRANSFER', reference: '', note: '' });
      reload();
    } catch { /* interceptor toasts */ } finally { setBusy(false); }
  };
  const voidIt = async (x) => {
    const reason = prompt(`Void this payment of ${fmt(x.amount, x.currency)} (${iso(x.periodFrom)} to ${iso(x.periodTo)})?\nReason (required):`);
    if (!reason) return;
    try { await api.post(`/tenants/${id}/prepaid/payments/${x.id}/void`, { reason }); toast.success('Payment voided'); reload(); } catch { /* toast */ }
  };
  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap"><h3 className="font-semibold">Prepaid subscription</h3><span className={PP_BADGE[p.state]}>{PP_LABEL[p.state] || p.state}</span>
        <span className="text-xs text-slate-500 ml-auto">Billed in {p.currency} · {p.graceDays} grace days</span></div>
      <div className="grid sm:grid-cols-4 gap-3 text-sm">
        <div><p className="text-xs text-slate-500">{p.source === 'TRIAL' ? 'Trial ends' : 'Paid through'}</p><p className="text-lg font-semibold">{p.expiresAt ? lastDay(p.expiresAt) : '—'}</p></div>
        <div><p className="text-xs text-slate-500">{p.daysLeft > 0 ? 'Days left' : 'Grace days left'}</p><p className="text-lg font-semibold">{p.daysLeft > 0 ? p.daysLeft : (p.graceDaysLeft ?? '—')}</p></div>
        <div><p className="text-xs text-slate-500">Read-only from</p><p className="text-lg font-semibold">{p.readOnlyFrom ? iso(p.readOnlyFrom) : '—'}</p></div>
        <div><p className="text-xs text-slate-500">Grace days</p>{canEdit
          ? <input className="input w-24" type="number" min="0" max="365" defaultValue={p.graceDays} onBlur={(ev) => { const v = Number(ev.target.value); if (v !== p.graceDays) api.patch(`/tenants/${id}/prepaid/grace`, { graceDays: v }).then(() => { toast.success('Grace period saved'); reload(); }).catch(() => {}); }} />
          : <p className="text-lg font-semibold">{p.graceDays}</p>}</div>
      </div>
      {canEdit && <div className="border border-slate-800 rounded-lg p-3 space-y-3"><h4 className="text-sm font-medium">Record a payment received ({t.currency})</h4>
        <div className="grid md:grid-cols-4 gap-3">
          <div><label className="label">Amount ({t.currency})</label><input className="input" inputMode="decimal" placeholder="e.g. 90000" value={f.amount} onChange={set('amount')} /></div>
          <div><label className="label">Covers from</label><input className="input" type="date" value={f.periodFrom} onChange={set('periodFrom')} /></div>
          <div><label className="label">Covers until (last paid day)</label><input className="input" type="date" value={f.periodTo} onChange={set('periodTo')} /></div>
          <div><label className="label">Method</label><select className="select" value={f.method} onChange={set('method')}>{['BANK_TRANSFER', 'CASH', 'CARD', 'MOBILE_MONEY', 'OTHER'].map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        <div className="flex gap-2 flex-wrap items-center"><span className="text-xs text-slate-500">Quick fill:</span>
          {[1, 3, 6, 12].map((n) => <button key={n} type="button" className="btn-ghost text-xs" onClick={() => setF({ ...f, periodTo: periodEnd(f.periodFrom, n) })}>{n} month{n > 1 ? 's' : ''}</button>)}</div>
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div><label className="label">Bank reference</label><input className="input" value={f.reference} onChange={set('reference')} /></div>
          <div><label className="label">Note (optional)</label><input className="input" value={f.note} onChange={set('note')} /></div>
          <button className="btn-primary justify-center" disabled={busy || !f.amount || !f.periodFrom || !f.periodTo} onClick={save}>{busy ? 'Saving…' : 'Record payment'}</button></div>
        <p className="text-xs text-slate-500">The paid-through date is calculated from the period you enter, never from the amount. Mistakes are voided (kept in the history), not edited.</p></div>}
      <div className="table-container"><table className="table"><thead><tr><th>Recorded</th><th>Covers</th><th>Amount</th><th>Method / ref</th><th>Status</th><th /></tr></thead><tbody>
        {p.payments.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-slate-500">No payments recorded yet</td></tr> : p.payments.map((x) => (
          <tr key={x.id} className={x.status === 'VOIDED' ? 'opacity-50' : ''}><td className="text-sm">{day(x.paidAt)}</td><td className="text-sm">{iso(x.periodFrom)} → {iso(x.periodTo)}</td><td className="font-mono">{fmt(x.amount, x.currency)}</td>
            <td className="text-sm">{x.method}{x.reference ? ` · ${x.reference}` : ''}</td><td><span className={x.status === 'VOIDED' ? 'badge-gray' : 'badge-green'}>{x.status}</span>{x.voidReason ? <span className="text-xs text-slate-500 ml-2">{x.voidReason}</span> : null}</td>
            <td>{canEdit && x.status === 'RECORDED' && <button className="btn-ghost text-xs text-red-400" onClick={() => voidIt(x)}>Void</button>}</td></tr>))}
      </tbody></table></div>
    </div>
  );
}

function AdminsPanel({ id, t, me }) {
  const [admins, setAdmins] = useState(null); const [shown, setShown] = useState(null);
  const canReset = can(me, 'tenants:update');
  const load = useCallback(() => api.get(`/tenants/${id}/admins`).then(setAdmins).catch(() => setAdmins([])), [id]);
  useEffect(() => { load(); }, [load]);
  const loginUrl = `${window.location.origin}/login`;
  const reset = async (a) => {
    if (!window.confirm(`Reset the password for ${a.email}?\nTheir current password stops working and any open sessions are signed out.`)) return;
    try { const r = await api.post(`/tenants/${id}/reset-admin-password`, { email: a.email }); setShown(r); load(); } catch { /* interceptor toasts */ }
  };
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed - select the text manually'));
  const locked = (a) => a.lockedUntil && new Date(a.lockedUntil) > new Date();
  return (
    <div className="card p-4 space-y-3">
      <h3 className="font-semibold">Estate sign-in & administrators</h3>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div><p className="text-xs text-slate-500">Estate code (type this at sign-in)</p><p className="font-mono text-base">{t.slug}</p></div>
        <div><p className="text-xs text-slate-500">Sign-in page</p><p className="font-mono text-sm break-all">{loginUrl}</p></div>
      </div>
      {!admins ? <Spin /> : <div className="table-container"><table className="table"><thead><tr><th>Name</th><th>Sign-in email</th><th>Status</th><th>Last sign-in</th><th /></tr></thead><tbody>
        {admins.length === 0 ? <tr><td colSpan={5} className="text-center py-6 text-slate-500">No administrator accounts</td></tr> : admins.map((a) => (
          <tr key={a.id}><td className="text-sm">{a.name}</td><td className="font-mono text-sm">{a.email}</td>
            <td className="text-xs space-x-1">{!a.isActive && <span className="badge-gray">INACTIVE</span>}{locked(a) && <span className="badge-red">LOCKED</span>}{a.mustChangePassword && <span className="badge-yellow">MUST CHANGE PASSWORD</span>}{a.isActive && !locked(a) && !a.mustChangePassword && <span className="badge-green">OK</span>}</td>
            <td className="text-sm">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : 'never'}</td>
            <td>{canReset && <button className="btn-ghost text-xs text-estate-400" onClick={() => reset(a)}>Reset password</button>}</td></tr>))}
      </tbody></table></div>}
      {shown && <div className="rounded-lg border border-amber-700/60 bg-amber-900/30 p-3 text-sm text-amber-100 space-y-2">
        <p><b>New temporary password for {shown.email}</b> - shown only once. Give it to the administrator privately; they must set a new one at first sign-in.</p>
        <div className="flex items-center gap-2 flex-wrap"><code className="font-mono text-base bg-black/30 px-2 py-1 rounded select-all">{shown.temporaryPassword}</code>
          <button className="btn-secondary text-xs" onClick={() => copy(shown.temporaryPassword)}>Copy</button><button className="btn-ghost text-xs" onClick={() => setShown(null)}>Hide</button></div></div>}
    </div>
  );
}

function TenantDetail({ me }) {
  const { id } = useParams(); const nav = useNavigate();
  const [t, setT] = useState(null); const [plans, setPlans] = useState([]); const [currencies, setCurrencies] = useState([]);
  const [price, setPrice] = useState({ customUnitAmount: '', committedUnits: '', maxUnits: '' });
  const load = useCallback(() => api.get(`/tenants/${id}`).then((x) => { setT(x); setPrice({ customUnitAmount: x.subscription?.customUnitAmount ?? '', committedUnits: x.subscription?.committedUnits ?? '', maxUnits: x.subscription?.maxUnits ?? '' }); }), [id]);
  useEffect(() => { load(); api.get('/plans').then(setPlans); api.get('/currencies').then(setCurrencies); }, [load]);
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch { /* interceptor toasts */ } };
  if (!t) return <Spin />;
  const sub = t.subscription; const e = t.nextInvoiceEstimate;
  const num = (v) => (v === '' || v === null ? null : Number(v));
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap"><h1 className="page-title">{t.name}</h1><span className={stBadge[t.status]}>{t.status}</span><span className="text-xs text-slate-500">{t.slug} · {t.currency}</span>
        <div className="ml-auto flex gap-2 flex-wrap">
          {can(me, 'tenants:suspend') && ['TRIAL', 'ACTIVE'].includes(t.status) && <button className="btn-secondary" onClick={() => { const reason = prompt('Reason for suspension?'); if (reason !== null) act(() => api.post(`/tenants/${id}/suspend`, { reason }), 'Suspended'); }}>Suspend</button>}
          {can(me, 'tenants:activate') && ['TRIAL', 'SUSPENDED', 'EXPIRED'].includes(t.status) && <button className="btn-primary" onClick={() => act(() => api.post(`/tenants/${id}/activate`), 'Activated')}>{t.status === 'TRIAL' ? 'Convert to paid' : 'Activate'}</button>}
          {can(me, 'tenants:delete') && t.status === 'DELETED' && !t.purgedAt && <button className="btn-secondary" onClick={() => act(() => api.post(`/tenants/${id}/restore`), 'Restored (suspended)')}>Restore</button>}
          {can(me, 'tenants:delete') && t.status !== 'DELETED' && <button className="btn-danger" onClick={() => { if (prompt(`Type "${t.slug}" to delete this estate (30-day retention)`) === t.slug) act(() => api.delete(`/tenants/${id}`, { data: { confirmSlug: t.slug } }), 'Deleted'); }}>Delete</button>}
        </div></div>
      <div className="grid sm:grid-cols-4 gap-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Units</p><p className="text-xl font-semibold">{t.usage.units}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Residents / users</p><p className="text-xl font-semibold">{t.usage.residents} / {t.usage.users}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Next invoice</p><p className="text-xl font-semibold">{e ? fmt(e.total, e.currency) : '—'}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Period ends</p><p className="text-xl font-semibold">{day(sub?.currentPeriodEnd)}</p></div>
      </div>
      {sub && can(me, 'subscriptions:update') && <div className="card p-4 space-y-3"><h3 className="font-semibold">Plan, pricing & currency</h3>
        <div className="grid md:grid-cols-3 gap-3">
          <div><label className="label">Plan</label><select className="select" value={sub.plan.code} onChange={(ev) => act(() => api.put(`/tenants/${id}/plan`, { planCode: ev.target.value }), 'Plan changed (prorated)')}>{plans.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}</select></div>
          <div><label className="label">Currency</label><select className="select" value={t.currency} onChange={(ev) => act(() => api.put(`/tenants/${id}/currency`, { currency: ev.target.value }), 'Currency changed')}>{currencies.filter((c) => c.isActive || c.code === t.currency).map((c) => <option key={c.code}>{c.code}</option>)}</select></div>
          <div><label className="label">Coupon code</label><input className="input" placeholder="Enter and press Enter" onKeyDown={(ev) => { if (ev.key === 'Enter' && ev.target.value) act(() => api.post(`/tenants/${id}/coupons`, { code: ev.target.value }), 'Coupon applied'); }} /></div></div>
        <div className="grid md:grid-cols-4 gap-3 items-end">
          <div><label className="label">Custom price / unit ({t.currency})</label><input className="input" type="number" step="0.01" value={price.customUnitAmount} onChange={(ev) => setPrice({ ...price, customUnitAmount: ev.target.value })} placeholder="plan price" /></div>
          <div><label className="label">Committed units</label><input className="input" type="number" value={price.committedUnits} onChange={(ev) => setPrice({ ...price, committedUnits: ev.target.value })} /></div>
          <div><label className="label">Max units (hard cap)</label><input className="input" type="number" value={price.maxUnits} onChange={(ev) => setPrice({ ...price, maxUnits: ev.target.value })} /></div>
          <button className="btn-primary justify-center" onClick={() => act(() => api.put(`/tenants/${id}/pricing`, { customUnitAmount: price.customUnitAmount === '' ? null : String(price.customUnitAmount), committedUnits: num(price.committedUnits), maxUnits: num(price.maxUnits), applyNow: true }), 'Pricing saved')}>Save pricing</button></div>
        <p className="text-xs text-slate-500">Saving applies immediately and prorates the current period. Leave “custom price” empty to use the plan price.</p></div>}
      <AdminsPanel id={id} t={t} me={me} />
      <PrepaidPanel id={id} t={t} me={me} reload={load} />
      <div className="table-container"><table className="table"><thead><tr><th>Invoice</th><th>Issued</th><th>Units</th><th>Total</th><th>Paid</th><th>Status</th><th /></tr></thead><tbody>
        {t.invoices.map((i) => <tr key={i.id}><td className="font-mono">{i.number}</td><td className="text-sm">{day(i.issuedAt)}</td><td>{i.units}</td><td className="font-mono">{fmt(i.total, i.currency)}</td><td className="font-mono">{fmt(i.amountPaid, i.currency)}</td><td><span className={stBadge[i.status]}>{i.status}</span></td>
          <td>{i.status === 'OPEN' && can(me, 'invoices:manage') && <button className="btn-ghost text-xs text-estate-400" onClick={() => { const a = prompt('Amount received', String(Number(i.total) - Number(i.amountPaid))); if (a) act(() => api.post(`/invoices/${i.id}/payments`, { amount: a, method: 'BANK_TRANSFER', reference: prompt('Bank reference (optional)') || undefined }), 'Payment recorded'); }}>Record payment</button>}</td></tr>)}</tbody></table></div>
      <div className="card p-4"><h3 className="font-semibold mb-2">Subscription history</h3>{t.events.map((ev) => <div key={ev.id} className="text-xs text-slate-400 py-1 border-b border-slate-800/50"><span className="text-slate-500">{new Date(ev.createdAt).toLocaleString()}</span> · <b className="text-slate-300">{ev.type}</b> · {JSON.stringify(ev.data)}</div>)}</div>
      <button className="btn-ghost" onClick={() => nav('/platform/tenants')}>← Back</button>
    </div>
  );
}

function Invoices() {
  const [d, setD] = useState(null); const [status, setStatus] = useState('OPEN');
  useEffect(() => { api.get(`/invoices?status=${status}`).then(setD).catch(() => {}); }, [status]);
  return (<div className="space-y-4"><div className="flex gap-3 items-center"><h1 className="page-title mr-auto">Invoices</h1><select className="select w-40" value={status} onChange={(e) => setStatus(e.target.value)}>{['OPEN', 'PAID', 'VOID', ''].map((s) => <option key={s} value={s}>{s || 'All'}</option>)}</select></div>
    {!d ? <Spin /> : <div className="table-container"><table className="table"><thead><tr><th>Invoice</th><th>Estate</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead><tbody>
      {d.items.map((i) => <tr key={i.id}><td className="font-mono">{i.number}</td><td><Link className="text-estate-300" to={`/platform/tenants/${i.tenantId}`}>{i.tenant?.name}</Link></td><td className="font-mono">{fmt(i.total, i.currency)}</td><td className="font-mono">{fmt(i.amountPaid, i.currency)}</td><td className="text-sm">{day(i.dueDate)}</td><td><span className={stBadge[i.status]}>{i.status}</span></td></tr>)}</tbody></table></div>}</div>);
}

function Plans({ me }) {
  const [plans, setPlans] = useState(null); const [coupons, setCoupons] = useState([]);
  const load = () => { api.get('/plans').then(setPlans); api.get('/coupons').then(setCoupons).catch(() => {}); };
  useEffect(load, []);
  if (!plans) return <Spin />;
  const editPrice = async (p, cur, current) => { const a = prompt(`${p.name}: price per unit per month in ${cur}`, current); if (a === null) return;
    try { await api.put(`/plans/${p.id}/prices`, { prices: [{ currency: cur, unitAmount: a }] }); toast.success('Price saved'); load(); } catch { /* toast */ } };
  return (<div className="space-y-5"><h1 className="page-title">Plans & pricing</h1>
    {plans.map((p) => <div key={p.id} className="card p-4"><div className="flex items-center gap-3"><h3 className="font-semibold">{p.name}</h3><span className="badge-gray">{p.code}</span><span className="text-xs text-slate-500">{p._count.subscriptions} estates · min {p.minBillableUnits} units · {p.trialDays}-day trial</span></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">{p.prices.map((x) => <button key={x.id} disabled={!can(me, 'plans:manage')} onClick={() => editPrice(p, x.currency, x.unitAmount)} className="text-left bg-surface-800 rounded-lg p-2 hover:bg-surface-700"><p className="text-xs text-slate-500">{x.currency}</p><p className="font-mono">{fmt(x.unitAmount, x.currency)}<span className="text-xs text-slate-500"> /unit/mo</span></p></button>)}</div></div>)}
    <div className="card p-4"><h3 className="font-semibold mb-2">Coupons</h3>{coupons.length === 0 && <p className="text-sm text-slate-500">None</p>}{coupons.map((c) => <div key={c.id} className="text-sm py-1 flex gap-3"><b className="font-mono">{c.code}</b><span>{c.type === 'PERCENT' ? `${c.percentOff}% off` : `${fmt(c.amountOff, c.currency)} off`}</span><span className="text-slate-500">{c.duration} · used {c.timesRedeemed}{c.maxRedemptions ? `/${c.maxRedemptions}` : ''}</span></div>)}</div></div>);
}

// Shrinks a chosen picture to a web banner (max 1200px wide, JPEG) and returns it as a data URI.
function pictureToDataUri(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => { img.onerror = () => reject(new Error('That file is not a picture')); img.onload = () => {
      const w = Math.min(1200, img.width); const h = Math.round(img.height * (w / img.width));
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.8)); }; img.src = r.result; };
    r.readAsDataURL(file);
  });
}

function Ads({ me }) {
  const [ads, setAds] = useState(null); const [tenants, setTenants] = useState([]);
  const blank = { tenantId: 'ALL', title: '', content: '', advertiserName: '', linkUrl: '', imageUrl: '', startDate: new Date().toISOString().slice(0, 10), endDate: '' };
  const [f, setF] = useState(blank); const [busy, setBusy] = useState(false);
  const load = () => api.get('/ads').then(setAds).catch(() => setAds([]));
  useEffect(() => { load(); api.get('/tenants').then((d) => setTenants((d.items || d || []).filter((t) => ['TRIAL', 'ACTIVE'].includes(t.status)))).catch(() => {}); }, []);
  if (!can(me, 'ads:manage')) return <p className="text-slate-400">Only the platform owner can manage ads.</p>;
  const pick = async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setF({ ...f, imageUrl: await pictureToDataUri(file) }); } catch (x) { toast.error(x.message); } };
  const create = async () => {
    if (!f.title || !f.endDate) return toast.error('Title and end date are required');
    setBusy(true);
    try { const r = await api.post('/ads', { ...f, linkUrl: f.linkUrl || undefined, imageUrl: f.imageUrl || undefined }); toast.success(`Ad published to ${r.created} estate${r.created === 1 ? '' : 's'}`); setF(blank); load(); }
    catch { /* toast */ } finally { setBusy(false); }
  };
  const stop = async (a) => { if (!confirm(`Stop "${a.title}" for ${a.tenantName}?`)) return; try { await api.post(`/ads/${a.id}/stop`, { tenantId: a.tenantId }); load(); } catch { /* toast */ } };
  const del = async (a) => { if (!confirm(`Delete "${a.title}" for ${a.tenantName}? Its view and click counts are lost.`)) return; try { await api.delete(`/ads/${a.id}?tenantId=${a.tenantId}`); load(); } catch { /* toast */ } };
  const state = (a) => { const now = new Date(); if (a.status !== 'APPROVED' || !a.isActive) return ['Stopped', 'badge-gray']; if (new Date(a.startDate) > now) return ['Scheduled', 'badge-blue']; if (new Date(a.endDate) < now) return ['Ended', 'badge-gray']; return ['Live', 'badge-green']; };
  return (<div className="space-y-5"><div><h1 className="page-title">Ads & banners</h1><p className="text-sm text-slate-500">Only you can create ads. They show as a banner at the top of every page for everyone in the estate.</p></div>
    <div className="card p-4 space-y-3"><h3 className="font-semibold">New banner</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label">Show in</label><select className="input" value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })}><option value="ALL">All live estates</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <div><label className="label">Title *</label><input className="input" maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label">Text (optional if you add a picture)</label><textarea className="input" rows={2} maxLength={2000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></div>
        <div><label className="label">Advertiser name</label><input className="input" maxLength={120} value={f.advertiserName} onChange={(e) => setF({ ...f, advertiserName: e.target.value })} /></div>
        <div><label className="label">Link when tapped (https://…)</label><input className="input" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} placeholder="https://" /></div>
        <div><label className="label">Starts</label><input type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></div>
        <div><label className="label">Ends *</label><input type="date" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label">Banner picture (wide image works best)</label><input type="file" accept="image/*" onChange={pick} className="text-sm" />
          {f.imageUrl && <div className="mt-2"><img src={f.imageUrl} alt="preview" className="max-h-32 rounded-lg border border-slate-700" /><button className="btn-ghost text-xs text-red-400" onClick={() => setF({ ...f, imageUrl: '' })}>Remove picture</button></div>}</div>
      </div>
      <button className="btn-primary" disabled={busy} onClick={create}>{busy ? 'Publishing…' : 'Publish banner'}</button></div>
    <div className="table-container"><table className="table"><thead><tr><th>Banner</th><th>Estate</th><th>Runs</th><th>Status</th><th>Views</th><th>Taps</th><th /></tr></thead><tbody>
      {!ads ? <tr><td colSpan={7} className="text-center py-8 text-slate-500">Loading…</td></tr> : ads.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-slate-500">No ads yet</td></tr> : ads.map((a) => { const [label, cls] = state(a); return (
        <tr key={a.tenantId + a.id}><td><p className="font-medium text-slate-200">{a.title}</p><p className="text-xs text-slate-500">{a.advertiserName}{a.imageUrl ? ' · picture' : ''}</p></td><td className="text-sm">{a.tenantName}</td>
          <td className="text-xs text-slate-400 whitespace-nowrap">{day(a.startDate)} – {day(a.endDate)}</td><td><span className={`badge ${cls}`}>{label}</span></td><td>{a.impressions}</td><td>{a.clicks}</td>
          <td className="whitespace-nowrap">{label === 'Live' || label === 'Scheduled' ? <button className="btn-ghost text-xs text-amber-400" onClick={() => stop(a)}>Stop</button> : null}<button className="btn-ghost text-xs text-red-400" onClick={() => del(a)}>Delete</button></td></tr>); })}
    </tbody></table></div></div>);
}

function Audit() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/audit-logs?pageSize=100').then(setD).catch(() => {}); }, []);
  if (!d) return <Spin />;
  return (<div className="space-y-4"><h1 className="page-title">Audit log</h1><div className="table-container"><table className="table"><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Estate</th><th>Detail</th></tr></thead><tbody>
    {d.items.map((a) => <tr key={a.id}><td className="text-xs text-slate-500 whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</td><td className="font-mono text-xs">{a.action}</td><td className="text-xs">{a.actorEmail || a.actorType}</td><td className="text-xs">{a.tenantId?.slice(0, 8) || '—'}</td><td className="text-xs text-slate-500 max-w-md truncate">{a.after ? JSON.stringify(a.after) : ''}</td></tr>)}</tbody></table></div></div>);
}

export default function PlatformApp() {
  const me = useMe();
  if (!localStorage.getItem(PLATFORM_TOKEN_KEY)) return <Navigate to="/platform/login" replace />;
  return (
    <Shell me={me}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/tenants" element={<Tenants me={me} />} />
        <Route path="/tenants/:id" element={<TenantDetail me={me} />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/plans" element={<Plans me={me} />} />
        <Route path="/ads" element={<Ads me={me} />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/platform" replace />} />
      </Routes>
    </Shell>
  );
}
