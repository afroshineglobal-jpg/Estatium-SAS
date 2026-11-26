'use strict';
/** Web Push device registration: /api/push  (any signed-in user, for their own devices only). */
const router = require('express').Router();
const crypto = require('crypto');
const prisma = require('../../config/prisma');
const { authenticate } = require('../../middleware/auth.middleware');
const H = require('../../utils/http');
const webpush = require('../../utils/webpush');

const MAX_DEVICES = 10;

router.get('/public-key', authenticate, (req, res) => res.json({ enabled: webpush.enabled(), publicKey: webpush.publicKey() }));

router.post('/subscribe', authenticate, H.wrap(async (req, res) => {
  if (!webpush.enabled()) throw H.conflict('Push notifications are not switched on for this server yet', 'PUSH_DISABLED');
  const s = req.body?.subscription || {};
  const endpoint = H.str(s.endpoint, { name: 'endpoint', required: true, max: 1000 });
  if (!/^https:\/\//.test(endpoint)) throw H.bad('endpoint must be an https URL');
  const p256dh = H.str(s.keys?.p256dh, { name: 'p256dh', required: true, max: 200 });
  const auth = H.str(s.keys?.auth, { name: 'auth', required: true, max: 100 });
  const userAgent = H.str(req.get('user-agent') || '', { max: 300 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });                         // the same device may have belonged to someone else before
  await prisma.pushSubscription.create({ data: { id: crypto.randomUUID(), userId: req.user.id, endpoint, p256dh, auth, userAgent } });
  const mine = await prisma.pushSubscription.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (mine.length > MAX_DEVICES) await prisma.pushSubscription.deleteMany({ where: { id: { in: mine.slice(MAX_DEVICES).map((m) => m.id) } } });
  res.status(201).json({ ok: true, devices: Math.min(mine.length, MAX_DEVICES) });
}));

router.post('/unsubscribe', authenticate, H.wrap(async (req, res) => {
  const endpoint = H.str(req.body?.endpoint, { name: 'endpoint', required: true, max: 1000 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
  res.json({ ok: true });
}));

module.exports = router;
