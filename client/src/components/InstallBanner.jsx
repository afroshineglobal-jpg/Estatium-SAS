import { useEffect, useState } from 'react';

const KEY = 'estatium_install_dismissed';
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const recentlyDismissed = () => { try { return Date.now() - Number(localStorage.getItem(KEY) || 0) < 7 * 86400000; } catch { return false; } };

/** Offers "install this app" on every screen (login, resident, gate, admin, platform console, registration page).
 *  Android/desktop: a one-tap Install button. iPhone/iPad: Safari has no button, so show the Share -> Add to Home Screen steps. */
export default function InstallBanner() {
  const [canPrompt, setCanPrompt] = useState(() => !!window.__installPrompt);
  const [hidden, setHidden] = useState(() => standalone() || recentlyDismissed());
  useEffect(() => {
    const a = () => setCanPrompt(true); const b = () => setHidden(true);
    window.addEventListener('app-installable', a); window.addEventListener('app-installed', b);
    return () => { window.removeEventListener('app-installable', a); window.removeEventListener('app-installed', b); };
  }, []);
  const ios = isIOS();
  if (hidden || (!canPrompt && !ios)) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* private mode */ } setHidden(true); };
  const install = async () => { const p = window.__installPrompt; if (!p) return; p.prompt(); try { await p.userChoice; } catch { /* ignored */ } window.__installPrompt = null; setHidden(true); };
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:max-w-sm z-[55] bg-surface-950 border border-estate-700 text-slate-100 rounded-xl shadow-xl px-4 py-3 text-sm">
      <p className="font-medium">Install Estatium on this device</p>
      {canPrompt
        ? <p className="text-xs text-slate-400 mt-0.5">Opens like an app, full screen, with quick access from your home screen.</p>
        : <p className="text-xs text-slate-400 mt-0.5">Tap the Share button in Safari, then choose <b>Add to Home Screen</b>.</p>}
      <div className="flex gap-2 mt-2 justify-end">
        <button className="btn-ghost" onClick={dismiss}>Not now</button>
        {canPrompt && <button className="btn-primary" onClick={install}>Install</button>}
      </div>
    </div>
  );
}
