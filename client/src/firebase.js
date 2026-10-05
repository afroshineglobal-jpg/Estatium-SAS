import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyB7O8YkqcRiIF_B0WklFFev7NS5bwO5VZ4",
  authDomain: "estatium-f.firebaseapp.com",

  projectId:"estatium-f",

  storageBucket: "estatium-f.firebasestorage.app",

  messagingSenderId: "195213042841",
  appId:"1:195213042841:web:a7111feb9d942033ce8408"
};

const app = initializeApp(firebaseConfig);

export const messaging = getMessaging(app);