/* Push notifications while the app is closed or in the background.
 * The server sends DATA-ONLY messages { title, body, kind } and this worker decides how to show them:
 *   VISITOR   - long vibration pattern "ring ring ring"
 *   EMERGENCY - strongest vibration, stays on screen until tapped, re-alerts on every new SOS
 *   MESSAGE   - short double buzz
 * Phones play their own notification sound (the web gives no way to choose a custom one); any open Estatium
 * window is also asked to play the matching in-app sound. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB7O8YkqcRiIF_B0WklFFev7NS5bwO5VZ4",
  authDomain: "estatium-f.firebaseapp.com",
  projectId: "estatium-f",
  storageBucket: "estatium-f.firebasestorage.app",
  messagingSenderId: "195213042841",
  appId: "1:195213042841:web:a7111feb9d942033ce8408"
});
const messaging = firebase.messaging();

const STYLE = {
  VISITOR:   { vibrate: [250, 120, 250, 120, 250, 120, 250], requireInteraction: false, tag: 'visitor',   url: '/visitors' },
  EMERGENCY: { vibrate: [600, 200, 600, 200, 600, 200, 600, 200, 600], requireInteraction: true, tag: 'emergency', url: '/emergency' },
  MESSAGE:   { vibrate: [120, 80, 120], requireInteraction: false, tag: 'message', url: '/communication' },
};

messaging.onBackgroundMessage(async (payload) => {
  const d = payload.data || {};
  const kind = STYLE[d.kind] ? d.kind : 'MESSAGE';
  const s = STYLE[kind];
  const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  open.forEach((c) => c.postMessage({ type: 'PLAY_SOUND', kind }));
  await self.registration.showNotification(d.title || 'Estatium', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', vibrate: s.vibrate, requireInteraction: s.requireInteraction,
    tag: s.tag, renotify: true, data: { url: s.url },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate && c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
