'use strict';
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate, authorize } = require('../../middleware/auth.middleware');
const { publicLimiter } = require('../../middleware/security');
const H = require('../../utils/http');

const ROLES = ['ADMIN', 'SECURITY_ADMIN', 'FINANCE_ADMIN', 'MAINTENANCE_MANAGER', 'RESIDENT', 'GUARD', 'STAFF'];
const url = (v, name) => { const s = H.str(v, { name, max: 700000 }); if (s && !/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(s)) throw H.bad(`${name} must be an http(s) URL or an image data URI`); return s; };   // blocks javascript: links

router.get('/', authenticate, H.wrap(async (req, res) => {
  const now = new Date(); let where = {};
  if (!['ADMIN', 'FINANCE_ADMIN'].includes(req.user.role)) where = { isActive: true, status: 'APPROVED', startDate: { lte: now }, endDate: { gte: now }, OR: [{ targetRole: null }, { targetRole: req.user.role }] };
  if (req.query.placement) where.placement = H.str(req.query.placement, { max: 20 });
  res.json(await prisma.advertisement.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }));
}));

router.post('/', authenticate, H.wrap(async (req, res) => {
  const b = req.body || {}; const isAdmin = ['ADMIN', 'FINANCE_ADMIN'].includes(req.user.role);
  const startDate = H.date(b.startDate, 'startDate'), endDate = H.date(b.endDate, 'endDate');
  if (endDate < startDate) throw H.bad('endDate must be after startDate');
  const ad = await prisma.advertisement.create({ data: {
    title: H.str(b.title, { name: 'title', required: true, max: 160 }), content: H.str(b.content, { max: 2000 }), imageUrl: url(b.imageUrl, 'imageUrl'), linkUrl: url(b.linkUrl, 'linkUrl'), advertiserName: H.str(b.advertiserName, { max: 120 }),
    type: b.type ? H.oneOf(b.type, ['BANNER', 'ANNOUNCEMENT', 'VENDOR'], 'type') : 'BANNER', placement: b.placement ? H.oneOf(b.placement, ['HOME', 'NOTIFICATION', 'OFFERS'], 'placement') : 'HOME',
    targetRole: b.targetRole ? H.oneOf(b.targetRole, ROLES, 'targetRole') : null, startDate, endDate, status: isAdmin ? 'APPROVED' : 'PENDING', isActive: isAdmin,
  } });
  res.status(201).json(ad);
}));

router.put('/:id/status', authenticate, authorize('ADMIN'), H.wrap(async (req, res) => {
  const status = H.oneOf(req.body?.status, ['APPROVED', 'REJECTED', 'EXPIRED'], 'status');
  res.json(await prisma.advertisement.update({ where: { id: H.requireId(req.params.id) }, data: { status, isActive: status === 'APPROVED' } }));
}));

// Counters now require a logged-in user of the same estate (they were open to the internet and cross-tenant).
const bump = (field) => [authenticate, publicLimiter, H.wrap(async (req, res) => {
  const r = await prisma.advertisement.updateMany({ where: { id: H.requireId(req.params.id) }, data: { [field]: { increment: 1 } } });
  if (!r.count) throw H.notFound('Advertisement');
  res.json({ success: true });
})];
router.post('/:id/impression', ...bump('impressions'));
router.post('/:id/click', ...bump('clicks'));

module.exports = router;
