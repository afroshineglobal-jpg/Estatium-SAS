import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Search, CheckCircle, XCircle, LogIn, LogOut, Camera, ScanLine, Car, Upload, X, Key, Video, VideoOff } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { QRCodeSVG } from 'qrcode.react';
import toast from 'react-hot-toast';

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
const statusBadge = (s) => {
  const map = { PENDING: 'badge-yellow', APPROVED: 'badge-green', DENIED: 'badge-red', INSIDE: 'badge-blue', EXITED: 'badge-gray' };
  return <span className={map[s] || 'badge-gray'}>{s}</span>;
};

// ─── AUDIO: unlocked AudioContext ─────────────────────────────────────────────
// We keep ONE context alive. It starts suspended until the user has interacted
// with the page (browser rule). On first click anywhere we call resume() once.
let _audioCtx = null;
const getAudioCtx = () => {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
};

// Call this once on any user gesture to unlock audio for the session
const unlockAudio = () => {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (_) {}
};

const playDoorbell = async () => {
  try {
    const ctx = getAudioCtx();
    // Must resume — if suspended (first visit) it may fail gracefully
    if (ctx.state === 'suspended') await ctx.resume();

    const note = (freq, startOffset, dur, vol = 0.5) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
      gain.gain.setValueAtTime(vol, ctx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + dur);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + dur + 0.05);
    };
    // Ding (high) then Dong (low)
    note(987, 0,    0.45, 0.55);
    note(659, 0.50, 0.60, 0.45);
  } catch (e) {
    console.warn('Audio blocked:', e.message);
  }
};

// ─── CAMERA CAPTURE COMPONENT ─────────────────────────────────────────────────
// Uses getUserMedia for real camera on desktop + mobile.
// Falls back to file picker if camera permission denied.
function CameraCapture({ value, onChange, label = 'Visitor Photo (optional)' }) {
  const [camOpen, setCamOpen]     = useState(false);
  const [stream, setStream]       = useState(null);
  const [camError, setCamError]   = useState('');
  const videoRef  = useRef();
  const fileRef   = useRef();

  const openCamera = async () => {
    setCamError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      setStream(s);
      setCamOpen(true);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setCamError('Camera permission denied. Use Upload instead.');
      } else if (err.name === 'NotFoundError') {
        setCamError('No camera found. Use Upload instead.');
      } else {
        setCamError('Camera unavailable. Use Upload instead.');
      }
      // Fall through to file picker as fallback
      fileRef.current?.click();
    }
  };

  useEffect(() => {
    if (camOpen && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [camOpen, stream]);

  const stopCamera = useCallback(() => {
    if (stream) stream.getTracks().forEach(t => t.stop());
    setStream(null);
    setCamOpen(false);
  }, [stream]);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onChange(dataUrl);
    stopCamera();
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast.error('Photo must be under 4MB'); return; }
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <>
      <div>
        <label className="label">{label}</label>
        <div className="flex items-center gap-2">
          {/* Camera button — getUserMedia */}
          <button type="button" onClick={openCamera}
            className="btn-secondary text-xs flex-1 justify-center py-2.5 gap-1.5">
            <Camera size={15} /> Camera
          </button>
          {/* Upload button — file picker */}
          <button type="button" onClick={() => fileRef.current.click()}
            className="btn-secondary text-xs flex-1 justify-center py-2.5 gap-1.5">
            <Upload size={15} /> Upload
          </button>
          {value && (
            <div className="relative flex-shrink-0">
              <img src={value} alt="preview" className="w-14 h-14 rounded-xl object-cover border-2 border-estate-600" />
              <button type="button" onClick={() => onChange(null)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 rounded-full text-white flex items-center justify-center hover:bg-red-500">
                <X size={10} />
              </button>
            </div>
          )}
        </div>
        {camError && <p className="text-xs text-amber-400 mt-1">{camError}</p>}
        {/* Hidden file input — no capture attr so it shows proper file browser */}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>

      {/* Camera modal */}
      {camOpen && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-md space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-200 font-medium">Camera Preview</p>
              <button onClick={stopCamera} className="btn-ghost text-red-400"><X size={18} /> Cancel</button>
            </div>
            <div className="rounded-xl overflow-hidden bg-black border border-slate-700" style={{ aspectRatio: '4/3' }}>
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
            <button onClick={capture}
              className="w-full py-4 rounded-2xl bg-estate-600 hover:bg-estate-500 text-white font-semibold text-base flex items-center justify-center gap-2 active:scale-95 transition-all">
              <Camera size={20} /> Take Photo
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── EXIT CODE MODAL (Resident shows exit code to visitor) ───────────────────
function ExitCodeModal({ visitor, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-amber-900/50 border border-amber-700 flex items-center justify-center mx-auto">
            <Key size={22} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Exit Code for {visitor.name}</h3>
            <p className="text-slate-400 text-sm mt-1">Share this code with your visitor.<br/>The guard will ask for it at the exit gate.</p>
          </div>

          {/* QR Code */}
          <div className="bg-white p-4 rounded-2xl inline-block mx-auto">
            <QRCodeSVG value={visitor.exitCode} size={140} />
          </div>

          {/* Exit code prominently */}
          <div className="card p-4 border-amber-800/50">
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">5-Digit Exit Code</p>
            <p className="text-4xl font-mono font-bold text-amber-300 tracking-[0.4em]">{visitor.exitCode}</p>
          </div>

          {/* Visitor info reminder */}
          <div className="text-sm text-slate-400 space-y-1">
            {visitor.phone && <p>📞 {visitor.phone}</p>}
            {visitor.vehicleNumber && <p>🚗 {visitor.vehicleNumber}</p>}
          </div>

          <button className="btn-secondary w-full justify-center" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── PRE-APPROVE MODAL ────────────────────────────────────────────────────────
function PreApproveModal({ onClose, onDone }) {
  const [form, setForm] = useState({ name: '', phone: '', purpose: '', visitorType: 'GUEST', expectedDate: '', vehicleNumber: '' });
  const [photo, setPhoto]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);

  const submit = async () => {
    if (!form.name) return toast.error('Visitor name required');
    setLoading(true);
    try {
      const data = await api.post('/visitors/pre-approve', { ...form, photo });
      setResult(data);
      onDone();
    } catch {} finally { setLoading(false); }
  };

  if (result) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4 text-center">✅ Visitor Pre-Approved</h3>
        <div className="flex flex-col items-center gap-4">
          {result.photo && <img src={result.photo} alt="visitor" className="w-20 h-20 rounded-xl object-cover border-2 border-estate-600" />}
          <div className="bg-white p-4 rounded-xl">
            <QRCodeSVG value={result.entryCode} size={150} />
          </div>
          <div className="w-full space-y-3">
            <div className="card p-3 text-center border-estate-800/50">
              <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider">Entry Code (share with visitor)</p>
              <p className="text-3xl font-mono font-bold text-estate-300 tracking-[0.3em]">{result.entryCode}</p>
            </div>
            <div className="card p-3 text-center border-amber-900/40">
              <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider">Exit Code (give when they leave)</p>
              <p className="text-2xl font-mono font-semibold text-amber-300 tracking-[0.3em]">{result.exitCode}</p>
            </div>
          </div>
          <p className="text-slate-400 text-xs text-center">Guard verifies the entry code to let them in and the exit code to let them out.</p>
          <button className="btn-primary w-full justify-center" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Pre-Approve Visitor</h3>
        <div className="space-y-3">
          <CameraCapture value={photo} onChange={setPhoto} />
          <div><label className="label">Visitor Name *</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Full name" autoFocus /></div>
          <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="+234..." /></div>
          <div>
            <label className="label">Vehicle Number (optional)</label>
            <div className="relative">
              <Car size={15} className="absolute left-3 top-3 text-slate-500" />
              <input className="input pl-9 uppercase" value={form.vehicleNumber} onChange={e => setForm({...form, vehicleNumber: e.target.value.toUpperCase()})} placeholder="e.g. LAG-456-XY" />
            </div>
          </div>
          <div><label className="label">Purpose</label><input className="input" value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} placeholder="e.g. Dinner" /></div>
          <div>
            <label className="label">Visitor Type</label>
            <select className="select" value={form.visitorType} onChange={e => setForm({...form, visitorType: e.target.value})}>
              <option value="GUEST">Guest</option><option value="DELIVERY">Delivery</option>
              <option value="SERVICE">Service Provider</option><option value="DOMESTIC">Domestic Staff</option>
            </select>
          </div>
          <div><label className="label">Expected Date</label><input type="date" className="input" value={form.expectedDate} onChange={e => setForm({...form, expectedDate: e.target.value})} /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? 'Generating...' : 'Generate Codes'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── WALK-IN MODAL (Guard) ────────────────────────────────────────────────────
function WalkInModal({ onClose, onDone, units }) {
  const [form, setForm] = useState({ name: '', phone: '', purpose: '', visitorType: 'GUEST', unitId: '', vehicleNumber: '' });
  const [photo, setPhoto]   = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!form.name || !form.unitId) return toast.error('Name and unit required');
    setLoading(true);
    try {
      await api.post('/visitors/walkin', { ...form, photo });
      toast.success('Visitor logged — resident notified');
      onDone(); onClose();
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-100 mb-4">Log Walk-in Visitor</h3>
        <div className="space-y-3">
          <CameraCapture value={photo} onChange={setPhoto} label="Capture Visitor Photo at Gate" />
          <div><label className="label">Visitor Name *</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus /></div>
          <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
          <div>
            <label className="label">Vehicle Number (optional)</label>
            <div className="relative">
              <Car size={15} className="absolute left-3 top-3 text-slate-500" />
              <input className="input pl-9 uppercase" value={form.vehicleNumber} onChange={e => setForm({...form, vehicleNumber: e.target.value.toUpperCase()})} placeholder="e.g. LAG-456-XY" />
            </div>
          </div>
          <div>
            <label className="label">Visiting Unit *</label>
            <select className="select" value={form.unitId} onChange={e => setForm({...form, unitId: e.target.value})}>
              <option value="">Select unit...</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.block?.name}-{u.unitNumber}{u.residents?.[0]?.user?.name ? ` (${u.residents[0].user.name})` : ''}</option>)}
            </select>
          </div>
          <div><label className="label">Purpose</label><input className="input" value={form.purpose} onChange={e => setForm({...form, purpose: e.target.value})} /></div>
          <div>
            <label className="label">Type</label>
            <select className="select" value={form.visitorType} onChange={e => setForm({...form, visitorType: e.target.value})}>
              <option value="GUEST">Guest</option><option value="DELIVERY">Delivery</option><option value="SERVICE">Service</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={submit} disabled={loading}>{loading ? 'Logging...' : 'Notify Resident'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── VERIFY CODE MODAL (Guard) ────────────────────────────────────────────────
function VerifyCodeModal({ mode, onClose, onDone }) {
  const [code, setCode]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [visitor, setVisitor]   = useState(null);
  const [confirming, setConfirming] = useState(false);
  const isEntry = mode === 'entry';

  const verify = async () => {
    if (code.length !== 5) return toast.error('Enter the full 5-digit code');
    setLoading(true);
    try {
      const endpoint = isEntry ? '/visitors/verify-code' : '/visitors/verify-exit-code';
      const payload  = isEntry ? { entryCode: code } : { exitCode: code };
      setVisitor(await api.post(endpoint, payload));
    } catch {} finally { setLoading(false); }
  };

  const confirm = async () => {
    setConfirming(true);
    try {
      if (isEntry) {
        await api.put(`/visitors/${visitor.id}/entry`, {});
        toast.success(`✅ ${visitor.name} — entry confirmed`);
      } else {
        await api.put(`/visitors/${visitor.id}/exit`, {});
        toast.success(`👋 ${visitor.name} — exit confirmed`);
      }
      onDone(); onClose();
    } catch {} finally { setConfirming(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isEntry ? 'bg-estate-900/60' : 'bg-amber-900/60'}`}>
            {isEntry ? <LogIn size={20} className="text-estate-400" /> : <LogOut size={20} className="text-amber-400" />}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Verify {isEntry ? 'Entry' : 'Exit'} Code</h3>
            <p className="text-slate-400 text-xs">Enter 5-digit code given by resident</p>
          </div>
        </div>

        {!visitor ? (
          <>
            <label className="label text-center block mb-2">5-Digit {isEntry ? 'Entry' : 'Exit'} Code</label>
            <input
              className="input text-center text-4xl font-mono tracking-[0.5em] py-5 mb-4"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="· · · · ·"
              maxLength={5}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && code.length === 5 && verify()}
            />
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
              <button className={`flex-1 justify-center ${isEntry ? 'btn-primary' : 'btn-secondary border-amber-700/50 text-amber-300 bg-amber-900/20 hover:bg-amber-900/40'}`}
                onClick={verify} disabled={loading || code.length !== 5}>
                {loading ? 'Checking...' : <><ScanLine size={16} /> Verify Code</>}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Full visitor details */}
            <div className="card p-4 border-estate-800/50 space-y-4 mb-4">
              {/* Photo + Name row */}
              <div className="flex items-center gap-4">
                {visitor.photo ? (
                  <img src={visitor.photo} alt={visitor.name}
                    className="w-20 h-20 rounded-xl object-cover border-2 border-estate-600 flex-shrink-0" />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-surface-800 border-2 border-slate-700 flex items-center justify-center text-3xl font-bold text-slate-500 flex-shrink-0">
                    {visitor.name?.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-xl font-bold text-slate-100">{visitor.name}</p>
                  {visitor.phone && <p className="text-sm text-slate-400 mt-0.5">📞 {visitor.phone}</p>}
                  <span className="badge-blue text-xs mt-1 inline-block">{visitor.visitorType}</span>
                </div>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-surface-900 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Visiting</p>
                  <p className="font-bold text-estate-300">{visitor.resident?.unit?.block?.name}-{visitor.resident?.unit?.unitNumber}</p>
                  <p className="text-xs text-slate-400">{visitor.resident?.user?.name}</p>
                </div>
                <div className="bg-surface-900 rounded-xl p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Purpose</p>
                  <p className="font-medium text-slate-300">{visitor.purpose || '—'}</p>
                </div>
                {visitor.vehicleNumber && (
                  <div className="bg-surface-900 rounded-xl p-3 col-span-2">
                    <p className="text-xs text-slate-500 mb-0.5">Vehicle</p>
                    <p className="font-mono font-bold text-lg text-slate-200">{visitor.vehicleNumber}</p>
                  </div>
                )}
              </div>

              {/* Code confirmed strip */}
              <div className={`p-3 rounded-xl text-center ${isEntry ? 'bg-estate-900/40 border border-estate-700/40' : 'bg-amber-900/40 border border-amber-700/40'}`}>
                <p className="text-xs text-slate-400 mb-0.5">{isEntry ? 'Entry' : 'Exit'} Code ✓ Verified</p>
                <p className={`text-2xl font-mono font-bold tracking-[0.4em] ${isEntry ? 'text-estate-300' : 'text-amber-300'}`}>{code}</p>
              </div>

              {visitor.preApproved && <span className="badge-green text-xs">✓ Pre-approved by resident</span>}
            </div>

            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => { setVisitor(null); setCode(''); }}>← Back</button>
              <button
                className={`flex-1 justify-center py-3 ${isEntry ? 'btn-primary' : 'btn-secondary border-amber-700/60 text-amber-200 bg-amber-900/30 hover:bg-amber-900/50'}`}
                onClick={confirm} disabled={confirming}>
                {confirming ? '...' : isEntry ? <><CheckCircle size={16} /> Allow Entry</> : <><LogOut size={16} /> Confirm Exit</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MAIN VISITORS PAGE ───────────────────────────────────────────────────────
export default function Visitors() {
  const { user } = useAuth();
  const socketRef = useSocket();
  const [visitors, setVisitors]     = useState([]);
  const [units, setUnits]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState(null);
  const [search, setSearch]         = useState('');
  const [filter, setFilter]         = useState('');
  const [approvingId, setApprovingId] = useState(null);
  const [exitCodeVisitor, setExitCodeVisitor] = useState(null);

  const isGuard    = ['GUARD', 'SECURITY_ADMIN', 'ADMIN'].includes(user.role);
  const isResident = user.role === 'RESIDENT';

  const load = useCallback(async () => {
    try {
      const params = filter ? `?status=${filter}` : '';
      const [v, u] = await Promise.all([api.get(`/visitors${params}`), api.get('/residents/units')]);
      setVisitors(v); setUnits(u);
    } catch {} finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Unlock audio context on first user interaction with this page
  useEffect(() => {
    const unlock = () => { unlockAudio(); document.removeEventListener('click', unlock); };
    document.addEventListener('click', unlock, { once: true });
    return () => document.removeEventListener('click', unlock);
  }, []);

  // Real-time socket: resident hears doorbell + auto-reloads
  useEffect(() => {
    if (!isResident) return;
    const socket = socketRef?.current;
    if (!socket) return;

    const handler = async (data) => {
      if (data.type === 'VISITOR_WAITING') {
        await playDoorbell();
        toast('🔔 Someone is at your gate!', {
          duration: 8000,
          icon: '🚪',
          style: {
            background: '#1a2420', color: '#fef3c7',
            border: '1px solid #d97706', fontWeight: 600, fontSize: '15px'
          }
        });
        load(); // refresh list so pending card appears immediately
      }
    };

    socket.on(`resident-${user.id}`, handler);
    return () => socket.off(`resident-${user.id}`, handler);
  }, [socketRef?.current, user.id, isResident, load]);

  const handleApprove = async (id, action) => {
    setApprovingId(id);
    try {
      await api.put(`/visitors/${id}/approve`, { action });
      toast.success(action === 'APPROVED' ? '✅ Visitor approved' : '❌ Visitor denied');
      load();
    } catch {} finally { setApprovingId(null); }
  };

  const filtered = visitors.filter(v =>
    v.name?.toLowerCase().includes(search.toLowerCase()) ||
    v.phone?.includes(search) ||
    v.vehicleNumber?.toLowerCase().includes(search.toLowerCase())
  );

  // Separate "active" visitors for resident quick-action panel
  const pendingVisitors = visitors.filter(v => v.status === 'PENDING');
  const insideVisitors  = visitors.filter(v => v.status === 'INSIDE');

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Visitor Management</h1>
          <p className="text-slate-500 text-sm">Gate access control & visitor tracking</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isResident && (
            <button className="btn-primary" onClick={() => setModal('preapprove')}>
              <Plus size={16} /> Pre-Approve
            </button>
          )}
          {isGuard && (<>
            <button className="btn-secondary" onClick={() => setModal('walkin')}><Plus size={16} /> Walk-In</button>
            <button className="btn-primary" onClick={() => setModal('entry-code')}><LogIn size={16} /> Verify Entry</button>
            <button className="btn-secondary border-amber-700/50 text-amber-300" onClick={() => setModal('exit-code')}><LogOut size={16} /> Verify Exit</button>
          </>)}
        </div>
      </div>

      {/* ── RESIDENT: Pending approval alerts ── */}
      {isResident && pendingVisitors.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">⏳ Awaiting Your Approval</p>
          {pendingVisitors.map(v => (
            <div key={v.id} className="card p-4 border-amber-800/50 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {v.photo
                  ? <img src={v.photo} alt={v.name} className="w-12 h-12 rounded-xl object-cover border border-amber-700/50 flex-shrink-0" />
                  : <div className="w-12 h-12 rounded-xl bg-amber-900/40 border border-amber-700/50 flex items-center justify-center text-xl font-bold text-amber-400 flex-shrink-0">{v.name?.charAt(0)}</div>
                }
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100 truncate">🔔 {v.name}</p>
                  <p className="text-xs text-slate-400">{v.visitorType}{v.purpose ? ` · ${v.purpose}` : ''}</p>
                  {v.vehicleNumber && <p className="text-xs text-slate-500 font-mono">🚗 {v.vehicleNumber}</p>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button className="btn-primary text-xs py-2" disabled={approvingId === v.id} onClick={() => handleApprove(v.id, 'APPROVED')}>
                  <CheckCircle size={14} /> Allow
                </button>
                <button className="btn-danger text-xs py-2" disabled={approvingId === v.id} onClick={() => handleApprove(v.id, 'DENIED')}>
                  <XCircle size={14} /> Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── RESIDENT: Visitors currently INSIDE — show exit code button ── */}
      {isResident && insideVisitors.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">🏠 Currently Inside ({insideVisitors.length})</p>
          {insideVisitors.map(v => (
            <div key={v.id} className="card p-4 border-blue-900/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {v.photo
                  ? <img src={v.photo} alt={v.name} className="w-10 h-10 rounded-lg object-cover border border-blue-700/40 flex-shrink-0" />
                  : <div className="w-10 h-10 rounded-lg bg-blue-900/40 border border-blue-700/40 flex items-center justify-center text-base font-bold text-blue-400 flex-shrink-0">{v.name?.charAt(0)}</div>
                }
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100 truncate">{v.name}</p>
                  <p className="text-xs text-slate-500">
                    In: {v.entryTime ? new Date(v.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </p>
                </div>
              </div>
              {/* Exit code button — resident shares this with visitor before they leave */}
              <button
                className="btn-secondary text-xs border-amber-700/50 text-amber-300 flex-shrink-0"
                onClick={() => setExitCodeVisitor(v)}>
                <Key size={14} /> Exit Code
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-44">
          <Search size={16} className="absolute left-3 top-3 text-slate-500" />
          <input className="input pl-9" placeholder="Search name, phone, plate..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['', 'PENDING', 'APPROVED', 'INSIDE', 'EXITED', 'DENIED'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`btn-${filter === s ? 'primary' : 'secondary'} text-xs px-3`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Visitor table */}
      <div className="table-container overflow-x-auto">
        <table className="table min-w-full">
          <thead><tr>
            <th>Visitor</th><th>Unit</th><th>Vehicle</th><th>Type</th><th>Status</th><th>Time</th><th>Code</th>
            {isResident && <th>Actions</th>}
          </tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-500">No visitors found</td></tr>
            ) : filtered.map(v => (
              <tr key={v.id}>
                <td>
                  <div className="flex items-center gap-3">
                    {v.photo
                      ? <img src={v.photo} alt={v.name} className="w-9 h-9 rounded-lg object-cover border border-slate-700 flex-shrink-0" />
                      : <div className="w-9 h-9 rounded-lg bg-surface-800 border border-slate-700 flex items-center justify-center text-sm font-bold text-slate-500 flex-shrink-0">{v.name?.charAt(0)}</div>
                    }
                    <div>
                      <p className="font-medium text-slate-200">{v.name}</p>
                      {v.phone && <p className="text-xs text-slate-500">{v.phone}</p>}
                    </div>
                  </div>
                </td>
                <td className="text-slate-400 text-sm">
                  {v.resident?.unit?.block?.name}-{v.resident?.unit?.unitNumber}
                  <p className="text-xs text-slate-600">{v.resident?.user?.name}</p>
                </td>
                <td>
                  {v.vehicleNumber
                    ? <span className="font-mono text-xs text-slate-300 bg-surface-800 px-2 py-0.5 rounded">{v.vehicleNumber}</span>
                    : <span className="text-slate-700">—</span>}
                </td>
                <td><span className="badge-gray text-xs">{v.visitorType}</span></td>
                <td>{statusBadge(v.status)}</td>
                <td className="text-xs text-slate-500">
                  {v.entryTime && <p>In {new Date(v.entryTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                  {v.exitTime  && <p>Out {new Date(v.exitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
                  {!v.entryTime && <p>{new Date(v.createdAt).toLocaleDateString()}</p>}
                </td>
                <td>
                  {v.status === 'APPROVED' && v.entryCode && (
                    <span className="font-mono text-estate-300 text-sm font-bold tracking-wider">{v.entryCode}</span>
                  )}
                </td>
                {isResident && (
                  <td>
                    {v.status === 'PENDING' && (
                      <div className="flex gap-1">
                        <button className="btn-ghost text-xs text-estate-400" disabled={approvingId === v.id} onClick={() => handleApprove(v.id, 'APPROVED')}><CheckCircle size={14} /></button>
                        <button className="btn-ghost text-xs text-red-400"    disabled={approvingId === v.id} onClick={() => handleApprove(v.id, 'DENIED')}><XCircle size={14} /></button>
                      </div>
                    )}
                    {v.status === 'INSIDE' && v.exitCode && (
                      <button className="btn-ghost text-xs text-amber-400" onClick={() => setExitCodeVisitor(v)}>
                        <Key size={14} /> Exit Code
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {modal === 'preapprove'  && <PreApproveModal  onClose={() => setModal(null)} onDone={load} />}
      {modal === 'walkin'      && <WalkInModal       onClose={() => setModal(null)} onDone={load} units={units.filter(u => u.isOccupied)} />}
      {modal === 'entry-code'  && <VerifyCodeModal   mode="entry" onClose={() => setModal(null)} onDone={load} />}
      {modal === 'exit-code'   && <VerifyCodeModal   mode="exit"  onClose={() => setModal(null)} onDone={load} />}
      {exitCodeVisitor         && <ExitCodeModal     visitor={exitCodeVisitor} onClose={() => setExitCodeVisitor(null)} />}
    </div>
  );
}
