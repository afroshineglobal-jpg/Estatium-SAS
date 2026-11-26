import nigeria from '../data/nigeria.json';

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * Estate address block shared by "New estate" and "Estate details".
 * Nigeria: State and Local Government Area are picked from the official lists (37 states incl. FCT, 774 LGAs).
 * Elsewhere: free text, with the spellings already used by other estates offered as suggestions, so ads can target places reliably.
 */
export default function PlaceFields({ value: v, onChange, places = {}, required = false }) {
  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value });
  const isNg = same(v.country, 'Nigeria');
  const st = isNg ? nigeria.states.find((s) => same(s.state, v.state)) : null;
  const dl = (id, list) => <datalist id={id}>{(list || []).map((x) => <option key={x} value={x} />)}</datalist>;
  const star = required ? ' *' : '';
  return (
    <div className="space-y-3">
      <div><label className="label">Address{star}</label><input className="input" value={v.address || ''} onChange={set('address')} placeholder="Street and number" maxLength={200} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">Country{star}</label><input className="input" list="pf-country" value={v.country || ''} onChange={(e) => onChange({ ...v, country: e.target.value, ...(same(e.target.value, 'Nigeria') === isNg ? {} : { state: '', district: '' }) })} placeholder="Nigeria" />{dl('pf-country', [...new Set(['Nigeria', 'India', ...(places.country || [])])])}</div>
        {isNg
          ? <div><label className="label">State{star}</label><select className="select" value={st?.state || ''} onChange={(e) => onChange({ ...v, state: e.target.value, district: '' })}><option value="">Choose state…</option>{nigeria.states.map((s) => <option key={s.state}>{s.state}</option>)}</select></div>
          : <div><label className="label">State / Province{star}</label><input className="input" list="pf-state" value={v.state || ''} onChange={set('state')} />{dl('pf-state', places.state)}</div>}
        {isNg
          ? <div><label className="label">Local Government Area</label><select className="select" value={v.district || ''} onChange={set('district')} disabled={!st}><option value="">{st ? 'Choose LGA…' : 'Choose a state first'}</option>{(st?.lgas || []).map((l) => <option key={l}>{l}</option>)}</select></div>
          : <div><label className="label">District / County</label><input className="input" list="pf-district" value={v.district || ''} onChange={set('district')} />{dl('pf-district', places.district)}</div>}
        <div><label className="label">City / Town</label><input className="input" list="pf-city" value={v.city || ''} onChange={set('city')} />{dl('pf-city', places.city)}</div>
        <div><label className="label">Area</label><input className="input" list="pf-area" value={v.area || ''} onChange={set('area')} placeholder="e.g. Lekki Phase 1" />{dl('pf-area', places.area)}</div>
        <div><label className="label">Locality{star}</label><input className="input" list="pf-locality" value={v.locality || ''} onChange={set('locality')} />{dl('pf-locality', places.locality)}</div>
        <div><label className="label">ZIP / postal code{star}</label><input className="input" value={v.postalCode || ''} onChange={set('postalCode')} maxLength={20} /></div>
      </div>
    </div>
  );
}
