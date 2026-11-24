'use strict';
const prisma = require('../config/prisma');
const { sendPushNotification } = require('./firebase');

/** Which alert sound/vibration the device should use: VISITOR (doorbell), EMERGENCY (siren), everything else MESSAGE. */
const kindOf = (type) => (type === 'EMERGENCY' ? 'EMERGENCY' : type === 'VISITOR' ? 'VISITOR' : 'MESSAGE');
const forgetToken = (token) => prisma.user.updateMany({ where: { fcmToken: token }, data: { fcmToken: null } }).catch(() => {});

/** Store an in-app notification (tenant-scoped via the request context) and push it WITHOUT blocking the response. */
const notify = async (userId, title, body, type = 'GENERAL', data = {}) => {
  try {
    const row = await prisma.notification.create({ data: { userId, title, body, type, data } });
    setImmediate(async () => {            // fire-and-forget: a slow FCM call must never delay an SOS response
      try {
        const user = await prisma.user.findFirst({ where: { id: userId }, select: { fcmToken: true } });
        if (user?.fcmToken) { const r = await sendPushNotification(user.fcmToken, title, body, { ...data, kind: kindOf(type) }); if (r.invalid) await forgetToken(user.fcmToken); }
      } catch (e) { console.warn('Push failed:', e.message); }
    });
    return row;
  } catch (err) { console.warn('Notify error:', err.message); return null; }
};

const notifyMany = async (userIds, title, body, type = 'GENERAL', data = {}) => {
  if (!userIds.length) return;
  await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, title, body, type, data })) });   // one INSERT, not N
  setImmediate(async () => {
    try {
      const users = await prisma.user.findMany({ where: { id: { in: userIds }, fcmToken: { not: null } }, select: { fcmToken: true } });
      await Promise.all(users.filter((u) => u.fcmToken).map(async (u) => { const r = await sendPushNotification(u.fcmToken, title, body, { ...data, kind: kindOf(type) }); if (r.invalid) await forgetToken(u.fcmToken); }));
    } catch (e) { console.warn('Bulk push failed:', e.message); }
  });
};

const notifyByRole = async (role, title, body, type = 'GENERAL', data = {}) => {
  const users = await prisma.user.findMany({ where: { role, isActive: true }, select: { id: true } });
  await notifyMany(users.map((u) => u.id), title, body, type, data);
};

module.exports = { notify, notifyMany, notifyByRole };
