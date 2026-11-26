import { useState, useEffect } from 'react';
import { Plus, MessageCircle, Send } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

const CATS = [['IDEA', 'An idea to improve Estatium'], ['PROBLEM', 'Something is not working'], ['QUESTION', 'A question'], ['OTHER', 'Other']];
const STATUS_BADGE = { OPEN: 'badge-yellow', IN_REVIEW: 'badge-blue', PLANNED: 'badge-blue', DONE: 'badge-green', CLOSED: 'badge-gray' };
const LABEL = { OPEN: 'Received', IN_REVIEW: 'Under review', PLANNED: 'Planned', DONE: 'Done', CLOSED: 'Closed' };

function NewTicket({ onClose, onDone }) {
  const [f, setF] = useState({ category: 'IDEA', subject: '', message: '' }); const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!f.subject.trim() || !f.message.trim()) return toast.error('Please fill in the subject and your message');
    setBusy(true);
    try { await api.post('/tickets', f); toast.success('Thank you! The Estatium team has received it.'); onDone(); onClose(); } catch { /* toast */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}><div className="modal p-6" onClick={(e) => e.stopPropagation()}>
      <h3 className="text-lg font-semibold text-slate-100 mb-1">Tell the Estatium team</h3>
      <p className="text-xs text-slate-500 mb-4">Your message goes to the people who build Estatium, not to your estate admin.</p>
      <div className="space-y-3">
        <div><label className="label">What is it about?</label><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="label">Subject *</label><input className="input" maxLength={140} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Add a way to pay by card" /></div>
        <div><label className="label">Details *</label><textarea className="input resize-none h-28" maxLength={3000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Tell us what you would like, or what went wrong." /></div>
      </div>
      <div className="flex gap-3 mt-5"><button className="btn-secondary flex-1" onClick={onClose}>Cancel</button><button className="btn-primary flex-1" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
    </div></div>
  );
}

function Thread({ id, onClose, onChange }) {
  const [t, setT] = useState(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => api.get(`/tickets/${id}`).then((x) => { setT(x); onChange(); }).catch(onClose);
  useEffect(() => { load(); }, [id]);
  const send = async () => { if (!msg.trim()) return; setBusy(true); try { await api.post(`/tickets/${id}/reply`, { message: msg }); setMsg(''); load(); } catch { /* toast */ } finally { setBusy(false); } };
  if (!t) return null;
  return (
    <div className="modal-overlay" onClick={onClose}><div className="modal p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3 mb-3"><h3 className="text-lg font-semibold text-slate-100">{t.subject}</h3><span className={STATUS_BADGE[t.status]}>{LABEL[t.status]}</span></div>
      <div className="space-y-3 mb-4">
        {t.messages.map((m) => (
          <div key={m.id} className={`rounded-lg p-3 text-sm ${m.fromPlatform ? 'bg-estate-900/40 border border-estate-800/50' : 'bg-surface-800'}`}>
            <p className="text-xs text-slate-500 mb-1">{m.fromPlatform ? 'Estatium team' : 'You'} · {new Date(m.createdAt).toLocaleString()}</p>
            <p className="text-slate-200 whitespace-pre-wrap break-words">{m.body}</p>
          </div>))}
      </div>
      {t.status !== 'CLOSED' ? (
        <div className="flex gap-2"><input className="input flex-1" maxLength={3000} placeholder="Write a reply…" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} /><button className="btn-primary" onClick={send} disabled={busy}><Send size={16} /></button></div>
      ) : <p className="text-sm text-slate-500">This ticket is closed.</p>}
      <button className="btn-secondary w-full mt-4" onClick={onClose}>Close</button>
    </div></div>
  );
}

export default function Support() {
  const [rows, setRows] = useState(null); const [modal, setModal] = useState(false); const [open, setOpen] = useState(null);
  const load = () => api.get('/tickets').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div><h1 className="page-title">Feedback &amp; ideas</h1><p className="text-slate-500 text-sm">Help us improve Estatium. We read every message.</p></div>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> New ticket</button>
      </div>
      <div className="space-y-3">
        {!rows ? <p className="text-center py-10 text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-center py-10 text-slate-500">You have not sent anything yet.</p> : rows.map((t) => (
          <button key={t.id} onClick={() => setOpen(t.id)} className="card p-4 w-full text-left flex items-start justify-between gap-3 hover:border-estate-700 transition-colors">
            <div className="min-w-0"><p className="font-medium text-slate-200 break-words flex items-center gap-2"><MessageCircle size={15} className="text-slate-500 flex-shrink-0" />{t.subject}{t.unreadForUser && <span className="w-2 h-2 rounded-full bg-amber-400" title="New reply" />}</p>
              <p className="text-xs text-slate-500 mt-1">{new Date(t.lastMessageAt).toLocaleString()}</p></div>
            <span className={STATUS_BADGE[t.status]}>{LABEL[t.status]}</span>
          </button>))}
      </div>
      {modal && <NewTicket onClose={() => setModal(false)} onDone={load} />}
      {open && <Thread id={open} onClose={() => setOpen(null)} onChange={load} />}
    </div>
  );
}
