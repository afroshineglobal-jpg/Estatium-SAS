'use strict';
/**
 * Resident side of advertising: READ-ONLY. Campaigns are created and stopped by the Platform owner only
 * (modules/platform/ads.routes.js). A resident gets the campaigns whose targeting covers their estate / flat.
 */
const router = require('express').Router();
const prisma = require('../../config/prisma');
const { authenticate } = require('../../middleware/auth.middleware');
const { publicLimiter } = require('../../middleware/security');
const H = require('../../utils/http');
const T = require('../../utils/adTargeting');

router.get('/', authenticate, H.wrap(async (req, res) => {
  if (req.user.role !== 'RESIDENT') return res.json([]);          // banners are for residents only
  const now = new Date();
  const where = { status: 'ACTIVE', startDate: { lte: now }, endDate: { gte: now } };
  if (req.query.placement) where.placement = H.oneOf(req.query.placement, ['TOP', 'BOTTOM'], 'placement');
  const [campaigns, tenant, me] = await Promise.all([
    prisma.system.adCampaign.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.system.tenant.findFirst({ where: { id: req.tenant.id }, select: { id: true, country: true, state: true, district: true, city: true, area: true, locality: true, postalCode: true } }),
    prisma.resident.findFirst({ where: { userId: req.user.id, isActive: true }, select: { unitId: true } }),
  ]);
  if (!tenant) return res.json([]);
  res.json(campaigns.filter((c) => T.matches(c.targeting, tenant, me?.unitId || null))
    .map((c) => ({ id: c.id, title: c.title, content: c.content, imageUrl: c.imageUrl, linkUrl: c.linkUrl, advertiserName: c.advertiserName, placement: c.placement, pages: c.pages })).slice(0, 20));
}));

// Counters: total per campaign and per estate (so the owner can show an advertiser where it ran).
const bump = (field) => [authenticate, publicLimiter, H.wrap(async (req, res) => {
  if (req.user.role !== 'RESIDENT') return res.json({ success: true });
  const id = H.requireId(req.params.id);
  const r = await prisma.system.adCampaign.updateMany({ where: { id }, data: { [field]: { increment: 1 } } });
  if (!r.count) throw H.notFound('Advertisement');
  await prisma.system.adCampaignStat.upsert({ where: { campaignId_tenantId: { campaignId: id, tenantId: req.tenant.id } }, create: { campaignId: id, tenantId: req.tenant.id, [field]: 1 }, update: { [field]: { increment: 1 } } });
  res.json({ success: true });
})];
router.post('/:id/impression', ...bump('impressions'));
router.post('/:id/click', ...bump('clicks'));

module.exports = router;
