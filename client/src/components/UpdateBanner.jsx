import { useEffect, useState } from 'react';

/** Shown when a new version of the app has been downloaded and is waiting. One tap reloads into it. */
export default function UpdateBanner() {
  const [ready, setReady] = useState(() => !!window.__updateSW);
  useEffect(() => { const on = () => setReady(true); window.addEventListener('app-update-ready', on); return () => window.removeEventListener('app-update-ready', on); }, []);
  if (!ready) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-surface-950 border border-estate-700 text-slate-100 rounded-xl shadow-xl px-4 py-3 flex items-center gap-3 text-sm">
      <span>A new version is available.</span>
      <button className="btn-primary" onClick={() => window.__updateSW?.(true)}>Update now</button>
      <button className="btn-ghost" onClick={() => setReady(false)}>Later</button>
    </div>
  );
}
