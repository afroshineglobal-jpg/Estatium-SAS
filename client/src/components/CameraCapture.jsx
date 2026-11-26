import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';

// Live camera (front camera on phones, webcam on computers). Returns a ~640px JPEG data URL via onCapture.
// If the camera is blocked or missing, the person can still upload a photo from the device.
export default function CameraCapture({ onCapture, onClose, onFallback }) {
  const videoRef = useRef(); const streamRef = useRef(); const [err, setErr] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if (dead) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s; videoRef.current.srcObject = s; await videoRef.current.play(); setReady(true);
      } catch (e) {
        setErr(e?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or upload a photo instead.' : 'No camera could be started on this device. You can upload a photo instead.');
      }
    })();
    return () => { dead = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  const snap = () => {
    const v = videoRef.current; if (!v?.videoWidth) return;
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext('2d'); ctx.translate(c.width, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, c.width, c.height);   // un-mirror so the saved photo is the true view
    let d = ''; for (const q of [0.8, 0.65, 0.5]) { d = c.toDataURL('image/jpeg', q); if (d.length < 380 * 1024 * 1.33) break; }
    streamRef.current?.getTracks().forEach((t) => t.stop()); onCapture(d);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-surface-950 border border-slate-700 rounded-2xl p-4 w-full max-w-sm">
        <div className="flex justify-between items-center mb-3"><p className="text-white font-medium">Take your photo</p>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        {err ? <p className="text-sm text-amber-300 mb-3">{err}</p> : (
          <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
            {!ready && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">Starting camera…</p>}
          </div>)}
        <p className="text-xs text-slate-400 mt-2">Face the camera in good light, so the administrator can recognise you.</p>
        <div className="flex gap-2 mt-3">
          {!err && <button type="button" className="btn-primary flex-1 justify-center" disabled={!ready} onClick={snap}><Camera className="w-4 h-4" />Capture</button>}
          <button type="button" className="btn-secondary flex-1 justify-center" onClick={onFallback}><RefreshCw className="w-4 h-4" />Upload instead</button>
        </div>
      </div>
    </div>
  );
}
