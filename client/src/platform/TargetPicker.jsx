import { useEffect, useState } from 'react';
import { platformApi as api } from '../utils/api';

const TABS = [
  ['countries', 'Country'], ['states', 'State'], ['districts', 'LGA / District'], ['cities', 'City'], ['areas', 'Area'], ['localities', 'Locality'],
  ['postalCodes', 'ZIP'], ['estateIds', 'Estates'], ['flats', 'Flats'],
];
const blank = { everywhere: false, countries: [], states: [], districts: [], cities: [], areas: [], localities: [], postalCodes: [], estateIds: [], flats: {} };
export const emptyTargeting = () => ({ ...blank, flats: {} });
export const hasTargets = (g) => g.everywhere || ['countries', 'states', 'districts', 'cities', 'areas', 'localities', 'postalCodes', 'estateIds'].some((k) => g[k].length) || Object.values(g.flats).some((a) => a.length);

/** Chooses where a banner runs: whole places, ZIP prefixes, estates or single flats, with a live count of who it reaches. */
export default function TargetPicker({ value: g, onChange }) {
  const [places, setPlaces] = useState(null); const [tab, setTab] = useState('states'); const [q, setQ] = useState('');
  const [reach, setReach] = useState(null); const [flatEstate, setFlatEstate] = useState(''); const [flats, setFlats] = useState([]);
  useEffect(() => { api.get('/ads/places').then(setPlaces).catch(() => setPlaces({})); }, []);
  useEffect(() => { // live reach, debounced
    if (!hasTargets(g)) { setReach(null); return undefined; }
    const t = setTimeout(() => api.post('/ads/reach', { targeting: g }).then(setReach).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [g]);
  useEffect(() => { if (flatEstate) api.get(`/ads/estates/${flatEstate}/flats`).then(setFlats).catch(() => setFlats([])); else setFlats([]); }, [flatEstate]);

  const toggle = (k, v) => onChange({ ...g, [k]: g[k].includes(v) ? g[k].filter((x) => x !== v) : [...g[k], v] });
  const toggleFlat = (tid, uid) => { const cur = g.flats[tid] || []; const next = cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid]; const flatsObj = { ...g.flats, [tid]: next }; if (!next.length) delete flatsObj[tid]; onChange({ ...g, flats: flatsObj }); };
  const count = (k) => (k === 'flats' ? Object.values(g.flats).reduce((s, a) => s + a.length, 0) : g[k].length);
  const needle = q.trim().toLowerCase();
  const filt = (arr) => (arr || []).filter((o) => !needle || `${o.label} ${o.sub || ''}`.toLowerCase().includes(needle));

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={g.everywhere} onChange={(e) => onChange({ ...emptyTargeting(), everywhere: e.target.checked })} /> Run everywhere (all estates)</label>
      {!g.everywhere && (<>
        <div className="flex flex-wrap gap-1">{TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setTab(k); setQ(''); }} className={`text-xs px-2.5 py-1 rounded-full border ${tab === k ? 'bg-estate-700 border-estate-500 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>{label}{count(k) ? ` (${count(k)})` : ''}</button>))}</div>
        {!places ? <p className="text-sm text-slate-500">Loading places…</p> : (<div className="border border-slate-800 rounded-lg p-3">
          {tab === 'postalCodes' ? (
            <div><p className="text-xs text-slate-400 mb-2">Type a ZIP / postal code, or just its first digits (for example <b>1002</b> covers 100271), and press Enter.</p>
              <input className="input" placeholder="ZIP or prefix, then Enter" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { e.preventDefault(); const v = e.target.value.trim(); if (!g.postalCodes.includes(v)) onChange({ ...g, postalCodes: [...g.postalCodes, v] }); e.target.value = ''; } }} />
              <div className="flex flex-wrap gap-1 mt-2">{g.postalCodes.map((p) => <button type="button" key={p} className="badge-blue" onClick={() => toggle('postalCodes', p)}>{p} ✕</button>)}</div>
              {places.postalCodes?.length > 0 && <p className="text-xs text-slate-500 mt-2">Codes in use: {places.postalCodes.join(', ')}</p>}</div>
          ) : tab === 'flats' ? (
            <div className="space-y-2"><select className="select" value={flatEstate} onChange={(e) => { setFlatEstate(e.target.value); setQ(''); }}><option value="">Choose an estate, then tick its flats…</option>{(places.estates || []).map((e) => <option key={e.id} value={e.id}>{e.label}{g.flats[e.id]?.length ? ` (${g.flats[e.id].length} chosen)` : ''}</option>)}</select>
              {flatEstate && <><input className="input" placeholder="Search flats" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="max-h-48 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 gap-1">{filt(flats).map((u) => <label key={u.id} className="text-sm text-slate-300 flex items-center gap-1.5"><input type="checkbox" checked={(g.flats[flatEstate] || []).includes(u.id)} onChange={() => toggleFlat(flatEstate, u.id)} />{u.label}</label>)}</div></>}</div>
          ) : (
            <div className="space-y-2"><input className="input" placeholder={`Search ${TABS.find((t) => t[0] === tab)[1].toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
              {(places[tab === 'estateIds' ? 'estates' : tab] || []).length === 0 ? <p className="text-sm text-slate-500">Nothing here yet. Fill in the estate details of your estates first.</p> :
                <div className="max-h-48 overflow-y-auto space-y-1">{filt(places[tab === 'estateIds' ? 'estates' : tab]).map((o) => { const id = tab === 'estateIds' ? o.id : o.key; return (
                  <label key={id} className="text-sm text-slate-300 flex items-center gap-2"><input type="checkbox" checked={g[tab].includes(id)} onChange={() => toggle(tab, id)} />{o.label}{o.sub ? <span className="text-xs text-slate-500">{o.sub}</span> : null}{o.estates != null && <span className="ml-auto text-xs text-slate-500">{o.estates} estate{o.estates === 1 ? '' : 's'}</span>}</label>); })}</div>}</div>
          )}
        </div>)}
      </>)}
      <div className={`rounded-lg p-3 text-sm ${reach && reach.estates ? 'bg-estate-900/30 border border-estate-800/60' : 'bg-surface-800 border border-slate-800'}`}>
        {!hasTargets(g) ? <span className="text-slate-400">Choose where this banner should run to see who it reaches.</span> : !reach ? <span className="text-slate-400">Counting…</span> : (<>
          <p className="font-semibold text-slate-100">This banner will reach</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2 text-center">
            {[['Estates', reach.estates], ['Flats', reach.flats], ['Flat owners', reach.owners], ['Tenants', reach.tenants], ['Family members', reach.family]].map(([l, n]) => <div key={l} className="bg-surface-900 rounded-lg py-2"><p className="text-xl font-bold text-estate-300">{n}</p><p className="text-[11px] text-slate-400">{l}</p></div>)}
          </div>
          {reach.estateNames?.length > 0 && <p className="text-xs text-slate-500 mt-2">{reach.estateNames.join(', ')}{reach.estates > reach.estateNames.length ? ` and ${reach.estates - reach.estateNames.length} more` : ''}</p>}
          <p className="text-[11px] text-slate-500 mt-1">Banners are shown to residents (owners and tenants). Family members are counted but will see them only once they have their own logins.</p></>)}
      </div>
    </div>
  );
}
