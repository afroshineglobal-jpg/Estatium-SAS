'use strict';
/**
 * Tenant side of advertising: READ-ONLY. Ads are created and stopped by the Platform owner only
 * (modules/platform/ads.routes.js). Everyone signed in sees the live banner for their role; estate admins cannot add ads.
 */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate } = require('../../middleware/auth.middleware');
const { publicLimiter } = require('../../middleware/security');
const H = require('../../utils/http');

router.get('/', authenticate, H.wrap(async (req, res) => {
  if (req.user.role !== 'RESIDENT') return res.json([]);          // banners are for residents only
  const now = new Date();
  const where = { isActive: true, status: 'APPROVED', startDate: { lte: now }, endDate: { gte: now }, OR: [{ targetRole: null }, { targetRole: req.user.role }] };
  if (req.query.placement) { const p = H.oneOf(req.query.placement, ['TOP', 'BOTTOM'], 'placement'); where.placement = p === 'TOP' ? { in: ['TOP', 'HOME'] } : 'BOTTOM'; }
  res.json(await prisma.advertisement.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 }));
}));

// Counters require a logged-in user of the same estate.
const bump = (field) => [authenticate, publicLimiter, H.wrap(async (req, res) => {
  const r = await prisma.advertisement.updateMany({ where: { id: H.requireId(req.params.id) }, data: { [field]: { increment: 1 } } });
  if (!r.count) throw H.notFound('Advertisement');
  res.json({ success: true });
})];
router.post('/:id/impression', ...bump('impressions'));
router.post('/:id/click', ...bump('clicks'));

module.exports = router;
