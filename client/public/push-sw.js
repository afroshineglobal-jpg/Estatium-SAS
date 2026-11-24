/* Web Push handler, loaded into the app's service worker (see vite.config.js: workbox.importScripts).
 * The server sends JSON { title, body, kind, url }. We show a system notification styled per kind and ask any open
 * Estatium window to play the matching in-app sound:
 *   VISITOR   - long "ring ring ring" vibration
 *   EMERGENCY - strongest vibration, stays on screen until tapped, re-alerts on every new SOS
 *   MESSAGE   - short double buzz
 * Phones play their own notification sound (the web offers no way to choose a custom one when the app is closed). */
const STYLE = {
  VISITOR:   { vibrate: [250, 120, 250, 120, 250, 120, 250], requireInteraction: false, tag: 'visitor' },
  EMERGENCY: { vibrate: [600, 200, 600, 200, 600, 200, 600, 200, 600], requireInteraction: true, tag: 'emergency' },
  MESSAGE:   { vibrate: [120, 80, 120], requireInteraction: false, tag: 'message' },
};

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Estatium', body: event.data ? event.data.text() : '' }; }
  const kind = STYLE[d.kind] ? d.kind : 'MESSAGE';
  const s = STYLE[kind];
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((c) => c.postMessage({ type: 'PLAY_SOUND', kind }));
    // An app window that is open and in front already shows the alert itself; otherwise show a system notification.
    if (wins.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification(d.title || 'Estatium', {
      body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', vibrate: s.vibrate,
      requireInteraction: s.requireInteraction, tag: s.tag, renotify: true, data: { url: d.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { if (c.navigate) c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
