import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import CameraCapture from '../components/CameraCapture';
import { Shield, Camera, CheckCircle2, XCircle, Clock } from 'lucide-react';

const http = axios.create({ baseURL: '/api/public', timeout: 20000 });
const errMsg = (e) => e.response?.data?.error || 'Something went wrong. Please try again.';
const STORE = 'estatium_reg_';

// Shrinks a photo to a ~640px JPEG (usually 40-90 KB) in the browser before upload.
async function toJpegDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.8, 0.65, 0.5]) { const d = c.toDataURL('image/jpeg', q); if (d.length < 380 * 1024 * 1.33) return d; }
  throw new Error('Photo too large');
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-surface-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6"><div className="inline-flex w-12 h-12 rounded-2xl bg-estate-600 items-center justify-center mb-3"><Shield className="w-6 h-6 text-white" /></div>
          <h1 className="text-2xl font-bold text-white">Estatium</h1></div>
        <div className="card p-6">{children}</div>
        <p className="text-center text-xs text-slate-500 mt-4"><Link to="/login" className="underline">Already have an account? Sign in</Link></p>
      </div>
    </div>
  );
}

function Status({ code, token }) {
  const [s, setS] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { http.get(`/registration/${code}/status/${token}`).then((r) => setS(r.data)).catch((e) => setErr(errMsg(e))); }, [code, token]);
  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!s) return <p className="text-slate-400 text-sm">Loading…</p>;
  const map = { PENDING: [Clock, 'text-amber-400', 'Waiting for approval', 'Your estate administrator will review your request. Check this page again later.'],
    APPROVED: [CheckCircle2, 'text-green-400', 'Approved!', 'You can now sign in with the email and password you chose.'],
    REJECTED: [XCircle, 'text-red-400', 'Not approved', s.note || ''],
    NEEDS_INFO: [Clock, 'text-amber-400', 'More information needed', s.note || ''] }[s.status];
  const [Icon, color, title, text] = map;
  return (<div className="text-center"><Icon className={`w-10 h-10 mx-auto mb-2 ${color}`} /><h2 className="text-lg font-semibold text-white">{title}</h2>
    <p className="text-sm text-slate-400 mt-1">{s.estate}</p><p className="text-sm text-slate-300 mt-3">{text}</p>
    {s.status === 'APPROVED' && <Link to="/login" className="btn-primary inline-block mt-4">Go to sign in</Link>}</div>);
}

export default function Register() {
  const { code: codeParam } = useParams(); const [sp] = useSearchParams();
  const [code, setCode] = useState(codeParam || sp.get('code') || '');
  const [info, setInfo] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(() => { try { return localStorage.getItem(STORE + (codeParam || '')) || ''; } catch { return ''; } });
  const [f, setF] = useState({ name: '', email: '', phone: '', residentType: 'TENANT', unitId: '', password: '', password2: '', consent: false, website: '' });
  const [selfie, setSelfie] = useState(''); const [cam, setCam] = useState(false); const fileRef = useRef();
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const lookup = async (c) => {
    setErr(''); setBusy(true);
    try { const r = await http.get(`/registration/${encodeURIComponent(c.trim())}`); setInfo(r.data); }
    catch (e) { setInfo(null); setErr(e.response?.status === 404 ? 'That code was not recognised. Please check it with your estate administrator.' : errMsg(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (code && !done) lookup(code); /* eslint-disable-next-line */ }, []);

  const pick = async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setSelfie(await toJpegDataUrl(file)); setErr(''); } catch { setErr('Could not use that photo. Please try another.'); } };
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.password2) return setErr('The two passwords do not match');
    if (!selfie) return setErr('Please take a photo of yourself');
    if (!f.unitId) return setErr('Please choose your unit');
    setBusy(true);
    try {
      const r = await http.post(`/registration/${encodeURIComponent(code.trim())}`, { name: f.name, email: f.email, phone: f.phone, residentType: f.residentType, unitId: f.unitId, password: f.password, consent: f.consent, selfie, website: f.website });
      try { localStorage.setItem(STORE + code.trim(), r.data.trackingToken); } catch { /* private mode */ }
      setDone(r.data.trackingToken);
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };

  if (done && code) return <Shell><Status code={code.trim()} token={done} /></Shell>;
  if (!info) return (
    <Shell><h2 className="text-lg font-semibold text-white mb-1">Join your estate</h2><p className="text-sm text-slate-400 mb-4">Enter the invitation code from your estate administrator.</p>
      <form onSubmit={(e) => { e.preventDefault(); lookup(code); }}>
        <input className="input w-full uppercase tracking-widest" placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        {err && <p className="text-red-400 text-sm mt-2">{err}</p>}
        <button className="btn-primary w-full mt-4" disabled={busy || !code}>{busy ? 'Checking…' : 'Continue'}</button></form></Shell>);

  return (
    <Shell><h2 className="text-lg font-semibold text-white">Register for {info.estate.name}</h2>
      <p className="text-sm text-slate-400 mb-4">Your estate administrator will check your details before your account is opened.</p>
      <form onSubmit={submit} className="space-y-3">
        <input className="input w-full" placeholder="Full name" value={f.name} onChange={set('name')} required minLength={2} autoComplete="name" />
        <input className="input w-full" type="email" placeholder="Email address" value={f.email} onChange={set('email')} required autoComplete="email" />
        <input className="input w-full" type="tel" placeholder="Phone (optional)" value={f.phone} onChange={set('phone')} autoComplete="tel" />
        <select className="input w-full" value={f.unitId} onChange={set('unitId')} required><option value="">Choose your unit…</option>{info.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
        <select className="input w-full" value={f.residentType} onChange={set('residentType')}><option value="TENANT">I rent this unit</option><option value="OWNER">I own this unit</option></select>
        <input className="input w-full" type="password" placeholder="Choose a password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
        <input className="input w-full" type="password" placeholder="Repeat password" value={f.password2} onChange={set('password2')} required autoComplete="new-password" />
        <div><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick} />
          <button type="button" className="btn-secondary w-full flex items-center justify-center gap-2" onClick={() => setCam(true)}><Camera className="w-4 h-4" />{selfie ? 'Retake photo' : 'Take a photo of yourself'}</button>
          <button type="button" className="text-xs text-slate-400 underline mt-1 block mx-auto" onClick={() => fileRef.current.click()}>or upload a photo from this device</button>
          {cam && <CameraCapture onCapture={(d) => { setSelfie(d); setErr(''); setCam(false); }} onClose={() => setCam(false)} onFallback={() => { setCam(false); fileRef.current.click(); }} />}
          {selfie && <img src={selfie} alt="Your photo" className="mt-2 mx-auto w-28 h-28 object-cover rounded-xl" />}</div>
        <input className="hidden" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden="true" />
        <label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={f.consent} onChange={set('consent')} className="mt-0.5" />
          <span>I agree that {info.estate.name} and its administrators may store my name, contact details, unit and photo to verify that I live here. My photo is used only for this check and is deleted after the review period. I can ask the estate administrator to correct or delete my data.</span></label>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || !f.consent}>{busy ? 'Sending…' : 'Submit registration'}</button>
      </form></Shell>);
}
