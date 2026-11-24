import { getToken, deleteToken, onMessage } from 'firebase/messaging';
import { messaging } from '../firebase';
import api from './api';
import { playSound } from './sounds';

const VAPID_KEY = 'BFTPnRvBCwX-I7_oSVmWJ7rjYkSByU6VLm0UDYmnNJ19qMIE_dqgcgy3HIUQncFJHjMy_t_Q78nB_Jl5H3LwADA';
const supported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

/** 'unsupported' | 'denied' | 'default' | 'granted' */
export const pushPermission = () => (supported() ? Notification.permission : 'unsupported');

/** Must be called from a tap/click (browsers refuse permission prompts that are not a response to a user action). */
export async function enablePush() {
  if (!supported()) throw new Error('This browser cannot receive push notifications. On iPhone, first add the app to the Home Screen.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in the browser or phone settings for this site.');
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('Could not register this device for notifications.');
  await api.put('/auth/fcm-token', { fcmToken: token });
  return token;
}

export async function disablePush() {
  try { await deleteToken(messaging); } catch { /* already gone */ }
  await api.put('/auth/fcm-token', { fcmToken: '' }).catch(() => {});
}

let listening = false;
/** Foreground pushes (app open and focused) and sound requests relayed by the service worker (app open in the background). */
export function listenForPushSounds() {
  if (listening || !supported()) return; listening = true;
  try { onMessage(messaging, (p) => playSound(p.data?.kind || 'MESSAGE')); } catch { /* messaging unavailable */ }
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'PLAY_SOUND') playSound(e.data.kind || 'MESSAGE'); });
}
