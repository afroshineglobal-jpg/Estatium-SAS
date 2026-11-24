const admin = require('firebase-admin');

let firebaseApp = null;

const initFirebase = () => {
  if (firebaseApp) return firebaseApp;
  try {
    if (admin.apps.length) { firebaseApp = admin.app(); return firebaseApp; }      // never initialise twice (the legacy double init silently disabled ALL push notifications)
    if (!process.env.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID === 'your-firebase-project-id') {
      console.warn('⚠️  Firebase not configured. Push notifications disabled.');
      return null;
    }
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    console.log('✅ Firebase Admin initialized');
    return firebaseApp;
  } catch (err) {
    console.warn('⚠️  Firebase init failed:', err.message);
    return null;
  }
};

const stringify = (data) => Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));

/**
 * DATA-ONLY message: the title/body/kind travel in `data`, so the app's service worker decides how to show it
 * (a different vibration pattern and urgency for VISITOR / MESSAGE / EMERGENCY, and a sound request to any open window).
 * Returns { ok, invalid }: invalid=true means the device token is dead and should be forgotten.
 */
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  const app = initFirebase();
  if (!app || !fcmToken) return { ok: false, invalid: false };
  const urgent = data.kind === 'EMERGENCY' || data.kind === 'VISITOR';
  try {
    await admin.messaging().send({
      token: fcmToken,
      data: stringify({ ...data, title, body }),
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { 'content-available': 1 } } },
      webpush: { headers: { Urgency: urgent ? 'high' : 'normal', TTL: urgent ? '300' : '3600' } },
    });
    return { ok: true, invalid: false };
  } catch (err) {
    const invalid = /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(err.code || err.message || '');
    console.warn('Push notification failed:', err.code || err.message);
    return { ok: false, invalid };
  }
};

const sendBulkNotification = async (tokens, title, body, data = {}) => {
  if (!tokens?.length) return;
  const validTokens = tokens.filter(Boolean);
  if (!validTokens.length) return;
  const app = initFirebase();
  if (!app) return null;
  try {
    return await admin.messaging().sendEachForMulticast({
      tokens: validTokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
    });
  } catch (err) {
    console.warn('Bulk push notification failed:', err.message);
    return null;
  }
};

module.exports = { sendPushNotification, sendBulkNotification, initFirebase };
