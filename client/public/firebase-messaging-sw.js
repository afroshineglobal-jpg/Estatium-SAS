importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB7O8YkqcRiIF_B0WklFFev7NS5bwO5VZ4",
  authDomain: "estatium-f.firebaseapp.com",
  projectId: "estatium-f",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "195213042841",
  appId: "1:195213042841:web:a7111feb9d942033ce8408"
});

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {

  console.log('Background Message:', payload);

  self.registration.showNotification(
    payload.notification.title,
    {
      body: payload.notification.body,
      icon: '/pwa-192x192.png',
      vibrate: [300, 100, 300],
      requireInteraction: true
    }
  );

});