import api from './api';
import { playSound } from './sounds';

const supported = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

/** 'unsupported' | 'denied' | 'default' | 'granted' */
export const pushPermission = () => (supported() ? Notification.permission : 'unsupported');

const b64ToBytes = (s) => { const pad = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

/** Must be called from a tap/click (browsers refuse permission prompts that are not a response to a user action). */
export async function enablePush() {
  if (!supported()) throw new Error('This browser cannot receive push notifications. On iPhone, first add the app to the Home Screen.');
  const { enabled, publicKey } = await api.get('/push/public-key');
  if (!enabled || !publicKey) throw new Error('Push notifications are not switched on for this server yet. Ask your administrator.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in the browser or phone settings for this site.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return true;
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (sub) { await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* nothing to remove */ }
}

let listening = false;
/** The service worker asks any open window to play the matching sound when a push arrives. */
export function listenForPushSounds() {
  if (listening || !supported()) return; listening = true;
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'PLAY_SOUND') playSound(e.data.kind || 'MESSAGE'); });
}
