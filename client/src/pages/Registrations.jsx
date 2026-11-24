import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api, { TOKEN_KEY } from '../utils/api';

function Selfie({ id }) {
  const [src, setSrc] = useState('');
  useEffect(() => {                                   // the photo endpoint needs the login token, so fetch it as a blob
    let url; fetch(`/api/registrations/${id}/selfie`, { headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } })
      .then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b) { url = URL.createObjectURL(b); setSrc(url); } }).catch(() => {});
    return () => url && URL.revokeObjectURL(url);
  }, [id]);
  return src ? <img src={src} alt="Applicant" className="w-24 h-24 object-cover rounded-xl" /> : <div className="w-24 h-24 rounded-xl bg-slate-800 text-xs text-slate-500 flex items-center justify-center">No photo</div>;
}

export default function Registrations() {
  const [rows, setRows] = useState([]); const [filter, setFilter] = useState('PENDING'); const [cfg, setCfg] = useState(null); const [busy, setBusy] = useState('');
  const load = useCallback(async () => { setRows(await api.get('/registrations', { params: { status: filter } })); }, [filter]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => { api.get('/registrations/settings').then(setCfg).catch(() => {}); }, []);

  const act = async (id, kind) => {
    let body = {};
    if (kind === 'reject') { const reason = window.prompt('Reason (the applicant will see this):'); if (!reason) return; body = { reason }; }
    setBusy(id);
    try { await api.post(`/registrations/${id}/${kind}`, body); toast.success(kind === 'approve' ? 'Approved — account created' : 'Rejected'); await load(); } catch { /* toast shown by api */ } finally { setBusy(''); }
  };
  const setting = async (body) => { try { setCfg(await api.post('/registrations/settings', body)); } catch { /* toast */ } };
  const link = cfg?.code ? `${window.location.origin}/register/${cfg.code.replace('-', '')}` : '';

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Registrations</h1>
      {cfg && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div><p className="text-sm text-white font-medium">Self-registration is {cfg.enabled ? 'ON' : 'OFF'}</p>
              {cfg.code && <p className="text-xs text-slate-400">Invitation code: <span className="font-mono text-slate-200 tracking-widest">{cfg.code}</span></p>}</div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setting({ enabled: !cfg.enabled })}>{cfg.enabled ? 'Turn off' : 'Turn on'}</button>
              {cfg.code && <button className="btn-secondary" onClick={() => window.confirm('The old code will stop working. Continue?') && setting({ regenerate: true })}>New code</button>}
            </div></div>
          {cfg.enabled && link && <div className="flex gap-2 items-center"><input readOnly className="input flex-1 text-xs" value={link} />
            <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copied'))}>Copy link</button></div>}
          {cfg.enabled && <p className="text-xs text-slate-500">Share this link or code with residents. Anyone with it can apply, but nobody gets an account until you approve.</p>}
        </div>)}
      <div className="flex gap-2 flex-wrap">{['PENDING', 'APPROVED', 'REJECTED'].map((s) => <button key={s} onClick={() => setFilter(s)} className={filter === s ? 'btn-primary' : 'btn-secondary'}>{s.charAt(0) + s.slice(1).toLowerCase()}</button>)}</div>
      {!rows.length && <p className="text-sm text-slate-400">Nothing here.</p>}
      {rows.map((r) => (
        <div key={r.id} className="card p-4 flex gap-4 flex-wrap">
          {r.hasSelfie ? <Selfie id={r.id} /> : <div className="w-24 h-24 rounded-xl bg-slate-800 text-xs text-slate-500 flex items-center justify-center">Photo removed</div>}
          <div className="flex-1 min-w-[200px]"><p className="text-white font-medium">{r.name}</p>
            <p className="text-sm text-slate-300">{r.email}{r.phone ? ` · ${r.phone}` : ''}</p>
            <p className="text-sm text-slate-400">{r.unit || 'Unit removed'} · {r.residentType === 'OWNER' ? 'Owner' : 'Tenant'}</p>
            <p className="text-xs text-slate-500">Applied {new Date(r.createdAt).toLocaleString()}</p>
            {r.reviewNote && <p className="text-xs text-slate-400 mt-1">Note: {r.reviewNote}</p>}</div>
          {r.status === 'PENDING' && <div className="flex gap-2 items-start"><button className="btn-primary" disabled={busy === r.id} onClick={() => act(r.id, 'approve')}>Approve</button>
            <button className="btn-secondary" disabled={busy === r.id} onClick={() => act(r.id, 'reject')}>Reject</button></div>}
        </div>))}
    </div>);
}
