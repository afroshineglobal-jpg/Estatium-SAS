'use strict';
const prisma = require('../config/prisma');
const webpush = require('./webpush');

const { kindOf } = webpush;
const URLS = { VISITOR: '/visitors', EMERGENCY: '/emergency', MESSAGE: '/communication' };

/** Push to every device the given users enabled notifications on. Never throws; dead devices are forgotten. */
async function pushToUsers(userIds, title, body, type, data = {}) {
  if (!webpush.enabled() || !userIds.length) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
    if (!subs.length) return;
    const kind = kindOf(type);
    const payload = { title, body, kind, url: URLS[kind], ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) };
    const gone = [];
    await Promise.all(subs.map(async (s) => { const r = await webpush.send(s, payload); if (r.gone) gone.push(s.id); }));
    if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  } catch (e) { console.warn('Push failed:', e.message); }
}

/** Store an in-app notification (tenant-scoped via the request context) and push it WITHOUT blocking the response. */
const notify = async (userId, title, body, type = 'GENERAL', data = {}) => {
  try {
    const row = await prisma.notification.create({ data: { userId, title, body, type, data } });
    setImmediate(() => pushToUsers([userId], title, body, type, data));     // fire-and-forget: a slow push service must never delay an SOS response
    return row;
  } catch (err) { console.warn('Notify error:', err.message); return null; }
};

const notifyMany = async (userIds, title, body, type = 'GENERAL', data = {}) => {
  if (!userIds.length) return;
  await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, title, body, type, data })) });   // one INSERT, not N
  setImmediate(() => pushToUsers(userIds, title, body, type, data));
};

const notifyByRole = async (role, title, body, type = 'GENERAL', data = {}) => {
  const users = await prisma.user.findMany({ where: { role, isActive: true }, select: { id: true } });
  await notifyMany(users.map((u) => u.id), title, body, type, data);
};

module.exports = { notify, notifyMany, notifyByRole, kindOf };
