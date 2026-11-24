
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { messaging } from './firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { registerSW } from 'virtual:pwa-register';

// Tell the app when a new version is waiting; check for one on load and then every hour.
const updateSW = registerSW({
  onNeedRefresh() { window.__updateSW = updateSW; window.dispatchEvent(new Event('app-update-ready')); },
  onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000); },
});

// Earlier builds cached authenticated API responses in 'api-cache'. Delete any leftover copy.
if (typeof caches !== 'undefined') caches.delete('api-cache').catch(() => {});

async function initializeNotifications() {

  try {

    const permission = await Notification.requestPermission();

    if (permission === 'granted') {

      console.log('Notification permission granted.');

      const token = await getToken(messaging, {
       vapidKey: 'BFTPnRvBCwX-I7_oSVmWJ7rjYkSByU6VLm0UDYmnNJ19qMIE_dqgcgy3HIUQncFJHjMy_t_Q78nB_Jl5H3LwADA'
      });

      console.log('FCM TOKEN:', token);

    } else {

      console.log('Notification permission denied');

    }

  } catch (error) {

    console.error('Notification error:', error);

  }

}

initializeNotifications();

onMessage(messaging, (payload) => {

  console.log('Foreground message:', payload);

  new Notification(
    payload.notification.title,
    {
      body: payload.notification.body,
      icon: '/pwa-192x192.png'
    }
  );

});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
