'use strict';
/**
 * Standard Web Push (VAPID). No Firebase, no third-party account: we hold our own key pair.
 * Payload is JSON { title, body, kind, url, ... }; the service worker (client/public/push-sw.js) decides how to show it.
 * kind: VISITOR (doorbell, long vibration) | MESSAGE (chat/notices) | EMERGENCY (siren, stays on screen).
 */
let wp = null; let ready = null;

function init() {
  if (ready !== null) return ready;
  const pub = process.env.VAPID_PUBLIC_KEY; const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { console.warn('⚠️  VAPID keys not set. Push notifications disabled (in-app alerts still work).'); return (ready = false); }
  try {
    wp = require('web-push');
    wp.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:afroshineglobal@gmail.com', pub, priv);
    return (ready = true);
  } catch (e) { console.warn('⚠️  Web push init failed:', e.message); return (ready = false); }
}
const enabled = () => init();
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

/** @returns {{ok:boolean, gone:boolean}}  gone=true => the device unsubscribed; delete the row */
async function send(sub, payload) {
  if (!init()) return { ok: false, gone: false };
  const urgent = payload.kind === 'EMERGENCY' || payload.kind === 'VISITOR';
  try {
    await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: payload.visitorId ? 60 : urgent ? 300 : 3600, urgency: urgent ? 'high' : 'normal', timeout: 10000 });
    return { ok: true, gone: false };
  } catch (e) {
    const gone = e.statusCode === 404 || e.statusCode === 410;
    if (!gone) console.warn('Web push failed:', e.statusCode || e.message);
    return { ok: false, gone };
  }
}
/** Which alert style the device should use: VISITOR (doorbell), EMERGENCY (siren), everything else MESSAGE. */
const kindOf = (type) => (type === 'EMERGENCY' ? 'EMERGENCY' : type === 'VISITOR' ? 'VISITOR' : 'MESSAGE');

module.exports = { enabled, publicKey, send, kindOf };
