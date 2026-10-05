// Advertisements.jsx
import { useState, useEffect } from 'react';
import { Plus, Megaphone, Eye, MousePointer } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

export function Advertisements() {
  const { user } = useAuth();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', linkUrl: '', advertiserName: '', type: 'BANNER', placement: 'HOME', startDate: '', endDate: '' });

  const load = async () => {
    try { setAds(await api.get('/advertisements')); }
    catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.title || !form.startDate || !form.endDate) return toast.error('Title and dates required');
    try {
      await api.post('/advertisements', form);
      toast.success('Ad submitted for approval');
      setModal(false);
      load();
    } catch {}
  };

  const updateStatus = async (id, status) => {
    try {
      await api.put(`/advertisements/${id}/status`, { status });
      toast.success(`Ad ${status.toLowerCase()}`);
      load();
    } catch {}
  };

  const isAdmin = ['ADMIN', 'FINANCE_ADMIN'].includes(user.role);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div><h1 className="page-title">Ads & Banners</h1><p className="text-slate-500 text-sm">Community advertising and announcements</p></div>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> New Ad</button>
      </div>

      {/* Active Banners - what residents see */}
      {user.role === 'RESIDENT' && (
        <div className="space-y-3">
          {ads.filter(a => a.status === 'APPROVED').map(a => (
            <div key={a.id} className="card p-4 border-estate-800/40 cursor-pointer hover:border-estate-700/60 transition-all"
              onClick={() => { api.post(`/advertisements/${a.id}/click`).catch(() => {}); if (a.linkUrl) window.open(a.linkUrl, '_blank'); }}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="badge-blue text-xs mb-2">{a.type}</span>
                  <p className="font-semibold text-slate-100">{a.title}</p>
                  {a.content && <p className="text-sm text-slate-400 mt-1">{a.content}</p>}
                  {a.advertiserName && <p className="text-xs text-slate-500 mt-1">— {a.advertiserName}</p>}
                </div>
                {a.linkUrl && <MousePointer size={16} className="text-estate-400 flex-shrink-0" />}
              </div>
            </div>
          ))}
          {ads.filter(a => a.status === 'APPROVED').length === 0 && (
            <div className="card p-10 text-center text-slate-500">No active advertisements</div>
          )}
        </div>
      )}

      {/* Admin view - manage all ads */}
      {isAdmin && (
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Title</th><th>Advertiser</th><th>Type</th><th>Dates</th><th>Stats</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="text-center py-10 text-slate-500">Loading...</td></tr>
              : ads.map(a => (
                <tr key={a.id}>
                  <td>
                    <p className="font-medium text-slate-200">{a.title}</p>
                    <p className="text-xs text-slate-500 truncate max-w-xs">{a.content}</p>
                  </td>
                  <td className="text-slate-400">{a.advertiserName || '—'}</td>
                  <td><span className="badge-blue text-xs">{a.type}</span></td>
                  <td className="text-slate-500 text-xs">
                    <p>{new Date(a.startDate).toLocaleDateString()}</p>
                    <p>{new Date(a.endDate).toLocaleDateString()}</p>
                  </td>
                  <td>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><Eye size={12} /> {a.impressions}</span>
                      <span className="flex items-center gap-1"><MousePointer size={12} /> {a.clicks}</span>
                    </div>
                  </td>
                  <td><span className={a.status === 'APPROVED' ? 'badge-green' : a.status === 'REJECTED' ? 'badge-red' : a.status === 'EXPIRED' ? 'badge-gray' : 'badge-yellow'}>{a.status}</span></td>
                  <td>
                    {a.status === 'PENDING' && (
                      <div className="flex gap-1">
                        <button className="btn-ghost text-xs text-estate-400" onClick={() => updateStatus(a.id, 'APPROVED')}>✓ Approve</button>
                        <button className="btn-ghost text-xs text-red-400" onClick={() => updateStatus(a.id, 'REJECTED')}>✗</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-100 mb-4">Submit Advertisement</h3>
            <div className="space-y-3">
              <div><label className="label">Ad Title *</label><input className="input" value={form.title} onChange={e => setForm({...form, title: e.target.value})} /></div>
              <div><label className="label">Content / Description</label><textarea className="input resize-none h-16" value={form.content} onChange={e => setForm({...form, content: e.target.value})} /></div>
              <div><label className="label">Advertiser Name</label><input className="input" value={form.advertiserName} onChange={e => setForm({...form, advertiserName: e.target.value})} /></div>
              <div><label className="label">Link URL</label><input className="input" value={form.linkUrl} onChange={e => setForm({...form, linkUrl: e.target.value})} placeholder="https://..." /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Type</label>
                  <select className="select" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                    {['BANNER', 'ANNOUNCEMENT', 'VENDOR'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div><label className="label">Placement</label>
                  <select className="select" value={form.placement} onChange={e => setForm({...form, placement: e.target.value})}>
                    {['HOME', 'NOTIFICATION', 'OFFERS'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Start Date *</label><input type="date" className="input" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} /></div>
                <div><label className="label">End Date *</label><input type="date" className="input" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} /></div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={submit}>Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Advertisements;
