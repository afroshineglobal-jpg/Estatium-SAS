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

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  const app = initFirebase();
  if (!app || !fcmToken) return null;
  try {
    const result = await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    });
    return result;
  } catch (err) {
    console.warn('Push notification failed:', err.message);
    return null;
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
