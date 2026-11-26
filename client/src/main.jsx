
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// The platform console (/platform) installs as its own app (own name, scope and start page).
if (window.location.pathname.startsWith('/platform')) {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/platform-manifest.json');
  document.title = 'Estatium Platform';
}
// Keep the browser's "install" offer so the app can show its own Install button.
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; window.dispatchEvent(new Event('app-installable')); });
window.addEventListener('appinstalled', () => { window.__installPrompt = null; window.dispatchEvent(new Event('app-installed')); });

// Tell the app when a new version is waiting; check for one on load and then every hour.
const updateSW = registerSW({
  onNeedRefresh() { window.__updateSW = updateSW; window.dispatchEvent(new Event('app-update-ready')); },
  onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000); },
});

// Earlier builds cached authenticated API responses in 'api-cache'. Delete any leftover copy.
if (typeof caches !== 'undefined') caches.delete('api-cache').catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
