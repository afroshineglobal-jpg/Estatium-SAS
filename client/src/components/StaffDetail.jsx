import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import api from '../utils/api';
import { downloadCsv } from '../utils/download';
import TempPasswordModal from './TempPasswordModal';

export const STATUS_LABEL = { ACTIVE: 'Active', SUSPENDED: 'Suspended', DEACTIVATED: 'Deactivated', LEFT: 'Left the job' };
export const STATUS_BADGE = { ACTIVE: 'badge-green', SUSPENDED: 'badge-yellow', DEACTIVATED: 'badge-gray', LEFT: 'badge-red' };
const ACTION_LABEL = { STAFF_STATUS_CHANGED: 'Status changed', STAFF_UPDATED: 'Details edited', PASSWORD_RESET_BY_ADMIN: 'Password reset', STAFF_CREATED: 'Added' };
const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

const Row = ({ k, v }) => <div><p className="text-xs text-slate-500">{k}</p><p className="text-sm text-slate-200 break-words">{v || '—'}</p></div>;

/** Everything about one staff member: who they are, how they sign in, status, history; plus status actions. */
export default function StaffDetail({ id, onClose, onChanged }) {
  const [s, setS] = useState(null); const [edit, setEdit] = useState(null); const [pending, setPending] = useState(null); const [reason, setReason] = useState(''); const [date, setDate] = useState(''); const [shown, setShown] = useState(null);
  const load = useCallback(async () => { try { setS(await api.get(`/staff/${id}`)); } catch { onClose(); } }, [id, onClose]);
  useEffect(() => { load(); }, [load]);
  if (!s) return <div className="modal-overlay"><div className="modal p-6 text-slate-400">Loading…</div></div>;

  const u = s.user || {};
  const save = async () => { try { await api.put(`/staff/${id}`, edit); toast.success('Details saved'); setEdit(null); await load(); onChanged(); } catch {} };
  const applyStatus = async () => {
    try { await api.post(`/staff/${id}/status`, { status: pending, note: reason, date: date || undefined }); toast.success('Status updated'); setPending(null); setReason(''); setDate(''); await load(); onChanged(); } catch {}
  };
  const resetPw = async () => {
    if (!window.confirm(`Reset the password for ${u.name}? They will be signed out everywhere.`)) return;
    try { const r = await api.post(`/staff/${id}/reset-password`); setShown({ email: r.email, password: r.temporaryPassword }); } catch {}
  };
  const actions = s.status === 'ACTIVE' ? [['SUSPENDED', 'Suspend'], ['DEACTIVATED', 'Deactivate'], ['LEFT', 'Mark as left the job']] : [['ACTIVE', s.status === 'LEFT' ? 'Re-hire / Reinstate' : 'Reinstate']];
  const asked = { SUSPENDED: 'Suspend (temporary — they cannot sign in until reinstated)', DEACTIVATED: 'Deactivate (switch the account off)', LEFT: 'Mark as left the job (record the leaving date)', ACTIVE: 'Reinstate (they can sign in again)' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      {shown && <TempPasswordModal {...shown} onClose={() => setShown(null)} />}
      <div className="modal p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4 gap-3">
          <div><h3 className="text-lg font-semibold text-slate-100">{u.name}</h3>
            <p className="text-xs text-slate-500">{s.staffType} · {s.employedBy}</p>
            <span className={`badge ${STATUS_BADGE[s.status]} mt-1 inline-block`}>{STATUS_LABEL[s.status]}</span></div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl">✕</button>
        </div>

        {(s.status !== 'ACTIVE') && <div className="card p-3 mb-3 text-sm"><p className="text-slate-300">{STATUS_LABEL[s.status]}{s.leftAt ? ` on ${new Date(s.leftAt).toLocaleDateString()}` : s.statusChangedAt ? ` on ${new Date(s.statusChangedAt).toLocaleDateString()}` : ''}</p>{s.statusNote && <p className="text-slate-400">Reason: {s.statusNote}</p>}</div>}

        <div className="card p-4 grid grid-cols-2 gap-3 mb-3">
          <Row k="Sign-in email" v={u.email} /><Row k="Phone" v={u.phone} />
          <Row k="Works from" v={s.accessStart} /><Row k="Works until" v={s.accessEnd} />
          <Row k="Added on" v={new Date(s.createdAt).toLocaleDateString()} /><Row k="Last sign-in" v={u.lastLoginAt ? fmt(u.lastLoginAt) : 'Never'} />
          <Row k="Must change password" v={u.mustChangePassword ? 'Yes (has not signed in with a new password yet)' : 'No'} />
          <Row k="Account" v={u.lockedUntil && new Date(u.lockedUntil) > new Date() ? 'Locked after wrong passwords' : u.isActive ? 'Can sign in' : 'Cannot sign in'} />
        </div>
        <p className="text-xs text-slate-500 mb-3">The password is never stored in a readable form, so it cannot be shown. Use <b>Reset password</b> to create a new temporary one.</p>

        {edit ? (
          <div className="card p-4 space-y-2 mb-3">
            {[['name', 'Full name'], ['email', 'Sign-in email'], ['phone', 'Phone']].map(([k, l]) => <div key={k}><label className="label">{l}</label><input className="input" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></div>)}
            <div className="grid grid-cols-2 gap-2"><div><label className="label">Works from</label><input type="time" className="input" value={edit.accessStart || ''} onChange={(e) => setEdit({ ...edit, accessStart: e.target.value })} /></div>
              <div><label className="label">Works until</label><input type="time" className="input" value={edit.accessEnd || ''} onChange={(e) => setEdit({ ...edit, accessEnd: e.target.value })} /></div></div>
            <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary flex-1 justify-center" onClick={save}>Save</button></div>
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap mb-3">
            <button className="btn-secondary" onClick={() => setEdit({ name: u.name, email: u.email, phone: u.phone || '', accessStart: s.accessStart || '', accessEnd: s.accessEnd || '' })}>Edit details</button>
            <button className="btn-secondary" onClick={resetPw}>Reset password</button>
            <button className="btn-secondary" onClick={() => downloadCsv('/exports/staff-attendance.csv', { staffId: id }, `attendance-${(u.name || 'staff').replace(/\W+/g, '-')}`)}>Download attendance</button>
          </div>)}

        <div className="card p-4 mb-3">
          <p className="text-sm font-semibold text-slate-300 mb-2">Status</p>
          {pending ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-300">{asked[pending]}</p>
              {pending !== 'ACTIVE' && <input className="input" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />}
              {pending === 'LEFT' && <div><label className="label">Date they left</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>}
              <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => { setPending(null); setReason(''); }}>Cancel</button><button className="btn-primary flex-1 justify-center" onClick={applyStatus}>Confirm</button></div>
            </div>
          ) : <div className="flex gap-2 flex-wrap">{actions.map(([v, l]) => <button key={v} className={v === 'ACTIVE' ? 'btn-primary' : 'btn-secondary'} onClick={() => setPending(v)}>{l}</button>)}</div>}
          <p className="text-xs text-slate-500 mt-2">Nothing is deleted. Suspended, deactivated or former staff cannot sign in, and their records stay for history and exports.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="card p-3 text-center"><p className="text-xs text-slate-500 mb-1">Access badge</p><div className="bg-white p-2 rounded-lg inline-block"><QRCodeSVG value={JSON.stringify({ staffId: s.id, type: 'STAFF' })} size={96} /></div></div>
          <div className="card p-3"><p className="text-xs text-slate-500 mb-1">Open tasks</p><p className="text-2xl font-bold text-slate-100">{s.tasks.filter((t) => t.status !== 'DONE').length}</p></div>
        </div>

        <details className="mb-2"><summary className="text-sm text-slate-300 cursor-pointer">Recent attendance ({s.attendanceLogs.length})</summary>
          {s.attendanceLogs.map((a) => <p key={a.id} className="text-xs text-slate-400 py-1 border-b border-slate-800/50">{fmt(a.timestamp)} · {a.action === 'CHECK_IN' ? 'Checked in' : 'Checked out'}</p>)}</details>
        <details open><summary className="text-sm text-slate-300 cursor-pointer">History ({s.history.length})</summary>
          {s.history.map((h, i) => <p key={i} className="text-xs text-slate-400 py-1 border-b border-slate-800/50">{fmt(h.createdAt)} · {ACTION_LABEL[h.action] || h.action}{h.after?.status ? ` → ${STATUS_LABEL[h.after.status] || h.after.status}` : ''}{h.after?.note ? ` (${h.after.note})` : ''}{h.actorEmail ? ` — by ${h.actorEmail}` : ''}</p>)}
          {!s.history.length && <p className="text-xs text-slate-500 py-1">Nothing recorded yet.</p>}</details>
      </div>
    </div>
  );
}
