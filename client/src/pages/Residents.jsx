import { useState, useEffect } from 'react';
import { Plus, Search, Users, Home, Phone, Mail, Trash2, Edit, UserPlus } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

function AddResidentModal({ onClose, onDone, units }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', unitId: '', residentType: 'TENANT' });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.name || !form.email || !form.unitId) return toast.error('Name, email, and unit required');
    setLoading(true);
    try {
      await api.post('/residents', form);
      toast.success('Resident added successfully');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Add New Resident</h3>
        <div className="space-y-3">
          <div><label className="label">Full Name *</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Chidi Okeke" /></div>
          <div><label className="label">Email *</label><input type="email" className="input" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="resident@email.com" /></div>
          <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="+2348..." /></div>
          <div><label className="label">Password (default: Resident@123)</label><input className="input" value={form.password} onChange={e => setForm({...form, password: e.target.value})} placeholder="Leave blank for default" /></div>
          <div>
            <label className="label">Unit *</label>
            <select className="select" value={form.unitId} onChange={e => setForm({...form, unitId: e.target.value})}>
              <option value="">Select unit...</option>
              {units.filter(u => !u.isOccupied).map(u => (
                <option key={u.id} value={u.id}>{u.block?.name} - {u.unitNumber}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Resident Type</label>
            <select className="select" value={form.residentType} onChange={e => setForm({...form, residentType: e.target.value})}>
              <option value="OWNER">Owner</option>
              <option value="TENANT">Tenant</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? 'Adding...' : 'Add Resident'}</button>
        </div>
      </div>
    </div>
  );
}

function AddBlockModal({ onClose, onDone }) {
  const [name, setName] = useState('');
  const [units, setUnits] = useState(10);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name) return toast.error('Block name required');
    setLoading(true);
    try {
      await api.post('/residents/blocks', { name, units });
      toast.success(`Block ${name} created with ${units} units`);
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Add New Block</h3>
        <div className="space-y-3">
          <div><label className="label">Block Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. E" /></div>
          <div><label className="label">Number of Units</label><input type="number" className="input" value={units} onChange={e => setUnits(parseInt(e.target.value))} min={1} max={50} /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? 'Creating...' : 'Create Block'}</button>
        </div>
      </div>
    </div>
  );
}

function ManageUnitsModal({ block, units, onClose, onDone }) {
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const blockUnits = units.filter(u => u.blockId === block.id);

  const addUnits = async () => {
    if (!count || count < 1) return toast.error('Enter number of units to add');
    setLoading(true);
    try {
      await api.post('/residents/blocks/add-units', { blockId: block.id, count });
      toast.success(`Added ${count} units to Block ${block.name}`);
      onDone();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-1">Manage Units — Block {block.name}</h3>
        <p className="text-slate-400 text-sm mb-4">{blockUnits.length} units · {blockUnits.filter(u => u.isOccupied).length} occupied</p>

        <div className="max-h-48 overflow-y-auto mb-4 space-y-1">
          {blockUnits.map(u => (
            <div key={u.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-surface-900">
              <span className="font-mono text-sm text-slate-300">{block.name}-{u.unitNumber}</span>
              <span className={u.isOccupied ? 'badge-green text-xs' : 'badge-gray text-xs'}>{u.isOccupied ? 'Occupied' : 'Vacant'}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-800 pt-4">
          <label className="label">Add More Units</label>
          <div className="flex gap-3">
            <input type="number" className="input flex-1" value={count} onChange={e => setCount(parseInt(e.target.value))} min={1} max={50} placeholder="How many?" />
            <button className="btn-primary" onClick={addUnits} disabled={loading}>{loading ? '...' : 'Add Units'}</button>
          </div>
        </div>

        <button className="btn-secondary w-full mt-3" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ResidentDetail({ resident, onClose }) {
  const [newMember, setNewMember] = useState({ name: '', relation: '', phone: '' });
  const [addingMember, setAddingMember] = useState(false);

  const addMember = async () => {
    if (!newMember.name || !newMember.relation) return toast.error('Name and relation required');
    try {
      await api.post(`/residents/${resident.id}/members`, newMember);
      toast.success('Family member added');
      setNewMember({ name: '', relation: '', phone: '' });
      setAddingMember(false);
    } catch {}
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold text-slate-100">{resident.user?.name}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl">✕</button>
        </div>

        <div className="space-y-4">
          <div className="card p-4 grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-slate-500">Unit</p><p className="text-slate-200 font-medium">{resident.unit?.block?.name}-{resident.unit?.unitNumber}</p></div>
            <div><p className="text-slate-500">Type</p><p className="text-slate-200 font-medium">{resident.residentType}</p></div>
            <div><p className="text-slate-500">Email</p><p className="text-slate-300">{resident.user?.email}</p></div>
            <div><p className="text-slate-500">Phone</p><p className="text-slate-300">{resident.user?.phone || '—'}</p></div>
          </div>

          {/* Family Members */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-300">Family Members ({resident.members?.length || 0}/15)</p>
              <button className="btn-ghost text-xs" onClick={() => setAddingMember(v => !v)}><UserPlus size={14} /> Add</button>
            </div>
            {addingMember && (
              <div className="card p-3 space-y-2 mb-2">
                <div className="grid grid-cols-3 gap-2">
                  <input className="input text-xs" placeholder="Name" value={newMember.name} onChange={e => setNewMember({...newMember, name: e.target.value})} />
                  <input className="input text-xs" placeholder="Relation" value={newMember.relation} onChange={e => setNewMember({...newMember, relation: e.target.value})} />
                  <input className="input text-xs" placeholder="Phone" value={newMember.phone} onChange={e => setNewMember({...newMember, phone: e.target.value})} />
                </div>
                <button className="btn-primary text-xs" onClick={addMember}>Add Member</button>
              </div>
            )}
            {resident.members?.map(m => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b border-slate-800/50">
                <div>
                  <p className="text-sm text-slate-300">{m.name}</p>
                  <p className="text-xs text-slate-500">{m.relation} {m.phone && `· ${m.phone}`}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Vehicles */}
          {resident.vehicles?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-300 mb-2">Vehicles</p>
              {resident.vehicles.map(v => (
                <div key={v.id} className="flex items-center gap-3 py-2 border-b border-slate-800/50">
                  <span className="badge-blue font-mono">{v.plateNumber}</span>
                  <span className="text-sm text-slate-400">{v.make} {v.model} · {v.color}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Residents() {
  const [residents, setResidents] = useState([]);
  const [units, setUnits] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [manageBlock, setManageBlock] = useState(null);

  const load = async () => {
    try {
      const [r, u, b] = await Promise.all([
        api.get('/residents'), api.get('/residents/units'), api.get('/residents/blocks')
      ]);
      setResidents(r); setUnits(u); setBlocks(b);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = residents.filter(r =>
    r.user?.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.user?.email?.toLowerCase().includes(search.toLowerCase()) ||
    `${r.unit?.block?.name}-${r.unit?.unitNumber}`.toLowerCase().includes(search.toLowerCase())
  );

  const occupied = units.filter(u => u.isOccupied).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Residents</h1>
          <p className="text-slate-500 text-sm">{occupied}/{units.length} units occupied across {blocks.length} blocks</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setModal('block')}><Home size={16} /> Add Block</button>
          <button className="btn-primary" onClick={() => setModal('resident')}><Plus size={16} /> Add Resident</button>
        </div>
      </div>

      {/* Block Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {blocks.map(b => {
          const blockUnits = units.filter(u => u.blockId === b.id);
          const occ = blockUnits.filter(u => u.isOccupied).length;
          return (
            <div key={b.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-lg font-display font-bold text-estate-400">Block {b.name}</p>
                <button className="btn-ghost text-xs text-slate-500 p-1" onClick={() => setManageBlock(b)} title="Manage units">
                  <Home size={14} />
                </button>
              </div>
              <p className="text-2xl font-bold text-slate-100">{occ}<span className="text-slate-500 text-base font-normal">/{blockUnits.length}</span></p>
              <div className="mt-2 h-1.5 bg-surface-800 rounded-full overflow-hidden">
                <div className="h-full bg-estate-600 rounded-full transition-all" style={{ width: `${blockUnits.length ? (occ/blockUnits.length)*100 : 0}%` }} />
              </div>
              <button className="btn-ghost text-xs text-estate-400 mt-2 w-full justify-center" onClick={() => setManageBlock(b)}>
                Manage Units
              </button>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3 text-slate-500" />
        <input className="input pl-9" placeholder="Search by name, email, or unit..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead><tr>
            <th>Resident</th><th>Unit</th><th>Type</th><th>Contact</th><th>Members</th><th>Vehicles</th><th></th>
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-slate-500">No residents found</td></tr>
            ) : filtered.map(r => (
              <tr key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                <td>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-estate-700 to-estate-900 flex items-center justify-center text-sm font-semibold text-white flex-shrink-0">
                      {r.user?.name?.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-slate-200">{r.user?.name}</p>
                      <p className="text-xs text-slate-500">{r.user?.email}</p>
                    </div>
                  </div>
                </td>
                <td><span className="font-mono text-estate-300 text-sm">{r.unit?.block?.name}-{r.unit?.unitNumber}</span></td>
                <td><span className={r.residentType === 'OWNER' ? 'badge-blue' : 'badge-gray'}>{r.residentType}</span></td>
                <td className="text-slate-400 text-sm">{r.user?.phone || '—'}</td>
                <td className="text-slate-400">{r.members?.length || 0}</td>
                <td className="text-slate-400">{r.vehicles?.length || 0}</td>
                <td><Edit size={14} className="text-slate-600" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal === 'resident' && <AddResidentModal onClose={() => setModal(null)} onDone={load} units={units} />}
      {modal === 'block' && <AddBlockModal onClose={() => setModal(null)} onDone={load} />}
      {selected && <ResidentDetail resident={selected} onClose={() => setSelected(null)} />}
      {manageBlock && <ManageUnitsModal block={manageBlock} units={units} onClose={() => setManageBlock(null)} onDone={load} />}
    </div>
  );
}
