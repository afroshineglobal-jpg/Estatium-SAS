import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { getPrefs, setPrefs, playSound, unlockAudio, stopAlarm } from '../utils/sounds';
import { enablePush, disablePush, pushPermission, listenForPushSounds } from '../utils/push';

const ROWS = [['VISITOR', '🔔 Visitors', 'Doorbell "ding-dong" when a visitor is at the gate or a decision is made'], ['MESSAGE', '💬 Chat & notices', 'Two soft pops for new messages and notices']];

/** Per-device sound + notification settings, opened from the speaker icon in the top bar. */
export default function SoundSettings({ onClose }) {
  const [p, setP] = useState(getPrefs()); const [perm, setPerm] = useState(pushPermission()); const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const change = (patch) => { setPrefs(patch); setP(getPrefs()); };
  const test = (k) => { unlockAudio(); if (k === 'EMERGENCY') { playSound('EMERGENCY'); setTimeout(stopAlarm, 2500); } else playSound(k, { force: true }); };
  const turnOn = async () => { setBusy(true); try { await enablePush(); listenForPushSounds(); setPerm('granted'); toast.success('Notifications are on for this device'); } catch (e) { toast.error(e.message || 'Could not turn notifications on'); setPerm(pushPermission()); } finally { setBusy(false); } };
  const turnOff = async () => { setBusy(true); try { await disablePush(); toast.success('Notifications turned off for this device'); } finally { setBusy(false); } };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal p-6" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 px-6 py-3 flex items-center justify-between bg-surface-900 border-b border-slate-800"><h3 className="text-lg font-semibold text-slate-100">Alert sounds</h3><button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-lg leading-none">✕</button></div>
        <div className="space-y-3">
          {ROWS.map(([k, label, text]) => (
            <div key={k} className="card p-3 flex items-center gap-3">
              <div className="flex-1"><p className="text-sm text-slate-100 font-medium">{label}</p><p className="text-xs text-slate-500">{text}</p></div>
              <button className="btn-secondary text-xs" onClick={() => test(k)}>Test</button>
              <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={!!p[k]} onChange={(e) => change({ [k]: e.target.checked })} />On</label>
            </div>))}
          <div className="card p-3 flex items-center gap-3 border border-red-900/60">
            <div className="flex-1"><p className="text-sm text-slate-100 font-medium">🚨 Emergency</p><p className="text-xs text-slate-500">Loud siren that repeats until silenced. Always on, always full volume.</p></div>
            <button className="btn-secondary text-xs" onClick={() => test('EMERGENCY')}>Test</button>
          </div>
          <div><label className="label">Volume (visitors, chat & notices)</label>
            <input type="range" min="0.1" max="1" step="0.05" value={p.volume} onChange={(e) => change({ volume: Number(e.target.value) })} className="w-full" /></div>
        </div>
        <div className="card p-3 mt-4">
          <p className="text-sm text-slate-100 font-medium">Notifications when the app is closed</p>
          {perm === 'unsupported' && <p className="text-xs text-amber-300 mt-1">This browser can't show them. On iPhone, add the app to the Home Screen first (Share, then Add to Home Screen), then open it from there.</p>}
          {perm === 'denied' && <p className="text-xs text-amber-300 mt-1">Notifications are blocked for this site. Allow them in the browser or phone settings, then come back here.</p>}
          {perm === 'granted' && <p className="text-xs text-green-300 mt-1">On for this device.</p>}
          <div className="flex gap-2 mt-2">
            {perm !== 'granted' && perm !== 'unsupported' && perm !== 'denied' && <button className="btn-primary" disabled={busy} onClick={turnOn}>Turn on notifications</button>}
            {perm === 'granted' && <><button className="btn-secondary" disabled={busy} onClick={turnOn}>Re-register this device</button><button className="btn-ghost" disabled={busy} onClick={turnOff}>Turn off</button></>}
          </div>
          <p className="text-xs text-slate-500 mt-2">With the app closed, phones play their own notification sound; the app's own sounds above play while it is open. Visitors, emergencies and chat/notices vibrate differently so you can tell them apart.</p>
          {perm === 'granted' && <p className="text-xs text-amber-400/90 mt-3">To keep receiving alerts: do not "Force stop" the app, and set battery to "Unrestricted" for it (Android: Settings → Apps → Estatium → Battery). Swiping it away from recent apps is fine; on iPhone keep it added to the Home Screen.</p>}
        </div>
        <button className="btn-secondary w-full mt-4" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
